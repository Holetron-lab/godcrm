import express from 'express';
import path from 'node:path';

// Accepting arbitrary attachments must not turn /uploads into same-origin code.
// Only passive preview formats render inline; the rest download as opaque bytes.
export default express.static(process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads', {
  setHeaders(res, filePath) {
    const inline = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|ico|mp4|m4v|mov|webm|ogv|mp3|m4a|wav|ogg|oga|opus|flac|aac|pdf|txt|csv|md|json)$/i.test(filePath);
    res.attachment(path.basename(filePath));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (inline) {
      res.setHeader('Content-Disposition', res.getHeader('Content-Disposition').replace(/^attachment/, 'inline'));
      res.removeHeader('X-Frame-Options');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    }
  }
});
