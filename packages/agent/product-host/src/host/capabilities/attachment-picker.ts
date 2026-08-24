/* Defines the host-provided attachment selection capability used by Product. */
import type { SelectedDocumentDto, SelectedImageDto } from '../session-host';

export interface AttachmentPicker {
  selectImages(): Promise<
    | { readonly status: 'selected'; readonly images: SelectedImageDto[] }
    | { readonly status: 'cancelled' }
  >;
  readClipboardImage(): Promise<
    | { readonly status: 'selected'; readonly images: SelectedImageDto[] }
    | { readonly status: 'cancelled' }
  >;
  selectDocuments(): Promise<
    | { readonly status: 'selected'; readonly documents: SelectedDocumentDto[] }
    | { readonly status: 'cancelled' }
  >;
}
