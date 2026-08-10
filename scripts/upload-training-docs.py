#!/usr/bin/env python3
"""
Upload bilingual training documentation to GOD CRM Documents module.

Reads two markdown files (English and Russian) and uploads them as a single
bilingual document into the CRM Knowledge Base (widget 126).

Usage:
    python3 scripts/upload-training-docs.py --en docs/training_en.md --ru docs/training_ru.md
    python3 scripts/upload-training-docs.py --en docs/training_en.md --ru docs/training_ru.md --name "User Guide"
    python3 scripts/upload-training-docs.py --en docs/training_en.md  # English only
    python3 scripts/upload-training-docs.py --list  # List existing documents

Environment variables:
    CRM_URL          - CRM base URL (default: http://localhost:5001)
    CRM_JWT_SECRET   - JWT secret for token generation (reads from .env if not set)
    CRM_USER_ID      - User ID for auth (default: 2)

Configuration:
    PROJECT_ID          = 146   (Knowledge Base project)
    REGISTRY_TABLE_ID   = 2362  (Documents registry)
    FOLDER_PATH         = knowledge-base/documents/
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
import struct
from pathlib import Path
from difflib import SequenceMatcher


# =============================================================================
# Configuration
# =============================================================================

CRM_URL = os.environ.get("CRM_URL", "http://localhost:5001")
PROJECT_ID = 146
REGISTRY_TABLE_ID = 2365
FOLDER_PATH = "knowledge-base/documents/"

# JWT configuration
JWT_SECRET = os.environ.get("CRM_JWT_SECRET", "")
CRM_USER_ID = int(os.environ.get("CRM_USER_ID", "2"))
CRM_USER_EMAIL = os.environ.get("CRM_USER_EMAIL", "gera69lvl@gmail.com")


# =============================================================================
# JWT Token Generation (minimal, no external deps)
# =============================================================================

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_jwt(payload: dict, secret: str) -> str:
    """Generate a HS256 JWT token without external dependencies."""
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
    """Get JWT token for CRM API authentication."""
    global JWT_SECRET
    if not JWT_SECRET:
        # Try to read from .env
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
        "exp": now + 86400,  # 24 hours
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
            with urllib.request.urlopen(req, timeout=30) as resp:
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
        """Unwrap CRM API response: {success, data} -> data."""
        if result.get("success") and "data" in result:
            return result["data"]
        return result

    def create_document(self, name: str, slug: str = None, description: str = "",
                        icon: str = "📄", category: str = None) -> dict:
        """Create a new document in the Knowledge Base registry."""
        payload = {
            "name": name,
            "description": description,
            "icon": icon,
            "folder_path": FOLDER_PATH,
        }
        if slug:
            payload["slug"] = slug
        if category:
            payload["category"] = category

        print(f"  Creating document: {name}")
        result = self._unwrap(self.post(f"/api/v3/projects/{PROJECT_ID}/documents", payload))
        print(f"  Created: document_id={result.get('document_id')}, table_id={result.get('table_id')}")
        return result

    def import_sections(self, document_id: int, sections: list) -> dict:
        """Import bilingual sections into a document via import-v4."""
        print(f"  Importing {len(sections)} sections into document {document_id}...")
        result = self._unwrap(self.post(
            f"/api/v3/documents/{document_id}/import-v4",
            {
                "registry_table_id": REGISTRY_TABLE_ID,
                "sections": sections,
            },
        ))
        print(f"  Imported {result.get('count', 0)} sections")
        return result

    def list_documents(self) -> list:
        """List existing documents in the Knowledge Base."""
        result = self._unwrap(self.get(
            f"/api/v3/tables/{REGISTRY_TABLE_ID}/rows?limit=100"
        ))
        if isinstance(result, list):
            return result
        return result.get("rows", result.get("data", []))


# =============================================================================
# Markdown Parser
# =============================================================================

def parse_markdown(text: str) -> list:
    """
    Parse markdown text into sections.

    Returns list of dicts with keys:
        level: 'h1', 'h2', 'h3', 'text', 'code', 'divider'
        title: heading text (for h1/h2/h3)
        content: body text
        code_lang: language for code blocks
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
                    "content": content,
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
                "content": title,
            })
            i += 1
            continue

        # Code blocks
        code_match = re.match(r"^```(\w*)$", line)
        if code_match:
            flush_text()
            lang = code_match.group(1) or "text"
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            code_content = "\n".join(code_lines)
            if code_content.strip():
                sections.append({
                    "level": "text",
                    "content": f"```{lang}\n{code_content}\n```",
                    "type": "code",
                })
            continue

        # Horizontal rules / dividers
        if re.match(r"^[-*_]{3,}\s*$", line):
            flush_text()
            sections.append({"level": "divider", "content": "---"})
            i += 1
            continue

        # Regular text
        current_text_lines.append(line)
        i += 1

    flush_text()
    return sections


