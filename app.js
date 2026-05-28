/* ============================================================================
   app.js — page glue for the Censorship & moderation Chapter 1 interactive.
   Phase 1: manuscript render, sidebar TOC, citation hover-cards,
            headline summary table, Sankey #2 (Discipline → Topic → Sub-topic).
   ========================================================================= */

(() => {
"use strict";

const slug = s => String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "section";

/* ────────────────────────────────────────────────────────────────────────
   1. Manuscript: fetch markdown → render → build TOC → wire citations
   ─────────────────────────────────────────────────────────────────────── */

async function renderManuscript() {
  const host = document.getElementById("manuscript");
  if (!host) { console.error("renderManuscript: #manuscript host missing"); return; }

  try {
    // 1) Sanity-check that marked actually loaded.
    if (typeof window.marked === "undefined") {
      throw new Error(
        "marked library failed to load from the CDN. Check the network tab " +
        "for cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js."
      );
    }

    // 2) Fetch the manuscript — timestamp-busted so we always get the latest
    //    version that `build_site_data.py` mirrored from the master .md file.
    const resp = await fetch(`manuscript.md?t=${Date.now()}`,
                             { cache: "no-store" });
    if (!resp.ok) throw new Error(`manuscript.md HTTP ${resp.status}`);
    let md = await resp.text();

    // 3) Pre-process Pandoc cite keys [@key1; @key2]. Each group becomes a
    //    placeholder span `<span class="cite-grp" data-keys="k1,k2"></span>`
    //    whose textContent is filled in step 4d with an inline Harvard cite
    //    like "(Allan, 2016; Smith, 2020)". The FULL bibliographic references
    //    are then dropped into a `.margin-cites` aside on the right of the
    //    paragraph (sidenotes style, Tufte-ish).
    const CITE_GROUP = /\[(?:[^\]]*?(?:@[\w:.-]+|[-@][\w:.-]+))(?:[^\]]*?)\]/g;
    md = md.replace(CITE_GROUP, m => {
      const keys = (m.match(/@[\w:.-]+/g) || []).map(k => k.slice(1));
      if (!keys.length) return m;
      // tabindex on the wrapper so keyboard users can focus the whole cite.
      return `<span class="cite-grp" data-keys="${keys.join(",")}" tabindex="0"></span>`;
    });

    // 3a-ii) Markdown layout rescue: Obsidian is lenient about tables that
    //         have no blank line before a following caption or paragraph.
    //         Marked.js is stricter — without a blank line it slurps the
    //         next line into the table. Insert a blank line BEFORE any line
    //         that starts with bold, prose, a heading, or a fenced-code
    //         marker, whenever the previous non-blank line was a table row.
    {
      const lines = md.split(/\r?\n/);
      const out = [];
      const tableRow = s => /^\s*\|/.test(s);
      for (let i = 0; i < lines.length; i++) {
        const cur  = lines[i];
        const prev = out[out.length - 1] ?? "";
        const isCap = /^(\*\*|Table |Figure |Prompt |Listing |#|>|`{3,})/.test(cur.trim());
        if (cur.trim() && !tableRow(cur) && tableRow(prev) && isCap) {
          out.push("");        // separator the parser needs
        }
        out.push(cur);
      }
      md = out.join("\n");
    }

    // 3a-iii) Obsidian image embeds: ![[file.png]] / ![[file.png|caption]]
    //         → standard markdown ![caption](file.png) so marked.js renders
    //         them on the site too. Plain ![alt](file.png) is left alone.
    md = md.replace(
      /!\[\[\s*([^\]\|]+?)\s*(?:\|([^\]]+))?\s*\]\]/g,
      (_, src, cap) => `![${(cap || "").trim()}](${src.trim()})`
    );

    // 3b) Pre-process Obsidian-style wikilinks. We tolerate any of:
    //        [[#^slug]]                    → <a href="#slug">slug</a>
    //        [[#^slug|Display]]            → <a href="#slug">Display</a>
    //        [[Note Title#^slug|Display]]  → <a href="#slug">Display</a>
    //        [[Note Title|Display]]        → <span class="wiki">Display</span>
    //        [[Note Title]]                → <span class="wiki">Note Title</span>
    //     We're lenient about stray whitespace and accidental parens so typos
    //     like `[[(# ^ slug)|Display]]` still resolve.
    md = md.replace(
      /\[\[\s*\(?\s*([^\]\|]*?)\s*\)?\s*(?:\|([^\]]+))?\s*\]\]/g,
      (whole, target, display) => {
        target  = (target || "").trim();
        display = (display || "").trim();
        // Find the block-id (after # or #^), if any
        const m = target.match(/#\s*\^?\s*([\w.\-]+)/);
        if (m) {
          const slug = m[1];
          const label = display || slug;
          return `<a class="wiki" href="#${slug}">${label}</a>`;
        }
        // No anchor → render the display text as plain bolded-italic prose
        return `<span class="wiki">${display || target}</span>`;
      }
    );

    // 4) Parse markdown. We deliberately do NOT call marked.setOptions() —
    //    `headerIds` and `mangle` were removed in marked v8+, and the static
    //    setOptions accessor is deprecated in v12 and absent in some builds.
    host.innerHTML = marked.parse(md);

    // 4a) Obsidian block-anchors. Markdown ending with " ^slug" at the end of
    //     a paragraph/heading/list-item assigns id="slug" to that block, so
    //     in-text [[#^slug]] links can jump to it.
    host.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote, table")
        .forEach(el => {
      const last = el.lastChild;
      const txt  = last && last.nodeType === 3 ? last.nodeValue
                                                : el.textContent;
      const m = txt && txt.match(/(?:\s|^)\^([A-Za-z][\w.\-]*)\s*$/);
      if (!m) return;
      el.id = m[1];
      el.classList.add("anchored");
      // strip the " ^slug" trailing marker from the rendered DOM
      if (last && last.nodeType === 3) {
        last.nodeValue = last.nodeValue.replace(/\s*\^[\w.\-]+\s*$/, "");
        if (!last.nodeValue.trim()) last.remove();
      } else {
        el.innerHTML = el.innerHTML.replace(/\s*\^[\w.\-]+\s*$/, "");
      }
    });
    // 4a-bis) Syntax-highlight every <pre><code class="language-X"> block
    //         using highlight.js (loaded from CDN). Falls back gracefully
    //         when the library is missing. Then wrap every <pre> in a
    //         <details class="foldable"> — long blocks collapse by default,
    //         short ones stay open.
    const LANG_PRETTY = {python:"Python", json:"JSON", bash:"Bash"};
    host.querySelectorAll("pre > code").forEach(block => {
      const cls = [...block.classList].find(c => c.startsWith("language-"));
      const lang = cls ? cls.slice("language-".length) : "";
      if (window.hljs && lang) {
        try { window.hljs.highlightElement(block); } catch { /* ignore */ }
      }
      const pre = block.parentElement;
      const lines = block.textContent.replace(/\n+$/, "").split("\n").length;
      const wrap = document.createElement("details");
      wrap.className = "foldable code-fold";
      if (lines <= 18) wrap.open = true;        // small blocks: open by default
      // Preserve any block id (anchor) on the wrapper so jumps still work.
      if (pre.id) { wrap.id = pre.id; pre.removeAttribute("id"); }
      const sum = document.createElement("summary");
      const langLabel = LANG_PRETTY[lang] || (lang ? lang.toUpperCase() : "Code");
      sum.innerHTML = `<span class="lbl">${langLabel}</span>` +
                      `<span class="meta">· ${lines} lines</span>`;
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(sum);
      wrap.appendChild(pre);
    });

    // Also resolve table block-anchors: an Obsidian convention is `^slug` on
    // a line directly AFTER the table. The marker shows up as a sibling <p>.
    host.querySelectorAll("p").forEach(p => {
      const m = p.textContent.trim().match(/^\^([A-Za-z][\w.\-]*)$/);
      if (!m) return;
      const prev = p.previousElementSibling;
      if (prev && (prev.tagName === "TABLE" || prev.matches("p, li, blockquote, h1, h2, h3, h4"))) {
        prev.id = m[1];
        prev.classList.add("anchored");
        p.remove();
      }
    });

    // 4a-tris) Wrap EVERY table in a <details class="foldable">. Tables with
    //          ≤ FOLD_OPEN_MAX body rows open by default; larger ones start
    //          collapsed. The matching "Table N. …" caption paragraph, if
    //          present below the table, is pulled inside the wrapper and its
    //          first segment is surfaced in the <summary>.
    const FOLD_OPEN_MAX = 12;
    host.querySelectorAll("table").forEach(tbl => {
      const rows = tbl.querySelectorAll("tbody tr").length;
      // Pull in a sibling "Table N. …" caption paragraph, if any.
      let cap = tbl.nextElementSibling;
      if (cap && cap.tagName === "P" &&
          /^(table|figure|listing|prompt)\s+\d/i.test(cap.textContent.trim())) {
        // ok — use it
      } else { cap = null; }

      const wrap = document.createElement("details");
      wrap.className = "foldable table-fold";
      // Small tables open by default; long ones start collapsed.
      wrap.open = rows <= FOLD_OPEN_MAX;
      // Preserve anchor id on the wrapper so [[#^slug]] still jumps here.
      if (tbl.id) { wrap.id = tbl.id; tbl.removeAttribute("id"); }
      else if (cap && cap.id) { wrap.id = cap.id; cap.removeAttribute("id"); }

      const sum = document.createElement("summary");
      const lbl = cap ? cap.textContent.trim().split(".")[0]   // "Table 5"
                      : "Table";
      const after = cap ? cap.textContent.trim().slice(lbl.length + 1).trim()
                        : `${rows} rows`;
      sum.innerHTML = `<span class="lbl">${lbl}</span>` +
                      `<span class="meta">· ${after} · ${rows} rows</span>`;

      const inner = document.createElement("div");
      inner.className = "table-wrap";
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(sum);
      inner.appendChild(tbl);
      wrap.appendChild(inner);
      if (cap) {
        cap.classList.add("table-cap");
        wrap.appendChild(cap);
      }
    });

    // 4a-fig) Mark in-prose figure placeholders. An <img> whose filename is
    //         `fig-<slug>.(png|jpg|svg|…)` is a placeholder for the live
    //         interactive `<figure id="fig-<slug>">`. We mark it here; the
    //         actual swap (move the live <figure> into this spot) happens in
    //         `promoteInlineFigures()`, after every chart has finished
    //         rendering in the Analysis section.
    host.querySelectorAll("img").forEach(img => {
      const src = img.getAttribute("src") || "";
      const fname = src.split("/").pop() || "";
      const m = fname.match(/^(fig[-_][\w.-]+?)(?:\.(?:png|jpe?g|gif|svg|webp))?$/i);
      if (!m) return;
      const slug = m[1].replace(/_/g, "-").toLowerCase();
      img.dataset.fig = slug;
      img.classList.add("inline-fig-placeholder");
    });

    // 4a-quater) Anchor-aware auto-open: when the URL has a #fragment that
    //            sits inside a closed <details.foldable>, open the wrapper
    //            so the target block is visible. Fires on load AND on
    //            hashchange (in-page link clicks).
    function openTargetAncestors() {
      const id = location.hash.slice(1); if (!id) return;
      const target = document.getElementById(id); if (!target) return;
      let el = target;
      while (el && el !== host) {
        if (el.tagName === "DETAILS" && !el.open) el.open = true;
        el = el.parentElement;
      }
      // After opening, re-scroll so the target sits in view.
      requestAnimationFrame(() =>
        target.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
    window.addEventListener("hashchange", openTargetAncestors);
    setTimeout(openTargetAncestors, 0);

    // 4b) The manuscript is now READ-ONLY (rendered from manuscript.md on
    //     every load). Clear any stale localStorage cache from when the
    //     article used to be contenteditable, and strip any orphan DOM
    //     structures that may have survived from an older rendering.
    try {
      window.localStorage?.removeItem("edit:manuscript");
      window.localStorage?.removeItem("edit:manuscript:fp");
    } catch {}
    host.querySelectorAll(".margin-cites, .cite-row").forEach(n => {
      if (n.classList.contains("cite-row")) {
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.remove();
      } else {
        n.remove();
      }
    });

    // 4c) Load the bibliography (built by `site/scripts/build_bibliography.py`
    //     from the master Better-BibTeX export). Falls back gracefully if the
    //     JSON is missing — cites then render as bare keys.
    let BIB = {};
    try {
      const br = await fetch(`data/bibliography.json?t=${CSV_BUST}`,
                             { cache: "no-store" });
      if (br.ok) BIB = await br.json();
    } catch (e) { console.warn("bibliography.json not loaded:", e); }

    // 4d) Render inline cites + link them to the manuscript's own References
    //     list (added by the user after the chapter body). The References list
    //     is the SOURCE OF TRUTH; bibliography.json is a richer fallback for
    //     entries the user hasn't typed into the manuscript yet.

    // Derive (Author, Year) from a Better-BibTeX key when the bibliography
    // doesn't have it: BBT default `[auth:lower][shorttitle][year(suffix)]`
    // → take the leading run of lowercase letters as the author, and the
    // LAST run of 4 digits as the year.
    function deriveFromKey(key) {
      const yearMatches = key.match(/\d{4}/g);
      const year = yearMatches ? yearMatches[yearMatches.length - 1] : "n.d.";
      let raw = key.match(/^[a-z]+/)?.[0] || key;
      const PRETTY = {
        europeanunion: "European Union",
        oxfordenglishdictionary: "Oxford English Dictionary",
        dekeulenaar: "de Keulenaar",
      };
      const author = PRETTY[raw] ||
                     (raw.charAt(0).toUpperCase() + raw.slice(1));
      return { author, year };
    }

    // ── Build an index of in-manuscript References: each <p> after the
    //    "# References" heading is one entry. We extract a (lastname, year)
    //    signature so BBT cite keys can be matched against it. We also store
    //    the rendered HTML and a stable anchor id so clicks can jump.
    const refIndex = new Map();             // "lastnamelower|year" → { id, html, link }
    const REF_HEAD = [...host.querySelectorAll("h1, h2")]
                       .find(h => /^references$/i.test(h.textContent.trim()));
    if (REF_HEAD) {
      let n = 0;
      let el = REF_HEAD.nextElementSibling;
      while (el && !/^H[12]$/.test(el.tagName)) {
        if (el.tagName === "P" && el.textContent.trim().length > 4) {
          const refId = `ref-${++n}`;
          el.id = refId;
          el.classList.add("ref-entry");
          const txt = el.textContent.trim();
          // First lastname: text up to the first comma or " (".
          //   "Klonick, K. (2017). …"      → "Klonick"
          //   "Regulation (EU) 2022/2065…" → "Regulation"
          //   "Oxford English Dictionary. (2025a). …" → multiword → "Oxford"
          //   "Cetina, K. K. & Werner Reichmann. (2015)…" → "Cetina"
          const lastMatch = txt.match(/^([A-Z][^,\.\(]{0,40}?)(?=[,\.\(])/);
          const lastFull  = (lastMatch?.[1] || "").trim();
          const lastFirst = lastFull.split(/\s+/)[0] || lastFull;
          const lastLower = lastFirst.toLowerCase().replace(/[^a-z]/g, "");
          // Year: first "(YYYY"  — APA convention.
          const yMatch = txt.match(/\((\d{4})/);
          const year   = yMatch ? yMatch[1] : "";
          // First DOI/URL inside the entry, if any.
          const a = el.querySelector("a[href]");
          const link = a ? a.getAttribute("href") : "";
          if (lastLower && year) {
            refIndex.set(`${lastLower}|${year}`, {
              id: refId, html: el.innerHTML, link, fullText: lastFull,
            });
          }
        }
        el = el.nextElementSibling;
      }
      console.info(`References indexed: ${refIndex.size} entries`);
    }

    function lookupRef(key) {
      const d = deriveFromKey(key);
      const lk = d.author.toLowerCase().replace(/[^a-z]/g, "");
      // Try the full author prefix first ("europeanunion"), then progressive
      // shorter prefixes — handy when the BBT key has a multiword author
      // that the References entry compressed to a single word.
      for (let len = lk.length; len >= 3; len--) {
        const probe = lk.slice(0, len);
        const hit = refIndex.get(`${probe}|${d.year}`);
        if (hit) return hit;
      }
      // Last resort: scan all refIndex keys whose author *starts with* lk[0..3].
      const stub = lk.slice(0, 4);
      for (const [k, v] of refIndex) {
        if (k.endsWith(`|${d.year}`) && k.startsWith(stub)) return v;
      }
      return null;
    }

    function inlineFor(key) {
      const e = BIB[key];
      if (e?.author && e?.year) return `${e.author}, ${e.year}`;
      const d = deriveFromKey(key);
      return `${d.author}, ${d.year}`;
    }
    function harvardFor(key) {
      // Prefer the manuscript's own APA entry; fall back to .bib Harvard.
      const r = lookupRef(key);
      if (r?.html) return r.html;
      const e = BIB[key];
      if (e?.harvard) return mdItalicToHtml(e.harvard);
      const d = deriveFromKey(key);
      return `${d.author} (${d.year}) <em>Reference pending</em>.`;
    }
    function linkFor(key) {
      return lookupRef(key)?.link || BIB[key]?.link || "";
    }
    function anchorFor(key) {
      return lookupRef(key)?.id || "";
    }
    function mdItalicToHtml(s) {
      return s
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    }

    let _filledCites = 0, _linkedCites = 0;
    host.querySelectorAll(".cite-grp").forEach(g => {
      const keys = (g.dataset.keys || "").split(",").filter(Boolean);
      if (!keys.length) { g.remove(); return; }
      // Build inner HTML: each key becomes its own anchor (when a matching
      // reference exists) so the user can click ANY name in a multi-cite
      // group and jump straight to that reference.
      const parts = keys.map(k => {
        const txt = escapeHtml(inlineFor(k));
        const ref = anchorFor(k);
        _filledCites++;
        if (ref) { _linkedCites++;
          return `<a class="cite-link" href="#${ref}" data-key="${escapeHtml(k)}">${txt}</a>`;
        }
        return `<span class="cite-link" data-key="${escapeHtml(k)}">${txt}</span>`;
      });
      g.innerHTML = "(" + parts.join("; ") + ")";
    });
    console.info(`Citations: filled ${_filledCites} inline, linked ${_linkedCites} to References`);

    // 4e) Hover or focus an inline cite → show the full reference in the
    //     data-card. The card prefers the manuscript's own APA-formatted
    //     reference; falls back to the bibliography.json Harvard text.
    function citeCardHtml(keys) {
      return keys.map(k => {
        const ref = anchorFor(k);
        const body = harvardFor(k);
        const link = linkFor(k);
        const tail = link
          ? ` <a class="ext" href="${escapeHtml(link)}" target="_blank" rel="noopener">Open ↗</a>`
          : "";
        const jump = ref
          ? ` <a class="ext" href="#${ref}">Jump to ref ↓</a>` : "";
        return `<div class="dc-cite" data-key="${escapeHtml(k)}">${body}${tail}${jump}</div>`;
      }).join("");
    }
    function keysFromTarget(el) {
      const a = el.closest(".cite-link"); if (a) {
        const k = a.dataset.key; return k ? [k] : [];
      }
      const g = el.closest(".cite-grp"); if (!g) return [];
      return (g.dataset.keys || "").split(",").filter(Boolean);
    }
    host.addEventListener("mouseover", e => {
      const keys = keysFromTarget(e.target);
      if (!keys.length) return;
      dataCard.show(citeCardHtml(keys), e);
    });
    host.addEventListener("mousemove", e => {
      if (e.target.closest(".cite-grp,.cite-link")) dataCard.move(e);
    });
    host.addEventListener("mouseout", e => {
      if (e.target.closest(".cite-grp,.cite-link")) dataCard.hide();
    });
    host.addEventListener("focusin", e => {
      const keys = keysFromTarget(e.target);
      if (!keys.length) return;
      const r = e.target.getBoundingClientRect();
      dataCard.show(citeCardHtml(keys),
        { clientX: r.left + r.width / 2, clientY: r.bottom + 6 });
    });
    host.addEventListener("focusout", e => {
      if (e.target.closest(".cite-grp,.cite-link")) dataCard.hide();
    });

    // 5) Add stable ids to headings + collect for TOC.
    //    The very first H1 is the chapter title — keep its id (so the
    //    sidebar title still anchors there) but DROP it from the sidebar TOC.
    const headings = host.querySelectorAll("h1, h2, h3");
    const toc = [];
    let droppedFirstH1 = false;
    headings.forEach(h => {
      const id = "h-" + slug(h.textContent);
      h.id = id;
      if (h.tagName === "H1" && !droppedFirstH1) {
        droppedFirstH1 = true;
        return;          // omit the chapter title from the TOC (per #9)
      }
      toc.push({
        level: Number(h.tagName.slice(1)),
        text:  h.textContent.trim(),
        id
      });
    });
    buildToc(toc);
    trackActiveSection();

    // 6) Wire citation hover-cards.
    host.querySelectorAll(".cite").forEach(c => {
      c.addEventListener("mouseenter", showCiteCard);
      c.addEventListener("focus",      showCiteCard);
      c.addEventListener("mouseleave", hideCiteCard);
      c.addEventListener("blur",       hideCiteCard);
    });
  } catch (e) {
    console.error("renderManuscript:", e);
    host.innerHTML =
      `<p class="loading"><strong>Couldn't render manuscript:</strong>
       ${escapeHtml(e.message)}.<br>
       Serve the folder over HTTP (<code>python3 -m http.server</code>) and
       check the browser console for the full stack trace.</p>`;
  }
}

function buildToc(items) {
  const ol = document.getElementById("toc");
  // Insert the Analysis section as the last entries.
  const tail = [
    { level: 1, text: "Analysis",        id: "analysis"        },
    { level: 2, text: "1. Overview",     id: "overview"        },
    { level: 2, text: "2. Analysis",     id: "analysis-files"  },
  ];
  const list = items.concat(tail);
  ol.innerHTML = list.map(it =>
    `<li class="lvl-${it.level}"><a href="#${it.id}">${escapeHtml(it.text)}</a></li>`
  ).join("");
}

function trackActiveSection() {
  if (typeof window.IntersectionObserver !== "function") return;  // older browsers / jsdom
  const links = [...document.querySelectorAll("#toc a")];
  const map   = new Map(links.map(a => [a.getAttribute("href").slice(1), a]));
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const a = map.get(e.target.id);
      if (!a) return;
      links.forEach(x => x.classList.remove("is-active"));
      a.classList.add("is-active");
    });
  }, { rootMargin: "-30% 0px -65% 0px", threshold: 0 });
  document.querySelectorAll("[id]").forEach(el => {
    if (map.has(el.id)) obs.observe(el);
  });
}

