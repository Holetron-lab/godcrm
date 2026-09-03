#!/usr/bin/env python3
"""Load Pipeline Constitution v2.0 into widget 218 (table 2197 + atoms 3574)."""

import json
import re
import subprocess
import urllib.request

API = "https://crm.hltrn.cc/api/v3"
JWT_SECRET = "super-secret-jwt-key-change-this-in-production-abc123xyz"
DOC_TABLE = 2197
ATOMS_TABLE = 3574
SOURCE_FILE = "/root/production/business-crm/docs/PIPELINE.md"


def get_token():
    result = subprocess.run(
        ["node", "-e", f"const jwt=require('jsonwebtoken'); console.log(jwt.sign({{id:1,role:'admin'}}, '{JWT_SECRET}', {{expiresIn:'1h'}}))"],
        capture_output=True, text=True
    )
    return result.stdout.strip()


def api_call(method, path, data=None, token=None):
    url = f"{API}{path}"
    body = json.dumps({"data": data}).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def parse_markdown(text):
    """Parse markdown into atoms (heading, paragraph, code, table, quote)."""
    atoms = []
    lines = text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

        # Empty line — skip
        if not line.strip():
            i += 1
            continue

        # Heading
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            level = len(m.group(1))
            atoms.append({"type": "heading", "content": m.group(2).strip(), "metadata": {"level": level}})
            i += 1
            continue

        # Blockquote
        if line.strip().startswith(">"):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(re.sub(r'^>\s?', '', lines[i]))
                i += 1
            atoms.append({"type": "quote", "content": "\n".join(quote_lines)})
            continue

        # Code block
        if line.strip().startswith("```"):
            lang = line.strip().replace("```", "").strip()
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            meta = {"language": lang} if lang else {}
            atoms.append({"type": "code", "content": "\n".join(code_lines), "metadata": meta})
            continue

        # Table
        if "|" in line and i + 1 < len(lines) and re.match(r'^[\s|:-]+$', lines[i + 1]):
            table_lines = []
            while i < len(lines) and "|" in lines[i]:
                table_lines.append(lines[i])
                i += 1
            atoms.append({"type": "table", "content": "\n".join(table_lines)})
            continue

        # Horizontal rule
        if re.match(r'^---+\s*$', line):
            atoms.append({"type": "divider", "content": "---"})
            i += 1
            continue

        # Italic/footer line
        if line.strip().startswith("*") and line.strip().endswith("*"):
            atoms.append({"type": "paragraph", "content": line.strip()})
            i += 1
            continue

        # Paragraph (collect consecutive non-empty lines)
        para_lines = []
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith("#") \
                and not lines[i].strip().startswith("```") and not lines[i].strip().startswith(">") \
                and not re.match(r'^---+\s*$', lines[i]):
            # Check if next line starts a table
            if "|" in lines[i] and i + 1 < len(lines) and re.match(r'^[\s|:-]+$', lines[i + 1]):
                break
            para_lines.append(lines[i])
            i += 1
        if para_lines:
            atoms.append({"type": "paragraph", "content": "\n".join(para_lines)})
        continue

    return atoms


def main():
    token = get_token()

    # Read source file
    with open(SOURCE_FILE, "r") as f:
        content = f.read()

    # Check if document already exists
    resp = api_call("GET", f"/tables/{DOC_TABLE}/rows?limit=100", token=token)
    rows = resp.get("data", {}).get("rows", [])
    existing = None
    for r in rows:
        name = r.get("data", {}).get("name", "")
        if "Pipeline" in name and "Constitution" in name:
            existing = r
            break

    if existing:
        doc_id = existing["id"]
        print(f"Document already exists: ID {doc_id}, updating...")
        api_call("PUT", f"/tables/{DOC_TABLE}/rows/{doc_id}", {
            "name": "Pipeline Constitution v2.0",
            "slug": "pipeline-constitution",
            "icon": "⚖️",
            "category": "DevOps",
            "status": "ready",
            "description": "Закон пайплайна. v2.0 — DB switching, gates, два режима DEV (2026-04-10)"
        }, token=token)
        print("Document row updated.")

        # Delete existing atoms for this document
        atoms_resp = api_call("GET", f"/tables/{ATOMS_TABLE}/rows?limit=500&filters=" +
                              json.dumps([{"column": "document_id", "operator": "eq", "value": doc_id}]),
                              token=token)
        old_atoms = atoms_resp.get("data", {}).get("rows", [])
        for a in old_atoms:
            api_call("DELETE", f"/tables/{ATOMS_TABLE}/rows/{a['id']}", token=token)
        print(f"Deleted {len(old_atoms)} old atoms.")
    else:
        # Create document row
        resp = api_call("POST", f"/tables/{DOC_TABLE}/rows", {
            "name": "Pipeline Constitution v2.0",
            "slug": "pipeline-constitution",
            "icon": "⚖️",
            "category": "DevOps",
            "status": "ready",
            "description": "Закон пайплайна. v2.0 — DB switching, gates, два режима DEV (2026-04-10)"
        }, token=token)
        doc_id = resp.get("data", {}).get("id") or resp.get("row", {}).get("id") or resp.get("id")
        print(f"Created document row: ID {doc_id}")

    # Parse markdown into atoms
    atoms = parse_markdown(content)
    print(f"Parsed {len(atoms)} atoms from PIPELINE.md")

    # Create atoms
    for idx, atom in enumerate(atoms):
        atom_data = {
            "document_id": doc_id,
            "type": atom["type"],
            "content": atom["content"],
            "order": idx
        }
        if atom.get("metadata"):
            atom_data["metadata"] = atom["metadata"]

        api_call("POST", f"/tables/{ATOMS_TABLE}/rows", atom_data, token=token)
        print(f"  [{idx}] {atom['type']}: {atom['content'][:60]}...")

    print(f"\nDone! Document ID: {doc_id}, {len(atoms)} atoms created.")
    print(f"View at: https://crm.hltrn.cc/widgets/218")


if __name__ == "__main__":
    main()