def _split_into_chapters(sections: list, level: str = "h1") -> list:
    """
    Split a flat list of sections into chapters at the given heading level.

    Returns list of dicts:
        {"heading": section_or_None, "body": [sections...]}
    """
    chapters = []
    current = {"heading": None, "body": []}

    for sec in sections:
        if sec["level"] == level:
            # Save previous chapter if it has content
            if current["heading"] or current["body"]:
                chapters.append(current)
            current = {"heading": sec, "body": []}
        else:
            current["body"].append(sec)

    if current["heading"] or current["body"]:
        chapters.append(current)

    return chapters


def _collect_text_content(sections: list) -> str:
    """Collect all text/divider content from sections into a single string."""
    parts = []
    for sec in sections:
        if sec["level"] in ("text", "divider"):
            parts.append(sec.get("content", ""))
    return "\n\n".join(parts)


def _collect_subheading_groups(body: list, sub_level: str) -> list:
    """
    Split body sections into groups by sub-heading level.

    Returns: [{"heading": sec_or_None, "body": [text_sections...]}]
    """
    groups = []
    current = {"heading": None, "body": []}

    for sec in body:
        if sec["level"] == sub_level:
            if current["heading"] or current["body"]:
                groups.append(current)
            current = {"heading": sec, "body": []}
        elif sec["level"] in ("text", "divider"):
            current["body"].append(sec)
        else:
            # Lower-level heading (e.g., h3 when splitting by h2) — treat as text
            current["body"].append(sec)

    if current["heading"] or current["body"]:
        groups.append(current)

    return groups


def _align_chapters(en_chapters: list, ru_chapters: list) -> list:
    """
    Build a list of (en_chapter_or_None, ru_chapter_or_None) pairs.

    Uses exact title matching as priority, then positional fallback.
    This handles cases where one language has extra chapters (e.g. RU has
    an extra "AI Агенты" chapter before "AI Agents API").
    """
    # Build mapping by exact title match
    ru_title_map = {}
    for idx, ch in enumerate(ru_chapters):
        if ch["heading"]:
            title = ch["heading"].get("title", "").strip()
            if title:
                ru_title_map[title] = idx

    pairs = []
    used_ru = set()
    en_idx = 0
    ru_idx = 0

    for en_ch in en_chapters:
        en_title = en_ch["heading"].get("title", "").strip() if en_ch["heading"] else ""

        # Try exact title match first
        if en_title and en_title in ru_title_map:
            matched_ru_idx = ru_title_map[en_title]
            # Add any unmatched RU chapters before this match as RU-only
            while ru_idx < matched_ru_idx:
                if ru_idx not in used_ru:
                    pairs.append((None, ru_chapters[ru_idx]))
                    used_ru.add(ru_idx)
                ru_idx += 1
            pairs.append((en_ch, ru_chapters[matched_ru_idx]))
            used_ru.add(matched_ru_idx)
            ru_idx = matched_ru_idx + 1
        else:
            # Positional fallback: match with next unused RU chapter
            while ru_idx < len(ru_chapters) and ru_idx in used_ru:
                ru_idx += 1
            if ru_idx < len(ru_chapters):
                pairs.append((en_ch, ru_chapters[ru_idx]))
                used_ru.add(ru_idx)
                ru_idx += 1
            else:
                pairs.append((en_ch, None))

    # Add remaining unmatched RU chapters
    for idx in range(len(ru_chapters)):
        if idx not in used_ru:
            pairs.append((None, ru_chapters[idx]))

    return pairs