/* citation hover-card. Phase 1 just shows the key + a placeholder hint.
   Phase 3 will resolve `@key` → CSL-JSON entry (Author · Title · Year · Venue).
*/
function showCiteCard(e) {
  const el = e.currentTarget;
  const card = document.getElementById("cite-card");
  const key = el.dataset.key || "";
  card.innerHTML = `
    <div class="ck">@${escapeHtml(key)}</div>
    <span class="hint">Reference details will resolve from the Zotero
      CSL-JSON library in Phase 3.</span>
  `;
  card.hidden = false;
  positionCard(card, el);
}
function hideCiteCard() { document.getElementById("cite-card").hidden = true; }
function positionCard(card, anchor) {
  const a = anchor.getBoundingClientRect();
  const x = window.scrollX + a.left;
  const y = window.scrollY + a.bottom + 6;
  card.style.left = `${x}px`;
  card.style.top  = `${y}px`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ────────────────────────────────────────────────────────────────────────
   2. CSV loader (tiny)
   ─────────────────────────────────────────────────────────────────────── */

// Per-session cache buster: appended to every CSV fetch so the browser can't
// hold onto a stale copy after `build_site_data.py` regenerates `data/*.csv`.
const CSV_BUST = String(Date.now());

async function loadCSV(path) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${path}${sep}t=${CSV_BUST}`, { cache: "no-store" });
  if (!r.ok) {
    // Treat 404 as "data not built yet" — caller will fall back gracefully.
    const err = new Error(`HTTP ${r.status} for ${path}`);
    err.missing = (r.status === 404);
    throw err;
  }
  const txt = await r.text();
  return d3.csvParse(txt, d3.autoType);
}

function renderPending(hostSel, msg) {
  const h = document.querySelector(hostSel);
  if (!h) return;
  h.innerHTML = `<div class="placeholder">${msg}</div>`;
}

/* ────────────────────────────────────────────────────────────────────────
   3. Table 2 — Corpus summary table (renumbered from Figure 1)
   ─────────────────────────────────────────────────────────────────────── */

const LABELS = {
  final_unique_items:     "Unique items in the final corpus",
  final_with_pdf_on_disk: "Items with a PDF on disk",
  final_finding_rows:     "Total finding rows (one per finding)",
};

async function renderSummary() {
  const rows = await loadCSV("data/summary.csv");
  const fmt  = d3.format(",");
  const tbl = d3.select("#summary-table").append("table");
  rows.forEach(r => {
    const tr = tbl.append("tr");
    tr.append("td").text(LABELS[r.metric] || r.metric);
    tr.append("td").text(fmt(r.value));
  });
}

/* ────────────────────────────────────────────────────────────────────────
   4. Figure 2 — Sankey  Discipline → Topic → Sub-topic
   ─────────────────────────────────────────────────────────────────────── */

const SUBTOPIC_PARENT = "Content moderation";
const SUB_BLANK = "(none)";

// Pastel palette tuned to the RawGraphs alluvial reference (yellow, mint,
// coral …). Shared across all alluvial diagrams.
const ALLUVIAL_PASTELS = [
  "#f3e09e", "#aed9c4", "#f0a87b", "#cdd5da", "#dde5d5",
  "#f4cda9", "#cbb9e0", "#a3b8d1", "#f0c0c8", "#c5dbb1",
  "#e3c9ad", "#b8c8b2", "#e6a8a8", "#c8d6b6", "#d8c8e0",
];

// Visible gap between node rectangle and where ribbons begin.
const ALLUVIAL_GAP = 6;

function alluvialPath(d) {
  const x0 = d.source.x1 + ALLUVIAL_GAP;
  const x1 = d.target.x0 - ALLUVIAL_GAP;
  const y0 = d.y0, y1 = d.y1;
  const xc = (x0 + x1) / 2;
  return `M${x0},${y0} C${xc},${y0} ${xc},${y1} ${x1},${y1}`;
}

const TOPIC_COLOR = {
  "Content moderation":   "#b16744",   /* accent — most frequent */
  "Censorship":           "#7c3a4b",
  "Debate management":    "#688a4f",
  "Political moderation": "#7a5b3a",
  "Moderation":           "#8a6b9f",
  "Media moderation":     "#4f6d8c",
  "AI alignment":         "#3f8aa6",
  "Media regulation":     "#9a7a4f",
  "Internet governance":  "#586478",
};
const TOPIC_KEYS = Object.keys(TOPIC_COLOR);
const colorFor = name => TOPIC_COLOR[name] || "#666";

async function renderSankeyDTS() {
  const rows = await loadCSV("data/items_by_disc_topic_subtopic.csv");

  // Build nodes/links for a 3-stage Sankey:
  //   stage 0 = Discipline,  stage 1 = Topic,  stage 2 = Sub-topic
  // For non-CM topics the third hop is omitted (Topic terminates).
  const N = new Map();   // id → {name, stage}
  const L = new Map();   // "s|t" → {source, target, value}
  const id = (name, stage) => `s${stage}::${name}`;
  const node = (name, stage) => {
    const k = id(name, stage);
    if (!N.has(k)) N.set(k, { id: k, name, stage });
    return k;
  };
  const link = (s, t, v) => {
    const k = `${s}|${t}`;
    L.set(k, { source: s, target: t, value: (L.get(k)?.value || 0) + v });
  };

  rows.forEach(r => {
    const q   = +r.Quantity || 0;
    if (!q) return;
    const d   = r.Discipline || "(unspecified)";
    const top = r.Topic       || "(unknown)";
    const sub = r["Sub-topic"] || "";
    const dN  = node(d,   0);
    const tN  = node(top, 1);
    link(dN, tN, q);
    // Only add a third-stage flow to a real Sub-topic. Non-CM topics
    // (Censorship, AI alignment, Debate management, Other) terminate at the
    // Topic column — no "(none)" mega-rectangle on the right.
    if (top === SUBTOPIC_PARENT && sub && sub !== SUB_BLANK) {
      const sN = node(sub, 2);
      link(tN, sN, q);
    }
  });

  // With .nodeId(d => d.id), d3-sankey expects source/target as id STRINGS
  // (not numeric indices). Pass them straight through.
  const nodes = [...N.values()];
  const links = [...L.values()].map(l => ({
    source: l.source, target: l.target, value: l.value,
  }));

  const host = d3.select("#sankey-discipline-topic");
  host.selectAll("*").remove();

  /* Render to the container's actual width so labels don't overflow.
     viewBox + width:100% lets the SVG scale responsively, like every other
     chart. Compute a viewBox W that gives Sub-topic labels enough room. */
  const containerW = host.node().clientWidth || 880;
  const W = Math.max(720, containerW);
  // Reserve gutters on BOTH sides so first-column labels (Disciplines, often
  // long like "communication_media_studies") and last-column labels (Sub-topics,
  // like "Moderation as the cultivation of a democratic public sphere") have
  // room to render without clipping.
  const LEFT_GUTTER  = 220;
  const RIGHT_GUTTER = 280;
  const NODE_PAD = 14;
  const colCount = d3.max(d3.rollups(nodes, v => v.length, n => n.stage), d => d[1]) || 1;
  const H = Math.max(640, 60 + colCount * NODE_PAD * 2.6);

  const svg = host.append("svg")
    .attr("class", "sankey")
    .attr("viewBox", [0, 0, W, H])
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("width", "100%")            /* scale into the figure column */
    .attr("height", "auto");

  /* Alluvial styling à la rawgraphs: white nodes with a thin dark outline,
     PASTEL ribbons coloured by source Discipline, visible gap between nodes
     and ribbons, italic stage headers at top, uppercase sans-serif labels
     stacked over a smaller count line. */
  const TOP_PAD = 38;               /* room for stage headers */
  const sankey = d3.sankey()
    .nodeId(d => d.id)
    .nodeWidth(10)
    .nodePadding(NODE_PAD)
    // Pin each node to its declared stage (0 = Discipline, 1 = Topic,
    // 2 = Sub-topic). Without this, d3-sankey's default `sankeyJustify`
    // pushes terminal nodes (Censorship/AI alignment as Topics, with no
    // outgoing edge) all the way to the rightmost column, where they'd
    // mix in with the actual sub-topic nodes.
    .nodeAlign(d => d.stage)
    .extent([[LEFT_GUTTER, TOP_PAD], [W - RIGHT_GUTTER, H - 18]]);

  const graph = sankey({
    nodes: nodes.map(d => ({ ...d })),
    links: links.map(d => ({ ...d })),
  });

  const discNames = [...new Set(rows.map(r => r.Discipline || "(unspecified)"))]
                      .sort();
  const discColor = d3.scaleOrdinal().domain(discNames).range(ALLUVIAL_PASTELS);

  function rootDiscipline(node) {
    let cur = node;
    while (cur && cur.depth > 0) {
      const inbound = (cur.targetLinks || [])
        .slice().sort((a, b) => b.value - a.value)[0];
      if (!inbound) break;
      cur = inbound.source;
    }
    return cur && cur.depth === 0 ? cur.name : null;
  }

  const GAP = ALLUVIAL_GAP;

  // Links — coloured by source Discipline (pastel).
  const linkSel = svg.append("g")
    .selectAll("path").data(graph.links).join("path")
      .attr("class", "link")
      .attr("d", alluvialPath)
      .attr("fill", "none")
      .attr("stroke", d => {
        const root = d.source.depth === 0 ? d.source.name : rootDiscipline(d.source);
        return root ? discColor(root) : "#cdd5da";
      })
      .attr("stroke-width", d => Math.max(1, d.width))
      .on("mouseenter", (e, d) => dataCard.show(
        `<div class="dc-t">${escapeHtml(d.source.name)} → ${escapeHtml(d.target.name)}</div>
         <div class="dc-row"><span>Items</span>${d3.format(",")(d.value)}</div>`, e))
      .on("mousemove",  e => dataCard.move(e))
      .on("mouseleave", () => dataCard.hide());

  // Nodes — white rectangles with thin dark outline.
  const nodeSel = svg.append("g").selectAll("g").data(graph.nodes).join("g")
      .attr("class", "node");
  nodeSel.append("rect")
    .attr("x", d => d.x0).attr("y", d => d.y0)
    .attr("height", d => Math.max(2, d.y1 - d.y0))
    .attr("width",  d => d.x1 - d.x0)
    /* fill / stroke come from CSS (`.node rect` rules) so the colour
       tracks the editorial palette. */
    .on("mouseenter", (e, d) => dataCard.show(
      `<div class="dc-t">${escapeHtml(d.name)}</div>
       <div class="dc-row"><span>Items</span>${d3.format(",")(d.value || 0)}</div>`, e))
    .on("mousemove",  e => dataCard.move(e))
    .on("mouseleave", () => dataCard.hide())
    .on("click", (e, d) => highlightNode(d));

  // Two-line labels: NAME (uppercase, bold) on top, count below in muted grey.
  // FIRST column → labels go LEFT of the rect (anchor end, into the left gutter).
  // OTHER columns → labels go RIGHT of the rect (anchor start, into the right
  // gutter we reserved). Putting last-column labels on the RIGHT keeps long
  // sub-topic names from running back through the Topic column.
  const maxDepth = d3.max(graph.nodes, n => n.depth);
  const isFirst  = d => d.depth === 0;
  const isLast   = d => d.depth === maxDepth;
  const labelX   = d => isFirst(d) ? d.x0 - GAP - 2 : d.x1 + GAP + 2;
  const anchorOf = d => isFirst(d) ? "end" : "start";

  const labels = nodeSel.append("text")
    .attr("class", "node-label")
    .attr("text-anchor", anchorOf)
    .attr("x", labelX)
    .attr("y", d => (d.y0 + d.y1) / 2);

  // Single-line uppercase name, truncated to keep within the gutters.
  // Full text is surfaced via <title> on the node + the hover data-card.
  const LBL_MAX = 30;
  const trunc = s => s.length > LBL_MAX ? s.slice(0, LBL_MAX - 1).trimEnd() + "…" : s;
  labels.append("tspan").attr("class", "lbl-name")
    .attr("x", labelX).attr("dy", "0.32em")
    .text(d => trunc((d.name || "").toUpperCase()));
  nodeSel.append("title").text(d => d.name);

  // Italic stage headers at the top of each column.
  const stageNames = { 0: "Discipline", 1: "Topic", 2: "Sub-topic" };
  const stageMid = new Map();
  graph.nodes.forEach(n => {
    if (!stageMid.has(n.depth)) stageMid.set(n.depth, (n.x0 + n.x1) / 2);
  });
  // Stage headers: FIRST column header → anchored to left gutter (text-anchor end);
  // all other columns → anchored to right gutter (text-anchor start), matching
  // where the labels themselves sit.
  svg.append("g").attr("class", "stage-headers")
    .selectAll("text")
    .data([...stageMid.keys()].sort((a, b) => a - b))
    .join("text")
      .attr("x", d => d === 0 ? stageMid.get(d) - 8 : stageMid.get(d) + 8)
      .attr("y", 20)
      .attr("text-anchor", d => d === 0 ? "end" : "start")
      .text(d => stageNames[d] || `Stage ${d}`);

  let pinnedId = null;
  function highlightNode(d) {
    if (!d) { pinnedId = null; clearHighlight(); return; }
    if (pinnedId === d.id) { pinnedId = null; clearHighlight(); return; }
    pinnedId = d.id;
    linkSel.classed("hi",  l => l.source.id === d.id || l.target.id === d.id)
           .classed("dim", l => l.source.id !== d.id && l.target.id !== d.id);
    nodeSel.classed("dim", n => {
      if (n.id === d.id) return false;
      return !graph.links.some(l =>
        (l.source.id === d.id && (l.source.id === n.id || l.target.id === n.id)) ||
        (l.target.id === d.id && (l.source.id === n.id || l.target.id === n.id)));
    });
  }
  function clearHighlight() {
    linkSel.classed("hi", false).classed("dim", false);
    nodeSel.classed("dim", false);
  }

  // Sidebar key: Discipline palette (alluvial colour-encoding). Clicking a
  // chip highlights every flow originating from that Discipline.
  figKey.register("fig-sankey-discipline-topic", {
    title: "Discipline",
    legend: discNames.map(d => ({ label: d, color: discColor(d) })),
    onHighlight(name) {
      if (!name) { clearHighlight(); return; }
      const target = graph.nodes.find(n => n.depth === 0 && n.name === name);
      if (target) highlightNode(target);
    },
  });
}

/* ────────────────────────────────────────────────────────────────────────
   5. Shared chart helpers (discipline colour, data hover-card, legend)
   ─────────────────────────────────────────────────────────────────────── */

const TOP_K        = 10;
const PALETTE_TOP  = d3.schemeTableau10;
const GREY_OTHER   = "#cdc8c0";

/** Top-K disciplines in `rows` by item count, ties broken by total citations.
 *  Returns a fn(d)→colour AND fn.legend (the top-K names in order). */
function topDisciplines(rows, k = TOP_K) {
  const agg = d3.rollup(rows,
    v => ({ n: v.length, cit: d3.sum(v, r => +r.Citations || 0) }),
    r => (r.Discipline || "(unspecified)"));
  const ordered = [...agg.entries()]
    .sort((a, b) => (b[1].n - a[1].n) || (b[1].cit - a[1].cit))
    .slice(0, k).map(([d]) => d);
  const cs = d3.scaleOrdinal().domain(ordered).range(PALETTE_TOP);
  const fn = d => ordered.includes(d || "(unspecified)") ? cs(d) : GREY_OTHER;
  fn.legend = ordered;
  return fn;
}

const dataCard = (() => {
  const el = () => document.getElementById("data-card");
  let pinned = false;
  let hideTimer = null;
  function position(node, ev) {
    const r = node.getBoundingClientRect();
    const pad = 12, vw = innerWidth, vh = innerHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width  > vw - 6) x = ev.clientX - r.width  - pad;
    if (y + r.height > vh - 6) y = ev.clientY - r.height - pad;
    node.style.left = `${x + scrollX}px`;
    node.style.top  = `${y + scrollY}px`;
  }
  function cancelHide() { clearTimeout(hideTimer); hideTimer = null; }
  function scheduleHide() {
    cancelHide();
    if (pinned) return;
    hideTimer = setTimeout(() => {
      const c = el(); if (c) c.hidden = true;
    }, 280);          // window in which the user can move into the card
  }
  // Wire interactive-card behaviour once the DOM is ready.
  function ensureBound() {
    const c = el();
    if (!c || c.dataset.bound) return;
    c.dataset.bound = "1";
    // Make the card itself interactive (links inside become clickable).
    c.addEventListener("mouseenter", cancelHide);
    c.addEventListener("mouseleave", scheduleHide);
  }
  document.addEventListener("DOMContentLoaded", ensureBound);
  setTimeout(ensureBound, 0);  // also bind ASAP if DOM is already ready
  return {
    show(html, ev) {
      ensureBound();
      if (pinned) return;       // a pinned card overrides hovers
      cancelHide();
      const c = el(); c.innerHTML = html; c.hidden = false;
      c.classList.remove("pinned");
      position(c, ev);
    },
    move(ev) { if (pinned) return;
      const c = el(); if (!c.hidden) position(c, ev); },
    hide()   { scheduleHide(); },
    /** Pin the card with `html` (full Abstract Note, etc.) until unpinned. */
    pin(html, ev) {
      ensureBound();
      cancelHide();
      pinned = true;
      const c = el(); c.innerHTML = html; c.hidden = false;
      c.classList.add("pinned");
      position(c, ev);
    },
    unpin() {
      cancelHide();
      pinned = false;
      const c = el(); if (c) { c.hidden = true; c.classList.remove("pinned"); }
    },
    isPinned() { return pinned; },
  };
})();

/* Global: clicking anywhere outside a pinned card (and not on a chart dot)
   unpins the card AND clears any selected dot. */
document.addEventListener("click", e => {
  if (!dataCard.isPinned()) return;
  if (e.target.closest("#data-card")) return;
  if (e.target.closest(".chart circle, .chart .nodes circle")) return;
  dataCard.unpin();
  document.querySelectorAll(".chart circle.selected")
    .forEach(c => c.classList.remove("selected"));
}, true);

function legend(svg, x, y, names, color) {
  const g = svg.append("g").attr("class", "legend")
    .attr("transform", `translate(${x},${y})`);
  names.forEach((n, i) => {
    g.append("circle").attr("cx", 6).attr("cy", i * 14).attr("r", 5).attr("fill", color(n));
    g.append("text").attr("x", 16).attr("y", i * 14 + 3)
      .text(n.length > 28 ? n.slice(0, 26) + "…" : n);
  });
  return g;
}

const seededJitter = (seed, sigma) =>
  d3.randomNormal.source(d3.randomLcg(seed))(0, sigma);

/* ────────────────────────────────────────────────────────────────────────
   6. Figures 3 / 4 — bubble: Year × (Topic | Sub-topic) — node size = Citations
   ─────────────────────────────────────────────────────────────────────── */

async function renderBubble({ csv, yField, hostSel, figId, yearInputs }) {
  const all = await loadCSV(csv);
  const data0 = all.filter(r => Number.isFinite(+r["Publication Year"]));
  const host = d3.select(hostSel);
  const getYears = setupYearRange(yearInputs[0], yearInputs[1], data0, draw);

  function draw() {
    const [lo, hi] = getYears();
    const data = data0.filter(r => inRange(r, lo, hi));
    host.selectAll("*").remove();
    if (!data.length) {
      host.append("div").attr("class", "placeholder").text("No data in this year range.");
      return;
    }
    const color  = topDisciplines(data);
    const groups = [...new Set(data.map(r => r[yField] || "(unknown)"))].sort();
    const W = Math.max(720, host.node().clientWidth || 880);
    const ROW_H = 70;
    const H = Math.max(280, groups.length * ROW_H + 90);
    const yScale = d3.scalePoint().domain(groups).range([40, H - 50]).padding(0.5);
    const x = d3.scaleLinear().domain([lo - 1, hi + 1]).range([220, W - 24]);
    const rScale = d3.scaleSqrt().domain([0, d3.max(data, d => +d.Citations) || 1]).range([2, 18]);
    const jit = seededJitter(7, 14);

    const svg = host.append("svg").attr("class", "chart")
      .attr("viewBox", [0, 0, W, H]).attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%");
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${H - 30})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(10));
    svg.append("g").attr("class", "y-labels")
      .selectAll("text").data(groups).join("text")
        .attr("x", 12).attr("y", g => yScale(g)).attr("dy", "0.32em").text(g => g);
    svg.append("g").attr("class", "rowguides")
      .selectAll("line").data(groups).join("line")
        .attr("x1", 220).attr("x2", W - 24)
        .attr("y1", g => yScale(g)).attr("y2", g => yScale(g));
    const dots = svg.append("g").selectAll("circle").data(data).join("circle")
        .attr("cx", d => x(+d["Publication Year"]))
        .attr("cy", d => yScale(d[yField] || "(unknown)") + jit())
        .attr("r",  d => rScale(+d.Citations || 0))
        .attr("fill", d => color(d.Discipline))
        .attr("opacity", 0.74)
        .on("mouseenter", async function (e, d) {
          d3.select(this).raise().attr("opacity", 1);
          const url   = await urlByKey(d.Key);
          const title = escapeHtml(d.Title || "(untitled)");
          const tHtml = url
            ? `<a class="ext" href="${escapeHtml(url)}" target="_blank" rel="noopener">${title} ↗</a>`
            : title;
          const abs = (d["Abstract Note"] || "").trim();
          dataCard.show(`
            <div class="dc-t">${tHtml}</div>
            <div class="dc-meta">${escapeHtml(d.Author || "")} · ${escapeHtml(String(d["Publication Year"]))}</div>
            <div class="dc-row"><span>${yField}</span>${escapeHtml(d[yField] || "")}</div>
            <div class="dc-row"><span>Discipline</span>${escapeHtml(d.Discipline || "")}</div>
            <div class="dc-row"><span>Citations</span>${d3.format(",")(+d.Citations || 0)}</div>
            ${abs ? `<div class="dc-abs">${escapeHtml(abs)}</div>` : ""}`, e);
        })
        .on("mousemove", e => dataCard.move(e))
        .on("mouseleave", function () { d3.select(this).attr("opacity", 0.74); dataCard.hide(); })
        .on("click", async function (e, d) {
          e.stopPropagation();
          const url = await urlByKey(d.Key);
          if (url) window.open(url, "_blank", "noopener");
        });

    // Register the sidebar key for this figure.
    figKey.register(figId, {
      title: "Discipline (top 10)",
      legend: color.legend.map(d => ({ label: d, color: color(d) }))
                  .concat([{ label: "other", color: GREY_OTHER }]),
      onHighlight(name) {
        dots
          .classed("dim", d => name && !(
            name === "other"
              ? !color.legend.includes(d.Discipline)
              : d.Discipline === name))
          .classed("hi",  d => name && (
            name === "other"
              ? !color.legend.includes(d.Discipline)
              : d.Discipline === name));
      },
    });
  }

  draw();
}

/* ────────────────────────────────────────────────────────────────────────
   7. Figures 5 / 6 — Sankey  Topic|Sub-topic → Country|Medium
   ─────────────────────────────────────────────────────────────────────── */

async function renderSankeyTwo({ csv, leftField, rightField, hostSel, figId,
                                 valueField="Quantity", topRight=0, stages=null }) {
  let rows = await loadCSV(csv);
  // `stages` is an optional array of column names defining a multi-stage
  // alluvial (e.g. ["LanguageName", "Country", "Topic"] for 3 stages).
  // When omitted we fall back to the classic 2-stage [leftField, rightField].
  const STAGES = stages && stages.length >= 2 ? stages.slice()
                                              : [leftField, rightField];
  const lastField = STAGES[STAGES.length - 1];
  const topCapField = stages ? STAGES[1] : rightField;

  // OPTIONAL: cap the most-explosive column (right column in the 2-stage
  // case, or the *middle* column in the 3-stage Language → Country → Topic
  // figure — that's where the long tail lives) to its `topRight` largest
  // members and roll the rest into one "Other (N)" bucket.
  if (topRight && Number.isFinite(+topRight)) {
    const totals = new Map();
    rows.forEach(r => {
      const v = +r[valueField] || 0;
      const t = r[topCapField] || "(unknown)";
      totals.set(t, (totals.get(t) || 0) + v);
    });
    const keep = new Set([...totals.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, +topRight).map(d => d[0]));
    const tailCount = totals.size - keep.size;
    const otherLabel = tailCount > 0 ? `Other (${tailCount})` : null;
    rows = rows.map(r => {
      const t = r[topCapField] || "(unknown)";
      if (keep.has(t)) return r;
      return { ...r, [topCapField]: otherLabel };
    }).filter(r => r[topCapField] != null);
  }

  const N = new Map(), L = new Map();
  const node = (name, stage) => {
    const k = `s${stage}::${name}`;
    if (!N.has(k)) N.set(k, { id: k, name, stage });
    return k;
  };
  rows.forEach(r => {
    const v = +r[valueField] || 0; if (!v) return;
    // For each row build a path STAGE0 → STAGE1 → … → STAGE_n and add v
    // to every adjacent edge along it. In the 2-stage case this collapses
    // back to the original Source → Target shape.
    const path = STAGES.map((field, i) => node(r[field] || "(unknown)", i));
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1], k = `${a}|${b}`;
      L.set(k, { source: a, target: b, value: (L.get(k)?.value || 0) + v });
    }
  });
  const nodes = [...N.values()];
  const links = [...L.values()].map(l => ({ source: l.source, target: l.target, value: l.value }));

  const host = d3.select(hostSel); host.selectAll("*").remove();
  if (!links.length) { host.append("div").attr("class", "placeholder").text("No data."); return; }
  const W = Math.max(700, host.node().clientWidth || 880);
  // Size the canvas so that node rectangles keep proportional HEIGHT — the
  // available vertical space must be much larger than total padding (per-side
  // node count × node-padding), otherwise the layout shrinks every rect to a
  // sliver. Heuristic: column-max × 3 × padding + top/bottom.
  const NODE_PAD = 12;
  const TOP_PAD = 40;
  const LEFT_GUTTER  = 220;       // reserve room for long left-column labels
  const RIGHT_GUTTER = 220;       // reserve room for long right-column labels
  const colCount = d3.max(d3.rollups(nodes, v => v.length, n => n.stage), d => d[1]) || 1;
  // Cap H so the figure stays inside one viewport. With many nodes we still
  // need vertical space for proportional rectangles, but cap at ~1.2× width
  // so the chart is never taller than it is wide.
  const H_MAX = Math.round(W * 1.2);
  const H = Math.min(H_MAX, Math.max(480, TOP_PAD + 30 + colCount * NODE_PAD * 2));
  const svg = host.append("svg").attr("class", "sankey alluvial")
    .attr("viewBox", [0, 0, W, H]).attr("preserveAspectRatio", "xMidYMid meet")
    .attr("width", "100%").attr("height", "auto");

  const sk = d3.sankey().nodeId(d => d.id).nodeWidth(10).nodePadding(NODE_PAD)
    .nodeAlign(d => d.stage)
    .extent([[LEFT_GUTTER, TOP_PAD], [W - RIGHT_GUTTER, H - 18]]);
  const g = sk({ nodes: nodes.map(n => ({ ...n })), links: links.map(l => ({ ...l })) });

  // Pastel ribbons, coloured by source name (left column).
  const leftNames = [...new Set(g.nodes.filter(n => n.depth === 0).map(n => n.name))].sort();
  const palette = d3.scaleOrdinal().domain(leftNames).range(ALLUVIAL_PASTELS);
  function rootName(node) {
    let cur = node;
    while (cur && cur.depth > 0) {
      const inbound = (cur.targetLinks || []).slice().sort((a, b) => b.value - a.value)[0];
      if (!inbound) break;
      cur = inbound.source;
    }
    return cur && cur.depth === 0 ? cur.name : null;
  }

  const linkSel = svg.append("g").selectAll("path").data(g.links).join("path")
    .attr("class", "link").attr("d", alluvialPath).attr("fill", "none")
    .attr("stroke", d => {
      const root = d.source.depth === 0 ? d.source.name : rootName(d.source);
      return root ? palette(root) : "#cdd5da";
    })
    .attr("stroke-width", d => Math.max(1, d.width))
    .on("mouseenter", (e, d) => dataCard.show(
      `<div class="dc-t">${escapeHtml(d.source.name)} → ${escapeHtml(d.target.name)}</div>
       <div class="dc-row"><span>Items</span>${d3.format(",")(d.value)}</div>`, e))
    .on("mousemove",  e => dataCard.move(e))
    .on("mouseleave", () => dataCard.hide());

  const nodeSel = svg.append("g").selectAll("g").data(g.nodes).join("g").attr("class", "node");
  nodeSel.append("rect")
    .attr("x", d => d.x0).attr("y", d => d.y0)
    .attr("height", d => Math.max(2, d.y1 - d.y0)).attr("width", d => d.x1 - d.x0)
    .on("mouseenter", (e, d) => dataCard.show(
      `<div class="dc-t">${escapeHtml(d.name)}</div>
       <div class="dc-row"><span>Items</span>${d3.format(",")(d.value || 0)}</div>`, e))
    .on("mousemove",  e => dataCard.move(e))
    .on("mouseleave", () => dataCard.hide())
    .on("click", (e, d) => highlight(d));

  // First column → labels left of rect; all others → right of rect.
  const maxDepth = d3.max(g.nodes, n => n.depth);
  const isFirst = d => d.depth === 0;
  const isLast  = d => d.depth === maxDepth;
  const labelX  = d => isFirst(d) ? d.x0 - ALLUVIAL_GAP - 2 : d.x1 + ALLUVIAL_GAP + 2;
  const anchorOf = d => isFirst(d) ? "end" : "start";
  const labels = nodeSel.append("text")
    .attr("class", "node-label")
    .attr("text-anchor", anchorOf)
    .attr("x", labelX)
    .attr("y", d => (d.y0 + d.y1) / 2);
  // Single-line uppercase name, truncated to fit the gutter (full text in <title>).
  const LBL_MAX = 30;
  const trunc = s => s.length > LBL_MAX ? s.slice(0, LBL_MAX - 1).trimEnd() + "…" : s;
  labels.append("tspan").attr("class", "lbl-name")
    .attr("x", labelX).attr("dy", "0.32em")
    .text(d => trunc((d.name || "").toUpperCase()));
  nodeSel.append("title").text(d => d.name);

  // Italic stage headers at the top of each column.
  const stageNames = Object.fromEntries(STAGES.map((f, i) => [i, f]));
  const stageMid = new Map();
  g.nodes.forEach(n => { if (!stageMid.has(n.depth)) stageMid.set(n.depth, (n.x0 + n.x1) / 2); });
  svg.append("g").attr("class", "stage-headers")
    .selectAll("text")
    .data([...stageMid.keys()].sort((a, b) => a - b))
    .join("text")
      .attr("x", d => d === 0 ? stageMid.get(d) - 8 : stageMid.get(d) + 8)
      .attr("y", 20)
      .attr("text-anchor", d => d === 0 ? "end" : "start")
      .text(d => stageNames[d] || `Stage ${d}`);

  let pinned = null;
  function highlight(d) {
    if (!d) { pinned = null; clear(); return; }
    if (pinned === d.id) { pinned = null; clear(); return; }
    pinned = d.id;
    linkSel.classed("hi",  l => l.source.id === d.id || l.target.id === d.id)
           .classed("dim", l => l.source.id !== d.id && l.target.id !== d.id);
    nodeSel.classed("dim", n =>
      n.id !== d.id &&
      !g.links.some(l => (l.source.id === d.id && l.target.id === n.id) ||
                          (l.target.id === d.id && l.source.id === n.id)));
  }
  function clear() {
    linkSel.classed("hi", false).classed("dim", false);
    nodeSel.classed("dim", false);
  }

  // Sidebar key for this Sankey: the canonical Topic palette is the
  // colour-encoding on the left stage.
  if (figId) figKey.register(figId, {
    title: leftField,
    legend: leftNames.map(t => ({ label: t, color: palette(t) })),
    onHighlight(name) {
      if (!name) { clear(); return; }
      const target = g.nodes.find(n => n.depth === 0 && n.name === name);
      if (target) highlight(target);
    },
  });
}

/** Bind a "by Topic / by CM Sub-topic" tab pair in a figure card. */
function bindSankeyTabs({ figSel, topicCsv, cmCsv, dlSel, hostSel, leftField, figId }) {
  const fig = document.querySelector(figSel);
  const dl  = document.querySelector(dlSel);
  let mode  = "topic";

  function rerender() {
    const csv = (mode === "topic") ? topicCsv : cmCsv;
    const lf  = (mode === "topic") ? leftField.topic : leftField.cm;
    const rf  = leftField.right;        // shared (Country or Media category)
    dl.href   = csv;
    renderSankeyTwo({ csv, leftField: lf, rightField: rf, hostSel, figId })
      .catch(e => e.missing ? renderPending(hostSel, "Awaiting data.") : console.error(e));
  }

  fig.querySelectorAll(".fig-controls .tab").forEach(b => b.addEventListener("click", () => {
    fig.querySelectorAll(".fig-controls .tab").forEach(x => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", x === b ? "true" : "false");
    });
    mode = b.dataset.mode; rerender();
  }));
  rerender();
}

/* ────────────────────────────────────────────────────────────────────────
   8. Figures 7 / 8 — Beeswarm (groups by Category | Sub-topic) + Gantt toggle
   ─────────────────────────────────────────────────────────────────────── */

async function renderBeeswarm({ csv, groupField, hostSel, controls, figId }) {
  const all = await loadCSV(csv);
  const host = d3.select(hostSel);
  const sel1 = controls.primarySel ? document.getElementById(controls.primarySel) : null;
  const selT = controls.typeSel    ? document.getElementById(controls.typeSel)    : null;
  const selS = controls.sortSel    ? document.getElementById(controls.sortSel)    : null;
  const selL = controls.langSel    ? document.getElementById(controls.langSel)    : null;
  const tabs = controls.tabsRoot   ? document.querySelector(controls.tabsRoot)    : null;

  if (sel1 && !sel1.options.length) {
    const pv = [...new Set(all.map(r => r[controls.primaryField]))].filter(Boolean).sort();
    pv.forEach(v => sel1.add(new Option(v, v)));
    sel1.value = pv[0];
  }
  // Populate the language dropdown from the data — "All languages" plus
  // every code that appears in the dataset (ordered by frequency desc).
  if (selL && !selL.options.length) {
    const LNAME = { en:"English", fr:"French", es:"Spanish", pt:"Portuguese",
                    it:"Italian", de:"German", ca:"Catalan", nl:"Dutch",
                    und:"undetermined" };
    const counts = d3.rollup(all, v => v.length, r => (r.Language || "und"));
    const codes = [...counts.entries()].sort((a,b) => b[1]-a[1]);
    selL.add(new Option("All languages", "ALL"));
    codes.forEach(([c,n]) => {
      const label = (LNAME[c] || c.toUpperCase()) + ` (${d3.format(",")(n)})`;
      selL.add(new Option(label, c));
    });
    selL.value = "ALL";
    selL.addEventListener("change", () => render());
  }

  const getYears = controls.yearInputs
    ? setupYearRange(controls.yearInputs[0], controls.yearInputs[1], all, () => render())
    : () => [null, null];

  function subset() {
    const p  = sel1 ? sel1.value : null;
    const ty = selT ? selT.value : "ALL";
    const lg = selL ? selL.value : "ALL";
    const [lo, hi] = getYears();
    return all.filter(r =>
      (!p || r[controls.primaryField] === p) &&
      (ty === "ALL" || (r.Type || "").toUpperCase() === ty) &&
      (lg === "ALL" || (r.Language || "und") === lg) &&
      inRange(r, lo, hi));
  }

  let mode = "gantt";   // Matrix view first (#2 default).

  /** Sort the Category (or Sub-topic) labels per the dropdown. */
  function sortGroups(groups, data) {
    const sortMode = selS ? selS.value : "alpha-asc";
    if (sortMode === "alpha-asc")  return groups.slice().sort();
    if (sortMode === "alpha-desc") return groups.slice().sort().reverse();
    if (sortMode === "qty-desc" || sortMode === "qty-asc") {
      const cnt = d3.rollup(data, v => v.length, r => r[groupField] || "(uncategorized)");
      return groups.slice().sort((a, b) =>
        (cnt.get(b) - cnt.get(a)) * (sortMode === "qty-desc" ? 1 : -1));
    }
    if (sortMode === "earliest" || sortMode === "latest") {
      const yr = d3.rollup(data,
        v => sortMode === "earliest" ? d3.min(v, r => +r["Publication Year"])
                                     : d3.max(v, r => +r["Publication Year"]),
        r => r[groupField] || "(uncategorized)");
      return groups.slice().sort((a, b) =>
        sortMode === "earliest" ? (yr.get(a) - yr.get(b)) : (yr.get(b) - yr.get(a)));
    }
    return groups.slice().sort();
  }

  function bee(data) {
    const color = topDisciplines(data);
    const groups = sortGroups([...new Set(data.map(r => r[groupField] || "(uncategorized)"))], data);
    const W = Math.max(720, host.node().clientWidth || 880);
    const ROW_H = 60;
    const H = Math.max(340, groups.length * ROW_H + 110);
    const yScale = d3.scalePoint().domain(groups).range([30, H - 50]).padding(0.5);
    const [y0, y1] = d3.extent(data, r => +r["Publication Year"]);
    const x = d3.scaleLinear().domain([y0 - 1, y1 + 1]).range([320, W - 24]);
    const rScale = d3.scaleSqrt().domain([0, d3.max(data, d => +d.Citations) || 1]).range([2, 12]);
    const jit = seededJitter(31, 11);

    const svg = host.append("svg").attr("class", "chart")
      .attr("viewBox", [0, 0, W, H]).attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%");
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${H - 30})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(10));
    const labelSel = svg.append("g").attr("class", "y-labels")
      .selectAll("text").data(groups).join("text")
        .attr("x", 12).attr("y", g => yScale(g) - 10)
        .text(g => g.length > 44 ? g.slice(0, 42) + "…" : g);
    labelSel.append("title").text(g => g);
    // Measure each label and start its row guide AFTER the label's right edge
    // so the dashed line never crosses through label text.
    const labelEnd = new Map();
    labelSel.each(function(g) {
      labelEnd.set(g, this.getBBox().x + this.getBBox().width + 10);
    });
    svg.append("g").attr("class", "rowguides")
      .selectAll("line").data(groups).join("line")
        .attr("x1", g => labelEnd.get(g) || 12).attr("x2", W - 24)
        .attr("y1", g => yScale(g)).attr("y2", g => yScale(g));
    const dots = svg.append("g").selectAll("circle").data(data).join("circle")
        .attr("cx", d => x(+d["Publication Year"]))
        .attr("cy", d => yScale(d[groupField] || "(uncategorized)") + jit())
        .attr("r",  d => rScale(+d.Citations || 0))
        .attr("fill", d => color(d.Discipline))
        .attr("opacity", 0.68)
        .on("mouseenter", async function (e, d) {
          d3.select(this).raise().attr("opacity", 1);
          const url   = await urlByKey(d.Key);
          const title = escapeHtml(d.Title || "(untitled)");
          const tHtml = url
            ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${title}</a>`
            : title;
          const abs = (d["Abstract Note"] || "").trim();
          dataCard.show(`
            <div class="dc-q">${escapeHtml(d["Mentioned item"] || "")}</div>
            <div class="dc-meta">p. ${escapeHtml(String(d.Page || "—"))} · ${escapeHtml(String(d["Publication Year"]))}</div>
            <div class="dc-t">${tHtml}</div>
            <div class="dc-row"><span>Author</span>${escapeHtml(d.Author || "")}</div>
            <div class="dc-row"><span>Discipline</span>${escapeHtml(d.Discipline || "")}</div>
            ${abs ? `<div class="dc-abs">${escapeHtml(abs)}</div>` : ""}`, e);
        })
        .on("mousemove", e => dataCard.move(e))
        .on("mouseleave", function () { d3.select(this).attr("opacity", 0.68); dataCard.hide(); })
        .on("click", async function (e, d) {
          e.stopPropagation();
          // Mark the clicked dot as "selected" so it stays visually pinned
          // while the card is open.
          host.selectAll("circle.selected").classed("selected", false);
          d3.select(this).classed("selected", true).raise();
          const url   = await urlByKey(d.Key);
          const title = escapeHtml(d.Title || "(untitled)");
          const tHtml = url
            ? `<a class="ext" href="${escapeHtml(url)}" target="_blank" rel="noopener">${title} ↗</a>`
            : title;
          const abs = (d["Abstract Note"] || "").trim();
          const pdf = (d["PDF Path"] || "").trim();
          dataCard.pin(`
            <button class="dc-close" aria-label="Close" type="button">×</button>
            <div class="dc-t">${tHtml}</div>
            <div class="dc-meta">${escapeHtml(d.Author || "")} · ${escapeHtml(String(d["Publication Year"]))} · p. ${escapeHtml(String(d.Page || "—"))}</div>
            <div class="dc-q">${escapeHtml(d["Mentioned item"] || "")}</div>
            <div class="dc-rows">
              <div class="dc-row"><span>Discipline</span>${escapeHtml(d.Discipline || "")}</div>
              ${pdf ? `<div class="dc-row"><span>PDF&nbsp;Path</span><code class="dc-pdf">${escapeHtml(pdf)}</code></div>` : ""}
            </div>
            ${abs ? `<div class="dc-abs full">${escapeHtml(abs)}</div>` : ""}`, e);
          const closeBtn = document.querySelector("#data-card .dc-close");
          if (closeBtn) closeBtn.addEventListener("click", () => {
            dataCard.unpin();
            host.selectAll("circle.selected").classed("selected", false);
          });
        });

    // Sidebar key — top-10 disciplines + "other".
    figKey.register(figId, {
      title: "Discipline (top 10)",
      legend: color.legend.map(d => ({ label: d, color: color(d) }))
                  .concat([{ label: "other", color: GREY_OTHER }]),
      onHighlight(name) {
        dots
          .classed("dim", d => name && !(
            name === "other"
              ? !color.legend.includes(d.Discipline)
              : d.Discipline === name))
          .classed("hi",  d => name && (
            name === "other"
              ? !color.legend.includes(d.Discipline)
              : d.Discipline === name));
      },
    });
  }

  function gantt(data) {
    const color  = topDisciplines(data);
    const groups = sortGroups([...new Set(data.map(r => r[groupField] || "(uncategorized)"))], data);
    const [y0, y1] = d3.extent(data, r => +r["Publication Year"]);
    const years = d3.range(y0, y1 + 1);
    const cells = d3.rollups(data,
      v => {
        const byD = d3.rollup(v, vv => vv.length, vv => vv.Discipline || "(unspecified)");
        const dom = [...byD.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { n: v.length, disc: dom };
      },
      r => r[groupField] || "(uncategorized)",
      r => +r["Publication Year"]);

    const W = Math.max(720, host.node().clientWidth || 880);
    const ROW_H = 24;
    const H = Math.max(300, groups.length * ROW_H + 110);
    const xb = d3.scaleBand().domain(years).range([320, W - 24]).padding(0.08);
    const yb = d3.scaleBand().domain(groups).range([30, H - 50]).padding(0.08);
    const maxN = d3.max(cells, c => d3.max(c[1], cc => cc[1].n)) || 1;
    const rs = d3.scaleSqrt().domain([0, maxN])
      .range([2, Math.min(xb.bandwidth(), yb.bandwidth()) / 2]);

    const svg = host.append("svg").attr("class", "chart")
      .attr("viewBox", [0, 0, W, H]).attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%");
    const xAxis = d3.scaleLinear().domain([y0, y1])
      .range([xb(y0) + xb.bandwidth() / 2, xb(y1) + xb.bandwidth() / 2]);
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${H - 30})`)
      .call(d3.axisBottom(xAxis).tickFormat(d3.format("d")).ticks(10));
    svg.append("g").attr("class", "y-labels")
      .selectAll("text").data(groups).join("text")
        .attr("x", 12).attr("y", g => yb(g) + yb.bandwidth() / 2).attr("dy", "0.32em")
        .text(g => g.length > 44 ? g.slice(0, 42) + "…" : g)
      .append("title").text(g => g);
    const flat = [];
    cells.forEach(([cat, yrs]) => yrs.forEach(([yr, info]) => flat.push({ cat, yr, ...info })));
    const cellsSel = svg.append("g").selectAll("circle").data(flat).join("circle")
      .attr("cx", d => xb(d.yr) + xb.bandwidth() / 2)
      .attr("cy", d => yb(d.cat) + yb.bandwidth() / 2)
      .attr("r", d => rs(d.n))
      .attr("fill", d => color(d.disc))
      .attr("opacity", 0.86)
      .on("mouseenter", function (e, d) {
        dataCard.show(`
          <div class="dc-t">${escapeHtml(d.cat)} · ${d.yr}</div>
          <div class="dc-row"><span>Mentions</span>${d.n}</div>
          <div class="dc-row"><span>Dominant Discipline</span>${escapeHtml(d.disc)}</div>`, e);
      })
      .on("mousemove", e => dataCard.move(e))
      .on("mouseleave", () => dataCard.hide());

    figKey.register(figId, {
      title: "Dominant Discipline (top 10)",
      legend: color.legend.map(d => ({ label: d, color: color(d) }))
                  .concat([{ label: "other", color: GREY_OTHER }]),
      onHighlight(name) {
        cellsSel
          .classed("dim", d => name && !(
            name === "other"
              ? !color.legend.includes(d.disc)
              : d.disc === name))
          .classed("hi",  d => name && (
            name === "other"
              ? !color.legend.includes(d.disc)
              : d.disc === name));
      },
    });
  }

  function render() {
    host.selectAll("*").remove();
    const data = subset();
    if (!data.length) {
      host.append("div").attr("class", "placeholder").text("No findings for this selection.");
      return;
    }
    (mode === "gantt" ? gantt : bee)(data);
  }

  if (sel1) sel1.addEventListener("change", render);
  if (selT) selT.addEventListener("change", render);
  if (selS) selS.addEventListener("change", render);
  if (tabs) {
    tabs.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => {
      tabs.querySelectorAll(".tab").forEach(x => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-selected", x === b ? "true" : "false");
      });
      mode = b.dataset.mode; render();
    }));
  }
  render();
}

/* ────────────────────────────────────────────────────────────────────────
   9. Figures 9 / 10 — Layered force network (GROUP → WHO → HOW → WHAT → WHY)
   ─────────────────────────────────────────────────────────────────────── */

const NET_LAYERS  = ["GROUP", "WHO", "HOW", "WHAT", "WHY"];
const LAYER_COLOR = {
  GROUP: "#7a766c", WHO: "#2f6f9f", HOW: "#3f8c63",
  WHAT:  "#e08e3b", WHY: "#c54a44"
};

async function renderNetwork({ edgesCsv, nodesCsv, hostSel, minInputId, figId }) {
  const [edges, nodes] = await Promise.all([loadCSV(edgesCsv), loadCSV(nodesCsv)]);
  const nodeN = new Map();
  nodes.forEach(n => nodeN.set(`${n.Type}::${n.Category}`, +n.n_items || 1));

  const host = d3.select(hostSel); host.selectAll("*").remove();
  const W = Math.max(880, host.node().clientWidth || 1040);
  const H = 760;                                  // taller for label room
  const svg = host.append("svg").attr("class", "chart network")
    .attr("viewBox", [0, 0, W, H]).attr("preserveAspectRatio", "xMidYMid meet")
    .attr("width", "100%");

  // Click on empty SVG → clear any pinned highlight.
  svg.on("click", () => clearHighlight());

  const gEdges  = svg.append("g").attr("class", "edges");
  const gNodes  = svg.append("g").attr("class", "nodes");
  const gLabels = svg.append("g").attr("class", "labels");

  // Leave generous room on the right so the WHY column's long labels can fit
  // without being clipped at the SVG edge.
  const xLayer = d3.scalePoint().domain(NET_LAYERS).range([110, W - 190]);
  svg.append("g").attr("class", "layer-h")
    .selectAll("text").data(NET_LAYERS).join("text")
      .attr("x", l => xLayer(l)).attr("y", 22).attr("text-anchor", "middle")
      .attr("fill", l => LAYER_COLOR[l]).attr("font-weight", 700).attr("font-size", 12)
      .text(l => l);

  /* State for click-to-highlight (#network click highlight). */
  let pinned = null;        // node id
  let nodeSel, linkSel, labelSel;
  let edgesByNode;          // Map<nodeId, [edges]>
  let nodeById;             // Map<nodeId, node>

  function clearHighlight() {
    pinned = null;
    if (!nodeSel) return;
    nodeSel.classed("dim",  false).classed("hi", false);
    linkSel.classed("dim",  false).classed("hi", false);
    labelSel.classed("dim", false);
  }
  function highlightNode(d) {
    if (!d) { clearHighlight(); return; }
    if (pinned === d.id) { clearHighlight(); return; }
    pinned = d.id;
    const neighbours = new Set([d.id]);
    (edgesByNode.get(d.id) || []).forEach(l => {
      neighbours.add(l.source); neighbours.add(l.target);
    });
    nodeSel
      .classed("dim", n => !neighbours.has(n.id))
      .classed("hi",  n => n.id === d.id);
    linkSel
      .classed("dim", l => l.source !== d.id && l.target !== d.id)
      .classed("hi",  l => l.source === d.id || l.target === d.id);
    labelSel
      .classed("dim", n => !neighbours.has(n.id));
  }

  function draw(min) {
    const useE = edges.filter(e => +e.Weight >= min);
    const keys = new Set();
    useE.forEach(e => {
      keys.add(`${e["Source Type"]}::${e["Source Category"]}`);
      keys.add(`${e["Target Type"]}::${e["Target Category"]}`);
    });
    const N = [...keys].map(k => {
      const [ty, ...rest] = k.split("::");
      return { id: k, ty, cat: rest.join("::"), n: nodeN.get(k) || 1 };
    });
    const L = useE.map(e => ({
      source: `${e["Source Type"]}::${e["Source Category"]}`,
      target: `${e["Target Type"]}::${e["Target Category"]}`,
      weight: +e.Weight,
    }));
    const wmax = d3.max(L, l => l.weight) || 1;
    const eW = d3.scaleSqrt().domain([0, wmax]).range([0.4, 3.2]);
    const nR = d3.scaleSqrt().domain([0, d3.max(N, n => n.n) || 1]).range([4, 16]);

    gEdges.selectAll("*").remove();
    gNodes.selectAll("*").remove();
    gLabels.selectAll("*").remove();
    svg.selectAll(".empty").remove();
    if (!N.length) {
      svg.append("text").attr("class", "empty")
         .attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle")
         .attr("fill", "#8a877f").text(`No edges with weight ≥ ${min}.`);
      return;
    }

    /* ── Fixed multipartite layout (mirrors network.png) ──────────────
       Per layer: sort nodes by n_items desc, then space them evenly on
       Y inside the chart's vertical band. Most-connected node sits in
       the middle, smaller nodes fan to the top/bottom. */
    const yTop = 50, yBot = H - 30;
    const byLayer = d3.group(N, n => n.ty);
    NET_LAYERS.forEach(ty => {
      const arr = (byLayer.get(ty) || []).slice().sort((a, b) => b.n - a.n);
      const k = arr.length;
      // Re-order so high-degree nodes sit in the middle (most readable).
      const middle = [];
      const ends = [];
      arr.forEach((node, i) => (i % 2 === 0 ? middle.push(node) : ends.push(node)));
      const ordered = ends.reverse().concat(middle);
      ordered.forEach((node, i) => {
        node.x = xLayer(ty);
        node.y = yTop + (yBot - yTop) * ((i + 0.5) / k);
      });
    });

    nodeById   = new Map(N.map(n => [n.id, n]));
    edgesByNode = new Map(N.map(n => [n.id, []]));
    L.forEach(l => {
      edgesByNode.get(l.source)?.push(l);
      edgesByNode.get(l.target)?.push(l);
    });

    linkSel = gEdges.selectAll("line").data(L).join("line")
      .attr("stroke", "#5d574d").attr("stroke-opacity", 0.10)
      .attr("stroke-width", d => eW(d.weight))
      .attr("x1", d => nodeById.get(d.source).x)
      .attr("y1", d => nodeById.get(d.source).y)
      .attr("x2", d => nodeById.get(d.target).x)
      .attr("y2", d => nodeById.get(d.target).y);

    nodeSel = gNodes.selectAll("circle").data(N).join("circle")
      .attr("cx", d => d.x).attr("cy", d => d.y)
      .attr("r",  d => nR(d.n))
      .attr("fill", d => LAYER_COLOR[d.ty] || "#888")
      .attr("opacity", 0.96)
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => dataCard.show(
        `<div class="dc-t">${escapeHtml(d.cat)}</div>
         <div class="dc-row"><span>Layer</span>${escapeHtml(d.ty)}</div>
         <div class="dc-row"><span>n items</span>${d3.format(",")(d.n)}</div>`, e))
      .on("mousemove",  e => dataCard.move(e))
      .on("mouseleave", () => dataCard.hide())
      .on("click", (e, d) => {
        e.stopPropagation();    // don't trigger the SVG-background clearer
        highlightNode(d);
      });

    labelSel = gLabels.selectAll("text").data(N).join("text")
      .attr("class", "node-label")
      .attr("font-size", 12)
      .attr("pointer-events", "none")
      .attr("x", d => d.x + nR(d.n) + 4)
      .attr("y", d => d.y + 3)
      .text(d => d.cat.length > 26 ? d.cat.slice(0, 24) + "…" : d.cat);
    labelSel.append("title").text(d => d.cat);

    if (figId) figKey.register(figId, {
      title: "Layer",
      legend: NET_LAYERS.map(l => ({ label: l, color: LAYER_COLOR[l] })),
      onHighlight(name) {
        if (!name) { clearHighlight(); return; }
        nodeSel.classed("dim", d => d.ty !== name).classed("hi", d => d.ty === name);
        linkSel.classed("dim", l =>
          nodeById.get(l.source).ty !== name && nodeById.get(l.target).ty !== name);
        labelSel.classed("dim", d => d.ty !== name);
      },
    });
  }

  const inp = document.getElementById(minInputId);
  draw(+inp.value || 1);
  let t;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => draw(+inp.value || 1), 120);
  });
}

/* ────────────────────────────────────────────────────────────────────────
   10. Sidebar fig-key panel — swaps as the user scrolls between figures.
   Each renderer registers { title, legend, onHighlight } for its figure.
   ─────────────────────────────────────────────────────────────────────── */

const figKey = (() => {
  const reg     = new Map();   // figId → { title, legend, onHighlight }
  let   active  = null;        // currently selected legend item (string) or null
  let   currentFig = null;     // figure id whose key is shown

  function render() {
    const panel = document.getElementById("fig-key");
    const head  = document.getElementById("fig-key-h");
    const body  = document.getElementById("fig-key-body");
    const clear = document.getElementById("fig-key-clear");
    if (!panel) return;
    const r = reg.get(currentFig);
    if (!r || !r.legend || !r.legend.length) {
      panel.hidden = true; return;
    }
    panel.hidden = false;
    head.textContent = r.title || "Key";
    body.innerHTML = "";
    r.legend.forEach(it => {
      const d = document.createElement("div");
      d.className = "fk-item" + (active === it.label ? " active" : "");
      d.innerHTML =
        `<span class="fk-sw" style="background:${it.color}"></span>
         <span class="fk-lab">${escapeHtml(it.label)}</span>`;
      d.addEventListener("click", () => {
        active = (active === it.label) ? null : it.label;
        r.onHighlight && r.onHighlight(active);
        render();
      });
      body.appendChild(d);
    });
    clear.hidden = !active;
    clear.onclick = () => {
      active = null;
      r.onHighlight && r.onHighlight(null);
      render();
    };
  }

  return {
    register(figId, opts) {
      reg.set(figId, opts);
      if (figId !== currentFig) return;
      // If the user has a label selected that no longer exists in the new
      // legend (e.g. after changing Topic in Fig 7), clear the highlight.
      if (active && !(opts.legend || []).some(it => it.label === active)) {
        opts.onHighlight && opts.onHighlight(null);
        active = null;
      }
      render();
    },
    setActive(figId) {
      if (figId === currentFig) return;
      if (currentFig && reg.get(currentFig)?.onHighlight) {
        reg.get(currentFig).onHighlight(null);
      }
      currentFig = figId; active = null; render();
    },
    activeLabel() { return active; },
  };
})();

/* Sub-topic palette is now OPEN — built per-figure from the data via an
   ordinal scale (`makeSubtopicScale(groups)`). The legacy `subtopicColor`
   fallback handles ad-hoc calls where no scale is available. */
const SUBTOPIC_PALETTE =
  d3.schemeTableau10.concat(d3.schemeSet2, d3.schemePastel1, d3.schemeSet3);
function makeSubtopicScale(groups) {
  return d3.scaleOrdinal()
    .domain([...new Set(groups)].filter(Boolean).sort())
    .range(SUBTOPIC_PALETTE);
}
let _DEFAULT_SUB_SCALE = null;
const subtopicColor = name => {
  if (!_DEFAULT_SUB_SCALE) _DEFAULT_SUB_SCALE = d3.scaleOrdinal().range(SUBTOPIC_PALETTE);
  return name ? _DEFAULT_SUB_SCALE(name) : "#7c7770";
};

/* ────────────────────────────────────────────────────────────────────────
   11. Key → Url map (lazy-loaded once for the beeswarm hover-cards)
   ─────────────────────────────────────────────────────────────────────── */

let _urlByKey = null;
async function urlByKey(key) {
  if (!_urlByKey) {
    try {
      const rows = await loadCSV("data/key_url.csv");
      _urlByKey = new Map(rows.map(r => [String(r.Key || "").trim(),
                                          String(r.Url || "").trim()]));
    } catch { _urlByKey = new Map(); }
  }
  return _urlByKey.get(String(key || "").trim()) || "";
}

/* ────────────────────────────────────────────────────────────────────────
   12. Per-figure notes (localStorage) + "Download manuscript + notes" button
   ─────────────────────────────────────────────────────────────────────── */

/** Pull every `.fig-notes` textarea OUT of its `<figure>` and into a sibling
 *  `.fig-notes-pane`, then wrap the pair in a `.fig-row` (per #1: notes live
 *  in the free space beside the figure, not inside the figure card). */
function restructureFigureNotes() {
  document.querySelectorAll("figure.fig").forEach(fig => {
    if (fig.parentElement?.classList.contains("fig-row")) return;
    const notes = fig.querySelector(":scope > .fig-notes");
    const row   = document.createElement("div");
    row.className = "fig-row";
    fig.parentNode.insertBefore(row, fig);
    row.appendChild(fig);
    const pane  = document.createElement("aside");
    pane.className = "fig-notes-pane";
    if (notes) pane.appendChild(notes);
    row.appendChild(pane);
  });
}

function setupNotes() {
  const store = (() => {
    try { return window.localStorage; } catch { return null; }
  })();
  document.querySelectorAll(".fig-notes").forEach(ta => {
    const k = "notes:" + ta.dataset.fig;
    if (store) try { ta.value = store.getItem(k) || ""; } catch {}
    ta.addEventListener("input", () => {
      if (store) try { store.setItem(k, ta.value); } catch {}
    });
  });
  const btn = document.getElementById("dl-md");
  if (btn) btn.addEventListener("click", downloadMarkdown);
}

/** Make every figure caption editable + persist (#9). */
function setupCaptionEdits() {
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  document.querySelectorAll("figure.fig .fig-cap").forEach(cap => {
    const figId = cap.closest("figure").id;
    cap.setAttribute("contenteditable", "true");
    cap.setAttribute("spellcheck", "false");
    const key = "edit:cap:" + figId;
    if (store) try {
      const saved = store.getItem(key);
      if (saved) cap.innerHTML = saved;
    } catch {}
    let t;
    cap.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (store) try { store.setItem(key, cap.innerHTML); } catch {}
      }, 400);
    });
  });
}

/** HTML → Markdown via Turndown, with a tiny preserve-style for citations. */
function htmlToMd(html) {
  if (typeof TurndownService === "undefined") {
    // Last-resort: strip tags so the user gets at least the text.
    return html.replace(/<[^>]+>/g, "");
  }
  const td = new TurndownService({
    headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-"
  });
  // Keep "@key" form for citation spans.
  td.addRule("cite", {
    filter: node => node.classList && node.classList.contains("cite"),
    replacement: (content, node) => `[@${node.getAttribute("data-key") || ""}]`,
  });
  return td.turndown(html);
}

async function downloadMarkdown() {
  // Start from the (possibly edited) manuscript host.
  const host = document.getElementById("manuscript");
  let manuscriptMd = "";
  if (host) {
    try { manuscriptMd = htmlToMd(host.innerHTML.trim()); } catch (e) {
      console.warn("Turndown failed; falling back to text only.", e);
      manuscriptMd = host.innerText || "";
    }
  }

  let out = manuscriptMd.trimEnd() + "\n\n---\n\n# Analysis figures & notes\n";
  document.querySelectorAll("figure.fig").forEach(f => {
    const cap = (f.querySelector(".fig-cap")?.innerText || f.id)
                  .replace(/\s+/g, " ").trim();
    const note = (f.querySelector(".fig-notes")?.value || "").trim();
    out += `\n## ${cap}\n`;
    if (note) out += `\n${note}\n`;
    else      out += `\n_(no notes)_\n`;
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const blob  = new Blob([out], { type: "text/markdown;charset=utf-8" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  a.href = url; a.download = `chapter1_manuscript_${stamp}.md`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

/* ────────────────────────────────────────────────────────────────────────
   13. Year-range control helper
   ─────────────────────────────────────────────────────────────────────── */

function setupYearRange(idA, idB, rows, onChange) {
  const a = document.getElementById(idA);
  const b = document.getElementById(idB);
  if (!a || !b) return () => [null, null];
  const years = rows.map(r => +r["Publication Year"]).filter(Number.isFinite);
  if (!years.length) return () => [null, null];
  const y0 = Math.min(...years), y1 = Math.max(...years);
  a.min = b.min = y0; a.max = b.max = y1;
  if (a.value === "" || +a.value < y0 || +a.value > y1) a.value = y0;
  if (b.value === "" || +b.value < y0 || +b.value > y1) b.value = y1;
  const fire = () => onChange();
  a.addEventListener("change", fire);
  b.addEventListener("change", fire);
  return () => [+a.value || y0, +b.value || y1];
}

function inRange(r, lo, hi) {
  const y = +r["Publication Year"]; if (!Number.isFinite(y)) return false;
  return (!Number.isFinite(lo) || y >= lo) && (!Number.isFinite(hi) || y <= hi);
}

/* ────────────────────────────────────────────────────────────────────────
   14. Bump renderer (Figs 3 & 4 — unique items per Topic/Sub-topic per year)
   ─────────────────────────────────────────────────────────────────────── */

async function renderBump({ csv, yField, hostSel, figId, yearInputs }) {
  const all  = await loadCSV(csv);
  const data = all.filter(r => Number.isFinite(+r["Publication Year"]));
  const host = d3.select(hostSel);
  const getYears = setupYearRange(yearInputs[0], yearInputs[1], data, draw);

  // Topic palette is fixed (5–10 stable names); Sub-topic is open, so we
  // build the scale fresh from the data and cache it across redraws.
  let _subScale = null;
  function colorFor(name, groups) {
    if (yField !== "Sub-topic") return TOPIC_COLOR_FN(name);
    if (!_subScale) _subScale = makeSubtopicScale(groups);
    return _subScale(name);
  }
  // Convenience wrapper that matches the previous signature.
  const colorFn = name => colorFor(name, currentGroups);
  let currentGroups = [];

  function draw() {
    const [lo, hi]  = getYears();
    const rows      = data.filter(r => inRange(r, lo, hi));
    host.selectAll("*").remove();
    if (!rows.length) {
      host.append("div").attr("class", "placeholder").text("No data in this year range.");
      return;
    }
    const groups = [...new Set(rows.map(r => r[yField] || "(unknown)"))].sort();
    currentGroups = groups;
    if (yField === "Sub-topic") _subScale = makeSubtopicScale(groups);
    const years  = d3.range(d3.min(rows, r => +r["Publication Year"]),
                             d3.max(rows, r => +r["Publication Year"]) + 1);
    const counts = new Map(groups.map(g => [g, new Map(years.map(y => [y, 0]))]));
    rows.forEach(r => {
      const g = r[yField] || "(unknown)";
      counts.get(g).set(+r["Publication Year"],
                        (counts.get(g).get(+r["Publication Year"]) || 0) + 1);
    });

    const W = Math.max(720, host.node().clientWidth || 880);
    const H = 420;
    const m = { top: 24, right: 200, bottom: 36, left: 56 };
    const x = d3.scaleLinear().domain([years[0], years[years.length - 1]])
                              .range([m.left, W - m.right]);
    const yMax = d3.max(groups.flatMap(g => [...counts.get(g).values()])) || 1;
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([H - m.bottom, m.top]);

    const svg = host.append("svg").attr("class", "chart bump")
      .attr("viewBox", [0, 0, W, H]).attr("preserveAspectRatio", "xMidYMid meet")
      .attr("width", "100%");
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${H - m.bottom})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(10));
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(6));

    const line = d3.line()
      .x(([yr]) => x(yr))
      .y(([, n]) => y(n))
      .curve(d3.curveMonotoneX);

    const series = groups.map(g => ({
      group: g,
      values: years.map(yr => [yr, counts.get(g).get(yr) || 0]),
    }));

    // One <g.series> per group with the path + invisible hover dots.
    const gSel = svg.append("g").attr("class", "lines")
      .selectAll("g").data(series).join("g")
        .attr("class", "series")
        .attr("data-group", d => d.group);
    gSel.append("path")
      .attr("stroke", d => colorFn(d.group))
      .attr("d", d => line(d.values));
    // Tiny hover dots (CSS keeps them invisible until series:hover).
    gSel.selectAll("circle")
      .data(d => d.values.map(v => ({ group: d.group, year: v[0], n: v[1] })))
      .join("circle")
        .attr("cx", d => x(d.year)).attr("cy", d => y(d.n))
        .attr("fill", d => colorFn(d.group))
        .on("mouseenter", (e, d) => dataCard.show(
          `<div class="dc-t">${escapeHtml(d.group)} · ${d.year}</div>
           <div class="dc-row"><span>Unique items</span>${d3.format(",")(d.n)}</div>`, e))
        .on("mousemove",  e => dataCard.move(e))
        .on("mouseleave", () => dataCard.hide());
    // End-of-line labels — the rawgraphs bumpchart convention.
    gSel.append("text").attr("class", "label")
      .attr("x", d => x(d.values[d.values.length - 1][0]) + 6)
      .attr("y", d => y(d.values[d.values.length - 1][1]))
      .attr("dy", "0.32em")
      .attr("fill", d => colorFn(d.group))
      .text(d => d.group);

    figKey.register(figId, {
      title: yField,
      legend: groups.map(g => ({ label: g, color: colorFn(g) })),
      onHighlight(name) {
        gSel.classed("dim", d => name && d.group !== name)
            .classed("hi",  d => name && d.group === name);
      },
    });
  }

  draw();
}

