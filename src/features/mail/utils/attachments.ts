// ADR-158 §P4 — turn picked `File`s into the base64 payload the send endpoint
// carries inline (backend/services/mail/attachments.js validates + caps them).
import type { MailAttachment } from '../types';

/** Read one File as raw base64 (no `data:` prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      // FileReader.readAsDataURL yields `data:<type>;base64,<payload>` — strip the head.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** Encode all picked files for the send body, in the order the user added them. */
export async function filesToAttachments(files: File[]): Promise<MailAttachment[]> {
  return Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      content: await fileToBase64(file),
    }))
  );
}
