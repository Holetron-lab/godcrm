#!/usr/bin/env python3
"""
Batch upload ADR files to GOD CRM Documents module.

Scans directories for ADR-*.md files and uploads them to the
Architecture & ADR project (ID: 138) in the Development space.

Skips ADRs that already exist in CRM (matched by slug).

Usage:
    python3 scripts/upload-adrs.py                         # Upload from all known directories
    python3 scripts/upload-adrs.py --dir /path/to/adrs     # Upload from specific directory
    python3 scripts/upload-adrs.py --dry-run               # Preview without uploading
    python3 scripts/upload-adrs.py --list                  # List existing ADR documents in CRM
    python3 scripts/upload-adrs.py --file ADR-110.md       # Upload single file
    python3 scripts/upload-adrs.py --missing               # Show only missing ADRs

Environment variables:
    CRM_URL          - CRM base URL (default: http://localhost:5001)
    CRM_JWT_SECRET   - JWT secret (reads from .env if not set)
    CRM_USER_ID      - User ID for auth (default: 2)
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
import hashlib
import hmac
import base64
import time
from pathlib import Path


# =============================================================================
# Configuration
# =============================================================================

CRM_URL = os.environ.get("CRM_URL", "http://localhost:5001")
PROJECT_ID = 138          # Architecture & ADR project
REGISTRY_TABLE_ID = 2197  # _registry table for project 138
FOLDER_PATH = "databases/documents/"

# Default ADR directories to scan
ADR_DIRS = [
    Path("/root/docs/architecture"),
    Path("/root/workspace/business-crm/docs/architecture"),
    Path("/root/workspace/business-crm/docs/adr"),
]

# JWT configuration
JWT_SECRET = os.environ.get("CRM_JWT_SECRET", "")
CRM_USER_ID = int(os.environ.get("CRM_USER_ID", "2"))
CRM_USER_EMAIL = os.environ.get("CRM_USER_EMAIL", "gera69lvl@gmail.com")


# =============================================================================
# JWT Token Generation (no external deps)
# =============================================================================

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_jwt(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(
        secret.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def get_jwt_token() -> str:
    global JWT_SECRET
    if not JWT_SECRET:
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("JWT_SECRET="):
                    JWT_SECRET = line.split("=", 1)[1].strip()
                    break
    if not JWT_SECRET:
        print("ERROR: JWT_SECRET not found. Set CRM_JWT_SECRET env var or add to .env")
        sys.exit(1)

    now = int(time.time())
    payload = {
        "id": CRM_USER_ID,
        "email": CRM_USER_EMAIL,
        "role": "admin",
        "iat": now,
        "exp": now + 86400,
    }
    return generate_jwt(payload, JWT_SECRET)


# =============================================================================
# CRM API Client
# =============================================================================

class CrmApi:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(self, method: str, path: str, data: dict = None) -> dict:
        url = f"{self.base_url}{path}"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Cookie": f"access_token={self.token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else ""
            print(f"  HTTP {e.code}: {error_body[:500]}")
            raise
        except urllib.error.URLError as e:
            print(f"  Connection error: {e.reason}")
            raise

    def get(self, path: str) -> dict:
        return self._request("GET", path)

    def post(self, path: str, data: dict) -> dict:
        return self._request("POST", path, data)

    @staticmethod
    def _unwrap(result: dict) -> dict:
        if result.get("success") and "data" in result:
            return result["data"]
        return result

    def create_document(self, name: str, slug: str, description: str = "",
                        icon: str = "📋", category: str = "ADR") -> dict:
        payload = {
            "name": name,
            "description": description,
            "icon": icon,
            "slug": slug,
            "category": category,
            "folder_path": FOLDER_PATH,
        }
        result = self._unwrap(self.post(f"/api/v3/projects/{PROJECT_ID}/documents", payload))
        return result

    def import_sections(self, document_id: int, sections: list) -> dict:
        result = self._unwrap(self.post(
            f"/api/v3/documents/{document_id}/import-v4",
            {
                "registry_table_id": REGISTRY_TABLE_ID,
                "sections": sections,
            },
        ))
        return result

    def list_documents(self) -> list:
        result = self._unwrap(self.get(
            f"/api/v3/projects/{PROJECT_ID}/documents?folder_path={FOLDER_PATH}"
        ))
        docs = result.get("documents", []) if isinstance(result, dict) else result
        return docs if isinstance(docs, list) else []


# =============================================================================
# Markdown Parser (ADR-specific)
# =============================================================================

def parse_adr_metadata(text: str) -> dict:
    """Extract ADR metadata from markdown text."""
    meta = {
        "number": "",
        "title": "",
        "status": "",
        "description": "",
    }

    lines = text.split("\n")

    # Extract title from first H1
    for line in lines:
        m = re.match(r"^#\s+(.+)$", line)
        if m:
            title = m.group(1).strip()
            meta["title"] = title
            # Extract ADR number
            num_match = re.match(r"ADR[- ]?(\d+)", title, re.IGNORECASE)
            if num_match:
                meta["number"] = num_match.group(1).zfill(3)
            break

    # Extract status
    for line in lines:
        status_match = re.match(r"\*\*(?:Status|Статус)\s*[:]*\s*\**\s*(.+?)[\s*]*$", line, re.IGNORECASE)
        if status_match:
            meta["status"] = status_match.group(1).strip().strip("*").strip()
            break
        # Also check for "## Status" section
        if re.match(r"^##\s+(?:Status|Статус)", line, re.IGNORECASE):
            # Next non-empty line might have status
            idx = lines.index(line) + 1
            while idx < len(lines):
                next_line = lines[idx].strip()
                if next_line:
                    # Extract status keyword
                    s_match = re.match(r"\*\*(\w+)\*\*", next_line)
                    if s_match:
                        meta["status"] = s_match.group(1)
                    else:
                        meta["status"] = next_line.split("|")[0].strip().strip("*").strip()
                    break
                idx += 1
            break

    # Extract description (first non-heading, non-empty paragraph)
    in_first_para = False
    desc_lines = []
    for i, line in enumerate(lines):
        if line.startswith("#"):
            if in_first_para:
                break
            continue
        stripped = line.strip()
        if not stripped:
            if in_first_para:
                break
            continue
        if stripped.startswith("**Status") or stripped.startswith("**Статус"):
            continue
        in_first_para = True
        desc_lines.append(stripped)

    meta["description"] = " ".join(desc_lines)[:300]

    return meta


def parse_markdown_sections(text: str) -> list:
    """
    Parse markdown into sections for CRM import.
    Keeps it simple: headings become h1/h2/h3, everything else is text.
    """
    sections = []
    lines = text.split("\n")
    i = 0
    current_text_lines = []

    def flush_text():
        nonlocal current_text_lines
        if current_text_lines:
            content = "\n".join(current_text_lines).strip()
            if content:
                sections.append({
                    "level": "text",
                    "content_en": content,
                })
            current_text_lines = []

    while i < len(lines):
        line = lines[i]

        # Headings
        h_match = re.match(r"^(#{1,3})\s+(.+)$", line)
        if h_match:
            flush_text()
            level = f"h{len(h_match.group(1))}"
            title = h_match.group(2).strip()
            sections.append({
                "level": level,
                "title": title,
                "content_en": title,
            })
            i += 1
            continue

        # Code blocks — preserve as single text block
        code_match = re.match(r"^```(\w*)(.*)$", line)
        if code_match:
            flush_text()
            lang = code_match.group(1) or "text"
            code_lines = [line]  # Include opening ```
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            if i < len(lines):
                code_lines.append(lines[i])  # Include closing ```
                i += 1
            code_content = "\n".join(code_lines)
            if code_content.strip():
                sections.append({
                    "level": "text",
                    "content_en": code_content,
                })
            continue

        # Horizontal rules
        if re.match(r"^[-*_]{3,}\s*$", line):
            flush_text()
            sections.append({"level": "divider", "content_en": "---"})
            i += 1
            continue

        # Regular text
        current_text_lines.append(line)
        i += 1

    flush_text()
    return sections


# =============================================================================
# ADR File Discovery
# =============================================================================

def find_adr_files(dirs: list) -> dict:
    """
    Find all ADR-*.md files in given directories.
    Returns dict: slug -> {path, number, filename}
    Deduplicates by ADR number (prefers workspace over archive).
    """
    adrs = {}

    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("ADR-*.md")):
            filename = f.name
            # Skip templates and index
            if filename in ("ADR-TEMPLATE.md", "ADR-INDEX.md", "ADR-000-TEMPLATE.md"):
                continue

            # Extract ADR number from filename
            num_match = re.match(r"ADR[- ]?(\d+)", filename, re.IGNORECASE)
            if not num_match:
                continue

            number = num_match.group(1).zfill(3)
            slug = f"adr-{number}"

            # Prefer workspace files over archive
            is_workspace = "workspace" in str(d)
            if slug in adrs and not is_workspace:
                continue

            adrs[slug] = {
                "path": f,
                "number": number,
                "filename": filename,
                "slug": slug,
                "is_workspace": is_workspace,
            }

    return adrs


def slugify_adr(filename: str) -> str:
    """Generate slug from ADR filename."""
    # ADR-001-universal-tables.md -> adr-001
    num_match = re.match(r"ADR[- ]?(\d+)", filename, re.IGNORECASE)
    if num_match:
        return f"adr-{num_match.group(1).zfill(3)}"
    return filename.replace(".md", "").lower().replace(" ", "-")


# =============================================================================
# Commands
# =============================================================================

def cmd_list(api):
    """List existing ADR documents in CRM."""
    docs = api.list_documents()
    adr_docs = [d for d in docs if (d.get("category") == "ADR" or
                                     (d.get("slug", "") or "").startswith("adr-") or
                                     (d.get("name", "") or "").startswith("ADR"))]

    print(f"\nADR Documents in CRM ({len(adr_docs)} total):")
    print(f"{'ID':<8} {'Slug':<30} {'Name':<50} {'Status':<12}")
    print("-" * 100)

    for doc in sorted(adr_docs, key=lambda d: d.get("slug", "")):
        doc_id = doc.get("id", "?")
        name = (doc.get("name") or "?")[:50]
        status = doc.get("status") or "?"
        slug = doc.get("slug") or "?"
        print(f"{doc_id:<8} {slug:<30} {name:<50} {status:<12}")

    return adr_docs


def cmd_missing(api, adr_dirs):
    """Show ADRs that exist on disk but not in CRM."""
    existing_docs = api.list_documents()
    existing_slugs = set()
    for doc in existing_docs:
        slug = doc.get("slug", "")
        if slug:
            existing_slugs.add(slug)

    local_adrs = find_adr_files(adr_dirs)

    missing = []
    for slug, info in sorted(local_adrs.items()):
        if slug not in existing_slugs:
            missing.append(info)

    if missing:
        print(f"\nMissing ADRs ({len(missing)}):")
        print(f"{'Slug':<15} {'File':<60} {'Source'}")
        print("-" * 90)
        for m in missing:
            src = "workspace" if m["is_workspace"] else "archive"
            print(f"{m['slug']:<15} {m['filename']:<60} {src}")
    else:
        print("\nAll local ADR files are already uploaded to CRM!")

    return missing


def cmd_upload(api, adr_dirs, args):
    """Upload ADR files to CRM."""

    # Get existing documents to skip duplicates
    existing_docs = api.list_documents()
    existing_slugs = set()
    for doc in existing_docs:
        slug = doc.get("slug", "")
        if slug:
            existing_slugs.add(slug)

    print(f"Found {len(existing_slugs)} existing documents in CRM")

    # Find local ADR files
    if args.file:
        # Single file mode
        file_path = Path(args.file)
        if not file_path.exists():
            # Try to find in known dirs
            for d in adr_dirs:
                candidate = d / args.file
                if candidate.exists():
                    file_path = candidate
                    break
        if not file_path.exists():
            print(f"ERROR: File not found: {args.file}")
            sys.exit(1)

        slug = slugify_adr(file_path.name)
        local_adrs = {slug: {
            "path": file_path,
            "number": re.match(r"ADR[- ]?(\d+)", file_path.name, re.IGNORECASE).group(1).zfill(3),
            "filename": file_path.name,
            "slug": slug,
        }}
    else:
        local_adrs = find_adr_files(adr_dirs)

    # Filter out already existing (unless --force)
    to_upload = {}
    for slug, info in sorted(local_adrs.items()):
        if slug in existing_slugs and not args.force:
            continue
        to_upload[slug] = info

    if not to_upload:
        print("\nNo new ADRs to upload. All files already exist in CRM.")
        if not args.force:
            print("Use --force to re-upload existing documents.")
        return

    print(f"\nADRs to upload: {len(to_upload)}")
    for slug, info in sorted(to_upload.items()):
        print(f"  {slug}: {info['filename']}")

    if args.dry_run:
        print("\n[DRY RUN] No changes made.")
        return

    # Upload each ADR
    success_count = 0
    fail_count = 0

    for slug, info in sorted(to_upload.items()):
        print(f"\n{'='*60}")
        print(f"Uploading: {info['filename']} (slug: {slug})")
        print(f"{'='*60}")

        try:
            text = info["path"].read_text(encoding="utf-8")
            meta = parse_adr_metadata(text)
            sections = parse_markdown_sections(text)

            # Prepare document name
            doc_name = meta["title"] or info["filename"].replace(".md", "")
            description = meta["description"] or f"Architecture Decision Record {info['number']}"

            # Determine icon based on status
            status = meta.get("status", "").upper()
            if "IMPLEMENT" in status:
                icon = "✅"
            elif "APPROVED" in status:
                icon = "👍"
            elif "DEPRECATED" in status or "SUPERSEDED" in status:
                icon = "🔴"
            else:
                icon = "📋"

            print(f"  Title: {doc_name}")
            print(f"  Status: {status or 'unknown'}")
            print(f"  Sections: {len(sections)}")
            print(f"  Description: {description[:80]}...")

            # Create document
            doc_result = api.create_document(
                name=doc_name,
                slug=slug,
                description=description,
                icon=icon,
                category="ADR",
            )

            document_id = doc_result["document_id"]
            table_id = doc_result["table_id"]
            print(f"  Created: document_id={document_id}, table_id={table_id}")

            # Prepare sections with order
            api_sections = []
            for idx, sec in enumerate(sections):
                entry = {
                    "level": sec["level"],
                    "order": (idx + 1) * 10,
                }
                if sec["level"] in ("h1", "h2", "h3"):
                    entry["title"] = sec.get("title", "")
                if sec.get("content_en"):
                    entry["content_en"] = sec["content_en"]
                api_sections.append(entry)

            # Import in batches
            batch_size = 50
            total_imported = 0
            for i in range(0, len(api_sections), batch_size):
                batch = api_sections[i:i + batch_size]
                result = api.import_sections(document_id, batch)
                total_imported += result.get("count", 0)

            print(f"  Imported: {total_imported} sections")
            success_count += 1

        except Exception as e:
            print(f"  FAILED: {e}")
            fail_count += 1
            continue

    # Summary
    print(f"\n{'='*60}")
    print(f"Upload complete!")
    print(f"  Success: {success_count}")
    print(f"  Failed:  {fail_count}")
    print(f"  Total:   {success_count + fail_count}")
    print(f"  CRM URL: {CRM_URL}/widgets/124")
    print(f"{'='*60}")


# =============================================================================
# Main
# =============================================================================

def main():
    global CRM_URL

    parser = argparse.ArgumentParser(
        description="Batch upload ADR files to GOD CRM Documents",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload all new ADRs
  python3 %(prog)s

  # Preview what would be uploaded
  python3 %(prog)s --dry-run

  # Upload single file
  python3 %(prog)s --file docs/architecture/ADR-110-HIERARCHICAL-SMART-CONTEXT.md

  # List existing ADRs in CRM
  python3 %(prog)s --list

  # Show missing ADRs
  python3 %(prog)s --missing

  # Upload from custom directory
  python3 %(prog)s --dir /path/to/adrs

  # Force re-upload existing
  python3 %(prog)s --force --file ADR-001-universal-tables.md
        """,
    )

    parser.add_argument("--dir", help="Directory with ADR files (can specify multiple)", action="append")
    parser.add_argument("--file", help="Upload single ADR file")
    parser.add_argument("--list", action="store_true", help="List existing ADR documents in CRM")
    parser.add_argument("--missing", action="store_true", help="Show ADRs on disk but not in CRM")
    parser.add_argument("--dry-run", action="store_true", help="Preview without uploading")
    parser.add_argument("--force", action="store_true", help="Re-upload even if slug already exists")
    parser.add_argument("--url", default=CRM_URL, help=f"CRM URL (default: {CRM_URL})")

    args = parser.parse_args()

    if args.url and args.url != CRM_URL:
        CRM_URL = args.url

    # Determine ADR directories
    adr_dirs = [Path(d) for d in args.dir] if args.dir else ADR_DIRS

    # Connect to CRM
    token = get_jwt_token()
    api = CrmApi(CRM_URL, token)

    if args.list:
        cmd_list(api)
    elif args.missing:
        cmd_missing(api, adr_dirs)
    else:
        cmd_upload(api, adr_dirs, args)


if __name__ == "__main__":
    main()
