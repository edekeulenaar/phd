-- Repairs for the print edition, run as a pandoc filter.
--   1. Table column widths: pandoc derives them from the number of dashes in
--      the separator row, so "| Category | Definition ... |" gave the first
--      column 2% of the line and its words spilled over the second.
--   2. A one-cell table is a callout in this manuscript (the website styles it
--      as one); as a LaTeX longtable it came out as prose between two rules.
--   3. Images: the equation snippets pasted into Chapters 12 and 14 are a few
--      dozen pixels tall and were being blown up to the full text width.

local MIN_COL   = 0.17   -- no column narrower than this fraction of the line
local INLINE_H  = 80     -- px: at or under this an image is a formula snippet
local INLINE_W  = 520

local function image_size(src)
  local f = io.open(src, "rb")
  if not f then return nil end
  local head = f:read(2048); f:close()
  if not head then return nil end
  -- PNG: width and height are big-endian 32-bit at offset 16
  if head:sub(1, 8) == "\137PNG\r\n\26\n" then
    local w, h = 0, 0
    for i = 17, 20 do w = w * 256 + head:byte(i) end
    for i = 21, 24 do h = h * 256 + head:byte(i) end
    return w, h
  end
  -- JPEG: walk the segment headers to the first SOFn
  if head:byte(1) == 0xFF and head:byte(2) == 0xD8 then
    local i = 3
    while i < #head - 8 do
      if head:byte(i) ~= 0xFF then break end
      local marker = head:byte(i + 1)
      local len = head:byte(i + 2) * 256 + head:byte(i + 3)
      if marker >= 0xC0 and marker <= 0xCF
         and marker ~= 0xC4 and marker ~= 0xC8 and marker ~= 0xCC then
        local h = head:byte(i + 5) * 256 + head:byte(i + 6)
        local w = head:byte(i + 7) * 256 + head:byte(i + 8)
        return w, h
      end
      i = i + 2 + len
    end
  end
  return nil
end

