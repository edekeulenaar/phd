"""Build the bibliography the thesis is typeset from.

Zotero's live export is the record of truth for every field: it is where the
author repairs entries. The wayback export is a snapshot from 9 September that
carries archived URLs for 72 entries but has since fallen behind Zotero, and
still holds author forms the author has already fixed. Taking whole entries
from either one is wrong in one direction or the other, so this merges at the
field level: every entry comes from the live library, and only `url` and
`urldate` are taken from the wayback copy, and only where that copy points at
web.archive.org.
"""
import re, sys

LIVE = "/Users/edekeulenaar/My_Library.bib"
WAYB = "/Users/edekeulenaar/Projects/PhDs/PhD 2020-2025/PhD - Manuscript/My_Library_wayback.bib"
OUT  = "/Users/edekeulenaar/Projects/PhDs/PhD 2020-2025/PhD - Manuscript/My_Library_merged.bib"

def entries(text):
    out, i = {}, 0
    pat = re.compile(r'(?m)^@(\w+)\{([^,\s]+),')
    for m in pat.finditer(text):
        j = text.index("{", m.start()); depth = 0
        while j < len(text):
            c = text[j]
            # A backslash-escaped brace is text, not structure. One scraped
            # entry carries "profile\_cb:function\{\}\}" in its author field,
            # and counting those closed it early and orphaned its real "}".
            if c == "\\":
                j += 2; continue
            if c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0: break
            j += 1
        out[m.group(2)] = (m.start(), j + 1)
    return out

live = open(LIVE, encoding="utf-8", errors="replace").read()
wayb = open(WAYB, encoding="utf-8", errors="replace").read()
lw, ww = entries(live), entries(wayb)

FIELD = lambda f: re.compile(r'(?m)^\s*' + f + r'\s*=\s*\{([^}]*)\},?\n')
merged, took = [], 0
for key, (i, j) in sorted(lw.items(), key=lambda kv: kv[1][0]):
    body = live[i:j]
    if key in ww:
        wb = wayb[ww[key][0]:ww[key][1]]
        m = FIELD("url").search(wb)
        if m and "web.archive.org" in m.group(1):
            url = m.group(1)
            ud = FIELD("urldate").search(wb)
            body = FIELD("url").sub(f"  url = {{{url}}},\n", body, count=1) if FIELD("url").search(body) \
                   else re.sub(r'(?m)^(\s*title\s*=.*\n)', lambda t: t.group(0) + f"  url = {{{url}}},\n", body, count=1)
            if ud:
                body = FIELD("urldate").sub(f"  urldate = {{{ud.group(1)}}},\n", body, count=1) if FIELD("urldate").search(body) \
                       else re.sub(r'(?m)^(\s*url\s*=.*\n)', lambda t: t.group(0) + f"  urldate = {{{ud.group(1)}}},\n", body, count=1)
            took += 1
    merged.append(body)

# Record-level corrections that must survive a Zotero re-export.
import json as _json, os as _os
OVR = _os.path.join(_os.path.dirname(OUT), "My_Library_overrides.json")
overrides = {k: v for k, v in _json.load(open(OVR, encoding="utf-8")).items() if not k.startswith("_")} if _os.path.exists(OVR) else {}
applied = 0
for n, body in enumerate(merged):
    m = re.match(r'\s*@(\w+)\{([^,]+),', body)
    if not m or m.group(2) not in overrides:
        continue
    ov = overrides[m.group(2)]
    if ov.get("type"):
        body = body.replace("@" + m.group(1) + "{", "@" + ov["type"] + "{", 1)
    for f in ov.get("drop", []):
        body = re.sub(r'(?m)^\s*' + f + r'\s*=\s*\{.*\},?\n', '', body)
    for f, v in ov.get("set", {}).items():
        line = f"  {f} = {{{v}}},\n"
        if re.search(r'(?m)^\s*' + f + r'\s*=', body):
            body = re.sub(r'(?m)^\s*' + f + r'\s*=\s*\{.*\},?\n', lambda _m: line, body, count=1)
        else:
            body = re.sub(r'^(\s*@\w+\{[^,]+,\n)', lambda _m: _m.group(1) + line, body, count=1)
    merged[n] = body
    applied += 1

# Emoji in tweet titles have no glyph in the PDF's fonts and printed as boxes
# (U+FFFC, an object-replacement character pasted into one URL, likewise).
# Mathematical letters such as 𝕏 are kept: the PDF sets them in a fallback face.
EMOJI = re.compile("[\U0001F000-\U0001FAFF\uFE0F\u200D\uFFFC]")
stripped = sum(len(EMOJI.findall(b)) for b in merged)
merged = [re.sub(r'(?m)^(\s*title\s*=\s*\{)\s*(.*?)\s*(\},?)$', r'\1\2\3', re.sub(r'  +', ' ', EMOJI.sub('', b))) if EMOJI.search(b) else b for b in merged]

open(OUT, "w", encoding="utf-8").write("\n\n".join(merged) + "\n")
print(f"overrides applied: {applied}; emoji/replacement characters removed: {stripped}")
print(f"merged: {len(merged)} entries from the live library; archived URLs carried over: {took}")