def merge_bilingual_sections(en_sections: list, ru_sections: list) -> list:
    """
    Merge English and Russian sections into bilingual sections.

    Strategy (heading-based tree alignment):
    1. Split both into H1 chapters
    2. Match chapters using exact title matching + positional fallback
    3. Within each chapter, split by H2 sections and match by index
    4. Within each H2, split by H3 and match by index
    5. Between matched headings, merge ALL text blocks into single content_en + content_ru
    6. Unmatched sections get single-language content

    This handles structural differences where one language has more
    detail (extra paragraphs, sub-headings) within the same chapter.
    """
    merged = []

    en_chapters = _split_into_chapters(en_sections, "h1")
    ru_chapters = _split_into_chapters(ru_sections, "h1")

    chapter_pairs = _align_chapters(en_chapters, ru_chapters)

    for en_ch, ru_ch in chapter_pairs:

        # --- Merge H1 heading ---
        if en_ch and en_ch["heading"] and ru_ch and ru_ch["heading"]:
            merged.append({
                "level": "h1",
                "title": en_ch["heading"].get("title", ""),
                "content_en": en_ch["heading"].get("title", ""),
                "content_ru": ru_ch["heading"].get("title", ""),
            })
        elif en_ch and en_ch["heading"]:
            merged.append({
                "level": "h1",
                "title": en_ch["heading"].get("title", ""),
                "content_en": en_ch["heading"].get("title", ""),
                "content_ru": "",
            })
        elif ru_ch and ru_ch["heading"]:
            merged.append({
                "level": "h1",
                "title": ru_ch["heading"].get("title", ""),
                "content_en": "",
                "content_ru": ru_ch["heading"].get("title", ""),
            })

        en_body = (en_ch["body"] if en_ch else [])
        ru_body = (ru_ch["body"] if ru_ch else [])

        # --- Split bodies by H2 ---
        en_h2_groups = _collect_subheading_groups(en_body, "h2")
        ru_h2_groups = _collect_subheading_groups(ru_body, "h2")

        max_h2 = max(len(en_h2_groups), len(ru_h2_groups)) if (en_h2_groups or ru_h2_groups) else 0

        for h2_idx in range(max_h2):
            en_g = en_h2_groups[h2_idx] if h2_idx < len(en_h2_groups) else None
            ru_g = ru_h2_groups[h2_idx] if h2_idx < len(ru_h2_groups) else None

            # --- Merge H2 heading ---
            if en_g and en_g["heading"] and ru_g and ru_g["heading"]:
                merged.append({
                    "level": "h2",
                    "title": en_g["heading"].get("title", ""),
                    "content_en": en_g["heading"].get("title", ""),
                    "content_ru": ru_g["heading"].get("title", ""),
                })
            elif en_g and en_g["heading"]:
                merged.append({
                    "level": "h2",
                    "title": en_g["heading"].get("title", ""),
                    "content_en": en_g["heading"].get("title", ""),
                    "content_ru": "",
                })
            elif ru_g and ru_g["heading"]:
                merged.append({
                    "level": "h2",
                    "title": ru_g["heading"].get("title", ""),
                    "content_en": "",
                    "content_ru": ru_g["heading"].get("title", ""),
                })

            en_sub_body = (en_g["body"] if en_g else [])
            ru_sub_body = (ru_g["body"] if ru_g else [])

            # --- Split by H3 within this H2 group ---
            en_h3_groups = _collect_subheading_groups(en_sub_body, "h3")
            ru_h3_groups = _collect_subheading_groups(ru_sub_body, "h3")

            max_h3 = max(len(en_h3_groups), len(ru_h3_groups)) if (en_h3_groups or ru_h3_groups) else 0

            for h3_idx in range(max_h3):
                en_h3 = en_h3_groups[h3_idx] if h3_idx < len(en_h3_groups) else None
                ru_h3 = ru_h3_groups[h3_idx] if h3_idx < len(ru_h3_groups) else None

                # --- Merge H3 heading ---
                if en_h3 and en_h3["heading"] and ru_h3 and ru_h3["heading"]:
                    merged.append({
                        "level": "h3",
                        "title": en_h3["heading"].get("title", ""),
                        "content_en": en_h3["heading"].get("title", ""),
                        "content_ru": ru_h3["heading"].get("title", ""),
                    })
                elif en_h3 and en_h3["heading"]:
                    merged.append({
                        "level": "h3",
                        "title": en_h3["heading"].get("title", ""),
                        "content_en": en_h3["heading"].get("title", ""),
                        "content_ru": "",
                    })
                elif ru_h3 and ru_h3["heading"]:
                    merged.append({
                        "level": "h3",
                        "title": ru_h3["heading"].get("title", ""),
                        "content_en": "",
                        "content_ru": ru_h3["heading"].get("title", ""),
                    })

                # --- Merge text content under H3 ---
                en_text = _collect_text_content(en_h3["body"] if en_h3 else [])
                ru_text = _collect_text_content(ru_h3["body"] if ru_h3 else [])

                if en_text or ru_text:
                    merged.append({
                        "level": "text",
                        "content_en": en_text,
                        "content_ru": ru_text,
                    })

    return merged