/* Topic colour function (sankey palette also uses this for legends). */
const TOPIC_COLOR_FN = name => TOPIC_COLOR[name] || colorFor(name);



const safe = (label, hostSel) => async fn => {
  try { await fn(); }
  catch (e) {
    if (e && e.missing) renderPending(hostSel,
      `Awaiting cleaned data (${label}) — run site/scripts/build_site_data.py.`);
    else console.error(label, e);
  }
};

/** Attach a Bubble/Bump segmented toggle on a figure card. */
function bindBubbleBump(opts) {
  const fig = document.querySelector(opts.figSel);
  let mode = "bump";   // Bump view first (per #3).
  function run() {
    const fn = (mode === "bump") ? renderBump : renderBubble;
    fn({ csv: opts.csv, yField: opts.yField, hostSel: opts.hostSel,
         figId: opts.figId, yearInputs: opts.yearInputs })
      .catch(e => e.missing ? renderPending(opts.hostSel, "Awaiting data.") : console.error(e));
  }
  fig.querySelectorAll(".seg .tab").forEach(b => b.addEventListener("click", () => {
    fig.querySelectorAll(".seg .tab").forEach(x => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", x === b ? "true" : "false");
    });
    mode = b.dataset.mode; run();
  }));
  run();
}

/** Watch which figure is in view; tell figKey to swap the sidebar key. */
function observeActiveFigure() {
  if (typeof IntersectionObserver !== "function") return;
  const obs = new IntersectionObserver(entries => {
    // Pick the most-visible figure currently intersecting.
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (visible.length) figKey.setActive(visible[0].target.id);
  }, { rootMargin: "-25% 0px -45% 0px", threshold: [0, 0.3, 0.6, 1] });
  document.querySelectorAll("figure.fig").forEach(f => obs.observe(f));
}

