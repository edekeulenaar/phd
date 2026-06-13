#!/usr/bin/env python3
"""
build_bibliography.py
─────────────────────
Parses the Better BibTeX export at

    /Users/edekeulenaar/Projects/PhDs/PhD 2020-2025/Master vault/My_Library.bib

extracts ONLY the entries cited in `site/manuscript.md`, and emits

    site/data/bibliography.json

with one record per cite key:

    {
      "<bbt-key>": {
        "inline":  "(Allan, 2016)",
        "harvard": "Allan, K. (2016) 'A Benchmark for Politeness', in Capone, A. and Mey, J. L. (eds) Interdisciplinary Studies in Pragmatics, Culture and Society. Cham: Springer International Publishing, pp. 397–420. doi:10.1007/978-3-319-12616-6_15."
      },
      …
    }

No external Python deps. Lightweight bibtex parser sufficient for the
fields we care about (author/editor/title/year/journal/booktitle/volume/
issue/pages/publisher/address/doi/url).
"""

from __future__ import annotations
import json, re, sys, unicodedata
from pathlib import Path

ROOT       = Path(__file__).resolve().parent.parent.parent
BIB_PATH   = Path("/Users/edekeulenaar/Projects/PhDs/PhD 2020-2025/"
                  "Master vault/My_Library.bib")
MANUSCRIPT = ROOT / "site" / "manuscript.md"
CHAPTERS   = ROOT / "site" / "chapters"
OUT        = ROOT / "site" / "data" / "bibliography.json"

# ─── Pull the cite keys we need ───────────────────────────────────────────

CITE_RE = re.compile(r"@([A-Za-z0-9_:.\-]+)")

def manuscript_keys() -> set[str]:
    """Union of cite keys across EVERY thesis chapter (global bibliography),
    falling back to the single manuscript.md if site/chapters/ is empty."""
    keys: set[str] = set()
    md_files = sorted(CHAPTERS.glob("*.md")) if CHAPTERS.exists() else []
    if not md_files and MANUSCRIPT.exists():
        md_files = [MANUSCRIPT]
    for p in md_files:
        keys |= set(CITE_RE.findall(p.read_text(encoding="utf-8")))
    return keys

# ─── Tiny bibtex parser ────────────────────────────────────────────────────

ENTRY_RE = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", re.M)

def strip_braces(s: str) -> str:
    """Collapse BibTeX brace-protection and tex commands into plain text."""
    s = s.strip()
    # Strip outer wrapper {...} or "..." once
    while len(s) >= 2 and ((s[0] == "{" and s[-1] == "}") or
                           (s[0] == '"' and s[-1] == '"')):
        s = s[1:-1].strip()
    # Drop remaining brace pairs that just protect casing: {{X}} → X, {X} → X.
    s = re.sub(r"\{+", "", s)
    s = re.sub(r"\}+", "", s)
    # Common TeX accents → unicode (very partial; good enough for display).
    REPL = {
        r"\\&": "&", r"\\%": "%", r"\\\$": "$", r"\\#": "#", r"\\_": "_",
        r"\\'a": "á", r"\\'e": "é", r"\\'i": "í", r"\\'o": "ó", r"\\'u": "ú",
        r'\\"a': "ä", r'\\"e': "ë", r'\\"i': "ï", r'\\"o': "ö", r'\\"u': "ü",
        r"\\`a": "à", r"\\`e": "è", r"\\`o": "ò",
        r"\\^a": "â", r"\\^e": "ê", r"\\^i": "î", r"\\^o": "ô",
        r"\\~n": "ñ", r"\\c\{c\}": "ç",
        r"\\textendash\b": "–", r"\\textemdash\b": "—",
        # French / journal quirks common in this corpus.
        r"n\$\^\\circ\$": "n°", r"\\textdegree\b": "°", r"\\circ\b": "°",
        r"\\textquoteleft\b": "‘", r"\\textquoteright\b": "’",
        r"\\guillemotleft\b": "«", r"\\guillemotright\b": "»",
        r"--": "–",
    }
    for pat, rep in REPL.items():
        s = re.sub(pat, rep, s)
    # Convert BibTeX non-breaking ties (~) used between words to a real space,
    # but only when they sit between non-space tokens (otherwise drop them).
    s = re.sub(r"(?<=\S)~(?=\S)", " ", s)
    s = s.replace("~", " ")
    # Drop any stray inline-math wrappers ($...$) — display only.
    s = re.sub(r"\$+", "", s)
    # Strip dangling LaTeX commands like \foo or \foo{}
    s = re.sub(r"\\[A-Za-z]+\*?(\{\})?", "", s)
    s = unicodedata.normalize("NFC", s)
    return re.sub(r"\s+", " ", s).strip()