def validate_bilingual_structure(en_sections: list, ru_sections: list) -> dict:
    """
    Validate that EN and RU documents have matching structure.

    Returns a report dict with:
    - valid: bool
    - warnings: [str]
    - errors: [str]
    - heading counts per level
    - matched/unmatched headings
    """
    report = {
        "valid": True,
        "warnings": [],
        "errors": [],
        "en_headings": {"h1": 0, "h2": 0, "h3": 0},
        "ru_headings": {"h1": 0, "h2": 0, "h3": 0},
        "en_total": len(en_sections),
        "ru_total": len(ru_sections),
        "matched": [],
        "en_only": [],
        "ru_only": [],
    }

    # Count headings
    en_h = [s for s in en_sections if s["level"] in ("h1", "h2", "h3")]
    ru_h = [s for s in ru_sections if s["level"] in ("h1", "h2", "h3")]

    for h in en_h:
        report["en_headings"][h["level"]] += 1
    for h in ru_h:
        report["ru_headings"][h["level"]] += 1

    # Check heading counts match
    for level in ("h1", "h2", "h3"):
        en_count = report["en_headings"][level]
        ru_count = report["ru_headings"][level]
        if en_count != ru_count:
            diff = abs(en_count - ru_count)
            msg = f"{level.upper()}: EN={en_count}, RU={ru_count} (diff: {diff})"
            if level == "h1" and diff > 0:
                report["errors"].append(msg)
                report["valid"] = False
            elif diff > 5:
                report["errors"].append(msg)
                report["valid"] = False
            else:
                report["warnings"].append(msg)

    # Match headings at each level using fuzzy matching
    for level in ("h1", "h2", "h3"):
        en_at_level = [h for h in en_h if h["level"] == level]
        ru_at_level = [h for h in ru_h if h["level"] == level]

        used_ru = set()
        for eh in en_at_level:
            en_title = eh.get("title", eh.get("content", "")).lower()
            best_score = 0.0
            best_idx = -1
            best_ru_title = ""

            for j, rh in enumerate(ru_at_level):
                if j in used_ru:
                    continue
                ru_title = rh.get("title", rh.get("content", "")).lower()

                # Check exact match or technical term overlap
                if en_title == ru_title:
                    score = 1.0
                else:
                    score = SequenceMatcher(None, en_title, ru_title).ratio()
                    # Boost for shared technical terms
                    tech = re.findall(r'[A-Z]{2,}|api|crm|jwt|webhook', f"{en_title} {ru_title}", re.IGNORECASE)
                    en_tech = set(t.lower() for t in re.findall(r'[A-Z]{2,}|api|crm|jwt|webhook', en_title, re.IGNORECASE))
                    ru_tech = set(t.lower() for t in re.findall(r'[A-Z]{2,}|api|crm|jwt|webhook', ru_title, re.IGNORECASE))
                    if en_tech and ru_tech and en_tech == ru_tech:
                        score = max(score, 0.85)

                if score > best_score:
                    best_score = score
                    best_idx = j
                    best_ru_title = ru_title

            if best_idx >= 0 and best_score >= 0.3:
                report["matched"].append((eh.get("title", ""), ru_at_level[best_idx].get("title", ""), round(best_score, 2)))
                used_ru.add(best_idx)
            else:
                report["en_only"].append(eh.get("title", eh.get("content", "")))

        for j, rh in enumerate(ru_at_level):
            if j not in used_ru:
                report["ru_only"].append(rh.get("title", rh.get("content", "")))

    # Total section count warning
    total_diff = abs(len(en_sections) - len(ru_sections))
    if total_diff > 20:
        report["warnings"].append(f"Section count differs: EN={len(en_sections)}, RU={len(ru_sections)} (diff: {total_diff})")

    return report


