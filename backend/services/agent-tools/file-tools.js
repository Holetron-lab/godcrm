/**
 * File System Tool Handlers
 *
 * Handles: read_file, write_file, list_directory, search_files, edit_file
 * Also exports shared FS security utilities used by other modules.
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { aiLogger } from '../../utils/logger.js';

// === FILE SYSTEM SECURITY ===
export const PROJECT_ROOT = process.cwd();
export const FS_MAX_READ_SIZE = 100 * 1024; // 100KB
export const FS_MAX_SEARCH_MATCHES = 50;
export const FS_MAX_SEARCH_FILES = 500;
export const FS_MAX_DIR_DEPTH = 2;

export const BLOCKED_DIRS = ['node_modules', '.git', 'backups'];
export const SENSITIVE_PATTERNS = [/^\.env/, /\.key$/, /\.pem$/, /id_rsa/];

/**
 * Validate and resolve a file path for FS operations.
 * Returns the absolute path or throws an error.
 */
export function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required');
  }

  // Resolve relative to project root
  const resolved = path.resolve(PROJECT_ROOT, filePath);

  // Must be within project root
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    throw new Error('Access denied: path is outside the project root');
  }

  // Block parent traversal (even if resolve already handled it, be explicit)
  if (filePath.includes('..')) {
    throw new Error('Access denied: path traversal (..) is not allowed');
  }

  // Block restricted directories
  const relative = path.relative(PROJECT_ROOT, resolved);
  const parts = relative.split(path.sep);
  for (const dir of BLOCKED_DIRS) {
    if (parts.includes(dir)) {
      throw new Error(`Access denied: "${dir}" directory is restricted`);
    }
  }

  // Block sensitive files
  const basename = path.basename(resolved);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(basename)) {
      throw new Error(`Access denied: "${basename}" is a sensitive file`);
    }
  }

  return resolved;
}

/**
 * Create an auto-backup before writing/editing a file.
 */
export async function autoBackup(absolutePath) {
  try {
    await fs.access(absolutePath);
    const ts = Date.now();
    const backupPath = `${absolutePath}.bak-agent-${ts}`;
    await fs.copyFile(absolutePath, backupPath);
    aiLogger.debug({ backupPath }, 'FS auto-backup created');
    return backupPath;
  } catch {
    // File doesn't exist yet, no backup needed
    return null;
  }
}

/**
 * File system tool handlers
 */
