"""Wrap the characters the heading face lacks in a fallback font.

The Test National trial has 68 glyphs and no colon, slash, question mark, en
dash or quotation marks, so headings silently dropped them. The browser hides
this by falling back per character to Helvetica Neue, which is exactly what the
site's --sans stack asks for; XeLaTeX has no such fallback. Do it by hand, and
only inside heading commands, so the body keeps ACaslon's own punctuation.
"""
import re, sys

TEX = sys.argv[1] if len(sys.argv) > 1 else "thesis.tex"
# Single characters the heading face lacks.
MISSING = ":/?#–’“”"
# Pandoc writes the curly quotes and dashes as TeX ligatures, not as Unicode,
# so looking only for the characters above missed every heading that used one:
# "``great replacement''" came out as two empty boxes. The fallback face does
# not form TeX ligatures either, so substitute the character each one stands
# for rather than passing the ligature through, or "``" prints as two
# backticks. Longest first.
LIGATURES = [("---", "\u2014"), ("--", "\u2013"), ("``", "\u201C"),
             ("''", "\u201D"), ("`", "\u2018"), ("'", "\u2019")]
CMDS = ("chapter", "section", "subsection", "subsubsection", "paragraph",
        "caption", "captionsetup")

def brace_span(s, i):
    """`i` is the index of an opening brace; return the index just past its match."""
    depth = 0
    while i < len(s):
        if s[i] == "\\":
            i += 2; continue
        if s[i] == "{": depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0: return i + 1
        i += 1
    return -1

def patch(title):
    # Ligatures first, so "---" is not eaten one hyphen at a time.
    lig = "|".join(re.escape(a) for a, _ in LIGATURES)
    table = dict(LIGATURES)
    title = re.sub("(?<!\\\\)(" + lig + ")",
                   lambda m: "{\\headfallback " + table[m.group(0)] + "}", title)
    # "#" is TeX's parameter character; inside a heading, which titlesec
    # re-reads when it saves the running mark, it must be written \#.
    return re.sub("[" + re.escape(MISSING) + "]",
                  lambda m: "{\\headfallback " + ("\\#" if m.group(0) == "#" else m.group(0)) + "}", title)

src = open(TEX, encoding="utf-8").read()

# Pandoc writes its table columns with plain \raggedright, which forbids
# hyphenation, so a long word in a narrow column overflows instead of breaking
# ("Marginalization" ran straight over the next column). ragged2e's variant
# keeps the ragged edge and allows the break.
src, ragged = re.subn(r'\\raggedright\\arraybackslash', r'\\RaggedRight\\arraybackslash', src)
print(f"   table columns allowed to hyphenate: {ragged}")

# A \newpage immediately before a sectioning command is left over from the
# manuscript's page-break divs. \chapter already starts a page, so the stray
# break only pushed the title a line further down.
src, dropped = re.subn(r'\\newpage\s*\n\s*(?=\\(?:chapter|section)\b)', '', src)
print(f"   stray page breaks before a heading removed: {dropped}")
# Only the document body: the preamble defines \chapterwithlabel in terms of
# \chapter[#2]{#3}, and walking that turned its "#3" into "{\headfallback #}3".
body_at = src.find("\\begin{document}")
preamble, src = (src[:body_at], src[body_at:]) if body_at >= 0 else ("", src)
out, i, n = [preamble], 0, 0
pat = re.compile(r"\\(" + "|".join(CMDS) + r")\*?(?:\[[^\]]*\])?\{")
while True:
    m = pat.search(src, i)
    if not m:
        out.append(src[i:]); break
    end = brace_span(src, m.end() - 1)
    if end == -1:
        out.append(src[i:]); break
    title = src[m.end():end - 1]
    new = patch(title)
    if new != title: n += 1
    out.append(src[i:m.end()]); out.append(new); out.append("}")
    i = end
src2 = "".join(out)

# "\\chapter{Chapter 14. From Twitter to X: ...}" becomes
# "\\chapterwithlabel{Chapter 14}{Chapter 14. From Twitter to X: ...}{From Twitter to X: ...}":
# the contents and the outline keep the full "Chapter 14. ..." entry, while
# the page shows the number on its own line above the title. Done here rather
# than in prep.py so pandoc still sees one plain heading.
def relabel(m):
    num, rest = m.group(1), m.group(2)
    return "\\chapterwithlabel{Chapter " + num + "}{Chapter " + num + ". " + rest + "}{" + rest + "}"
src2, relabelled = re.subn(r"\\chapter\{Chapter (\d+)\.\s+((?:[^{}]|\{[^{}]*\})*)\}", relabel, src2)
print(f"   chapters given a separate number line: {relabelled}")
open(TEX, "w", encoding="utf-8").write(src2)
print(f"   headings given a fallback glyph: {n}")
