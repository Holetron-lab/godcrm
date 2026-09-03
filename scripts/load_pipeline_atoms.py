#!/usr/bin/env python3
"""Load Pipeline Constitution v2.0 atoms into table 3574 for doc 116925."""

import json
import re
import subprocess
import urllib.request

API = "https://crm.hltrn.cc/api/v3"
JWT_SECRET = "super-secret-jwt-key-change-this-in-production-abc123xyz"
ATOMS_TABLE = 3574
DOC_ID = 116925
SOURCE_FILE = "/root/production/business-crm/docs/PIPELINE.md"


def get_token():
    result = subprocess.run(
        ["node", "-e", f"const jwt=require('jsonwebtoken'); console.log(jwt.sign({{id:1,role:'admin'}}, '{JWT_SECRET}', {{expiresIn:'1h'}}))"],
        capture_output=True, text=True
    )
    return result.stdout.strip()


def api_post(path, data, token):
    url = f"{API}{path}"
    body = json.dumps({"data": data}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"  ERROR: {e}")
        return None


def parse_markdown(text):
    """Parse markdown into atoms."""
    atoms = []
    lines = text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

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

        # Paragraph
        para_lines = []
        while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith("#") \
                and not lines[i].strip().startswith("```") and not lines[i].strip().startswith(">") \
                and not re.match(r'^---+\s*$', lines[i]):
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

    with open(SOURCE_FILE, "r") as f:
        content = f.read()

    atoms = parse_markdown(content)
    print(f"Parsed {len(atoms)} atoms from PIPELINE.md")

    for idx, atom in enumerate(atoms):
        atom_data = {
            "document_id": DOC_ID,
            "type": atom["type"],
            "content": atom["content"],
            "order": idx
        }
        if atom.get("metadata"):
            atom_data["metadata"] = atom["metadata"]

        result = api_post(f"/tables/{ATOMS_TABLE}/rows", atom_data, token)
        status = "OK" if result and result.get("success") else "FAIL"
        print(f"  [{idx:2d}] {status} {atom['type']:10s} {atom['content'][:70]}...")

    print(f"\nDone! {len(atoms)} atoms created for doc {DOC_ID}")
    print(f"View at: https://crm.hltrn.cc/widgets/218")


if __name__ == "__main__":
    main()
