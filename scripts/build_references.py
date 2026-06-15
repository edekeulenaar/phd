#!/usr/bin/env python3
"""Extract the consolidated bibliography from the merged manuscript.

The authoritative, complete, alphabetised reference list lives in the
"# References" section of the merged Obsidian manuscript. We copy each
citation (one per non-empty line) verbatim, in markdown, into
site/data/references.json. The SPA's renderReferences() converts the
markdown (italics + links) to HTML at display time.

Usage:
    python3 build_references.py [path/to/Manuscript-merged.md]
"""
import json
import re
import sys
from pathlib import Path

DEFAULT_MERGED = Path(
    "/Users/edekeulenaar/Projects/Master_vault/Manuscript-merged.md"
)
SITE = Path(__file__).resolve().parent.parent          # …/site
CHAPTERS = SITE / "chapters"
OUT = SITE / "data" / "references.json"

# The merged manuscript's consolidated list.
HEAD = re.compile(r"^#{1,3}\s*(references?|bibliography|works\s+cited)\s*$", re.I)
# Per-chapter "Primary references" / "Secondary references|sources" callout
# lists (markdown may bold the heading: "## **Primary references**").
CH_HEAD = re.compile(
    r"^#{1,4}\s*\**\s*(primary|secondary)\s+(references?|sources)\s*\**\s*$", re.I)
ANY_HEAD = re.compile(r"^#{1,6}\s+\S")


def _collect_after(lines: list[str], start: int) -> list[str]:
    """Non-empty, non-heading lines following a heading until the next heading."""
    out = []
    for ln in lines[start + 1:]:
        s = ln.strip()
        if not s:
            continue
        if ANY_HEAD.match(s):
            break
        out.append(s)
    return out


def extract_merged(md_path: Path) -> list[str]:
    lines = md_path.read_text(encoding="utf-8").splitlines()
    start = None
    for i, ln in enumerate(lines):       # the LAST References heading is the consolidated one
        if HEAD.match(ln.strip()):
            start = i
    if start is None:
        raise SystemExit(f"No References heading found in {md_path}")
    return _collect_after(lines, start)


def extract_chapter_refs() -> list[str]:
    """Every entry under a 'Primary/Secondary references|sources' heading across
    the per-chapter markdown (e.g. Chapter 3's primary + secondary lists)."""
    out = []
    for md in sorted(CHAPTERS.glob("*.md")):
        lines = md.read_text(encoding="utf-8").splitlines()
        for i, ln in enumerate(lines):
            if CH_HEAD.match(ln.strip()):
                out.extend(_collect_after(lines, i))
    return out


def _sort_key(s: str) -> str:
    t = re.sub(r'^[\s_*"“”‘’\'(]+', "", s)   # drop leading md/quotes
    t = re.sub(r"^[^0-9A-Za-zÀ-ÿ]+", "", t)
    return t.lower()


def main() -> None:
    md_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MERGED
    if not md_path.exists():
        raise SystemExit(f"Merged manuscript not found: {md_path}")
    merged = extract_merged(md_path)
    chapter = extract_chapter_refs()
    # Merge, drop exact-duplicate lines (case/space-insensitive), sort A→Z.
    seen, entries = set(), []
    for e in merged + chapter:
        norm = re.sub(r"\s+", " ", e).strip().lower()
        if norm in seen:
            continue
        seen.add(norm)
        entries.append(e)
    entries.sort(key=_sort_key)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"entries": entries}, ensure_ascii=False, indent=0),
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} references "
          f"({len(merged)} merged + {len(chapter)} from chapters, deduped) → {OUT}")


if __name__ == "__main__":
    main()
