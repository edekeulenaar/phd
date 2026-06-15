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
OUT = SITE / "data" / "references.json"

HEAD = re.compile(r"^#{1,3}\s*(references?|bibliography|works\s+cited)\s*$", re.I)
ANY_HEAD = re.compile(r"^#{1,6}\s+\S")


def extract(md_path: Path) -> list[str]:
    lines = md_path.read_text(encoding="utf-8").splitlines()
    # Find the LAST References/Bibliography heading (the consolidated one).
    start = None
    for i, ln in enumerate(lines):
        if HEAD.match(ln.strip()):
            start = i
    if start is None:
        raise SystemExit(f"No References heading found in {md_path}")
    entries = []
    for ln in lines[start + 1:]:
        s = ln.strip()
        if not s:
            continue
        if ANY_HEAD.match(s):          # next section → stop
            break
        entries.append(s)
    return entries


def main() -> None:
    md_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MERGED
    if not md_path.exists():
        raise SystemExit(f"Merged manuscript not found: {md_path}")
    entries = extract(md_path)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"entries": entries}, ensure_ascii=False, indent=0),
        encoding="utf-8",
    )
    print(f"Wrote {len(entries)} references → {OUT}")


if __name__ == "__main__":
    main()
