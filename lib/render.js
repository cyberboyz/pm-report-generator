import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { imageSize } from "image-size";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { Profile } from "./schema";
import { compute, colourStatus } from "./metrics";
import { buildSsl, colourCertRows } from "./ssl";
import { parseHealthZip, parseTopologyZip, parseCassandraZip } from "./ingest";
import { buildServices } from "./services";
import { checkPatches } from "./patches";
import { buildBackup } from "./backup";
import { fitTables } from "./tables";
import { envKeys, envLabel } from "./envs";

const ARCH_MEDIA = "word/media/image2.png"; // architecture diagram in the template
const ARCH_RID = "rId15";
const EXT = { png: "png", jpg: "jpeg", gif: "gif", bmp: "bmp" }; // formats Word can embed
const MIME = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" };
const withNo = (rows) => rows.map((r, i) => ({ no: i + 1, ...r, ip: Array.isArray(r.ip) ? r.ip.join("\n") : r.ip }));

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (y, m, d) => `${+d} ${MONTHS[+m - 1]} ${y}`;
// "2026-02-25", "25/02/2026" -> "25 February 2026"; anything else is kept as typed
function normDate(t) {
  const a = String(t || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), b = String(t || "").trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  return a ? longDate(a[1], a[2], a[3]) : b ? longDate(b[3], b[2], b[1]) : t;
}

/** Release history: older rows come from the profile; the row of the version being generated always carries the
 *  report date and the author's first name, and is added when the profile has no row for it. */
export function buildReleases(p, version, y, m, d) {
  const first = (a) => (a || "").trim().split(/\s+/)[0]; // the Author column shows the first name only
  const rows = p.releases.map((r) => ({ ...r, author: first(r.author), date: normDate(r.date) }));
  const cur = rows.find((r) => r.version === version);
  if (cur) Object.assign(cur, { date: longDate(y, m, d), author: first(p.author.name) });
  else rows.push({ version, author: first(p.author.name), date: longDate(y, m, d), description: version === "1.0" ? "Initial document" : "Preventive maintenance report update" });
  return rows;
}

const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
/** Transactions analysis window: three months ending on the 1st of the last month of the report's calendar quarter
 *  (Q1 = 1 Dec - 1 Mar, Q2 = 1 Mar - 1 Jun, Q3 = 1 Jun - 1 Sep, Q4 = 1 Sep - 1 Dec). */
export function txPeriod(y, m) {
  const endM = Math.ceil(+m / 3) * 3; // 3, 6, 9 or 12
  const [sy, sm] = endM === 3 ? [+y - 1, 12] : [+y, endM - 3];
  return { tx_from: `1 ${ID_MONTHS[sm - 1]} ${sy}`, tx_to: `1 ${ID_MONTHS[endM - 1]} ${y}` };
}

/** One entry per environment in the profile, named as written there ("Old Production Environment" -> "Old Production"). */
export function txItems(p) {
  return p.environments.map((e) => ({ tx_env: (e.name || "").replace(/\s*environment\s*$/i, "").trim() || p.customer.environment }));
}

/** Merge the notes of every environment into one list: findings first (prefixed with the environment name when there are several), the fixed notes once at the end. */
function mergeNotes(perEnv, multi) {
  const rows = perEnv.flatMap(({ label, notes }) => notes.map((n) => ({ ...n, server: multi && label ? `${label}\n${n.server}` : n.server })));
  const fixed = compute({ servers: [] }).notes;
  return [...rows, ...fixed].map((n, i) => ({ ...n, no: i + 1 }));
}

/** envFiles: { [environment key]: { healthZip, topologyZip, cassandraZip } } (see lib/envs.js);
 *  legacy: the same three zips uploaded without an environment, which belong to the `current` environment (default: the last one). */