def parse_fields(body: str) -> dict[str, str]:
    """Parse `field = {value}` pairs from one bibtex entry body (no outer braces).
       Handles nested braces in values."""
    out: dict[str, str] = {}
    i, n = 0, len(body)
    while i < n:
        m = re.match(r"\s*([A-Za-z_-]+)\s*=\s*", body[i:])
        if not m:
            i += 1; continue
        key = m.group(1).lower()
        i  += m.end()
        if i >= n: break
        if body[i] == "{":
            depth, j = 1, i + 1
            while j < n and depth:
                if body[j] == "{": depth += 1
                elif body[j] == "}": depth -= 1
                j += 1
            val = body[i:j]
            i = j
        elif body[i] == '"':
            j = i + 1
            while j < n and body[j] != '"': j += 1
            val = body[i:j+1]
            i = j + 1
        else:
            j = i
            while j < n and body[j] not in ",\n": j += 1
            val = body[i:j]
            i = j
        out[key] = strip_braces(val)
        # Skip the trailing comma, if any.
        while i < n and body[i] in ", \n\t": i += 1
    return out

def iter_entries(bibtext: str):
    """Yield (entrytype, key, body-of-fields) for every @type{key, …} entry."""
    for m in ENTRY_RE.finditer(bibtext):
        start = m.end()
        depth, j = 1, start
        while j < len(bibtext) and depth:
            if bibtext[j] == "{": depth += 1
            elif bibtext[j] == "}": depth -= 1
            j += 1
        yield m.group(1).lower(), m.group(2), bibtext[start:j-1]

# ─── Author parsing & Harvard formatting ──────────────────────────────────

def split_authors(raw: str) -> list[tuple[str, str]]:
    """Split a bibtex `author = ...` value into [(last, first), …]."""
    if not raw: return []
    parts = re.split(r"\s+and\s+", raw)
    out = []
    for p in parts:
        p = p.strip()
        if not p: continue
        if "," in p:
            last, first = p.split(",", 1)
            out.append((last.strip(), first.strip()))
        else:
            toks = p.split()
            last = toks[-1]
            first = " ".join(toks[:-1])
            out.append((last, first))
    return out

def initials(first: str) -> str:
    """`John Adam` → `J. A.`"""
    if not first: return ""
    bits = re.findall(r"[A-Z][\w'’]*", first)
    if not bits:
        # already initialled or non-Latin
        return first.strip()
    return " ".join(b[0] + "." for b in bits)

def inline_cite(authors: list[tuple[str,str]], year: str) -> str:
    if not authors: return f"({year})" if year else "(n.d.)"
    yr = year or "n.d."
    if len(authors) == 1:           return f"({authors[0][0]}, {yr})"
    if len(authors) == 2:           return f"({authors[0][0]} and {authors[1][0]}, {yr})"
    return f"({authors[0][0]} et al., {yr})"

def author_list_full(authors: list[tuple[str,str]]) -> str:
    """Harvard reference list form: Last, F. M., Last, F. M. and Last, F. M."""
    if not authors: return ""
    bits = [f"{l}, {initials(f)}" if f else l for l, f in authors]
    if len(bits) == 1: return bits[0]
    if len(bits) == 2: return f"{bits[0]} and {bits[1]}"
    return ", ".join(bits[:-1]) + " and " + bits[-1]

def editor_list(editors: list[tuple[str,str]]) -> str:
    if not editors: return ""
    bits = [f"{initials(f)} {l}".strip() if f else l for l, f in editors]
    joined = ", ".join(bits[:-1]) + " and " + bits[-1] if len(bits) > 1 else bits[0]
    return f"{joined} ({'eds' if len(bits) > 1 else 'ed'}.)"

