#!/usr/bin/env python3
"""
build_site_data.py — produce the OVERVIEW CSVs consumed by the static site
(`site/data/*.csv`).

SOLE SOURCE
    "Chapter 1 - Final results - Results.csv"   (root)
    One row per finding; columns:
      Key, Title, Author, Citations, Year, Discipline, Topic, Sub-topic,
      Country, Medium, Media category, Type, Category, Mentioned item, Page,
      Source, File, PDF Path, DOI, Publication Title, ISSN, Volume, Issue,
      Pages, Publisher, Abstract Note

The study population is the set of unique Zotero Keys in this CSV.
All discipline / topic / sub-topic / country / media-category / year rollups
are deduplicated to that set. No other CSV is consulted.

Outputs (six files):

    summary.csv                          metric, value
    items_by_disc_topic_subtopic.csv     Quantity, Discipline, Topic, Sub-topic
                                         → Sankey / alluvial source
    items_year_disc_topic.csv            per-item rows for the
                                         Year × Discipline × Topic chart
                                         columns:
                                           Citations, Publication Year, Discipline,
                                           Topic, Title, Author, Key
    items_year_disc_subtopic.csv         same but only for Content-moderation
                                         items, grouped by Sub-topic
    top_countries_by_topic.csv           Topic, Country, Quantity (top 10 / Topic)
    top_countries_by_cm_subtopic.csv     Sub-topic, Country, Quantity
    top_media_by_topic.csv               Topic, Medium, Quantity (top 10 / Topic)
    top_media_by_cm_subtopic.csv         Sub-topic, Medium, Quantity

Item dedup: by Zotero Key; falls back to normalised Title.
Topic / Sub-topic / Discipline / Year per item = the most-common value across
that item's v2 finding rows. Country / Medium are '; '-split.
"""

from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

csv.field_size_limit(10**7)

# ─── Paths ────────────────────────────────────────────────────────────────────
# The script lives at  site/scripts/build_site_data.py
# Project root is two levels up.
ROOT   = Path(__file__).resolve().parent.parent.parent
SRC    = ROOT / "Chapter 1 - Final results - New results.csv"
MASTER = ROOT / "master_bibliography.csv"   # only for: (a) Fig 1 counts,
                                            # (b) URL-by-Key (Fig 7 hover-link)
OUT    = Path(__file__).resolve().parent.parent / "data"
OUT.mkdir(parents=True, exist_ok=True)

# Topic + Sub-topic vocabularies are OPEN: derived from whatever values
# appear in the cleaned data (excluding plain/"Other:" buckets).
# See `derive_topics()` below — it's filled at the top of main().
TOPICS: list[str] = []
SUBTOPIC_PARENT = "Content moderation"

# Source markdown we mirror into site/manuscript.md on every build.
MANUSCRIPT_SRC = Path("/Users/edekeulenaar/Projects/Master_vault/Manuscript/"
                      "Chapter 1. Censorship and moderation.md")
SITE_MANUSCRIPT = Path(__file__).resolve().parent.parent / "manuscript.md"


def _is_other(v: str) -> bool:
    v = (v or "").strip().lower()
    return v in ("", "other") or v.startswith("other:")


def derive_topics(rows: list[dict]) -> list[str]:
    """Every Topic value present in the data, minus the catch-all 'Other'.
    Under the v2 schema 'Topic' is the WHAT-typed finding's Category."""
    seen = set()
    out = []
    for r in rows:
        if (r.get("Type") or "").strip().upper() != "WHAT":
            continue
        t = (r.get("Category") or "").strip()
        if not t or _is_other(t) or t in seen:
            continue
        seen.add(t); out.append(t)
    return out

TOP_N_COUNTRY = 10
TOP_N_MEDIUM  = 10

DISC_BLANK = "(unspecified)"
MULTI_SPLIT = re.compile(r"\s*[;|]\s*")


# ─── Helpers ──────────────────────────────────────────────────────────────────

def nt(t) -> str:
    if not isinstance(t, str):
        t = "" if t is None else str(t)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", t.lower())).strip()


