// Post-processing of every table in the generated document.xml:
//  1. columns are re-sized to fit their content (longest line / longest word), keeping the table's total width;
//  2. in identity columns (Server, Zone, Env, IP ...) consecutive equal cells are merged vertically;
//     a cell whose text is MERGE (U+E000) is also merged into the cell above it.
import { MERGE } from "./metrics";

const PAD = 240, MIN = 560; // cell padding (left + right margin + border) and the narrowest column, in twips
const MERGE_COLS = /^(server|hostname|host|zone|env|environment|ip|ip address|address)$/i;
const strip = (x) => x.replace(/<w:br\/>|<w:cr\/>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Approximate Calibri advance widths (in em) so that "iiii" and "WWWW" are not treated alike.
function em(ch) {
  if (ch === " ") return 0.226;
  if (/[0-9]/.test(ch)) return 0.507;
  if (/[ilI.,:;|!'`]/.test(ch)) return ch === "I" ? 0.252 : 0.24;
  if (/[fjtr()\[\]\/\-]/.test(ch)) return 0.33;
  if (/[MW]/.test(ch)) return 0.87;
  if (ch === "m") return 0.8;
  if (ch === "w") return 0.72;
  if (/[A-Z]/.test(ch)) return 0.6;
  if (/[a-z]/.test(ch)) return 0.5;
  return 0.55;
}
/** width of a text in twips at `half` half-points */
const measure = (t, half, bold) => [...t].reduce((a, ch) => a + em(ch), 0) * half * 10 * (bold ? 1.06 : 1);

/** Water-filling: every column gets what it wants unless that does not fit; then the widest wishes are cut back to a
 *  common level (but never below the column's minimum, i.e. its longest unbreakable word). */
function widths(cols, total) {
  const min = cols.map((c) => Math.min(Math.max(c.word + PAD, MIN), total * 0.45));
  const want = cols.map((c, i) => Math.max(c.line + PAD, min[i]));
  // comfort floor: a column keeps at least 60% of what it wants (so one long value is not squeezed into many short lines)
  const floor = min.map((m, i) => Math.max(m, want[i] * 0.6));
  if (floor.reduce((a, b) => a + b, 0) <= total) floor.forEach((f, i) => { min[i] = f; });
  const sMin = min.reduce((a, b) => a + b, 0), sWant = want.reduce((a, b) => a + b, 0);
  let w;
  if (sMin >= total) w = min.map((m) => (m * total) / sMin);
  else if (sWant <= total) w = want.map((x) => (x * total) / sWant); // room to spare: spread in proportion
  else {
    let lo = 0, hi = total;
    for (let k = 0; k < 40; k++) { const L = (lo + hi) / 2; const sum = want.reduce((a, x, i) => a + Math.max(min[i], Math.min(x, L)), 0); if (sum > total) hi = L; else lo = L; }
    w = want.map((x, i) => Math.max(min[i], Math.min(x, lo)));
    const f = total / w.reduce((a, b) => a + b, 0); w = w.map((x) => x * f);
  }
  const r = w.map(Math.floor);
  r[r.indexOf(Math.max(...r))] += total - r.reduce((a, b) => a + b, 0); // keep the exact total
  return r;
}

function fitTable(tbl) {
  if ((tbl.match(/<w:tbl>/g) || []).length !== 1) return tbl; // nested tables stay as designed
  const nGrid = (tbl.match(/<w:gridCol /g) || []).length;
  const rows = (tbl.match(/<w:tr[ >].*?<\/w:tr>/gs) || []).map((r) => {
    let g = 0;
    return (r.match(/<w:tc>.*?<\/w:tc>/gs) || []).map((xml) => {
      const span = +(xml.match(/<w:gridSpan w:val="(\d+)"/) || [])[1] || 1, cell = { xml, span, g, text: strip(xml) };
      g += span; return cell;
    });
  });
  if (!nGrid || !rows.length || rows.some((r) => r.reduce((a, c) => a + c.span, 0) !== nGrid)) return tbl;
  const total = +(tbl.match(/<w:tblW w:w="(\d+)" w:type="dxa"/) || [])[1] || 9067;
  const at = (r, g) => rows[r].find((c) => c.g === g && c.span === 1); // single-column cell of grid column g
  const clean = (t) => t.replace(new RegExp(MERGE, "g"), "").trim();

  // header rows: the first one plus every following row that continues a merged header cell (e.g. "Available" / "MB, %")
  let head = 1;
  while (head < rows.length && rows[head].some((c) => /<w:vMerge\/>|<w:vMerge w:val="continue"\/>/.test(c.xml))) head++;

  // 1. vertical merges in identity columns
  const state = rows.map(() => ({}));
  for (let g = 0; g < nGrid; g++) {
    const title = clean(rows[head - 1].find((c) => g >= c.g && g < c.g + c.span)?.text || rows[0].find((c) => g >= c.g && g < c.g + c.span)?.text || "");
    const sentinel = rows.slice(head).some((r, i) => at(i + head, g)?.text.includes(MERGE));
    if (!MERGE_COLS.test(title) && !sentinel) continue;
    for (let r = head; r < rows.length; r++) {
      const c = at(r, g), prev = r > head ? at(r - 1, g) : null;
      if (!c) continue;
      const same = c.text.includes(MERGE) || (prev && clean(c.text) !== "" && clean(c.text) === clean(prev.text));
      if (same && prev) { state[r][g] = "continue"; if (!state[r - 1][g]) state[r - 1][g] = "restart"; }
    }
  }
  // 2. widths: from single-column cells that are not continuations
  const cols = Array.from({ length: nGrid }, (_, g) => {
    let line = 0, word = 0;
    rows.forEach((r, ri) => {
      const c = at(ri, g);
      if (!c || state[ri][g] === "continue") return;
      // Word also breaks lines after - and /, so those pieces count as separate words
      const half = +(c.xml.match(/<w:sz w:val="(\d+)"/) || [])[1] || 22, bold = /<w:b\/>/.test(c.xml);
      for (const ln of clean(c.text).split("\n")) { line = Math.max(line, measure(ln, half, bold)); for (const w of ln.split(/\s+|(?<=[-/])/)) word = Math.max(word, measure(w, half, bold)); }
    });
    return { line, word };
  });
  const w = widths(cols, total);

  let ri = 0;
  let out = tbl.replace(/<w:tr[ >].*?<\/w:tr>/gs, (row) => {
    const r = ri++; let ci = 0;
    return row.replace(/<w:tc>.*?<\/w:tc>/gs, (tc) => {
      const cell = rows[r][ci++], width = w.slice(cell.g, cell.g + cell.span).reduce((a, b) => a + b, 0), st = cell.span === 1 ? state[r][cell.g] : null;
      tc = tc.replace(/<w:tcW [^>]*\/>/, `<w:tcW w:w="${width}" w:type="dxa"/>`);
      if (!/<w:tcW /.test(tc)) tc = tc.replace(/<w:tcPr>/, `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>`);
      if (st) {
        tc = tc.replace(/<w:vMerge[^>]*\/>/g, "");
        const vm = st === "restart" ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>";
        tc = tc.replace(/(<w:tcW [^>]*\/>(?:<w:gridSpan [^>]*\/>)?)/, `$1${vm}`);
        if (st === "restart" && !/<w:vAlign /.test(tc)) tc = tc.replace("</w:tcPr>", '<w:vAlign w:val="center"/></w:tcPr>');
        if (st === "continue") tc = tc.replace(/<w:r[ >].*?<\/w:r>/gs, ""); // the cell above shows the value
      }
      return tc.split(MERGE).join("");
    });
  });
  out = out.replace(/<w:tblGrid>.*?<\/w:tblGrid>/s, `<w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join("")}</w:tblGrid>`);
  if (!/<w:tblLayout /.test(out)) out = out.replace("</w:tblPr>", '<w:tblLayout w:type="fixed"/></w:tblPr>');
  return out;
}

export const fitTables = (xml) => xml.replace(/<w:tbl>.*?<\/w:tbl>/gs, fitTable).split(MERGE).join("");