def print_validation(report: dict) -> bool:
    """Print validation report and return whether valid."""
    valid = report["valid"]
    print(f"\n{'─'*50}")
    print(f"📋 Structure Validation: {'✅ VALID' if valid else '❌ INVALID'}")
    print(f"{'─'*50}")

    print(f"   {'Level':<6} {'EN':>5} {'RU':>5} {'Match':>7}")
    for level in ("h1", "h2", "h3"):
        en_n = report["en_headings"][level]
        ru_n = report["ru_headings"][level]
        ok = "✅" if en_n == ru_n else "❌" if (level == "h1" and en_n != ru_n) else "⚠️"
        print(f"   {level.upper():<6} {en_n:>5} {ru_n:>5} {ok:>7}")

    print(f"   Total: EN={report['en_total']}, RU={report['ru_total']}")

    if report["matched"]:
        print(f"\n   Matched headings ({len(report['matched'])}):")
        for en_t, ru_t, score in report["matched"][:10]:
            print(f"      {score:.0%} │ {en_t[:30]:<30} ↔ {ru_t[:30]}")

    if report["en_only"]:
        print(f"\n   EN-only ({len(report['en_only'])}):")
        for t in report["en_only"][:5]:
            print(f"      🇬🇧 {t}")

    if report["ru_only"]:
        print(f"\n   RU-only ({len(report['ru_only'])}):")
        for t in report["ru_only"][:5]:
            print(f"      🇷🇺 {t}")

    if report["errors"]:
        print(f"\n   ❌ Errors:")
        for e in report["errors"]:
            print(f"      • {e}")

    if report["warnings"]:
        print(f"\n   ⚠️  Warnings:")
        for w in report["warnings"]:
            print(f"      • {w}")

    return valid


def prepare_api_sections(merged_sections: list) -> list:
    """Convert merged sections to API import-v4 format."""
    api_sections = []
    order = 10

    for sec in merged_sections:
        entry = {
            "level": sec["level"],
            "order": order,
        }

        if sec["level"] in ("h1", "h2", "h3"):
            entry["title"] = sec.get("title", "")

        if sec.get("content_en"):
            entry["content_en"] = sec["content_en"]
        if sec.get("content_ru"):
            entry["content_ru"] = sec["content_ru"]

        # For single-language fallback
        if "content_en" not in entry and "content_ru" not in entry:
            entry["content_en"] = sec.get("content", "")

        api_sections.append(entry)
        order += 10

    return api_sections


