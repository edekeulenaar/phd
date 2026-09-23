"""Turn Manuscript-merged.md into a LaTeX-ready body:
resolve Obsidian links into real internal hyperlinks, keep every image,
and anchor the hand-written References so citations can link into it."""
import re, os, json, pathlib, unicodedata
from urllib.parse import unquote

SRC   = "/Users/edekeulenaar/Projects/Master_vault/Manuscript-merged.md"
VAULT = pathlib.Path("/Users/edekeulenaar/Projects/Master_vault")
BIB   = "/Users/edekeulenaar/Projects/PhDs/PhD 2020-2025/PhD - Manuscript/My_Library_wayback.bib"
BIBJSON = ("/private/tmp/claude-502/-Users-edekeulenaar-Projects-Master-vault-Manuscript/"
           "0c02e882-bfa9-4aa7-860b-e48132ffbe9a/scratchpad/phd/data/bibliography.json")
text = open(SRC, encoding="utf-8").read()
log = []

# ── 1. housekeeping ────────────────────────────────────────────────────────
text, n = re.subn(r'^# Table of contents\n+```table-of-contents.*?```\n', '', text,
                  flags=re.S | re.M)
log.append(f"TOC code block removed: {n}")
text, a = re.subn(r'<div class="page-break"[^>]*>\s*</div>', r'\n\\newpage\n', text)
text, b = re.subn(r'<div class="page-break"[^>]*>', r'\n\\newpage\n', text)
log.append(f"page breaks -> \\newpage: {a + b}")

# ── 1b. epigraphs and the chapter notice ──────────────────────────────────
# Consecutive right-aligned divs at the head of a chapter are its epigraph; the
# website wraps them in one block set in a mono face. The italic line about the
# figures being interactive is a notice, not body prose. Both need air around
# them, which they did not get when they came through as ordinary paragraphs.
def epigraph(m):
    inner = re.sub(r'</?div[^>]*>', '', m.group(0))
    lines = [l.strip() for l in inner.split("\n") if l.strip()]
    return ("\n\n```{=latex}\n\\begin{epigraph}\n```\n\n"
            + "\n\n".join(lines)
            + "\n\n```{=latex}\n\\end{epigraph}\n```\n\n")

text, n = re.subn(r'(?m)^(?:<div style="text-align: right;">.*</div>\s*\n?){1,4}',
                  epigraph, text)
log.append(f"epigraphs wrapped: {n}")

text, n = re.subn(
    r'(?m)^\*(The figures in this chapter are interactive\..*?)\*\s*$',
    lambda m: ("\n```{=latex}\n\\begin{chapternotice}\n```\n\n" + m.group(1)
               + "\n\n```{=latex}\n\\end{chapternotice}\n```\n"), text)
log.append(f"chapter notices wrapped: {n}")

# ── 2. give every heading a stable id, and index them by title ─────────────
def norm_title(s):
    return re.sub(r'\s+', ' ', s.strip()).lower()

head_id, heading_anchor, counters, lines = {}, {}, {}, text.split("\n")
sec = 0
for i, ln in enumerate(lines):
    m = re.match(r'^(#{1,6})\s+(.*?)\s*$', ln)
    if not m:
        continue
    level, title = len(m.group(1)), m.group(2)
    if level == 1:
        sec += 1
    counters[level] = counters.get(level, 0) + 1
    hid = f"h{level}-{counters[level]}"
    # A heading may carry its own block anchor, as "## The circumstances of
    # content moderation ^the-why-of-content-moderation" does. Take it off the
    # title and point it at the heading's id, or the id appended below would
    # push it out of reach of the anchor pass and it would print as text.
    a = re.match(r'^(.*?)\s+\^([A-Za-z0-9-]+)$', title)
    if a:
        title = a.group(1).rstrip()
        heading_anchor[a.group(2)] = hid
    head_id.setdefault(norm_title(title), hid)
    lines[i] = f"{m.group(1)} {title} {{#{hid}}}"
