#!/usr/bin/env python3
"""Load PIPELINE.md into document content table 3756"""
import json, re, subprocess, sys

API = "https://crm.hltrn.cc/api/v3"
TABLE_ID = 3756

# Generate JWT
token = subprocess.check_output([
    "node", "-e",
    "const jwt=require('jsonwebtoken');"
    "console.log(jwt.sign({userId:1,role:'admin'},"
    "'super-secret-jwt-key-change-this-in-production-abc123xyz',{expiresIn:'1h'}))"
], cwd="/root/production/business-crm").decode().strip()

HEADERS = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Parse PIPELINE.md into document items
with open("/root/production/business-crm/docs/PIPELINE.md") as f:
    lines = f.readlines()

items = []
order = 10
i = 0
while i < len(lines):
    line = lines[i].rstrip()

    # Skip empty lines
    if not line.strip():
        i += 1
        continue

    # Headings
    m = re.match(r'^(#{1,3})\s+(.+)', line)
    if m:
        level_num = len(m.group(1))
        level = f"h{level_num}"
        items.append({"order": order, "level": level, "content_en": m.group(2), "type": "reference", "is_collapsed": False})
        order += 10
        i += 1
        continue

    # Code blocks
    if line.strip().startswith('```'):
        lang = line.strip()[3:]
        code_lines = []
        i += 1
        while i < len(lines) and not lines[i].strip().startswith('```'):
            code_lines.append(lines[i].rstrip())
            i += 1
        i += 1  # skip closing ```
        content = '\n'.join(code_lines)
        if lang:
            content = f"```{lang}\n{content}\n```"
        else:
            content = f"```\n{content}\n```"
        items.append({"order": order, "level": "code", "content_en": content, "type": "reference", "is_collapsed": False})
        order += 10
        continue

    # Tables (lines starting with |)
    if line.strip().startswith('|'):
        table_lines = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            table_lines.append(lines[i].rstrip())
            i += 1
        content = '\n'.join(table_lines)
        items.append({"order": order, "level": "table", "content_en": content, "type": "reference", "is_collapsed": False})
        order += 10
        continue

    # Blockquotes
    if line.strip().startswith('>'):
        quote_lines = []
        while i < len(lines) and lines[i].strip().startswith('>'):
            quote_lines.append(lines[i].strip().lstrip('> '))
            i += 1
        content = '\n'.join(quote_lines)
        items.append({"order": order, "level": "quote", "content_en": content, "type": "reference", "is_collapsed": False})
        order += 10
        continue

    # Dividers
    if re.match(r'^---+$', line.strip()):
        items.append({"order": order, "level": "divider", "content_en": "---", "type": "reference", "is_collapsed": False})
        order += 10
        i += 1
        continue

    # Lists (collect consecutive list items)
    if re.match(r'^[\s]*[-*\d+.]\s', line):
        list_lines = []
        while i < len(lines) and (re.match(r'^[\s]*[-*\d+.]\s', lines[i]) or (lines[i].strip() and lines[i].startswith('  '))):
            list_lines.append(lines[i].rstrip())
            i += 1
        content = '\n'.join(list_lines)
        items.append({"order": order, "level": "list", "content_en": content, "type": "reference", "is_collapsed": False})
        order += 10
        continue

    # Regular text paragraphs
    para_lines = []
    while i < len(lines) and lines[i].strip() and not lines[i].strip().startswith('#') and not lines[i].strip().startswith('```') and not lines[i].strip().startswith('|') and not lines[i].strip().startswith('>') and not re.match(r'^---+$', lines[i].strip()):
        para_lines.append(lines[i].rstrip())
        i += 1
    if para_lines:
        content = '\n'.join(para_lines)
        items.append({"order": order, "level": "text", "content_en": content, "type": "reference", "is_collapsed": False})
        order += 10

print(f"Parsed {len(items)} items from PIPELINE.md")

# Load items via API
import urllib.request

ok = 0
fail = 0
for idx, item in enumerate(items):
    data = json.dumps({"data": item}).encode()
    req = urllib.request.Request(f"{API}/tables/{TABLE_ID}/rows", data=data, headers=HEADERS, method="POST")
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        if result.get("success"):
            ok += 1
            lvl = item["level"]
            txt = item["content_en"][:60].replace('\n', ' ')
            print(f"  [{idx:2d}] OK {lvl:8s} {txt}...")
        else:
            fail += 1
            print(f"  [{idx:2d}] FAIL: {result.get('error', {}).get('message', '?')}")
    except Exception as e:
        fail += 1
        err_body = ""
        if hasattr(e, 'read'):
            err_body = e.read().decode()[:200]
        print(f"  [{idx:2d}] ERROR: {e} {err_body}")

print(f"\nDone: {ok} OK, {fail} FAIL out of {len(items)} items")