window.addEventListener("DOMContentLoaded", async () => {
  try { await renderManuscript(); } catch (e) { console.error(e); }

  await safe("summary",  "#summary-table")(() => renderSummary());
  await safe("sankey D→T→S", "#sankey-discipline-topic")(() => renderSankeyDTS());

  await safe("bubble/bump year×topic", "#bubble-year-topic")(() =>
    bindBubbleBump({
      figSel: "#fig-year-topic", hostSel: "#bubble-year-topic",
      figId:  "fig-year-topic",  yField:  "Topic",
      csv:    "data/items_year_disc_topic.csv",
      yearInputs: ["yt-y0", "yt-y1"],
    }));
  await safe("bubble/bump year×subtopic", "#bubble-year-subtopic")(() =>
    bindBubbleBump({
      figSel: "#fig-year-subtopic", hostSel: "#bubble-year-subtopic",
      figId:  "fig-year-subtopic",  yField:  "Sub-topic",
      csv:    "data/items_year_disc_subtopic.csv",
      yearInputs: ["ys-y0", "ys-y1"],
    }));

  await safe("sankey media", "#sankey-media")(() =>
    bindSankeyTabs({
      figSel: "#fig-media", hostSel: "#sankey-media", figId: "fig-media",
      topicCsv: "data/top_media_by_topic.csv",
      cmCsv:    "data/top_media_by_cm_subtopic.csv",
      dlSel: "#dl-media",
      leftField: { topic: "Topic", cm: "Sub-topic", right: "Media category" },
    }));

  await safe("beeswarm topics", "#beeswarm-topics")(() =>
    renderBeeswarm({
      csv: "data/beeswarm_by_topic.csv", groupField: "Category",
      hostSel: "#beeswarm-topics", figId: "fig-beeswarm-topics",
      controls: {
        primarySel: "bee-topic-select", primaryField: "Topic",
        typeSel:    "bee-type-select",
        sortSel:    "bee-sort-select",
        langSel:    "bee-lang-select",
        tabsRoot:   "#fig-beeswarm-topics .seg",
        yearInputs: ["bt-y0", "bt-y1"],
      },
    }));
  await safe("beeswarm CM", "#beeswarm-cm")(() =>
    renderBeeswarm({
      csv: "data/beeswarm_by_cm_subtopic.csv", groupField: "Category",
      hostSel: "#beeswarm-cm", figId: "fig-beeswarm-cm",
      controls: {
        primarySel: "bee-cm-select", primaryField: "Sub-topic",
        typeSel:    "bee-cm-type-select",
        sortSel:    "bee-cm-sort-select",
        langSel:    "bee-cm-lang-select",
        tabsRoot:   "#fig-beeswarm-cm .seg",
        yearInputs: ["bc-y0", "bc-y1"],
      },
    }));

  await safe("network topics", "#network-topics")(() =>
    renderNetwork({ edgesCsv: "data/network_topic_edges.csv",
                    nodesCsv: "data/network_topic_nodes.csv",
                    hostSel:  "#network-topics",
                    minInputId: "net-topics-min",
                    figId: "fig-network-topics" }));
  await safe("network subtopics", "#network-subtopics")(() =>
    renderNetwork({ edgesCsv: "data/network_subtopic_edges.csv",
                    nodesCsv: "data/network_subtopic_nodes.csv",
                    hostSel:  "#network-subtopics",
                    minInputId: "net-subtopics-min",
                    figId: "fig-network-subtopics" }));

  // Figure 1 — Language → Country → (Topic | CM Sub-topic) alluvial.
  // The "by Topic" tab uses every item in the corpus; the "by CM Sub-topic"
  // tab restricts to items whose Topic is Content moderation. The middle
  // (Country) column is capped at the 20 most-mentioned countries.
  function renderLangCountryFig(mode) {
    const cfg = mode === "cm" ? {
      csv: "data/items_by_language_country_cm_subtopic.csv",
      stages: ["LanguageName", "Country", "Sub-topic"],
    } : {
      csv: "data/items_by_language_country_topic.csv",
      stages: ["LanguageName", "Country", "Topic"],
    };
    const dl = document.getElementById("dl-lang-country");
    if (dl) dl.href = cfg.csv;
    return renderSankeyTwo({
      csv: cfg.csv,
      stages: cfg.stages,
      valueField: "Items",
      hostSel: "#sankey-lang-country",
      figId: "fig-lang-country",
      topRight: 20,
    });
  }
  await safe("lang × country × topic", "#sankey-lang-country")(() =>
    renderLangCountryFig("topic"));
  document.querySelectorAll("#fig-lang-country .fig-controls .tab")
    .forEach(btn => btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll("#fig-lang-country .fig-controls .tab")
        .forEach(b => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
      renderLangCountryFig(mode).catch(console.error);
    }));

  // restructureFigureNotes() / setupNotes() disabled — per-figure note
  // textareas were removed from index.html; nothing to bundle or wire up.
  // setupCaptionEdits() disabled — manuscript editing happens in the source
  //                      manuscript.md file, not in the page.
  observeActiveFigure();    // swap the sidebar fig-key as you scroll
  setupFigureDownloads();   // ⬇ PNG / ⬇ SVG buttons on every chart
  promoteInlineFigures();   // swap manuscript placeholders for live figures
});

