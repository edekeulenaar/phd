# PDF build

Turns `Manuscript-merged.md` (the version of record in the Obsidian vault)
into `pdf/E de Keulenaar - PhD thesis - Dialogue and restraint.pdf`.

    bash tools/pdfbuild/build.sh          # ~4 minutes, writes thesis.pdf here

Environment: `VAULT` (default `~/Projects/Master_vault`) and `FONTS`
(default `~/.cache/phd-site/fonts`, i.e. this repo's fonts).

Steps, in order:

| file | what it does |
|---|---|
| `prep.py` | merged manuscript → `body.md`: heading ids, Obsidian links and block anchors → internal links, images resolved, `.mp4` embeds → a still from `stills/`, footnote labels namespaced per chapter, hand-written References replaced by citeproc's |
| `shrink.py` | copies images into `img/`, recompressing the large ones and whitening the site's paper-coloured backgrounds |
| `merge-bib.py` | live Zotero export + archived URLs from the wayback snapshot + `My_Library_overrides.json` → `My_Library_merged.bib`; strips emoji the PDF fonts cannot set |
| `pandoc` | `body.md` → `thesis.tex` with citeproc (Harvard), `fix-pdf.lua`, `header.tex`, `titlepage.tex` |
| `fix-pdf.lua` | table widths, prompts as boxes, figure + caption in one float, headings kept with the figure or table below them, annexes on a fresh page |
| `headglyphs.py` | wraps glyphs the heading face lacks in a fallback font; gives each chapter its "Chapter N" line |
| `xelatex` ×3 | `thesis.pdf` |

After a build: copy `thesis.pdf` to `pdf/E de Keulenaar - PhD thesis - Dialogue
and restraint.pdf`, run `python3 scripts/build_site_data.py` (it hashes the PDF
into `data/toc.json` as the download's cache key), then commit both.

The bibliography repairs live in `My_Library_overrides.json` next to the Zotero
export, not in the export itself: Better BibTeX rewrites the export and silently
undoes anything edited there. Twelve records were lost that way in September
2026 and are now restored from this file on every build.

Recovered on 23 September 2026 from the session transcripts after the original
working copy, which lived only in a temporary directory, was deleted by a reboot.