# =============================================================================
# Main
# =============================================================================

def cmd_upload(args):
    """Upload markdown files as a bilingual document."""
    # Read files
    en_text = ""
    ru_text = ""

    if args.en:
        en_path = Path(args.en)
        if not en_path.exists():
            print(f"ERROR: English file not found: {args.en}")
            sys.exit(1)
        en_text = en_path.read_text(encoding="utf-8")
        print(f"Read EN: {en_path} ({len(en_text)} chars)")

    if args.ru:
        ru_path = Path(args.ru)
        if not ru_path.exists():
            print(f"ERROR: Russian file not found: {args.ru}")
            sys.exit(1)
        ru_text = ru_path.read_text(encoding="utf-8")
        print(f"Read RU: {ru_path} ({len(ru_text)} chars)")

    if not en_text and not ru_text:
        print("ERROR: At least one language file is required (--en or --ru)")
        sys.exit(1)

    # Parse markdown
    en_sections = parse_markdown(en_text) if en_text else []
    ru_sections = parse_markdown(ru_text) if ru_text else []
    print(f"Parsed: {len(en_sections)} EN sections, {len(ru_sections)} RU sections")

    # Validate structure before merge
    if en_sections and ru_sections and not getattr(args, 'skip_validation', False):
        report = validate_bilingual_structure(en_sections, ru_sections)
        is_valid = print_validation(report)

        if getattr(args, 'validate', False):
            print("\n🔍 VALIDATE MODE — no upload performed")
            sys.exit(0 if is_valid else 1)

        if not is_valid:
            print("\n❌ Structure validation failed!")
            print("   Fix the EN/RU files to have matching structure, or use --skip-validation to force import")
            sys.exit(1)

    elif getattr(args, 'validate', False):
        print("❌ Need both --en and --ru for validation")
        sys.exit(1)

    # Merge bilingual
    if en_sections and ru_sections:
        merged = merge_bilingual_sections(en_sections, ru_sections)
        print(f"Merged: {len(merged)} bilingual sections")
    elif en_sections:
        merged = [
            {
                "level": s["level"],
                "title": s.get("title", ""),
                "content_en": s.get("content", s.get("title", "")),
            }
            for s in en_sections
        ]
    else:
        merged = [
            {
                "level": s["level"],
                "title": s.get("title", ""),
                "content_ru": s.get("content", s.get("title", "")),
            }
            for s in ru_sections
        ]

    # Prepare API sections
    api_sections = prepare_api_sections(merged)

    # Connect to CRM
    token = get_jwt_token()
    api = CrmApi(CRM_URL, token)

    # Determine document name
    doc_name = args.name
    if not doc_name:
        # Use first H1 from EN, or filename
        for s in (en_sections or ru_sections):
            if s["level"] == "h1":
                doc_name = s.get("title", "")
                break
        if not doc_name:
            doc_name = Path(args.en or args.ru).stem.replace("_", " ").replace("-", " ").title()

    doc_slug = args.slug
    doc_icon = args.icon or "📖"
    doc_category = args.category

    # Create document
    print(f"\nCreating document: '{doc_name}'")
    doc_result = api.create_document(
        name=doc_name,
        slug=doc_slug,
        description=f"Training documentation ({('EN+RU' if en_text and ru_text else 'EN' if en_text else 'RU')})",
        icon=doc_icon,
        category=doc_category,
    )

    document_id = doc_result["document_id"]
    table_id = doc_result["table_id"]

    # Import sections
    print(f"\nImporting sections into document {document_id} (table {table_id})...")

    # Split into batches of 50 to avoid timeout
    batch_size = 50
    total_imported = 0

    for i in range(0, len(api_sections), batch_size):
        batch = api_sections[i : i + batch_size]
        # Re-number orders within batch
        for j, sec in enumerate(batch):
            sec["order"] = (i + j) * 10 + 10

        result = api.import_sections(document_id, batch)
        total_imported += result.get("count", 0)

    print(f"\n{'='*60}")
    print(f"SUCCESS: Document uploaded!")
    print(f"  Name:        {doc_name}")
    print(f"  Document ID: {document_id}")
    print(f"  Table ID:    {table_id}")
    print(f"  Sections:    {total_imported}")
    print(f"  Languages:   {'EN + RU' if en_text and ru_text else 'EN' if en_text else 'RU'}")
    print(f"  URL:         {CRM_URL}/widgets/126")
    print(f"{'='*60}")


