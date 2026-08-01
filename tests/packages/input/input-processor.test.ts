/*
 * Protects the single Input processing path and attachment-order semantics.
 */
import { describe, expect, it, vi } from "vitest";
import { createCommands, createInputCommandHandler } from "@megumi/commands";
import {
  createInputProcessor,
  type InputCommandHandler,
  type InputSourceAccess,
  type RawUserInput,
} from "@megumi/input";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sourceAccess(overrides: Partial<InputSourceAccess> = {}): InputSourceAccess {
  return {
    async readImage() {
      return PNG;
    },
    async resolveDocument() {
      return { path: "C:\\workspace\\notes.md", sizeBytes: 12 };
    },
    ...overrides,
  };
}

function context() {
  return { workspaceId: "workspace-1" };
}

describe("InputProcessor", () => {
  it("normalizes text and rejects only a truly empty submission", async () => {
    const processor = createInputProcessor({ sourceAccess: sourceAccess() });
    await expect(processor.process({
      input: { text: "  first\r\nsecond  " },
      context: context(),
    })).resolves.toMatchObject({
      status: "accepted",
      input: { text: "first\nsecond", attachments: [] },
    });
    await expect(processor.process({ input: { text: " \r\n " }, context: context() }))
      .resolves.toMatchObject({ status: "failed", failure: { code: "input_empty" } });
  });

  it("accepts attachment-only input and preserves mixed attachment order", async () => {
    const access = sourceAccess({
      readImage: vi.fn(async () => PNG),
      resolveDocument: vi.fn(async () => ({ path: "C:\\workspace\\notes.md", sizeBytes: 12 })),
    });
    const processor = createInputProcessor({ sourceAccess: access });
    const input: RawUserInput = {
      text: "",
      attachments: [
        {
          draftAttachmentId: "doc-1",
          type: "file",
          name: "notes.md",
          source: { type: "host_file_reference", referenceId: "ref-doc" },
        },
        {
          draftAttachmentId: "image-1",
          type: "image",
          name: "screen.png",
          source: { type: "host_file_reference", referenceId: "ref-image" },
        },
      ],
    };
    const result = await processor.process({ input, context: context() });
    expect(result).toMatchObject({
      status: "accepted",
      input: {
        attachments: [
          { draftAttachmentId: "doc-1", type: "file" },
          { draftAttachmentId: "image-1", type: "image" },
        ],
      },
    });
  });

  it("fails the whole submission when an attachment identity is duplicated", async () => {
    const processor = createInputProcessor({ sourceAccess: sourceAccess() });
    const result = await processor.process({
      input: {
        text: "hello",
        attachments: [
          {
            draftAttachmentId: "same",
            type: "image",
            source: { type: "host_file_reference", referenceId: "one" },
          },
          {
            draftAttachmentId: "same",
            type: "file",
            source: { type: "host_file_reference", referenceId: "two" },
          },
        ],
      },
      context: context(),
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "attachment_identity_conflict" },
    });
  });

  it.each(["", "   ", "\t\r\n"])(
    "rejects an empty attachment identity %j before source access",
    async (draftAttachmentId) => {
      const access = sourceAccess({ readImage: vi.fn(async () => PNG) });
      const processor = createInputProcessor({ sourceAccess: access });

      await expect(processor.process({
        input: {
          text: "hello",
          attachments: [{
            draftAttachmentId,
            type: "image",
            source: { type: "host_file_reference", referenceId: "image-ref" },
          }],
        },
        context: context(),
      })).resolves.toMatchObject({
        status: "failed",
        failure: { code: "attachment_identity_conflict" },
      });
      expect(access.readImage).not.toHaveBeenCalled();
    },
  );

  it("routes complete UserInput through Commands without rejecting attachments", async () => {
    const handle = vi.fn<InputCommandHandler<string>["handle"]>(async () => ({
      status: "command_result",
      result: "handled",
    }));
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      commandHandler: { handle },
    });
    const result = await processor.process({
      input: {
        text: "/review feedback",
        attachments: [{
          draftAttachmentId: "image-1",
          type: "image",
          source: { type: "host_file_reference", referenceId: "image-ref" },
        }],
      },
      context: context(),
    });
    expect(result).toEqual({ status: "command_result", result: "handled" });
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ text: "/review feedback", attachments: [expect.objectContaining({ draftAttachmentId: "image-1" })] }),
      context(),
      undefined,
    );
  });

  it("preserves an explicit Skill selection when /review forwards attachments to the Agent", async () => {
    const selectedSkill = {
      type: "skill" as const,
      name: "review",
      skillPath: "C:\\workspace\\.megumi\\skills\\review\\SKILL.md",
    };
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      commandHandler: createInputCommandHandler(createCommands()),
    });

    await expect(processor.process({
      input: {
        text: "/review feedback",
        attachments: [{
          draftAttachmentId: "document-1",
          type: "file",
          name: "notes.md",
          source: { type: "host_file_reference", referenceId: "document-ref" },
        }],
      },
      context: { ...context(), selectedSkill },
    })).resolves.toMatchObject({
      status: "accepted",
      input: {
        text: "/review feedback",
        attachments: [expect.objectContaining({ draftAttachmentId: "document-1", type: "file" })],
      },
      requestedSkill: selectedSkill,
    });
  });

  it("returns a distinct cancellation failure before and during source access", async () => {
    const preAborted = new AbortController();
    preAborted.abort();
    const processor = createInputProcessor({ sourceAccess: sourceAccess() });
    await expect(processor.process(
      { input: { text: "hello" }, context: context() },
      { signal: preAborted.signal },
    )).resolves.toMatchObject({ status: "failed", failure: { code: "input_cancelled" } });

    const during = new AbortController();
    const pending = createInputProcessor({
      sourceAccess: sourceAccess({
        async readImage(_source, options) {
          await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
          throw new DOMException("aborted", "AbortError");
        },
      }),
    }).process({
      input: {
        text: "",
        attachments: [{
          draftAttachmentId: "image-1",
          type: "image",
          source: { type: "host_file_reference", referenceId: "ref" },
        }],
      },
      context: context(),
    }, { signal: during.signal });
    during.abort();
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      failure: { code: "input_cancelled" },
    });
  });
});
