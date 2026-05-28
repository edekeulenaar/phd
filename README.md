# Censorship & moderation — interactive Chapter 1

Static page that pairs the manuscript text with interactive overviews of the
underlying literature corpus. Lives in the
[`edekeulenaar/censorship-and-moderation`](https://github.com/edekeulenaar/censorship-and-moderation)
repository, published via GitHub Pages at
**`https://edekeulenaar.github.io/censorship-and-moderation/`**.

## Local preview

```sh
cd "site/"
python3 -m http.server 8000
# open  http://localhost:8000/
```

`fetch()` (used to load the manuscript and CSVs) requires a real HTTP server —
opening `index.html` directly via `file://` will not work.

## Layout

```
site/
├── index.html              static page (manuscript + analysis)
├── style.css               off-white aesthetic, two-column
├── app.js                  Markdown render, TOC, citation hovers, Sankey #1
├── manuscript.md           ch.1, truncated at line 76 ("## 7. Limitations")
├── data/                   overview CSVs (downloadable from each figure)
│   ├── summary.csv
│   ├── items_by_disc_topic_subtopic.csv
│   ├── items_year_disc_topic.csv
│   ├── items_year_disc_subtopic.csv
│   ├── top_countries_by_topic.csv
│   ├── top_countries_by_cm_subtopic.csv
│   ├── top_media_by_topic.csv
│   └── top_media_by_cm_subtopic.csv
├── scripts/
│   └── build_site_data.py  regenerate site/data/*.csv from master + v2
└── README.md
```

## Regenerating data

```sh
python3 site/scripts/build_site_data.py
```

Reads from the project root:

- `master_bibliography.csv` — relevance screening, discipline, file paths.
- `taxonomy_classification_v2.csv` — Gemini Stage-1 (Topic / Sub-topic) +
  Stage-2 (WHAT / HOW / WHO / WHY) findings.

## Publishing to GitHub Pages

```sh
# (one-time) point this directory at the GitHub repo
git init
git remote add origin https://github.com/edekeulenaar/censorship-and-moderation.git

# every push
git add .
git commit -m "site update"
git push -u origin main
```

Then in the repo settings → Pages → Build from `main` branch, root directory.
The site lives at <https://edekeulenaar.github.io/censorship-and-moderation/>.

## What's done vs. pending

| Section | State |
|---|---|
| Page scaffold, sidebar TOC, off-white aesthetic | ✅ Phase 1 |
| Manuscript render (md → HTML) with citation hovers | ✅ Phase 1 (key only — refs resolve in Phase 3) |
| Fig 1 · Summary table                | ✅ Phase 1 |
| Fig 2 · Sankey Discipline→Topic→Sub-topic | ✅ Phase 1 |
| Fig 3 · Items × Year × Discipline × Topic       | ⏳ Phase 2 |
| Fig 4 · Items × Year × Discipline × CM Sub-topic | ⏳ Phase 2 |
| Fig 5 · Top-10 countries Sankey      | ⏳ Phase 2 |
| Fig 6 · Top-10 media Sankey          | ⏳ Phase 2 |
| Fig 7 · Beeswarm per Topic           | ⏳ Phase 2 |
| Fig 8 · Beeswarm CM Sub-topics       | ⏳ Phase 2 |
| Fig 9 · Gantt / matrix-plot toggle   | ⏳ Phase 2 |
| Fig 10 · Network — Topic layer       | ⏳ Phase 2 |
| Fig 11 · Network — Sub-topic layer   | ⏳ Phase 2 |
| Citation hover-cards resolve via CSL-JSON | ⏳ Phase 3 |
| Accessibility / responsive pass      | ⏳ Phase 3 |
