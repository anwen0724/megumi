/*
 * Protects the single Input processing path, interpretation ordering and
 * explicit Skill expansion semantics.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createInputProcessor,
  DOCUMENT_INPUT_POLICY,
  IMAGE_INPUT_POLICY,
  InputInterpretationError,
  type InputInterpreter,
  type InputSourceAccess,
  type RawUserInput,
  type UserInput,
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

function acceptedText(text: string): UserInput {
  return {
    displayContent: [{ type: "text", text }],
    modelContent: [{ type: "text", text }],
    attachments: [],
  };
}

describe("InputProcessor", () => {
  it("normalizes text and rejects only a truly empty submission", async () => {
    const processor = createInputProcessor({ sourceAccess: sourceAccess() });
    await expect(processor.process({
      input: { text: "  first\r\nsecond  " },
      context: context(),
    })).resolves.toMatchObject({
      status: "accepted",
      input: acceptedText("first\nsecond"),
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
        displayContent: [],
        modelContent: [],
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

  it("lets an interpreter complete the submission without creating a Run", async () => {
    const interpreter: InputInterpreter<string> = {
      async interpret() {
        return { status: "completed", result: "handled" };
      },
    };
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      interpreters: [interpreter],
    });
    const result = await processor.process({
      input: { text: "/compact", attachments: [] },
      context: context(),
    });
    expect(result).toEqual({ status: "completed", result: "handled" });
  });

  it("stops at the first interpreter that consumes the input", async () => {
    const first: InputInterpreter<string> = {
      async interpret() {
        return { status: "accepted", input: acceptedText("adjusted") };
      },
    };
    const second = vi.fn<InputInterpreter<string>["interpret"]>(async () => ({ status: "unhandled" }));
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      interpreters: [first, { interpret: second }],
    });
    const result = await processor.process({
      input: { text: "hello", attachments: [] },
      context: context(),
    });
    expect(result).toMatchObject({ status: "accepted", input: acceptedText("adjusted") });
    expect(second).not.toHaveBeenCalled();
  });

  it("maps interpreter failures and cancellation to stable Input Failures", async () => {
    const failing: InputInterpreter<string> = {
      async interpret() {
        throw new InputInterpretationError({
          code: "input_interpretation_failed",
          message: "Command failed.",
        });
      },
    };
    const processor = createInputProcessor({ sourceAccess: sourceAccess(), interpreters: [failing] });
    await expect(processor.process({
      input: { text: "/boom", attachments: [] },
      context: context(),
    })).resolves.toMatchObject({
      status: "failed",
      failure: { code: "input_interpretation_failed" },
    });

    const cancelling: InputInterpreter<string> = {
      async interpret() {
        throw new InputInterpretationError({ code: "input_cancelled", message: "Cancelled." });
      },
    };
    const cancelledProcessor = createInputProcessor({ sourceAccess: sourceAccess(), interpreters: [cancelling] });
    await expect(cancelledProcessor.process({
      input: { text: "/stop", attachments: [] },
      context: context(),
    })).resolves.toMatchObject({
      status: "failed",
      failure: { code: "input_cancelled" },
    });
  });

  it("expands an explicit Skill selection once into modelContent only", async () => {
    const selectedSkill = {
      type: "skill" as const,
      name: "review",
      skillPath: "C:\\workspace\\.megumi\\skills\\review\\SKILL.md",
    };
    const resolveSelection = vi.fn(async () => ({
      status: "ok" as const,
      content: {
        name: "review",
        skillPath: "C:\\workspace\\.megumi\\skills\\review\\SKILL.md",
        packagePath: "C:\\workspace\\.megumi\\skills\\review",
        content: "Review the changed files.",
      },
    }));
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      skillSelectionResolver: { resolveSelection },
    });

    const result = await processor.process({
      input: { text: "请检查代码", skillSelection: selectedSkill },
      context: context(),
    });
    expect(result).toMatchObject({ status: "accepted" });
    if (result.status !== "accepted") return;
    expect(result.input.displayContent).toEqual([{ type: "text", text: "请检查代码" }]);
    expect(result.input.skillSelection).toEqual(selectedSkill);
    // The Skill block precedes the task text and appears exactly once.
    const modelText = result.input.modelContent.map((block) => block.text).join("");
    expect(modelText).toContain('<skill name="review" location="C:\\workspace\\.megumi\\skills\\review\\SKILL.md">');
    expect(modelText).toContain("References are relative to C:\\workspace\\.megumi\\skills\\review.");
    expect(modelText).toContain("Review the changed files.");
    expect(modelText.endsWith("请检查代码")).toBe(true);
    expect(result.input.modelContent.filter((block) => block.text.includes("<skill "))).toHaveLength(1);
    expect(resolveSelection).toHaveBeenCalledWith(
      { skillSelection: selectedSkill, workspaceId: "workspace-1" },
      {},
    );
  });

  it("fails when an explicit Skill selection cannot be resolved", async () => {
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      skillSelectionResolver: {
        async resolveSelection() {
          return { status: "failed", failure: { code: "skill_not_found", skillPath: "C:/missing/SKILL.md" } };
        },
      },
    });
    await expect(processor.process({
      input: {
        text: "task",
        skillSelection: { type: "skill", name: "gone", skillPath: "C:/missing/SKILL.md" },
      },
      context: context(),
    })).resolves.toMatchObject({
      status: "failed",
      failure: { code: "skill_selection_failed", details: { skillPath: "C:/missing/SKILL.md" } },
    });
  });

  it("fails when a Skill selection exists but no resolver is configured", async () => {
    const processor = createInputProcessor({ sourceAccess: sourceAccess() });
    await expect(processor.process({
      input: {
        text: "task",
        skillSelection: { type: "skill", name: "review", skillPath: "C:/skills/review/SKILL.md" },
      },
      context: context(),
    })).resolves.toMatchObject({
      status: "failed",
      failure: { code: "skill_selection_failed" },
    });
  });

  it("rejects text beyond the configured limit with a stable failure code", async () => {
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      policy: { maxTextCharacters: 4, image: IMAGE_INPUT_POLICY, document: DOCUMENT_INPUT_POLICY },
    });
    await expect(processor.process({
      input: { text: "12345" },
      context: context(),
    })).resolves.toMatchObject({
      status: "failed",
      failure: { code: "text_length_exceeded" },
    });
  });

  it("fails fast on an invalid Policy before any input is processed", () => {
    expect(() => createInputProcessor({
      sourceAccess: sourceAccess(),
      policy: { maxTextCharacters: 0, image: IMAGE_INPUT_POLICY, document: DOCUMENT_INPUT_POLICY },
    })).toThrow(/Input Policy is invalid/);
  });

  it("does not expand a Skill when an interpreter already completed the input", async () => {
    const resolveSelection = vi.fn(async () => ({ status: "ok" as const, content: { name: "x", skillPath: "C:/x/SKILL.md", packagePath: "C:/x", content: "body" } }));
    const interpreter: InputInterpreter<string> = {
      async interpret() {
        return { status: "completed", result: "done" };
      },
    };
    const processor = createInputProcessor({
      sourceAccess: sourceAccess(),
      interpreters: [interpreter],
      skillSelectionResolver: { resolveSelection },
    });
    const result = await processor.process({
      input: {
        text: "task",
        skillSelection: { type: "skill", name: "x", skillPath: "C:/x/SKILL.md" },
      },
      context: context(),
    });
    expect(result).toEqual({ status: "completed", result: "done" });
    expect(resolveSelection).not.toHaveBeenCalled();
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

export type { UserInput };
