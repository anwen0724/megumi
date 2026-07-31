/*
 * Defines the provider-neutral model failure contract and its safe normalization.
 * Provider payloads and exception text never cross this public boundary.
 */
import { ModelsError } from "./auth/resolve.ts";
import type { AssistantMessage, ModelFailure, ModelFailureCode } from "./types.ts";

const FAILURE_MESSAGES: Readonly<Record<ModelFailureCode, string>> = {
	aborted: "Model call was aborted.",
	authentication_failed: "Model authentication failed.",
	invalid_request: "The model request was invalid.",
	rate_limited: "The model provider rate limit was reached.",
	provider_unavailable: "The model provider is unavailable.",
	transport_failed: "The model provider connection failed.",
	provider_failed: "The model provider failed to complete the request.",
	unknown: "Model call failed.",
};

export interface CreateModelFailureOptions {
	code: ModelFailureCode;
	retryable: boolean;
	retryAfterMs?: number;
}

export interface ClassifyModelFailureOptions {
	reason: "error" | "aborted";
	/** An already-classified failure from a trusted provider adapter. */
	failure?: ModelFailure;
	/** The thrown value is inspected only for authoritative structured metadata. */
	error?: unknown;
}

export function createModelFailure(options: CreateModelFailureOptions): ModelFailure {
	const retryAfterMs = normalizeRetryAfterMs(options.retryAfterMs);
	return {
		code: options.code,
		message: FAILURE_MESSAGES[options.code],
		retryable: options.code === "aborted" ? false : options.retryable,
		...(retryAfterMs === undefined ? {} : { retryAfterMs }),
	};
}

/**
 * Typed adapter error for failures backed by authoritative provider metadata.
 * The original provider error may remain as `cause`, but is never copied into
 * the public failure message.
 */
export class ModelFailureError extends Error {
	readonly failure: ModelFailure;

	constructor(options: CreateModelFailureOptions, cause?: unknown) {
		const failure = createModelFailure(options);
		super(failure.message, cause === undefined ? undefined : { cause });
		this.name = "ModelFailureError";
		this.failure = failure;
	}
}

/**
 * Produces the only failure shape consumed above the AI boundary.
 *
 * Unknown thrown values deliberately remain non-retryable. Classification uses
 * typed Megumi failures, numeric HTTP status and headers, or explicitly
 * whitelisted transport codes; provider text and response bodies are ignored.
 */
export function classifyModelFailure(options: ClassifyModelFailureOptions): ModelFailure {
	if (options.reason === "aborted") {
		return createModelFailure({ code: "aborted", retryable: false });
	}
	if (options.failure) {
		return createModelFailure(options.failure);
	}
	if (options.error instanceof ModelFailureError) {
		return createModelFailure(options.error.failure);
	}
	if (options.error instanceof ModelsError) {
		return createModelFailure({
			code: mapModelsErrorCode(options.error.code),
			retryable: false,
		});
	}
	if (isStructuredAbort(options.error)) {
		return createModelFailure({ code: "aborted", retryable: false });
	}
	const status = readHttpStatus(options.error);
	if (status !== undefined) {
		return classifyHttpStatus(status, readRetryAfterMs(options.error));
	}
	if (isTransportFailure(options.error)) {
		return createModelFailure({ code: "transport_failed", retryable: true });
	}
	return createModelFailure({ code: "unknown", retryable: false });
}

export function getModelFailure(
	message: Pick<AssistantMessage, "stopReason" | "failure">,
): ModelFailure {
	return classifyModelFailure({
		reason: message.stopReason === "aborted" ? "aborted" : "error",
		failure: message.failure,
	});
}

export function withSafeModelFailure(
	message: AssistantMessage,
	failure = getModelFailure(message),
): AssistantMessage {
	return {
		...message,
		diagnostics: message.diagnostics?.map((diagnostic) => ({
			type: diagnostic.type,
			timestamp: diagnostic.timestamp,
			...(diagnostic.error
				? {
						error: {
							name: diagnostic.error.name,
							message: failure.message,
							code: diagnostic.error.code,
						},
				  }
				: {}),
		})),
		failure,
		errorMessage: failure.message,
	};
}