def clean_year(v) -> str:
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", str(v or ""))
    return m.group(1) if m else ""


def clean_citations(v) -> int:
    s = str(v or "").strip()
    if not s:
        return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def disc(v) -> str:
    return (v or "").strip() or DISC_BLANK


def split_multi(v) -> list[str]:
    out = []
    for part in MULTI_SPLIT.split(str(v or "").strip()):
        p = part.strip()
        if p and p not in out:
            out.append(p)
    return out


def item_id(r: dict) -> str:
    k = (r.get("Key") or "").strip()
    if k:
        return f"key:{k}"
    nt_ = nt(r.get("Title"))
    return f"title:{nt_}" if nt_ else ""


def load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, header: list[str], rows: list[list]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"  ✓ data/{path.name:<46}  {len(rows):>6,} rows")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    if not SRC.exists():
        sys.exit(f"✗ {SRC} not found")

    print(f"Reading {SRC.name} …")
    F = load_csv(SRC)
    print(f"  findings: {len(F):,} rows")

    # Always re-sync the manuscript from the source-of-truth file.
    if MANUSCRIPT_SRC.exists():
        import shutil as _sh
        _sh.copy2(MANUSCRIPT_SRC, SITE_MANUSCRIPT)
        with open(SITE_MANUSCRIPT, encoding="utf-8") as _f:
            print(f"Synced manuscript ({sum(1 for _ in _f):,} lines) → "
                  f"{SITE_MANUSCRIPT.name}")
    else:
        print(f"  (manuscript source not found: {MANUSCRIPT_SRC})")

    # Rebuild Harvard bibliography for cite keys in the manuscript.
    try:
        import subprocess as _sub, sys as _sys
        _sub.check_call([_sys.executable,
                         str(Path(__file__).with_name("build_bibliography.py"))])
    except Exception as _e:
        print(f"  (bibliography build skipped: {_e})")

    # Derive the Topic vocabulary from the cleaned data.
    global TOPICS
    TOPICS = derive_topics(F)
    print(f"Topics derived from data ({len(TOPICS)}): {', '.join(TOPICS)}")

    # ── master_bibliography.csv: minimal read for two summary counts and a
    #    Key→Url map (Fig 7 hover-cards link out via the Url column).
    master_total = master_ym = 0
    url_by_key: dict[str, str] = {}
    if MASTER.exists():
        print(f"Reading {MASTER.name} (counts + URLs) …")
        for r in load_csv(MASTER):
            master_total += 1
            if (r.get("Relevant") or "").strip().upper() in ("YES", "MAYBE"):
                master_ym += 1
            k = (r.get("Key") or "").strip()
            u = (r.get("Url") or r.get("URL") or "").strip()
            if k and u:
                url_by_key[k] = u
        print(f"  master: {master_total:,} rows · YES+MAYBE: {master_ym:,} · "
              f"with Url: {len(url_by_key):,}\n")
    else:
        print(f"  (master not found — Fig 1 master counts left blank)\n")

    # ── 1. summary ──────────────────────────────────────────────────────────
    # Unique Zotero Keys in the final results = the study's operational N.
    final_keys     : set[str] = set()
    final_with_pdf : set[str] = set()
    for r in F:
        k = (r.get("Key") or "").strip()
        if not k:
            continue
        final_keys.add(k)
        pdf = (r.get("PDF Path") or "").strip()
        if pdf and os.path.isfile(pdf):
            final_with_pdf.add(k)

    write_csv(OUT / "summary.csv", ["metric", "value"], [
        ["master_total_items",      master_total],
        ["master_yes_maybe",        master_ym],
        ["final_unique_items",      len(final_keys)],
        ["final_with_pdf_on_disk",  len(final_with_pdf)],
    ])

    # ── key→url map for the beeswarm hover-card link ────────────────────────
    used = sorted(k for k in url_by_key if k in final_keys)
    write_csv(OUT / "key_url.csv",
              ["Key", "Url"],
              [[k, url_by_key[k]] for k in used])

    # ── Per-item rollup from v2 finding rows ────────────────────────────────
    item_topic    = defaultdict(Counter)
    item_subtopic = defaultdict(Counter)
    item_disc     = defaultdict(Counter)
    item_year     = defaultdict(Counter)
    item_cit      = {}                       # one citations value per item
    item_title    = {}
    item_author   = {}
    item_key      = {}                       # Zotero Key (or '')
    item_abstract = {}                       # Abstract Note (first non-empty)
    item_lang     = {}                       # Language (first non-empty)
    item_countries:   dict[str, set] = defaultdict(set)
    item_media_cat:   dict[str, set] = defaultdict(set)  # 'Media category' (v2_final)
    item_how:         dict[str, set] = defaultdict(set)  # HOW categories per item
    for r in F:
        t = item_id(r)
        if not t:
            continue
        item_title.setdefault(t, (r.get("Title") or "").strip())
        item_author.setdefault(t, (r.get("Author") or "").strip())
        item_key.setdefault(t, (r.get("Key") or "").strip())
        if t not in item_abstract and (r.get("Abstract Note") or "").strip():
            item_abstract[t] = (r.get("Abstract Note") or "").strip()
        lg = (r.get("Language") or "").strip().lower()
        if lg and t not in item_lang:
            item_lang[t] = lg
        # New v2 schema: Topic/Sub-topic don't exist as their own columns —
        # they are the Category + Sub-category of the row when Type == WHAT.
        # Each finding's WHAT category contributes one vote toward the item's
        # most-common WHAT framing (its 'Topic'); same for sub-categories.
        if (r.get("Type") or "").strip().upper() == "WHAT":
            wc = (r.get("Category") or "").strip()
            ws = (r.get("Sub-category") or "").strip()
            if wc:
                item_topic[t][wc] += 1
                # Per the chapter's data convention, an "Other" category never
                # carries a sub-category — keep it consistent here.
                if ws and not wc.lower().startswith("other"):
                    item_subtopic[t][ws] += 1
        item_disc[t][disc(r.get("Discipline"))] += 1
        y = clean_year(r.get("Year"))
        if y:
            item_year[t][y] += 1
        # citations: keep the largest value seen for the item (rows agree usually)
        c = clean_citations(r.get("Citations"))
        if c > item_cit.get(t, 0):
            item_cit[t] = c
        item_countries[t].update(split_multi(r.get("Country")))
        # 'Media category' supersedes the raw 'Medium' column for the
        # top-10 media visualisations.  Both header spellings are tolerated
        # in case the CSV is renamed.
        item_media_cat[t].update(split_multi(
            r.get("Media category") or r.get("Medium category") or ""))
        # HOW categories: collect the per-finding Category whenever Type=HOW.
        if (r.get("Type") or "").strip().upper() == "HOW":
            cat = (r.get("Category") or "").strip()
            if cat:
                item_how[t].add(cat)

    items = list(item_title.keys())
    topic_of    = lambda t: item_topic[t].most_common(1)[0][0]    if item_topic[t]    else ""
    subtopic_of = lambda t: item_subtopic[t].most_common(1)[0][0] if item_subtopic[t] else ""
    disc_of     = lambda t: item_disc[t].most_common(1)[0][0]     if item_disc[t]     else DISC_BLANK
    year_of     = lambda t: item_year[t].most_common(1)[0][0]     if item_year[t]     else ""

    # ── 2. items_by_disc_topic_subtopic (Sankey / alluvial source) ──────────
    sub_blank = "(none)"
    agg = Counter()
    for t in items:
        topic = topic_of(t) or "(unknown)"
        sub   = subtopic_of(t) if topic == SUBTOPIC_PARENT else sub_blank
        if topic == SUBTOPIC_PARENT and not sub:
            sub = sub_blank
        agg[(disc_of(t), topic, sub)] += 1
    write_csv(OUT / "items_by_disc_topic_subtopic.csv",
              ["Quantity", "Discipline", "Topic", "Sub-topic"],
              [[n, d, top, sub] for (d, top, sub), n in
               sorted(agg.items(), key=lambda x: (-x[1], x[0]))])

    # ── 3. items_year_disc_topic (per-item; node size = citations) ──────────
    rows3 = []
    for t in items:
        rows3.append([
            item_cit.get(t, 0),
            year_of(t) or "",
            disc_of(t),
            topic_of(t) or "(unknown)",
            item_title.get(t, ""),
            item_author.get(t, ""),
            item_key.get(t, ""),
            item_abstract.get(t, ""),
            item_lang.get(t, ""),
        ])
    rows3.sort(key=lambda r: (str(r[3]), str(r[1]), -r[0]))
    write_csv(OUT / "items_year_disc_topic.csv",
              ["Citations", "Publication Year", "Discipline", "Topic",
               "Title", "Author", "Key", "Abstract Note", "Language"], rows3)

    # ── 4. items_year_disc_subtopic (CM only) ───────────────────────────────
    rows4 = []
    for t in items:
        if topic_of(t) != SUBTOPIC_PARENT:
            continue
        sub = subtopic_of(t)
        if not sub:
            continue
        rows4.append([
            item_cit.get(t, 0),
            year_of(t) or "",
            disc_of(t),
            sub,
            item_title.get(t, ""),
            item_author.get(t, ""),
            item_key.get(t, ""),
            item_abstract.get(t, ""),
            item_lang.get(t, ""),
        ])
    rows4.sort(key=lambda r: (str(r[3]), str(r[1]), -r[0]))
    write_csv(OUT / "items_year_disc_subtopic.csv",
              ["Citations", "Publication Year", "Discipline", "Sub-topic",
               "Title", "Author", "Key", "Abstract Note", "Language"], rows4)

    # ── 4b. language_summary.csv (one row per language code) ────────────────
    LANG_NAMES = {
        "en":"English","fr":"French","es":"Spanish","pt":"Portuguese",
        "it":"Italian","de":"German","ca":"Catalan","nl":"Dutch",
        "id":"Indonesian","pl":"Polish","hr":"Croatian","ro":"Romanian",
        "af":"Afrikaans","ru":"Russian","tr":"Turkish","cy":"Welsh",
        "hu":"Hungarian","vi":"Vietnamese","so":"Somali","und":"undetermined",
    }
    lang_counter = Counter(item_lang.get(t,"und") or "und" for t in items)
    write_csv(OUT / "language_summary.csv",
              ["code", "name", "items"],
              [[code, LANG_NAMES.get(code, code.upper()), n]
               for code, n in sorted(lang_counter.items(),
                                     key=lambda x: (-x[1], x[0]))])

    # ── 4c. items_by_language_country.csv (alluvial source, 2-stage) ────────
    # Long-form tidy: one row per (Language × Country) pair. An item that
    # mentions N countries contributes 1 to each of N rows; items without
    # any Country value land under "(unspecified)".
    lc = Counter()
    for t in items:
        L = item_lang.get(t, "und") or "und"
        if not item_countries[t]:
            lc[(L, "(unspecified)")] += 1
        for c in item_countries[t]:
            lc[(L, c)] += 1
    write_csv(OUT / "items_by_language_country.csv",
              ["Language", "LanguageName", "Country", "Items"],
              [[L, LANG_NAMES.get(L, L.upper()), C, n]
               for (L, C), n in sorted(lc.items(),
                                       key=lambda x: (-x[1], x[0][0], x[0][1]))])

    # ── 4d. items_by_language_country_topic.csv (Fig 1 alluvial, 3-stage) ──
    lct = Counter()
    for t in items:
        L = item_lang.get(t, "und") or "und"
        T = topic_of(t) or "(unknown)"
        if not item_countries[t]:
            lct[(L, "(unspecified)", T)] += 1
        for c in item_countries[t]:
            lct[(L, c, T)] += 1
    write_csv(OUT / "items_by_language_country_topic.csv",
              ["Language", "LanguageName", "Country", "Topic", "Items"],
              [[L, LANG_NAMES.get(L, L.upper()), C, T, n]
               for (L, C, T), n in sorted(lct.items(),
                                           key=lambda x: (-x[1], x[0]))])

    # ── 4e. items_by_language_country_cm_subtopic.csv (Fig 1 toggle) ───────
    # Same shape but restricted to items whose Topic is Content moderation,
    # with the final stage being the CM Sub-topic (blank → "(unspecified)").
    lcs = Counter()
    for t in items:
        if topic_of(t) != SUBTOPIC_PARENT:
            continue
        S = subtopic_of(t) or "(unspecified)"
        L = item_lang.get(t, "und") or "und"
        if not item_countries[t]:
            lcs[(L, "(unspecified)", S)] += 1
        for c in item_countries[t]:
            lcs[(L, c, S)] += 1
    write_csv(OUT / "items_by_language_country_cm_subtopic.csv",
              ["Language", "LanguageName", "Country", "Sub-topic", "Items"],
              [[L, LANG_NAMES.get(L, L.upper()), C, S, n]
               for (L, C, S), n in sorted(lcs.items(),
                                           key=lambda x: (-x[1], x[0]))])

    # ── 4f. media_per_item_year_topic.csv / _cm_subtopic.csv (Fig 5 bump) ──
    # One row per (item, Media category) pair, so renderBump can group by
    # Media category and end up with one line per medium — each item that
    # mentions multiple media categories contributes once to each line.
    rows_t, rows_s = [], []
    for t in items:
        if not item_media_cat[t]:
            continue
        year = year_of(t) or ""
        if not year:
            continue
        item_disc_name = disc_of(t)
        topic = topic_of(t) or "(unknown)"
        title  = item_title.get(t, "")
        author = item_author.get(t, "")
        key    = item_key.get(t, "")
        abst   = item_abstract.get(t, "")
        cits   = item_cit.get(t, 0)
        for media in item_media_cat[t]:
            base = [cits, year, item_disc_name, media, title, author, key, abst]
            rows_t.append(base + [topic])
            if topic == SUBTOPIC_PARENT:
                sub = subtopic_of(t)
                if sub:
                    rows_s.append(base + [sub])
    rows_t.sort(key=lambda r: (r[3], str(r[1]), -r[0]))
    rows_s.sort(key=lambda r: (r[3], str(r[1]), -r[0]))
    write_csv(OUT / "media_per_item_year_topic.csv",
              ["Citations", "Publication Year", "Discipline", "Media category",
               "Title", "Author", "Key", "Abstract Note", "Topic"], rows_t)
    write_csv(OUT / "media_per_item_year_cm_subtopic.csv",
              ["Citations", "Publication Year", "Discipline", "Media category",
               "Title", "Author", "Key", "Abstract Note", "Sub-topic"], rows_s)

    # ── 4g. items_by_topic_medium_how.csv (Topic → Medium → How alluvial) ──
    # One row per (Topic, Medium, HOW-category) triple. Each item contributes
    # 1 to every (its Topic × each of its mediums × each of its HOW codes).
    tmh = Counter()
    for t in items:
        topic = topic_of(t) or "(unknown)"
        if not item_media_cat[t] or not item_how[t]:
            continue
        for m in item_media_cat[t]:
            for h in item_how[t]:
                tmh[(topic, m, h)] += 1
    write_csv(OUT / "items_by_topic_medium_how.csv",
              ["Topic", "Medium", "How", "Items"],
              [[T, M, H, n] for (T, M, H), n in sorted(tmh.items(),
                                                       key=lambda x: (-x[1], x[0]))])

    # ── 5–8. Top-10 countries / media by Topic and by CM Sub-topic ──────────
    def _top_by(group_of, label_col: str, items_field: dict, n: int):
        per: dict[str, Counter] = defaultdict(Counter)
        for t in items:
            g = group_of(t)
            if not g:
                continue
            for v in items_field[t]:
                per[g][v] += 1
        out: list[list] = []
        for g, c in per.items():
            for v, k in c.most_common(n):
                out.append([g, v, k])
        out.sort(key=lambda r: (r[0], -r[2]))
        return out

    write_csv(OUT / "top_countries_by_topic.csv",
              ["Topic", "Country", "Quantity"],
              _top_by(topic_of, "Topic", item_countries, TOP_N_COUNTRY))

    write_csv(OUT / "top_countries_by_cm_subtopic.csv",
              ["Sub-topic", "Country", "Quantity"],
              _top_by(lambda t: subtopic_of(t) if topic_of(t) == SUBTOPIC_PARENT else "",
                      "Sub-topic", item_countries, TOP_N_COUNTRY))

    write_csv(OUT / "top_media_by_topic.csv",
              ["Topic", "Media category", "Quantity"],
              _top_by(topic_of, "Topic", item_media_cat, TOP_N_MEDIUM))

    write_csv(OUT / "top_media_by_cm_subtopic.csv",
              ["Sub-topic", "Media category", "Quantity"],
              _top_by(lambda t: subtopic_of(t) if topic_of(t) == SUBTOPIC_PARENT else "",
                      "Sub-topic", item_media_cat, TOP_N_MEDIUM))

    # ── 9–10. Per-finding beeswarm CSVs (per-Topic and per-CM-Subtopic) ─────
    # Each finding row inherits the item's rolled-up Topic / Sub-topic /
    # Discipline / Year / Citations (most common across the item's finding
    # rows) for consistent X-axis & colour mapping.
    bee_t: list[list] = []
    bee_s: list[list] = []
    TYPES_ALLOWED = {"WHO", "WHAT", "HOW", "WHY"}
    # The v2 dataset carries paragraph-length verbatim quotes plus full
    # abstracts; per-finding repetition of these would balloon each beeswarm
    # CSV well past GitHub Pages' file-size limits. Truncate the hover-card
    # quote to a readable preview (the full quote lives in the source v2 CSV)
    # and drop fields the chart never consults.
    QUOTE_PREVIEW_MAX = 240
    for r in F:
        t = item_id(r)
        if not t:
            continue
        ty  = (r.get("Type") or "").strip().upper()
        cat = (r.get("Category") or "").strip()
        if ty not in TYPES_ALLOWED or not cat:
            continue
        top = topic_of(t)
        if top not in TOPICS:
            continue
        # Pipe-joined lists of every Media category / Country the item
        # touches; the client filters via substring-match against these
        # multi-valued columns.
        media     = " | ".join(sorted(item_media_cat[t]))
        countries = " | ".join(sorted(item_countries[t]))
        quote = (r.get("Mentioned item") or "").strip()
        if len(quote) > QUOTE_PREVIEW_MAX:
            quote = quote[:QUOTE_PREVIEW_MAX - 1].rstrip() + "…"
        row = [
            item_cit.get(t, 0),
            year_of(t) or "",
            disc_of(t),
            top, ty, cat,
            quote,
            (r.get("Page") or "").strip(),
            item_title.get(t, ""),
            item_author.get(t, ""),
            item_key.get(t, ""),
            item_lang.get(t, ""),
            media,
            countries,
        ]
        bee_t.append(row)
        if top == SUBTOPIC_PARENT:
            sub = subtopic_of(t)
            if sub:
                bee_s.append([
                    item_cit.get(t, 0), year_of(t) or "", disc_of(t),
                    sub, ty, cat,
                    quote,
                    (r.get("Page") or "").strip(),
                    item_title.get(t, ""), item_author.get(t, ""),
                    item_key.get(t, ""),
                    item_lang.get(t, ""),
                    media,
                    countries,
                ])

    bee_t.sort(key=lambda r: (r[3], r[4], r[5], str(r[1]), -r[0]))
    bee_s.sort(key=lambda r: (r[3], r[4], r[5], str(r[1]), -r[0]))
    write_csv(OUT / "beeswarm_by_topic.csv",
              ["Citations", "Publication Year", "Discipline", "Topic", "Type",
               "Category", "Mentioned item", "Page", "Title", "Author", "Key",
               "Language", "Media categories", "Countries"],
              bee_t)
    write_csv(OUT / "beeswarm_by_cm_subtopic.csv",
              ["Citations", "Publication Year", "Discipline", "Sub-topic", "Type",
               "Category", "Mentioned item", "Page", "Title", "Author", "Key",
               "Language", "Media categories", "Countries"],
              bee_s)

    # ── 11–14. Network CSVs (Topic-level and CM Sub-topic-level) ────────────
    # Five layers — we emit edges for EVERY ordered layer pair (GROUP→WHO,
    # GROUP→HOW, GROUP→WHAT, GROUP→WHY, WHO→HOW, WHO→WHAT, WHO→WHY,
    # HOW→WHAT, HOW→WHY, WHAT→WHY), so the chart can reveal direct
    # cross-layer co-occurrences (#network all-pair edges), not only the
    # adjacent ones. Edge weight = number of unique items the pair occurs in.
    NET_ORDER = ["GROUP", "WHO", "HOW", "WHAT", "WHY"]
    LAYER_PAIRS = [(a, b) for i, a in enumerate(NET_ORDER) for b in NET_ORDER[i+1:]]

    def _network(group_of):
        """Return (edges, nodes) for a given grouping (Topic or Sub-topic)."""
        # collect categories per item per layer
        cats_by_item: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
        for r in F:
            t = item_id(r)
            ty = (r.get("Type") or "").strip().upper()
            cat = (r.get("Category") or "").strip()
            if t and ty in TYPES_ALLOWED and cat:
                cats_by_item[t][ty].add(cat)

        edge_w: Counter = Counter()
        node_items: dict[tuple, set] = defaultdict(set)
        for t in items:
            g = group_of(t)
            if not g:
                continue
            layer_cats = {
                "GROUP": {g},
                "WHO":  cats_by_item[t].get("WHO",  set()),
                "WHAT": cats_by_item[t].get("WHAT", set()),
                "HOW":  cats_by_item[t].get("HOW",  set()),
                "WHY":  cats_by_item[t].get("WHY",  set()),
            }
            for ty, cset in layer_cats.items():
                for c in cset:
                    node_items[(ty, c)].add(t)
            # All 10 layer-pair combinations.
            for sT, dT in LAYER_PAIRS:
                for s in layer_cats[sT]:
                    for d in layer_cats[dT]:
                        edge_w[(sT, s, dT, d)] += 1
        edges = sorted(
            ([sT, s, dT, d, w] for (sT, s, dT, d), w in edge_w.items()),
            key=lambda r: -r[4])
        nodes = sorted(
            ([ty, c, len(s)] for (ty, c), s in node_items.items()),
            key=lambda r: (r[0], -r[2]))
        return edges, nodes

    # Topic-level network: GROUP = Topic ∈ TOPICS (excludes "Other: …")
    edges_t, nodes_t = _network(
        lambda t: topic_of(t) if topic_of(t) in TOPICS else "")
    write_csv(OUT / "network_topic_edges.csv",
              ["Source Type", "Source Category", "Target Type", "Target Category", "Weight"],
              edges_t)
    write_csv(OUT / "network_topic_nodes.csv",
              ["Type", "Category", "n_items"], nodes_t)

    # CM Sub-topic network: items with Topic = "Content moderation"; GROUP = any
    # non-empty, non-"Other: …" Sub-topic from the data.
    def _cm_sub(t):
        if topic_of(t) != SUBTOPIC_PARENT:
            return ""
        s = subtopic_of(t)
        if not s or s.startswith("Other:"):
            return ""
        return s
    edges_s, nodes_s = _network(_cm_sub)
    write_csv(OUT / "network_subtopic_edges.csv",
              ["Source Type", "Source Category", "Target Type", "Target Category", "Weight"],
              edges_s)
    write_csv(OUT / "network_subtopic_nodes.csv",
              ["Type", "Category", "n_items"], nodes_s)

    print(f"\nAll outputs → {OUT}")


if __name__ == "__main__":
    main()