export async function render({ yamlText, date, version, archPng, sslJson, envFiles = {}, legacy = {} }) {
  const p = Profile.parse(YAML.parse(yamlText));
  const [y, m, d] = date.split("-");
  const keys = envKeys(p.environments), multi = p.environments.length > 1;
  const unknown = Object.keys(envFiles).filter((k) => !keys.includes(k));
  if (unknown.length) throw new Error(`No environment "${unknown[0]}" in the profile (environments: ${keys.join(", ")})`);
  const cur = p.environments.findIndex((e) => e.current); // legacy uploads go here
  const legacyIdx = cur >= 0 ? cur : p.environments.length - 1;

  // everything below is built once per environment from that environment's own zips
  const envs = p.environments.map((e, i) => {
    const f = { ...(i === legacyIdx ? legacy : {}), ...(envFiles[keys[i]] || {}) };
    const health = f.healthZip ? parseHealthZip(f.healthZip) : [];
    // list servers in the order of the environment's Servers table (unlisted ones go last, DC before DRC)
    const pos = (h) => { const k = e.servers.findIndex((x) => x.env.toUpperCase() === h.env && x.hostname.toLowerCase() === h.server.toLowerCase()); return k < 0 ? 1e6 : k; };
    health.sort((a, b) => pos(a) - pos(b)); // stable: unlisted servers keep the DC-then-name order
    const topologies = f.topologyZip ? parseTopologyZip(f.topologyZip) : [];
    const cassandra = f.cassandraZip ? parseCassandraZip(f.cassandraZip, health) : [];
    const computed = compute({ servers: health.map((h) => h.metrics) }, false);
    const hasIo = computed.mem.some((r) => r.iowait !== "-"); // iowait column only when the health-check provides it
    return { e, label: envLabel(e, i, p.environments.length), health, topologies, cassandra, computed, hasIo, backup: buildBackup(p, e, topologies) };
  });
  const allTopologies = envs.flatMap((x) => x.topologies);

  const data = {
    customer: p.customer.name, customer_short: p.customer.short, product: p.customer.product,
    product_short: p.customer.product_short, environment: p.customer.environment,
    author_name: p.author.name, doc_title: p.doc_title, version, date_short: `${d}/${m}/${y}`,
    file_name: `[${p.customer.short}] – Preventive Maintenance – ${p.customer.product_short} (${p.customer.environment} Environment) ${d}-${m}-${y}`,
    contacts: withNo(p.contacts), releases: buildReleases(p, version, y, m, d), distribution: p.distribution,
    environments: p.environments.map((e, i) => ({ name: e.name, has_name: !!e.name, new_page: i > 0, servers: withNo(e.servers) })), // one heading + table each, from the second one on a new page
    ...txPeriod(y, m), tx_items: txItems(p),
    notes: mergeNotes(envs.map((x) => ({ label: x.label, notes: x.computed.notes })), multi), // one list of notes for the whole report
    // Services List, Capacity, Topology, Cassandra, Summary and Backup repeat for every environment, each from its own uploads
    env_blocks: envs.map((x) => ({
      name: x.e.name, has_name: !!x.e.name,
      services: buildServices(x.health, x.topologies),
      mem: x.computed.mem, disk: x.computed.disk, summary: x.computed.summary, has_iowait: x.hasIo, no_iowait: !x.hasIo,
      topologies: x.topologies, cassandra: x.cassandra,
      ...x.backup,
    })),
    has_arch: !!archPng, // the sample diagram in the template is only kept when a diagram is uploaded
    ...(await checkPatches({ today: new Date().toISOString().slice(0, 10), reportDate: `${y}-${m}-${d}`, overrides: p.support_dates, installed: p.current_version.slice(4) })),
    ssl_groups: sslJson ? buildSsl(JSON.parse(sslJson).instances, `${y}-${m}-${d}`, allTopologies) : [],
  };
  const zip = new PizZip(fs.readFileSync(path.join(process.cwd(), "templates/pm-template.docx")));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  const out = doc.getZip();
  out.file("word/document.xml", fitTables(colourCertRows(colourStatus(out.file("word/document.xml").asText()))));
  if (!archPng) { // drop the template's sample diagram and its relationship so nothing customer-specific is shipped
    out.remove(ARCH_MEDIA);
    const rp = "word/_rels/document.xml.rels";
    out.file(rp, out.file(rp).asText().replace(new RegExp(`<Relationship [^>]*Id="${ARCH_RID}"[^>]*/>`), ""));
  }
  if (archPng) {
    let dim;
    try { dim = imageSize(archPng); } catch { dim = null; }
    const ext = dim && EXT[dim.type];
    if (!ext) throw new Error("Architecture image must be of valid image type");
    const { width, height } = dim;
    const media = `word/media/architecture.${ext}`;
    out.remove(ARCH_MEDIA);
    out.file(media, archPng);
    // point the template's image relationship at the new file
    const relsPath = "word/_rels/document.xml.rels";
    out.file(relsPath, out.file(relsPath).asText().replace(new RegExp(`(Id="${ARCH_RID}"[^>]*Target=")[^"]+`), `$1media/architecture.${ext}`));
    // make sure the extension is declared in [Content_Types].xml
    let ct = out.file("[Content_Types].xml").asText();
    if (!new RegExp(`Extension="${ext}"`, "i").test(ct))
      ct = ct.replace("<Default ", `<Default Extension="${ext}" ContentType="${MIME[ext]}"/><Default `);
    out.file("[Content_Types].xml", ct);
    let xml = out.file("word/document.xml").asText();
    xml = xml.replace(/<w:drawing>.*?<\/w:drawing>/gs, (blk) => {
      if (!blk.includes(`r:embed="${ARCH_RID}"`)) return blk;
      const cx = +blk.match(/<wp:extent cx="(\d+)"/)[1];
      const cy = Math.round((cx * height) / width);
      return blk.replace(/(<wp:extent cx="\d+" cy=")\d+/, `$1${cy}`).replace(/(<a:ext cx="\d+" cy=")\d+/, `$1${cy}`);
    });
    out.file("word/document.xml", xml);
  }
  return { buf: out.generate({ type: "nodebuffer", compression: "DEFLATE" }), fileName: data.file_name + ".docx" };
}