function mapModelsErrorCode(code: ModelsError["code"]): ModelFailureCode {
	switch (code) {
		case "auth":
		case "oauth":
			return "authentication_failed";
		case "model_validation":
			return "invalid_request";
		case "provider":
		case "model_source":
		case "stream":
			return "provider_failed";
	}
}

function classifyHttpStatus(status: number, retryAfterMs: number | undefined): ModelFailure {
	if (status === 401 || status === 403) {
		return createModelFailure({ code: "authentication_failed", retryable: false });
	}
	if (status === 400 || status === 404 || status === 422) {
		return createModelFailure({ code: "invalid_request", retryable: false });
	}
	if (status === 429) {
		return createModelFailure({ code: "rate_limited", retryable: true, retryAfterMs });
	}
	if (status === 408 || status === 409 || status === 425 || (status >= 500 && status <= 599)) {
		return createModelFailure({ code: "provider_unavailable", retryable: true, retryAfterMs });
	}
	return createModelFailure({ code: "unknown", retryable: false });
}

function readHttpStatus(error: unknown): number | undefined {
	for (const candidate of structuredErrorChain(error)) {
		const status = readInteger(candidate, "status") ?? readInteger(candidate, "statusCode");
		if (status !== undefined && status >= 100 && status <= 599) return status;
		const response = readRecord(candidate, "response");
		const responseStatus = response ? readInteger(response, "status") : undefined;
		if (responseStatus !== undefined && responseStatus >= 100 && responseStatus <= 599) {
			return responseStatus;
		}
	}
	return undefined;
}

function readRetryAfterMs(error: unknown): number | undefined {
	for (const candidate of structuredErrorChain(error)) {
		const own = retryAfterFromHeaders(readValue(candidate, "headers"));
		if (own !== undefined) return own;
		const response = readRecord(candidate, "response");
		const nested = response ? retryAfterFromHeaders(readValue(response, "headers")) : undefined;
		if (nested !== undefined) return nested;
	}
	return undefined;
}

function retryAfterFromHeaders(headers: unknown): number | undefined {
	const value = readHeader(headers, "retry-after");
	if (value === undefined) return undefined;
	const seconds = typeof value === "number" ? value : Number(value.trim());
	if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1_000);
	if (typeof value !== "string") return undefined;
	const retryAt = Date.parse(value);
	if (!Number.isFinite(retryAt)) return undefined;
	return Math.max(0, retryAt - Date.now());
}

function readHeader(headers: unknown, name: string): string | number | undefined {
	if (!isRecord(headers)) return undefined;
	const get = headers.get;
	if (typeof get === "function") {
		try {
			const value = get.call(headers, name);
			if (typeof value === "string" || typeof value === "number") return value;
		} catch {
			return undefined;
		}
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name && (typeof value === "string" || typeof value === "number")) {
			return value;
		}
	}
	return undefined;
}

const TRANSPORT_ERROR_CODES = new Set([
	"ECONNABORTED",
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETDOWN",
	"ENETUNREACH",
	"ENOTFOUND",
	"ETIMEDOUT",
	"EAI_AGAIN",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_SOCKET",
]);

function isTransportFailure(error: unknown): boolean {
	return structuredErrorChain(error).some((candidate) => {
		const code = readValue(candidate, "code");
		return typeof code === "string" && TRANSPORT_ERROR_CODES.has(code.toUpperCase());
	});
}

function isStructuredAbort(error: unknown): boolean {
	return structuredErrorChain(error).some((candidate) => {
		const name = readValue(candidate, "name");
		const code = readValue(candidate, "code");
		return name === "AbortError" || code === "ABORT_ERR";
	});
}

function structuredErrorChain(error: unknown): Record<string, unknown>[] {
	if (!isRecord(error)) return [];
	const chain = [error];
	const cause = readRecord(error, "cause");
	if (cause && cause !== error) chain.push(cause);
	return chain;
}

function readInteger(value: Record<string, unknown>, key: string): number | undefined {
	const candidate = readValue(value, key);
	return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : undefined;
}

function readRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
	const candidate = readValue(value, key);
	return isRecord(candidate) ? candidate : undefined;
}

function readValue(value: Record<string, unknown>, key: string): unknown {
	try {
		return value[key];
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeRetryAfterMs(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
	return Math.floor(value);
}
