/*
 * Extracts searchable text from supported local documents for the existing
 * file tools. It does not cache content, so each call observes the source file.
 */
import path from 'node:path';
import * as mammoth from 'mammoth';
import { PDFParse, PasswordException } from 'pdf-parse';
import type { WorkspaceFileAccess } from './types';

export type ExtractedFileText = {
  path: string;
  content: string;
  sizeBytes: number;
};

export async function extractFileText(
  fileAccess: WorkspaceFileAccess,
  targetPath: string,
): Promise<ExtractedFileText> {
  const extension = path.extname(targetPath).toLowerCase();
  if (extension === '.pdf') return extractPdfText(fileAccess, targetPath);
  if (extension === '.docx') return extractDocxText(fileAccess, targetPath);
  if (extension === '.txt' || extension === '.md' || extension === '.markdown' || !extension) {
    return fileAccess.readFile({ path: targetPath });
  }
  return fileAccess.readFile({ path: targetPath });
}

async function extractDocxText(
  fileAccess: WorkspaceFileAccess,
  targetPath: string,
): Promise<ExtractedFileText> {
  if (!fileAccess.readBinaryFile) throw new Error('Binary file reading is unavailable.');
  const source = await fileAccess.readBinaryFile({ path: targetPath });
  let result: Awaited<ReturnType<typeof mammoth.extractRawText>>;
  try {
    result = await mammoth.extractRawText({ buffer: Buffer.from(source.bytes) });
  } catch (error) {
    throw new Error(`DOCX could not be parsed: ${errorMessage(error)}`);
  }
  const content = result.value.trim();
  if (!content) throw new Error('DOCX does not contain extractable text.');
  return {
    path: source.path,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  };
}

async function extractPdfText(
  fileAccess: WorkspaceFileAccess,
  targetPath: string,
): Promise<ExtractedFileText> {
  if (!fileAccess.readBinaryFile) throw new Error('Binary file reading is unavailable.');
  const source = await fileAccess.readBinaryFile({ path: targetPath });
  const parser = new PDFParse({ data: Buffer.from(source.bytes) });
  try {
    const result = await parser.getText();
    const content = result.pages
      .map((page) => `[Page ${page.num}]\n${page.text.trim()}`)
      .join('\n\n')
      .trim();
    const extractedText = result.pages.map((page) => page.text).join('').trim();
    if (!extractedText) {
      throw new Error('PDF does not contain extractable text. Scanned documents require OCR.');
    }
    return {
      path: source.path,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
  } catch (error) {
    if (error instanceof PasswordException) {
      throw new Error('PDF is password-protected and cannot be read without a password.');
    }
    if (error instanceof Error && error.message.includes('does not contain extractable text')) {
      throw error;
    }
    throw new Error(`PDF could not be parsed: ${errorMessage(error)}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