text = "\n".join(lines)
log.append(f"headings given ids: {sum(counters.values())} in {sec} sections")

# ── 3. block anchors: "^figure-5" at end of line -> an anchor span ─────────
#     Anchor names repeat across chapters, so they are namespaced per section.
sections = re.split(r'(?m)^(?=# )', text)
anchor_ids = []                       # per section: {anchor name -> unique id}
for si, s in enumerate(sections):
    amap = {}
    def define(m):
        name = m.group(1)
        uid = f"a{si}-{name}"
        amap[name] = uid
        return f" []{{#{uid}}}"
    s = re.sub(r'(?m)[ \t]*\^([A-Za-z0-9-]+)[ \t]*$', define, s)
    sections[si] = s
    anchor_ids.append(amap)
log.append(f"block anchors turned into targets: {sum(len(a) for a in anchor_ids)}")
# A few references point at a figure in another chapter; fall back to the
# first definition anywhere in the thesis.
global_anchor = {}
for amap in anchor_ids:
    for name, uid in amap.items():
        global_anchor.setdefault(name, uid)
for name, uid in heading_anchor.items():
    global_anchor.setdefault(name, uid)

# ── 4. resolve links, section by section so anchors stay local ─────────────
flat_head, flat_anchor, ok_head, ok_anchor = [], [], 0, 0
for si, s in enumerate(sections):
    amap = anchor_ids[si]

    def wiki(m):
        global ok_head, ok_anchor
        target, label = m.group(1).strip(), (m.group(2) or m.group(1)).strip()
        if target.startswith("^"):
            uid = amap.get(target[1:]) or global_anchor.get(target[1:])
            if uid:
                ok_anchor += 1
                return f"[{label}](#{uid})"
            flat_anchor.append(target)
            # Never print the raw slug: "#the-why-of-content-moderation" was
            # appearing in the text as though it were a heading.
            clean = label
            if clean.lstrip("#^") == target.lstrip("#^"):
                clean = target.lstrip("#^").replace("-", " ")
            return f"**{clean}**"
        uid = head_id.get(norm_title(target))
        if not uid:
            # Chapters are often linked by their short title ("Chapter 6. Moderation
            # in crisis") while the heading carries the full one ("… : YouTube
            # debates on …"). Accept a unique heading that begins with the target.
            nt_ = norm_title(target)
            cands = [v for k, v in head_id.items() if nt_ and k.startswith(nt_)]
            uid = cands[0] if len(set(cands)) == 1 else None
        if uid:
            ok_head += 1
            return f"[{label}](#{uid})"
        flat_head.append(target)
        return label

    s = re.sub(r'\[\[#([^\]|]+)(?:\|([^\]]*))?\]\]', wiki, s)
    s = re.sub(r'\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]', wiki, s)

    def mdlink(m):
        global ok_anchor
        label, name = m.group(1), m.group(2)
        uid = amap.get(name) or global_anchor.get(name)
        if uid:
            ok_anchor += 1
            return f"[{label}](#{uid})"
        flat_anchor.append("^" + name)
        return f"**{label}**"

    sections[si] = re.sub(r'\[([^\]]+)\]\(#\\?\^([A-Za-z0-9-]+)\)', mdlink, s)
text = "".join(sections)
log.append(f"links resolved: {ok_head} to headings, {ok_anchor} to figures/tables")
if flat_head or flat_anchor:
    log.append(f"    unresolved, left as plain text: "
               f"{sorted(set(flat_head)) + sorted(set(flat_anchor))}")

