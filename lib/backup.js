// Backup section: a Category / Subcategory / Status table. It is built as raw XML (docxtemplater `{@backup_table}`)
// so the No and Category cells can span their rows, which a looped template row cannot do.
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COLS = [480, 3000, 4251, 1620]; // 9351 twips, same width as the topology tables
const run = (t, bold) => `<w:r><w:rPr>${bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const cell = (i, text, { head, merge, center } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${COLS[i]}" w:type="dxa"/>${merge ? (merge === "start" ? '<w:vMerge w:val="restart"/>' : "<w:vMerge/>") : ""}` +
  `${head ? '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>' : ""}</w:tcPr>` +
  `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${center || head ? '<w:jc w:val="center"/>' : ""}</w:pPr>${text ? run(text, head) : ""}</w:p></w:tc>`;

/** [{ category, subcategories: [] }] from the profile, else derived from the topology groups and the API Portal hosts. */
export function backupItems(profile, current, topologies = []) {
  if (profile.backup.items.length) return profile.backup.items;
  const port = new Map();
  for (const t of topologies) for (const i of t.instances || []) if (!port.has(i.group) || +i.port < port.get(i.group)) port.set(i.group, +i.port);
  const groups = [...port].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([g]) => `Group: ${g}`);
  const portals = [...new Set(current.servers.filter((s) => /portal/i.test(s.function)).map((s) => s.hostname))].map((h) => `Host: ${h}`);
  return [
    { category: "Policy Studio (.fed)", subcategories: groups },
    { category: "KPS Data", subcategories: groups },
    { category: "API Portal MySQL Database", subcategories: portals },
  ];
}

/** → { has_backup, backup_table } ; the table is left out when there is nothing to list */
export function buildBackup(profile, current, topologies) {
  const items = backupItems(profile, current, topologies).filter((c) => c.subcategories.length);
  if (!items.length) return { has_backup: false, backup_table: "" };
  const status = profile.backup.status;
  const head = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${["No", "Category", "Subcategory", "Status"].map((t, i) => cell(i, t, { head: true })).join("")}</w:tr>`;
  const body = items.map((c, n) => c.subcategories.map((sub, k) => {
    const merge = c.subcategories.length > 1 ? (k ? "cont" : "start") : null;
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(0, k ? "" : String(n + 1), { merge, center: true })}${cell(1, k ? "" : c.category, { merge })}${cell(2, sub)}${cell(3, status)}</w:tr>`;
  }).join("")).join("");
  const grid = COLS.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  return {
    has_backup: true,
    backup_table: `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${COLS.reduce((a, b) => a + b)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
      `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>`,
  };
}
