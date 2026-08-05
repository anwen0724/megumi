/*
 * Protects image signatures, declared media types, and document references.
 */
import { describe, expect, it } from "vitest";
import {
  createInputProcessor,
  type InputPolicy,
  type InputSourceAccess,
} from "@megumi/input";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function access(bytes: Uint8Array, documentPath = "C:\\workspace\\notes.md"): InputSourceAccess {
  return {
    async readImage() {
      return bytes;
    },
    async resolveDocument() {
      return { path: documentPath, sizeBytes: 1 };
    },
  };
}

describe("Input attachment policy", () => {
  it("detects image bytes instead of trusting the declared MIME type", async () => {
    const processor = createInputProcessor({ sourceAccess: access(new Uint8Array([1, 2, 3])) });
    const result = await processor.process({
      input: {
        text: "",
        attachments: [{
          draftAttachmentId: "image-1",
          type: "image",
          declaredMimeType: "image/png",
          source: { type: "host_file_reference", referenceId: "ref" },
        }],
      },
      context: { workspaceId: "workspace-1" },
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "image_format_unsupported" },
    });
  });

  it("validates documents by the resolved canonical path", async () => {
    const processor = createInputProcessor({ sourceAccess: access(new Uint8Array(), "C:\\workspace\\notes.exe") });
    const result = await processor.process({
      input: {
        text: "",
        attachments: [{
          draftAttachmentId: "document-1",
          type: "file",
          source: { type: "host_file_reference", referenceId: "ref" },
        }],
      },
      context: { workspaceId: "workspace-1" },
    });
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "document_format_unsupported" },
    });
  });

  it.each([
    {
      label: "image count",
      policy: policy({ maxImageCount: 1 }),
      attachments: [image("image-1"), image("image-2")],
      failureCode: "image_count_exceeded",
    },
    {
      label: "document count",
      policy: policy({}, { maxDocumentCount: 1 }),
      attachments: [document("document-1"), document("document-2")],
      failureCode: "document_count_exceeded",
    },
  ])("enforces the $label limit before source access", async ({ policy, attachments, failureCode }) => {
    let sourceWasRead = false;
    const processor = createInputProcessor({
      sourceAccess: {
        async readImage() { sourceWasRead = true; return PNG; },
        async resolveDocument() { sourceWasRead = true; return { path: "C:\\workspace\\notes.md", sizeBytes: 1 }; },
      },
      policy,
    });

    await expect(processor.process({
      input: { text: "", attachments },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ status: "failed", failure: { code: failureCode } });
    expect(sourceWasRead).toBe(false);
  });

  it("enforces per-image, total-image, and document-size limits", async () => {
    const oversizedImage = createInputProcessor({
      sourceAccess: access(PNG),
      policy: policy({ maxImageBytes: PNG.byteLength - 1 }),
    });
    await expect(oversizedImage.process({
      input: { text: "", attachments: [image("image-1")] },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ status: "failed", failure: { code: "image_too_large" } });

    const excessiveTotal = createInputProcessor({
      sourceAccess: access(PNG),
      // The total budget stays >= the per-image budget; two images still exceed it.
      policy: policy({ maxTotalBytes: PNG.byteLength + 2 }),
    });
    await expect(excessiveTotal.process({
      input: { text: "", attachments: [image("image-1"), image("image-2")] },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({
      status: "failed",
      failure: { code: "image_total_size_exceeded" },
    });

    const oversizedDocument = createInputProcessor({
      sourceAccess: {
        ...access(PNG),
        async resolveDocument() { return { path: "C:\\workspace\\notes.md", sizeBytes: 2 }; },
      },
      policy: policy({}, { maxDocumentBytes: 1 }),
    });
    await expect(oversizedDocument.process({
      input: { text: "", attachments: [document("document-1")] },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ status: "failed", failure: { code: "document_too_large" } });
  });

  it("rejects declared image and document media types that disagree with canonical content", async () => {
    const processor = createInputProcessor({ sourceAccess: access(PNG) });
    await expect(processor.process({
      input: {
        text: "",
        attachments: [{ ...image("image-1"), declaredMimeType: "image/jpeg" }],
      },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ status: "failed", failure: { code: "image_mime_mismatch" } });
    await expect(processor.process({
      input: {
        text: "",
        attachments: [{ ...document("document-1"), declaredMimeType: "application/pdf" }],
      },
      context: { workspaceId: "workspace-1" },
    })).resolves.toMatchObject({ status: "failed", failure: { code: "document_mime_mismatch" } });
  });
});

function image(draftAttachmentId: string) {
  return {
    draftAttachmentId,
    type: "image" as const,
    source: { type: "host_file_reference" as const, referenceId: `${draftAttachmentId}-ref` },
  };
}

function document(draftAttachmentId: string) {
  return {
    draftAttachmentId,
    type: "file" as const,
    source: { type: "host_file_reference" as const, referenceId: `${draftAttachmentId}-ref` },
  };
}

function policy(
  imageOverrides: Partial<InputPolicy["image"]> = {},
  documentOverrides: Partial<InputPolicy["document"]> = {},
): InputPolicy {
  return {
    maxTextCharacters: 200_000,
    image: {
      allowedMediaTypes: ["image/png", "image/jpeg", "image/webp"],
      maxImageCount: 5,
      maxImageBytes: 10,
      maxTotalBytes: 20,
      ...imageOverrides,
    },
    document: {
      allowedMediaTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
      ],
      maxDocumentCount: 10,
      maxDocumentBytes: 50,
      ...documentOverrides,
    },
  };
}