# ── 5. images ─────────────────────────────────────────────────────────────
# A PDF cannot play the Chapter 11 animations, and dropping them left their
# captions with nothing above. Where a still has been prepared in stills/
# (a frame, or two frames side by side), set it in the video's place; the
# captions already point readers to the animated version online.
STILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stills")
def video(m):
    stem = os.path.splitext(os.path.basename(m.group(2)))[0]
    still = os.path.join(STILLS, stem + ".png")
    if os.path.exists(still):
        return f"![{m.group(1)}]({still})"
    return f"*{m.group(1)}*" if m.group(1).strip() else ""
text, n = re.subn(r'!\[([^\]]*)\]\(([^)]*\.mp4)\)', video, text)
log.append(f"mp4 embeds -> stills or caption text: {n}")

BASES = ("", "Manuscript", "Manuscript/images", "Manuscript/Figures", "Figures",
         "Manuscript/attachments", "attachments")
missing = []
def img(m):
    alt, path = m.group(1), m.group(2).strip()
    if path.startswith(("http://", "https://")):
        return m.group(0)
    for cand in (unquote(path), path):
        for base in BASES:
            p = VAULT / base / cand
            if p.exists():
                return f"![{alt}]({p})"
    missing.append(path)
    return f"*{alt}*" if alt.strip() else ""
text, n = re.subn(r'!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)', img, text)
log.append(f"image embeds processed: {n}; missing: {len(missing)}")

# ── 6. footnote labels are per-chapter; namespace them for the merged doc ──
secs, renamed = re.split(r'(?m)^(?=# )', text), 0
for i, s in enumerate(secs):
    for lb in set(re.findall(r'^\[\^([^\]]+)\]:', s, flags=re.M)):
        s2 = re.sub(r'\[\^' + re.escape(lb) + r'\]', f'[^s{i}-{lb}]', s)
        renamed += s2 != s
        s = s2
    secs[i] = s
text = "".join(secs)
log.append(f"footnote labels namespaced: {renamed}")

# ── 7. social-media handles are not citation keys ─────────────────────────
bibkeys = set(re.findall(r'^@\w+\{([^,]+),',
                         open(BIB, encoding="utf-8", errors="replace").read(), flags=re.M))
INTENDED = {"OpenTermsArchive"}
escaped = []
def handle(m):
    pre, key = m.group(1), m.group(2)
    if pre == "\\" or key in bibkeys or re.search(r'\d{4}[a-z]?$', key) or key in INTENDED:
        return m.group(0)
    if pre in ";-":
        return m.group(0)
    escaped.append(key)
    return f"{pre}\\@{key}"
text, _ = re.subn(r'(.)@([A-Za-z][A-Za-z0-9_]*(?:[:.#$%&+?<>~/-][A-Za-z0-9_]+)*)', handle, text)
log.append(f"@handles escaped: {len(set(escaped))}")

# ── 8. References: let citeproc build it, so every citation is a live link ─
#     The hand-written list on the website cannot carry link targets, and it is
#     missing entries for works the chapters cite (Abbas 2020, 4chan 2022,
#     Crawford and Gillespie 2016 among them). The generated list contains
#     exactly the works cited, in the same Harvard style, each one linked.
head = text.index("\n# References")
hand_count = len([l for l in text[head:].split("\n")
                  if l.strip() and not l.lstrip().startswith("#")])
text = text[:head] + "\n# References\n\n::: {#refs}\n:::\n"
log.append(f"References: hand-written list ({hand_count} entries) replaced by "
           f"citeproc's generated, hyperlinked bibliography")

# ── 9. glyphs the body font cannot render ─────────────────────────────────
text = text.replace("￼", "").replace("\U0001D54F", "X")
for e in ("\U0001F602", "\U0001F99C", "\U0001F9F5"):
    text = text.replace(e, "")
text = text.replace("⟷", r"\ensuremath{\longleftrightarrow}")

open("body.md", "w", encoding="utf-8").write(text)
print("\n".join(log))
print("remaining ](#^ links:", len(re.findall(r'\]\(#\\?\^', text)))
print("remaining [[wikilinks:", len(re.findall(r'\[\[', text)))