function Table(tbl)
  -- A one-column table is a callout in this manuscript, and the website draws
  -- it as a tinted panel. Written as "| text |" with a "| --- |" rule under it,
  -- pandoc puts the text in the table HEAD and leaves the body empty, so the
  -- earlier check for a single BODY row never matched and these came out as
  -- prose between two rules.
  if #tbl.colspecs == 1 then
    local rows = {}
    for _, r in ipairs(tbl.head.rows) do rows[#rows + 1] = r end
    for _, b in ipairs(tbl.bodies) do
      for _, r in ipairs(b.body) do rows[#rows + 1] = r end
    end
    if #rows == 1 and rows[1].cells[1] then
      local out = { pandoc.RawBlock("latex", "\\begin{callout}") }
      for _, blk in ipairs(rows[1].cells[1].contents) do out[#out + 1] = blk end
      out[#out + 1] = pandoc.RawBlock("latex", "\\end{callout}")
      return out
    end
  end

  -- Clamp the narrow columns, then renormalise so the row still fills the line.
  local w, total, raised = {}, 0, false
  for i, spec in ipairs(tbl.colspecs) do
    local width = spec[2]
    if type(width) ~= "number" or width <= 0 then return nil end
    if width < MIN_COL then width, raised = MIN_COL, true end
    w[i] = width; total = total + width
  end
  if raised and total > 1 then
    -- Take the excess off the columns that were already wide enough, so a
    -- clamped column keeps its full MIN_COL rather than being pulled back
    -- under it by a flat renormalisation.
    local excess, slack = total - 1, 0
    for i = 1, #w do if w[i] > MIN_COL then slack = slack + (w[i] - MIN_COL) end end
    for i, spec in ipairs(tbl.colspecs) do
      local width = w[i]
      if width > MIN_COL and slack > 0 then
        width = width - excess * (width - MIN_COL) / slack
      end
      tbl.colspecs[i] = { spec[1], width }
    end
    return tbl
  end
end

-- The pasted snippets are screenshots of a single text line, 18px tall. Size
-- them in ems relative to that, so a two-line fraction stays taller than a
-- one-line expression instead of every snippet being flattened to one height.
local SNIPPET_PX = 18

local function em_height(hh, factor, cap)
  local em = (hh / SNIPPET_PX) * factor
  if em > cap then em = cap end
  if em < 0.7 then em = 0.7 end
  return string.format("%.2fem", em)
end

local function raw(t) return pandoc.RawBlock("latex", t) end

-- Pull the image out of a paragraph, whether it stands alone or is wrapped in
-- a link, as Chapter 1's "[![alt](img)](url)" figures are.
local function lead_image(inlines)
  local first = inlines[1]
  if not first then return nil end
  if first.t == "Image" then return first, 1 end
  if first.t == "Link" and #first.content == 1 and first.content[1].t == "Image" then
    return first.content[1], 1
  end
  return nil
end

local function words(inlines)
  return select(2, pandoc.utils.stringify(inlines):gsub("%S+", "")) or 0
end

local function is_caption(para)
  local head = pandoc.utils.stringify(para):gsub("^%s+", "")
  return head:match("^Figure%s+%w+[.:]") or head:match("^Table%s+%w+[.:]")
      or head:match("^Prompt%s+%w+[.:]") or head:match("^Listing%s+%w+[.:]")
end

-- Every prompt must look the same, and like the one on the website: a tinted
-- box in a mono face. Pandoc only produces its Shaded/Highlighting pair for a
-- fenced block that names a language; the prompts written with a bare fence
-- came through as plain verbatim, with no box and no line breaking, and ran
-- off the page. Emit one form for all of them.
function CodeBlock(cb)
  return pandoc.RawBlock("latex",
    "\\begin{promptbox}\n" ..
    "\\begin{Verbatim}[breaklines=true,breakanywhere=true,fontsize=\\small," ..
    "breaksymbolleft={},breakautoindent=false]\n" ..
    cb.text .. "\n\\end{Verbatim}\n\\end{promptbox}")
end

function Para(para)
  local img, idx = lead_image(para.content)
  if not img then
    -- Most chapters write the description as its own paragraph after the
    -- figure, table or prompt. Centre those, tight above and clear below.
    if is_caption(para) then
      return { raw("\\begin{figcaption}"), para, raw("\\end{figcaption}") }
    end
    return nil
  end

  local ww, hh = image_size(img.src)
  local small = ww and hh and hh <= INLINE_H and ww <= INLINE_W
  if small then img.attributes["height"] = em_height(hh, 1.45, 7) end

  -- A display image and its caption travel together inside a float, so a
  -- figure that does not fit the rest of a page is carried over and the text
  -- that follows fills the page instead of leaving it two-thirds blank. The
  -- caption is placed inside the float for that reason; [!htbp] lets LaTeX
  -- prefer "here" but move on when there is no room.
  local place = img.attributes["pdf-placement"] or "!htbp"
  img.attributes["pdf-placement"] = nil
  local out = { raw("\\begin{figure}[" .. place .. "]"), raw("\\begin{figureblock}"),
                pandoc.Para({ img }), raw("\\end{figureblock}") }

  -- Anything after the image in the same paragraph is its caption; without
  -- this it was set as a normal paragraph and ended up beside a tall figure
  -- rather than under it.
  local rest = {}
  for i = idx + 1, #para.content do rest[#rest + 1] = para.content[i] end
  while rest[1] and rest[1].t == "Space" do table.remove(rest, 1) end

  -- What follows the image is often only the block anchor prep.py appends
  -- ("[]{#a5-figure-1}"), which carries no text. Treating that as the caption
  -- is what left Chapter 1's figures unlabelled: the real description is in
  -- the alt text. Keep the anchor with the image and look to the alt instead.
  if #rest > 0 and pandoc.utils.stringify(rest):match("^%s*$") then
    for _, el in ipairs(rest) do table.insert(out, #out, pandoc.Plain({ el })) end
    rest = {}
  end

  if #rest > 0 then
    out[#out + 1] = raw("\\begin{figcaption}")
    out[#out + 1] = pandoc.Para(rest)
    out[#out + 1] = raw("\\end{figcaption}")
  elseif img.caption and #img.caption > 0 and words(img.caption) >= 5 then
    -- Chapter 1 carries its descriptions in the alt text and has no caption
    -- paragraph at all, which is why its figures came through unlabelled.
    out[#out + 1] = raw("\\begin{figcaption}")
    out[#out + 1] = pandoc.Para(img.caption)
    out[#out + 1] = raw("\\end{figcaption}")
  end
  out[#out + 1] = raw("\\end{figure}")
  return out
end

function Image(img)
  if img.attributes["height"] then return nil end   -- already sized above
  local ww, hh = image_size(img.src)
  if not (ww and hh) then return nil end
  if hh <= INLINE_H and ww <= INLINE_W then
    img.attributes["height"] = em_height(hh, 1.0, 2.2)   -- inline, on the baseline
  end
  return img
end

-- A figure written as an image paragraph followed by its own caption
-- paragraph ("**Figure 7.** *…*") used to become a float holding only the
-- image, while the caption stayed in the running text. When the float moved
-- to a later page the caption was left on its own with no figure above it
-- (Ch. 1 Fig. 7, Ch. 4 Fig. 10, Ch. 14 Fig. 3). Join each such pair into one
-- paragraph first, so Para() puts image and caption in the same float.
local function display_image_para(b)
  if b.t ~= "Para" then return false end
  local img = lead_image(b.content)
  if not img then return false end
  local ww, hh = image_size(img.src)
  if ww and hh and hh <= INLINE_H and ww <= INLINE_W then return false end
  -- only the image (and an optional anchor) — nothing that is already a caption
  local rest = {}
  for i = 2, #b.content do rest[#rest + 1] = b.content[i] end
  return pandoc.utils.stringify(rest):match("^%s*$") ~= nil
end

local function figure_caption(b)
  if b.t ~= "Para" then return false end
  local head = pandoc.utils.stringify(b):gsub("^%s+", "")
  return head:match("^Figure%s+%w+[.:]") ~= nil
end

local function join_captions(blocks)
  local out, i = {}, 1
  while i <= #blocks do
    local b = blocks[i]
    local nxt = blocks[i + 1]
    if nxt and display_image_para(b) and figure_caption(nxt) then
      local content = b.content
      content[#content + 1] = pandoc.Space()
      for _, el in ipairs(nxt.content) do content[#content + 1] = el end
      out[#out + 1] = pandoc.Para(content)
      i = i + 2
    else
      out[#out + 1] = b
      i = i + 1
    end
  end
  return out
end

-- Headings that end up alone at the foot of a page.
--  * An annex opens with a table or figure whose first row or image is taller
--    than what is left of the page, so the heading stayed behind with a blank
--    three-quarters of a page under it (Ch. 8, printed p. 250). Annexes now
--    start on a fresh page.
--  * Any other heading directly above a figure asks for room for that figure
--    (its height at text width, capped as figureblock caps it, plus caption),
--    and the figure is set right there instead of floating away from it.
--  * "Endnotes" headings with nothing under them: the PDF sets notes at the
--    foot of each page, so the heading stood alone (end of Ch. 5).
local TEXTW_CM, TEXTH_CM = 16.0, 24.7
local function header_text(b) return pandoc.utils.stringify(b.content):gsub("^%s+", ""):gsub("%s+$", "") end

local function figure_height_cm(b)
  local img = lead_image(b.content)
  if not img then return nil end
  local ww, hh = image_size(img.src)
  if not (ww and hh) or ww == 0 then return nil end
  local h = math.min(hh / ww * TEXTW_CM, 0.8 * TEXTH_CM)
  return h + 2.0
end

local function is_display_figure(b)
  if not b or b.t ~= "Para" then return false end
  local img = lead_image(b.content)
  if not img then return false end
  local ww, hh = image_size(img.src)
  return not (ww and hh and hh <= INLINE_H and ww <= INLINE_W)
end

local function keep_with_next(blocks)
  local out, i = {}, 1
  while i <= #blocks do
    local b, nxt = blocks[i], blocks[i + 1]
    local drop = false
    if b.t == "Header" then
      local txt = header_text(b)
      local empty_notes = (txt == "Endnotes" or txt == "Notes")
        and (nxt == nil or nxt.t == "Header" or nxt.t == "HorizontalRule"
             or (nxt.t == "RawBlock" and nxt.text:match("newpage") ~= nil))
      if empty_notes then
        drop = true
      else
        local follows_table = nxt ~= nil and nxt.t == "Table"
        local follows_fig = is_display_figure(nxt)
        if (txt:match("^Annex") or txt:match("^Appendix")) and (follows_table or follows_fig) then
          -- An annex opens with a table row or image taller than what is left of
          -- the page, so it starts on a fresh page; the section rule that
          -- would otherwise close the previous page on its own is dropped.
          if out[#out] and out[#out].t == "HorizontalRule" then table.remove(out) end
          -- The chapter's last lines should not spill onto a page of their own
          -- ahead of the annex: let the page they finish on run a little long.
          local last = out[#out]
          if last and last.t == "Para" and #last.content > 60 then
            table.insert(last.content, #last.content - 50, pandoc.RawInline("latex", "\\enlargethispage{3\\baselineskip}"))
          end
          out[#out + 1] = raw("\\clearpage")
        elseif follows_fig then
          local h = figure_height_cm(nxt)
          if h then
            out[#out + 1] = raw(string.format("\\needspace{%.1fcm}", h))
            lead_image(nxt.content).attributes["pdf-placement"] = "H"
          end
        elseif follows_table then
          out[#out + 1] = raw("\\needspace{8\\baselineskip}")
        end
      end
    end
    if not drop then out[#out + 1] = b end
    i = i + 1
    ::continue::
  end
  return out
end

return {
  { Blocks = join_captions },
  { Blocks = keep_with_next },
  { Table = Table, CodeBlock = CodeBlock, Para = Para, Image = Image },
}
