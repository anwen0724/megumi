/*
 * Fetches public HTTP(S) documents through an SSRF-resistant network adapter.
 * Redirects and DNS answers are revalidated before any connection is opened.
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, requireString } from './input';
import type { BuiltInToolContext } from './types';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_CONTENT_BYTES = 9_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export type WebFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  contentType: string;
  content: string;
  truncated: boolean;
};

export interface WebFetchService {
  fetch(request: { url: string; signal?: AbortSignal }): Promise<WebFetchResult>;
}

export async function executeWebFetch(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  if (!context.webFetchService) throw new Error('web_fetch is unavailable.');
  const requestedUrl = requireString(inputRecord(input), 'url').trim();
  const result = await context.webFetchService.fetch({ url: requestedUrl, signal });
  return {
    outputKind: 'json',
    content: result,
    metadata: { requestedUrl: result.requestedUrl, finalUrl: result.finalUrl, truncated: result.truncated },
  };
}

export function createWebFetchService(input: { timeoutMs?: number } = {}): WebFetchService {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async fetch(request) {
      const initial = parsePublicUrl(request.url);
      const response = await fetchPublicUrl(initial, request.signal, timeoutMs, 0);
      const extracted = extractContent(response.body, response.contentType);
      const truncated = truncateUtf8(extracted.content, MAX_CONTENT_BYTES);
      return {
        requestedUrl: initial.toString(),
        finalUrl: response.finalUrl.toString(),
        ...(extracted.title ? { title: extracted.title } : {}),
        contentType: response.contentType,
        content: truncated.content,
        truncated: response.bodyTruncated || truncated.truncated,
      };
    },
  };
}

async function fetchPublicUrl(
  url: URL,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  redirectCount: number,
): Promise<{ finalUrl: URL; contentType: string; body: Buffer; bodyTruncated: boolean }> {
  if (redirectCount > MAX_REDIRECTS) throw new Error('web_fetch exceeded the redirect limit.');
  const address = await resolvePublicAddress(url.hostname);
  const response = await requestAddress(url, address, signal, timeoutMs);
  if (isRedirect(response.statusCode) && response.location) {
    const redirected = parsePublicUrl(new URL(response.location, url).toString());
    return fetchPublicUrl(redirected, signal, timeoutMs, redirectCount + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`web_fetch request failed with status ${response.statusCode}.`);
  }
  const contentType = normalizeContentType(response.contentType);
  if (!isSupportedContentType(contentType)) throw new Error(`web_fetch does not support content type ${contentType}.`);
  return { finalUrl: url, contentType, body: response.body, bodyTruncated: response.truncated };
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
    throw new Error('web_fetch blocked a local address.');
  }
  const literalFamily = net.isIP(hostname);
  const addressSource = literalFamily ? 'literal' as const : 'hostname' as const;
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isAllowedResolvedAddress(entry.address, addressSource))) {
    throw new Error('web_fetch blocked a private or non-public address.');
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

function requestAddress(
  url: URL,
  resolved: { address: string; family: 4 | 6 },
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ statusCode: number; location?: string; contentType?: string; body: Buffer; truncated: boolean }> {
  if (signal?.aborted) return Promise.reject(new Error('web_fetch was cancelled.'));
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET',
      headers: { accept: 'text/html, text/plain, application/json;q=0.9', 'user-agent': 'Megumi/0.1 web_fetch' },
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) {
          callback(null, [{ address: resolved.address, family: resolved.family }]);
          return;
        }
        callback(null, resolved.address, resolved.family);
      },
    }, async (response) => {
      try {
        const statusCode = response.statusCode ?? 0;
        const location = firstHeader(response.headers.location);
        if (isRedirect(statusCode) && location) {
          response.resume();
          resolve({ statusCode, location, body: Buffer.alloc(0), truncated: false });
          return;
        }
        const stream = decodedStream(response, firstHeader(response.headers['content-encoding']));
        const collected = await collectLimited(stream, MAX_RESPONSE_BYTES, signal);
        resolve({
          statusCode,
          ...(firstHeader(response.headers['content-type']) ? { contentType: firstHeader(response.headers['content-type']) } : {}),
          body: collected.body,
          truncated: collected.truncated,
        });
      } catch (error) {
        reject(error);
      }
    });
    const timer = setTimeout(() => request.destroy(new Error(`web_fetch timed out after ${timeoutMs}ms.`)), timeoutMs);
    const cancel = () => request.destroy(new Error('web_fetch was cancelled.'));
    signal?.addEventListener('abort', cancel, { once: true });
    request.once('error', reject);
    request.once('close', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    });
    request.end();
  });
}

function decodedStream(response: http.IncomingMessage, encoding: string | undefined): Readable {
  if (encoding === 'gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return response;
}

async function collectLimited(
  stream: Readable,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error('web_fetch was cancelled.');
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxBytes - size;
    if (buffer.length > remaining) {
      if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      truncated = true;
      stream.destroy();
      break;
    }
    chunks.push(buffer);
    size += buffer.length;
  }
  return { body: Buffer.concat(chunks), truncated };
}

function extractContent(body: Buffer, contentType: string): { title?: string; content: string } {
  const text = body.toString('utf8');
  if (contentType !== 'text/html') return { content: text.trim() };
  const titleMatch = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? htmlText(titleMatch[1]) : undefined;
  const content = htmlText(text
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, '\n'));
  return { ...(title ? { title } : {}), content };
}

function htmlText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parsePublicUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('web_fetch requires a valid URL.'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('web_fetch only accepts HTTP(S) URLs without embedded credentials.');
  }
  return url;
}

export function isPublicIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || (a === 203 && b === 0));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPublicIp(normalized.slice(7));
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith('2001:db8:');
  }
  return false;
}

export function isAllowedResolvedAddress(
  address: string,
  source: 'literal' | 'hostname',
): boolean {
  if (isPublicIp(address)) return true;
  // Clash-compatible TUN resolvers commonly synthesize hostname answers from
  // 198.18.0.0/15. A literal URL using that reserved range remains blocked.
  return source === 'hostname' && isProxySyntheticIpv4(address);
}

function isProxySyntheticIpv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return first === 198 && (second === 18 || second === 19);
}

function truncateUtf8(content: string, maxBytes: number): { content: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8');
  return buffer.length <= maxBytes
    ? { content, truncated: false }
    : { content: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}

function normalizeContentType(value: string | undefined): string {
  return (value ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

function isSupportedContentType(value: string): boolean {
  return value === 'text/html' || value === 'text/plain' || value === 'application/json'
    || value.endsWith('+json') || value === 'application/xml' || value === 'text/xml';
}

function isRedirect(status: number): boolean { return [301, 302, 303, 307, 308].includes(status); }
function firstHeader(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