def cmd_list(args):
    """List existing documents in Knowledge Base."""
    token = get_jwt_token()
    api = CrmApi(CRM_URL, token)

    docs = api.list_documents()
    if not docs:
        print("No documents found in Knowledge Base")
        return

    print(f"\nKnowledge Base Documents ({len(docs)} total):")
    print(f"{'ID':<6} {'Name':<40} {'Status':<10} {'Slug':<30}")
    print("-" * 90)

    for doc in docs:
        data = doc.get("data", doc) if isinstance(doc, dict) else {}
        if isinstance(data, str):
            data = json.loads(data)
        doc_id = doc.get("id", "?")
        name = data.get("name", "?")
        status = data.get("status", "?")
        slug = data.get("slug", "?")
        print(f"{doc_id:<6} {name:<40} {status:<10} {slug:<30}")


def _update_crm_url(url):
    global CRM_URL
    CRM_URL = url


def main():
    parser = argparse.ArgumentParser(
        description="Upload bilingual training docs to GOD CRM Knowledge Base",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload both languages
  python3 %(prog)s --en training_en.md --ru training_ru.md --name "User Guide"

  # Upload English only
  python3 %(prog)s --en training_en.md --name "Quick Start"

  # Upload with custom settings
  python3 %(prog)s --en guide_en.md --ru guide_ru.md --name "API Guide" --icon "🔌" --category "api"

  # List existing documents
  python3 %(prog)s --list
        """,
    )

    parser.add_argument("--en", help="Path to English markdown file")
    parser.add_argument("--ru", help="Path to Russian markdown file")
    parser.add_argument("--name", help="Document name (auto-detected from first H1 if not set)")
    parser.add_argument("--slug", help="Document slug (auto-generated from name if not set)")
    parser.add_argument("--icon", default="📖", help="Document icon emoji (default: 📖)")
    parser.add_argument("--category", help="Document category")
    parser.add_argument("--list", action="store_true", help="List existing documents")
    parser.add_argument("--dry-run", action="store_true", help="Parse files but don't upload")
    parser.add_argument("--validate", action="store_true", help="Validate EN/RU structure only (no upload)")
    parser.add_argument("--skip-validation", action="store_true", help="Skip structure validation before import")
    parser.add_argument("--url", default=CRM_URL, help=f"CRM URL (default: {CRM_URL})")

    args = parser.parse_args()

    if args.url and args.url != CRM_URL:
        _update_crm_url(args.url)

    if args.list:
        cmd_list(args)
        return

    if not args.en and not args.ru:
        parser.print_help()
        print("\nERROR: Specify at least --en or --ru file")
        sys.exit(1)

    if args.dry_run:
        # Just parse and show structure
        for lang, path in [("EN", args.en), ("RU", args.ru)]:
            if path:
                text = Path(path).read_text(encoding="utf-8")
                sections = parse_markdown(text)
                print(f"\n{lang} sections ({len(sections)}):")
                for i, s in enumerate(sections):
                    level = s["level"]
                    preview = s.get("title", s.get("content", ""))[:80]
                    print(f"  [{i:3d}] {level:6s} {preview}")
        return

    cmd_upload(args)


if __name__ == "__main__":
    main()