export const fileToolHandlers = {
  async read_file({ path: filePath, line_start, line_end }) {
    try {
      const abs = validateFilePath(filePath);
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return { error: 'Not a file' };
      if (stat.size > FS_MAX_READ_SIZE) {
        // Read truncated
        const handle = await fs.open(abs, 'r');
        const buf = Buffer.alloc(FS_MAX_READ_SIZE);
        await handle.read(buf, 0, FS_MAX_READ_SIZE, 0);
        await handle.close();
        let content = buf.toString('utf-8');
        if (line_start || line_end) {
          const lines = content.split('\n');
          const start = Math.max(1, line_start || 1) - 1;
          const end = line_end ? Math.min(line_end, lines.length) : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return { success: true, path: filePath, content, truncated: true, size: stat.size };
      }
      let content = await fs.readFile(abs, 'utf-8');
      if (line_start || line_end) {
        const lines = content.split('\n');
        const start = Math.max(1, line_start || 1) - 1;
        const end = line_end ? Math.min(line_end, lines.length) : lines.length;
        content = lines.slice(start, end).join('\n');
      }
      return { success: true, path: filePath, content, size: stat.size, lines: content.split('\n').length };
    } catch (err) {
      return { error: err.message };
    }
  },

  async write_file({ path: filePath, content }) {
    try {
      const abs = validateFilePath(filePath);
      const backupPath = await autoBackup(abs);
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
      const stat = await fs.stat(abs);
      aiLogger.info({ path: filePath, size: stat.size, backup: backupPath }, 'write_file executed');
      return {
        success: true,
        path: filePath,
        size: stat.size,
        backup: backupPath ? path.relative(PROJECT_ROOT, backupPath) : null,
        message: `File written (${stat.size} bytes)${backupPath ? ', backup created' : ''}`
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async list_directory({ path: dirPath = '.', depth = 1, pattern }) {
    try {
      const abs = validateFilePath(dirPath);
      const effectiveDepth = Math.min(depth, FS_MAX_DIR_DEPTH);
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) return { error: 'Not a directory' };

      async function listRecursive(dir, currentDepth) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results = [];
        for (const entry of entries) {
          // Skip blocked directories
          if (BLOCKED_DIRS.includes(entry.name)) continue;
          // Skip hidden files at root level
          if (entry.name.startsWith('.') && currentDepth === 0) continue;

          const relPath = path.relative(PROJECT_ROOT, path.join(dir, entry.name));
          const isDir = entry.isDirectory();

          // Apply pattern filter (simple extension match)
          if (pattern && !isDir) {
            const ext = pattern.replace('*', '');
            if (!entry.name.endsWith(ext)) continue;
          }

          const item = { name: entry.name, path: relPath, type: isDir ? 'directory' : 'file' };
          if (!isDir) {
            try {
              const s = await fs.stat(path.join(dir, entry.name));
              item.size = s.size;
            } catch { /* skip */ }
          }
          results.push(item);

          if (isDir && currentDepth < effectiveDepth - 1) {
            try {
              item.children = await listRecursive(path.join(dir, entry.name), currentDepth + 1);
            } catch { /* skip unreadable dirs */ }
          }
        }
        return results;
      }

      const entries = await listRecursive(abs, 0);
      return { success: true, path: dirPath, depth: effectiveDepth, entries, count: entries.length };
    } catch (err) {
      return { error: err.message };
    }
  },

  async search_files({ query, path: searchPath = '.', file_pattern, case_sensitive = false }) {
    try {
      const abs = validateFilePath(searchPath);
      const stat = await fs.stat(abs);
      if (!stat.isDirectory()) return { error: 'Search path must be a directory' };

      const flags = case_sensitive ? 'g' : 'gi';
      let regex;
      try {
        regex = new RegExp(query, flags);
      } catch {
        // Fall back to literal match
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, flags);
      }

      const matches = [];
      let filesScanned = 0;

      async function scanDir(dir) {
        if (filesScanned >= FS_MAX_SEARCH_FILES || matches.length >= FS_MAX_SEARCH_MATCHES) return;
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch { return; }

        for (const entry of entries) {
          if (filesScanned >= FS_MAX_SEARCH_FILES || matches.length >= FS_MAX_SEARCH_MATCHES) return;
          if (BLOCKED_DIRS.includes(entry.name)) continue;
          if (entry.name.startsWith('.')) continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            // Apply file pattern filter
            if (file_pattern) {
              const ext = file_pattern.replace('*', '');
              if (!entry.name.endsWith(ext)) continue;
            }
            // Skip binary/large files
            try {
              const s = await fs.stat(fullPath);
              if (s.size > FS_MAX_READ_SIZE) continue;
            } catch { continue; }

            filesScanned++;
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= FS_MAX_SEARCH_MATCHES) break;
                if (regex.test(lines[i])) {
                  matches.push({
                    file: path.relative(PROJECT_ROOT, fullPath),
                    line: i + 1,
                    content: lines[i].trim().substring(0, 200)
                  });
                }
                // Reset regex lastIndex for global flag
                regex.lastIndex = 0;
              }
            } catch { /* skip unreadable files */ }
          }
        }
      }

      await scanDir(abs);
      return {
        success: true,
        query,
        matches_count: matches.length,
        files_scanned: filesScanned,
        matches,
        ...(matches.length >= FS_MAX_SEARCH_MATCHES ? { truncated: true, message: `Results limited to ${FS_MAX_SEARCH_MATCHES} matches` } : {})
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  async edit_file({ path: filePath, old_text, new_text, replace_all = false }) {
    try {
      const abs = validateFilePath(filePath);
      const content = await fs.readFile(abs, 'utf-8');

      if (!content.includes(old_text)) {
        return { error: 'old_text not found in file. Make sure it matches exactly (including whitespace).' };
      }

      // Check uniqueness when not using replace_all
      if (!replace_all) {
        const count = content.split(old_text).length - 1;
        if (count > 1) {
          return { error: `old_text found ${count} times. Use replace_all: true or provide more unique text.` };
        }
      }

      const backupPath = await autoBackup(abs);
      let newContent;
      if (replace_all) {
        newContent = content.split(old_text).join(new_text);
      } else {
        const idx = content.indexOf(old_text);
        newContent = content.substring(0, idx) + new_text + content.substring(idx + old_text.length);
      }

      await fs.writeFile(abs, newContent, 'utf-8');
      const replacements = replace_all ? content.split(old_text).length - 1 : 1;
      aiLogger.info({ path: filePath, replacements, backup: backupPath }, 'edit_file executed');
      return {
        success: true,
        path: filePath,
        replacements,
        backup: backupPath ? path.relative(PROJECT_ROOT, backupPath) : null,
        message: `${replacements} replacement(s) made${backupPath ? ', backup created' : ''}`
      };
    } catch (err) {
      return { error: err.message };
    }
  },

  // === ADR-144 P0: Upload file from local path or URL ===
  // T-138802: project_id is now optional. files.project_id is nullable post
  // migration 053; system uploads (avatars, agent generations) genuinely
  // have no owning project. Visibility defaults to 'internal' per ADR-0016 P5.
  async upload_file({ source, space_id, project_id, folder = 'mcp', description = '', visibility = 'internal' }, userId) {
    const { dbRun, sqlNow } = await import('../../database/connection.js');

    const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
    const targetDir = path.join(UPLOAD_BASE_PATH, folder);
    await fs.mkdir(targetDir, { recursive: true });

    let fileName, filePath, fileSize, mimeType;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // Download from URL
      const response = await fetch(source);
      if (!response.ok) return { error: `Failed to download: ${response.status}` };

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      mimeType = contentType.split(';')[0];

      // Extract filename from URL or content-disposition
      const urlPath = new URL(source).pathname;
      fileName = path.basename(urlPath) || `download_${Date.now()}`;

      const buffer = Buffer.from(await response.arrayBuffer());
      fileSize = buffer.length;

      const uniqueName = `${Date.now()}_${fileName}`;
      filePath = path.join(targetDir, uniqueName);
      await fs.writeFile(filePath, buffer);
      fileName = uniqueName;
    } else {
      // Local file
      const abs = path.resolve(source);
      try {
        const stat = await fs.stat(abs);
        fileSize = stat.size;
      } catch {
        return { error: `File not found: ${source}` };
      }

      const { default: mime } = await import('mime-types').catch(() => ({ default: { lookup: () => 'application/octet-stream' } }));
      mimeType = (typeof mime.lookup === 'function' ? mime.lookup(abs) : null) || 'application/octet-stream';

      fileName = `${Date.now()}_${path.basename(abs)}`;
      filePath = path.join(targetDir, fileName);
      await fs.copyFile(abs, filePath);
    }

    const relativePath = `${folder}/${fileName}`;
    const fileUrl = `/uploads/${relativePath}`;
    const fileId = `file_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

    // ADR-0016 §Phase 5: agent-uploaded files (chat tool calls,
    // image-generators, fetch tools) need to render inline in chat for any
    // logged-in user. Default visibility 'internal' since these are orphan
    // files (column_id null) and would otherwise fall through to private.
    // T-138802: project_id passed through (nullable) so callers can scope
    // when relevant; defaults null for system/agent uploads.
    const VALID = ['private', 'internal', 'public'];
    const safeVisibility = VALID.includes(visibility) ? visibility : 'internal';
    await dbRun(`
      INSERT INTO files (id, name, original_name, mime_type, size, path, url, storage_provider_id, space_id, project_id, uploaded_by, description, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [fileId, fileName, path.basename(source), mimeType, fileSize, filePath, fileUrl, space_id || null, project_id || null, userId || 1, description, safeVisibility]);

    return {
      success: true,
      file_id: fileId,
      url: fileUrl,
      size: fileSize,
      mime_type: mimeType,
      message: `File uploaded: ${fileUrl}`
    };
  }
};
