/**
 * Recognize only one complete, literal document write. This is deliberately
 * not a shell parser: every unrecognized form keeps the original deny scan.
 * Quoted heredocs do not expand substitutions; cat only copies their bytes.
 * DB policies still inspect the original command via buildSubjects.
 */
export function literalDocumentCommand(command) {
  const lines = command.split('\n');
  // Literal ASCII pathname, optionally quoted; no shell operators or expansion.
  const path = `(?:[./A-Za-z0-9_-]+\\.(?:md|txt)|'[./A-Za-z0-9_-]+\\.(?:md|txt)'|"[./A-Za-z0-9_-]+\\.(?:md|txt)")`;
  const outputFirst = new RegExp(`^(?:/bin/|/usr/bin/)?cat[ \\t]+>>?[ \\t]*${path}[ \\t]+<<[ \\t]*(['"])([A-Za-z_][A-Za-z0-9_]*)\\1[ \\t]*$`);
  const inputFirst = new RegExp(`^(?:/bin/|/usr/bin/)?cat[ \\t]+<<[ \\t]*(['"])([A-Za-z_][A-Za-z0-9_]*)\\1[ \\t]+>>?[ \\t]*${path}[ \\t]*$`);
  const header = lines[0];
  const match = outputFirst.exec(header) || inputFirst.exec(header);
  if (!match) return command;
  // Only the FIRST terminator closes stdin. Never hide subsequent commands.
  const end = lines.indexOf(match[2], 1);
  if (end < 1 || lines.slice(end + 1).some((line) => !/^[ \t]*$/.test(line))) return command;
  return header;
}
