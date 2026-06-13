# Thesis PDF links

The PDFs are too large to live in this repo, so they're hosted externally.
Edit **pdf-urls.json** to point each section at its hosted URL:

  {
    "thesis": "https://your-host/thesis.pdf",
    "chapter-1": "https://your-host/chapter-1.pdf"
  }

- "thesis" is the full-thesis PDF (shown as "Download full thesis").
- Per-section keys use the slug shown in the URL (#/chapter-7 → "chapter-7").
- Leave a value as "" if that section has no PDF yet.

Re-run site/scripts/build_site_data.py after editing so the site picks up
the links. (Small per-section PDFs may alternatively be committed here as
<slug>.pdf and they'll be linked directly — but anything near GitHub's
100 MB file limit must be hosted externally.)