def harvard(entry_type: str, f: dict[str, str]) -> str:
    authors = split_authors(f.get("author", ""))
    editors = split_authors(f.get("editor", ""))
    year    = f.get("year", "") or f.get("date", "")[:4]
    yr      = year or "n.d."
    title   = f.get("title", "").rstrip(".")
    journal = f.get("journaltitle") or f.get("journal", "")
    book    = f.get("booktitle", "")
    vol     = f.get("volume", "")
    iss     = f.get("number", "") or f.get("issue", "")
    pages   = f.get("pages", "").replace("--", "–")
    pub     = f.get("publisher", "")
    place   = f.get("address", "") or f.get("location", "")
    doi     = f.get("doi", "")
    url     = f.get("url", "")

    head = (author_list_full(authors) or editor_list(editors) or "Anon.")
    out  = f"{head} ({yr})"

    et = entry_type
    if et in ("article", "article-journal"):
        out += f" ‘{title}’"
        if journal: out += f", *{journal}*"
        if vol:
            out += f", {vol}"
            if iss: out += f"({iss})"
        if pages: out += f", pp. {pages}"
        out += "."
    elif et in ("book", "thesis", "phdthesis", "mastersthesis"):
        out += f" *{title}*"
        if place or pub: out += "."
        if place: out += f" {place}"
        if place and pub: out += ":"
        if pub: out += f" {pub}"
        out += "."
    elif et in ("incollection", "inbook", "chapter"):
        out += f" ‘{title}’"
        if editors: out += f", in {editor_list(editors)}"
        if book:    out += f" *{book}*"
        if place or pub: out += "."
        if place: out += f" {place}"
        if place and pub: out += ":"
        if pub: out += f" {pub}"
        if pages: out += f", pp. {pages}"
        out += "."
    elif et in ("inproceedings", "conference"):
        out += f" ‘{title}’"
        if book: out += f", in *{book}*"
        if place: out += f". {place}"
        if pub:   out += f": {pub}"
        if pages: out += f", pp. {pages}"
        out += "."
    elif et in ("online", "misc", "manual", "techreport", "report"):
        out += f" *{title}*"
        if pub: out += f". {pub}"
        out += "."
        if url: out += f" Available at: {url}."
    else:
        out += f" *{title}*."
        if pub: out += f" {pub}."

    if doi: out += f" doi:{doi}"
    return out

# ─── Main ────────────────────────────────────────────────────────────────

def main():
    if not BIB_PATH.exists():
        sys.exit(f"✗ Bibliography not found: {BIB_PATH}")
    if not MANUSCRIPT.exists():
        sys.exit(f"✗ Manuscript not found: {MANUSCRIPT}")

    needed = manuscript_keys()
    print(f"Manuscript cites: {len(needed)} unique keys")
    bibtext = BIB_PATH.read_text(encoding="utf-8", errors="replace")
    print(f"Reading bibliography: {BIB_PATH.name} ({len(bibtext):,} chars)")

    found: dict[str, dict[str, str]] = {}
    for et, key, body in iter_entries(bibtext):
        if key not in needed: continue
        f = parse_fields(body)
        authors = split_authors(f.get("author", "") or f.get("editor", ""))
        year    = f.get("year", "") or f.get("date", "")[:4]
        # author_short: "Allan" / "Allan and Mey" / "Allan et al."
        if not authors: au_short = ""
        elif len(authors) == 1: au_short = authors[0][0]
        elif len(authors) == 2: au_short = f"{authors[0][0]} and {authors[1][0]}"
        else: au_short = f"{authors[0][0]} et al."
        doi = f.get("doi", "").strip()
        url = f.get("url", "").strip()
        # Prefer a DOI link when present; fall back to the URL.
        link = (f"https://doi.org/{doi}" if doi else url) or ""
        found[key] = {
            "author":  au_short,
            "year":    year or "n.d.",
            "inline":  inline_cite(authors, year),
            "harvard": harvard(et, f),
            "link":    link,
        }

    missing = sorted(needed - set(found))
    print(f"Resolved {len(found)}/{len(needed)} — missing: {len(missing)}")
    for m in missing[:20]:
        print(f"  · {m}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(found, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(f"\n✓ {OUT.relative_to(ROOT)}  ({len(found)} entries)")

if __name__ == "__main__":
    main()