/* If `manuscript.md` embeds a screenshot called `fig-<slug>.png`, we treat
   it as a placeholder for the live interactive figure with id `fig-<slug>`.
   On the live page we MOVE that <figure> from its Analysis-section slot
   into the placeholder's spot, so the prose flows directly into the
   interactive chart. The PNG and any "View interactive" pill we added earlier
   are discarded — they were only for the static (PDF) surface. */
function promoteInlineFigures() {
  const placeholders = document.querySelectorAll("img.inline-fig-placeholder");
  placeholders.forEach(img => {
    const slug = img.dataset.fig;
    if (!slug) return;
    const live = document.getElementById(slug);
    if (!live || live.classList.contains("fig-live-mounted")) return;

    // Walk up to the outermost wrapper the user might have written:
    //   `[![alt](fig.png)](url)` → wrapping <a>
    //   `![alt](fig.png)`        → just the <img>
    // Replace whichever is at the top with the live figure.
    let outer = img;
    while (outer.parentElement &&
           outer.parentElement !== document.body &&
           (outer.parentElement.children.length === 1 ||
            outer.parentElement.tagName === "A")) {
      const p = outer.parentElement;
      if (!/^(A|PICTURE|P|SPAN|FIGURE)$/.test(p.tagName)) break;
      outer = p;
    }
    (outer.parentElement || document)
       .querySelectorAll(".fig-live-pill").forEach(el => el.remove());

    outer.replaceWith(live);
    live.classList.add("fig-live-mounted");
    if (location.hash === "#" + slug) {
      requestAnimationFrame(() =>
        live.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  });

  // ── Tidy the Analysis / Overview section as figures move out of it ──
  // For each <h2> inside `#analysis`, look at the elements between it and
  // the next <h2>: if none of them contains a `.fig`, hide the heading.
  // If `#analysis` ends up with no `.fig` at all, hide the whole section
  // (including its lede paragraph). All hidden so the slug-anchored
  // permalinks still resolve if anything later wants to un-hide them.
  const analysis = document.getElementById("analysis");
  if (!analysis) return;
  const allHeadings = [...analysis.querySelectorAll("h1, h2, h3")];
  allHeadings.forEach((h, i) => {
    const next = allHeadings[i + 1] || null;
    let hasFig = false;
    let el = h.nextElementSibling;
    while (el && el !== next) {
      if (el.matches(".fig") || el.querySelector(".fig")) { hasFig = true; break; }
      el = el.nextElementSibling;
    }
    if (!hasFig) {
      h.hidden = true;
      // also hide everything between this heading and the next heading
      // (intro paragraphs / "lede" text under an empty subsection).
      let cur = h.nextElementSibling;
      while (cur && cur !== next) {
        if (!cur.classList.contains("fig")) cur.hidden = true;
        cur = cur.nextElementSibling;
      }
    }
  });
  // If no figure remains in Analysis at all, hide the section header too.
  if (!analysis.querySelector(".fig")) {
    const head = analysis.querySelector(".analysis-head");
    if (head) head.hidden = true;
    // The `.analysis` wrapper itself stays in the DOM (it provides the
    // section landmark and may host the page footer), but its contents
    // are now all hidden.
  }
}

/* ────────────────────────────────────────────────────────────────────────
   Figure export — adds "⬇ SVG" + "⬇ PNG (300 ppi)" buttons to every
   `.fig` card that contains an SVG chart. The PNG export rasterises the
   SVG at ~4× the screen pixel density (≈ 4 × 96 = 384 ppi nominal, well
   over the 300 ppi requested) onto a paper-coloured canvas, then
   downloads it via Blob URL.
   ─────────────────────────────────────────────────────────────────────── */

const PNG_SCALE = 4;                                     // ≈ 384 nominal ppi
const PAPER_BG  = "#faf7f2";                             // --paper

function setupFigureDownloads() {
  document.querySelectorAll(".fig").forEach(fig => {
    // Re-attach on every chart re-render (some figs swap views).
    const tryAttach = () => {
      const svg = fig.querySelector("svg.chart, svg.sankey, svg.alluvial, svg");
      if (!svg) return;
      const foot = fig.querySelector(".fig-foot");
      if (!foot) return;
      if (foot.querySelector(".dl-png")) return;          // already attached
      const slug = fig.id || "figure";
      const png = document.createElement("button");
      png.type = "button"; png.className = "dl dl-png";
      png.textContent = "⬇ PNG (300 ppi)";
      png.addEventListener("click", () => exportSVGtoPNG(svg, slug));
      const sv  = document.createElement("button");
      sv.type  = "button"; sv.className = "dl dl-svg";
      sv.textContent = "⬇ SVG";
      sv.addEventListener("click", () => exportSVGtoSVG(svg, slug));
      foot.insertBefore(sv,  foot.firstChild);
      foot.insertBefore(png, foot.firstChild);
    };
    tryAttach();
    // Some figures rebuild their SVG on user input — observe and re-attach.
    new MutationObserver(tryAttach).observe(fig, { childList: true, subtree: true });
  });
}

/* For SVG exports only: append each node's flow value to its label, so the
   exported figure reads "UNITED STATES — 567" instead of the bare label.
   The live on-page SVG is left untouched — these annotations live in the
   clone consumed by the exporter. */
function annotateEdgesForExport(srcSvg, cloneSvg) {
  const srcNodes  = srcSvg.querySelectorAll(".node");
  if (!srcNodes.length) return;
  const cloneNodes = cloneSvg.querySelectorAll(".node");
  if (srcNodes.length !== cloneNodes.length) return;

  const fmt = (typeof d3 !== "undefined" && d3.format) ? d3.format(",") : String;

  for (let i = 0; i < srcNodes.length; i++) {
    const d = srcNodes[i].__data__;
    if (!d) continue;
    const v = d.value;
    if (!Number.isFinite(+v) || +v <= 0) continue;
    // Find the label tspan inside the cloned node — that's where the
    // human-readable name lives. Append " — N" to it.
    const lbl = cloneNodes[i].querySelector("tspan.lbl-name")
             || cloneNodes[i].querySelector("text");
    if (!lbl) continue;
    const cur = lbl.textContent.replace(/\s*[—–-]\s*[\d,]+\s*$/, "");
    lbl.textContent = `${cur} — ${fmt(v)}`;
  }
}

function cloneWithInlineStyles(srcSvg) {
  const STYLE_PROPS = [
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
    "font-family", "font-size", "font-weight", "font-style",
    "letter-spacing", "text-transform", "text-anchor",
    "dominant-baseline", "alignment-baseline",
    "opacity", "color", "visibility", "display", "mix-blend-mode",
  ];
  const clone = srcSvg.cloneNode(true);
  const srcAll = [srcSvg, ...srcSvg.querySelectorAll("*")];
  const dstAll = [clone,  ...clone.querySelectorAll("*")];
  for (let i = 0; i < srcAll.length; i++) {
    const cs = getComputedStyle(srcAll[i]);
    let s = "";
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "none" && v !== "normal") s += `${p}:${v};`;
    }
    if (s) dstAll[i].setAttribute("style", s);
  }
  // Ensure the SVG has an explicit width/height for rasterisers (some PNG
  // exporters refuse to render percentage-sized SVGs).
  const vb = srcSvg.viewBox && srcSvg.viewBox.baseVal;
  const w = vb && vb.width  ? vb.width  : srcSvg.clientWidth  || 800;
  const h = vb && vb.height ? vb.height : srcSvg.clientHeight || 600;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width",  w);
  clone.setAttribute("height", h);
  if (!clone.getAttribute("viewBox"))
    clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
  return { svg: clone, width: w, height: h };
}

function svgString(cloneSvg) {
  // Prepend an XML declaration so editors (Inkscape, Illustrator) treat
  // the download as a proper SVG document.
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
       + new XMLSerializer().serializeToString(cloneSvg);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function exportSVGtoSVG(srcSvg, slug) {
  const { svg } = cloneWithInlineStyles(srcSvg);
  // Edge value labels appear ONLY in exports, not on the live page.
  annotateEdgesForExport(srcSvg, svg);
  const xml = svgString(svg);
  triggerDownload(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
                  `${slug}.svg`);
}

async function exportSVGtoPNG(srcSvg, slug) {
  const { svg, width, height } = cloneWithInlineStyles(srcSvg);
  annotateEdgesForExport(srcSvg, svg);
  const xml = svgString(svg);
  // Load the inline SVG into an Image via a Blob URL — works around the
  // cross-origin tainting that data: URLs sometimes incur.
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(width  * PNG_SCALE);
    canvas.height = Math.round(height * PNG_SCALE);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = PAPER_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => {
      if (b) triggerDownload(b, `${slug}@${PNG_SCALE}x.png`);
    }, "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

})();
