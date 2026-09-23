set -e
B="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V="${VAULT:-/Users/edekeulenaar/Projects/Master_vault}"
FONTS="${FONTS:-$HOME/.cache/phd-site/fonts}"
cd "$B"
# header.tex ships with a placeholder for the font directory so the build
# runs from any clone; fill it in for this run.
sed "s|FONTSDIR/|$FONTS/|g" "$B/header.tex" > "$B/header.run.tex"

echo "== 1. prep =="   ; python3 prep.py
echo "== 2. images =="; python3 shrink.py
echo "== 2b. merge the bibliographies =="
python3 "$B/merge-bib.py"
echo "== 3. pandoc -> latex =="
cd "$V"
pandoc "$B/body.md" -f markdown-tex_math_dollars-implicit_figures -t latex --standalone \
  --citeproc \
  `# Built by merge-bib.py: every field from the live Zotero export, with the` \
  `# wayback snapshot supplying only its archived URLs.` \
  --bibliography="/Users/edekeulenaar/Projects/PhDs/PhD 2020-2025/PhD - Manuscript/My_Library_merged.bib" \
  --csl=".pandoc/harvard-cite-them-right.csl" \
  -M link-citations=true \
  --lua-filter="$B/fix-pdf.lua" \
  --toc --toc-depth=2 \
  -V documentclass=report -V papersize=a4 -V geometry:margin=2.5cm \
  -V fontsize=11pt -V linestretch=1.4 -V colorlinks=true -V linkcolor=blue \
  -V citecolor=blue -V urlcolor=blue -V toccolor=black \
  --include-in-header="$B/header.run.tex" --include-before-body="$B/titlepage.tex" \
  -o "$B/thesis.tex" 2> "$B/tex.log"
echo "   citeproc misses: $(grep -c Citeproc "$B/tex.log" || true)"
echo "== 4. heading glyph fallback =="
cd "$B"
python3 headglyphs.py thesis.tex

echo "== 5. xelatex x3 =="
cd "$B"
for i in 1 2 3; do
  xelatex -interaction=nonstopmode -file-line-error thesis.tex > "pass$i.log" 2>&1 || true
  echo "   pass $i: $(grep -h 'Output written' "pass$i.log" | tail -1)"
done
echo "   undefined references: $(grep -c 'undefined' pass3.log || true)"
ls -lh thesis.pdf
echo "BUILD COMPLETE"
