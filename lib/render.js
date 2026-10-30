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

/** One entry per environment in the profile, named as written there ("Old Production Environment" -> "Old Production").
 *  tx_key is the environment key (lib/envs.js): it ties the traffic screenshots of that environment to its place in the report. */
export function txItems(p) {
  const keys = envKeys(p.environments);
  return p.environments.map((e, i) => ({ tx_env: (e.name || "").replace(/\s*environment\s*$/i, "").trim() || p.customer.environment, tx_key: keys[i] }));
}

/** Traffic screenshots: replaces each [[TXIMG:<environment key>]] marker paragraph of the template (below the Transactions summary table)
 *  with one centred picture per screenshot, scaled to the text width. A marker without screenshots simply disappears. */
const RELS = "word/_rels/document.xml.rels";
const TX_W = 5760720, TX_MAX_H = 7600000; // EMU: text width (9067 twips) and a height that still fits one page
function placeShots(out, shots) {
  let xml = out.file("word/document.xml").asText(), rels = out.file(RELS).asText(), ct = out.file("[Content_Types].xml").asText();
  let n = 0;
  xml = xml.replace(/<w:p><w:r><w:t[^>]*>\[\[TXIMG:([a-z0-9-]*)\]\]<\/w:t><\/w:r><\/w:p>/g, (_, key) => (shots[key] || []).map(({ buf, ext, width, height }) => {
    n++;
    const rid = `rIdTxShot${n}`, media = `word/media/traffic${n}.${ext}`;
    out.file(media, buf);
    rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/traffic${n}.${ext}"/></Relationships>`);
    if (!new RegExp(`Extension="${ext}"`, "i").test(ct)) ct = ct.replace("<Default ", `<Default Extension="${ext}" ContentType="${MIME[ext]}"/><Default `);
    let cx = TX_W, cy = Math.round((TX_W * height) / width);
    if (cy > TX_MAX_H) { cy = TX_MAX_H; cx = Math.round((TX_MAX_H * width) / height); }
    return `<w:p><w:pPr><w:spacing w:before="120" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${9000 + n}" name="Traffic ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${9000 + n}" name="traffic${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }).join(""));
  out.file("word/document.xml", xml); out.file(RELS, rels); out.file("[Content_Types].xml", ct);
}

/** Merge the notes of every environment into one list: findings first (prefixed with the environment name when there are several), the fixed notes once at the end. */
function mergeNotes(perEnv, multi) {
  const rows = perEnv.flatMap(({ label, notes }) => notes.map((n) => ({ ...n, server: multi && label ? `${label}\n${n.server}` : n.server })));
  const fixed = compute({ servers: [] }).notes;
  return [...rows, ...fixed].map((n, i) => ({ ...n, no: i + 1 }));
}

/** envFiles: { [environment key]: { healthZip, topologyZip, cassandraZip } } (see lib/envs.js);
 *  legacy: the same three zips uploaded without an environment, which belong to the `current` environment (default: the last one). */
export async function render({ yamlText, date, version, archPng, sslJson, envFiles = {}, legacy = {}, shots = {} }) {
  const p = Profile.parse(YAML.parse(yamlText));
  const [y, m, d] = date.split("-");
  const keys = envKeys(p.environments), multi = p.environments.length > 1;
  const unknown = [...Object.keys(envFiles), ...Object.keys(shots)].filter((k) => !keys.includes(k));
  if (unknown.length) throw new Error(`No environment "${unknown[0]}" in the profile (environments: ${keys.join(", ")})`);
  const cur = p.environments.findIndex((e) => e.current); // legacy uploads go here
  const legacyIdx = cur >= 0 ? cur : p.environments.length - 1;

  const warnings = [];
  // traffic screenshots per environment; an unreadable image is left out instead of stopping the report
  const shotImgs = {};
  for (const [k, list] of Object.entries(shots)) for (const buf of list) {
    let dim; try { dim = imageSize(buf); } catch { dim = null; }
    if (!dim || !EXT[dim.type]) { warnings.push(`${envLabel(p.environments[keys.indexOf(k)], keys.indexOf(k), p.environments.length)} environment, a traffic screenshot left out: it is not a valid PNG, JPG, GIF or BMP image.`); continue; }
    (shotImgs[k] ||= []).push({ buf, ext: EXT[dim.type], width: dim.width, height: dim.height });
  }
  if (archPng) { // an unreadable image is left out instead of stopping the report
    let dim; try { dim = imageSize(archPng); } catch { dim = null; }
    if (!dim || !EXT[dim.type]) { warnings.push("Architecture diagram left out: it is not a valid PNG, JPG, GIF or BMP image."); archPng = null; }
  }
  // everything below is built once per environment from that environment's own zips
  const envs = p.environments.map((e, i) => {
    const f = { ...(i === legacyIdx ? legacy : {}), ...(envFiles[keys[i]] || {}) };
    const lab = envLabel(e, i, p.environments.length);
    // a problem in one upload never stops the report: that upload is left out, its tables stay empty and the problem is reported
    const soft = (what, fn, fallback) => { try { return fn(); } catch (ex) { warnings.push(`${lab} environment, ${what} left out: ${ex.message}`); return fallback; } };
    // a health-check file without a CPU(s) line uses the cpu of the same server (hostname + DC/DRC) in the profile
    const coresFor = (host, env) => parseInt(e.servers.find((x) => x.hostname.toLowerCase() === host.toLowerCase() && x.env.toUpperCase() === env)?.cpu, 10) || 0;
    const health = f.healthZip ? soft("health check", () => parseHealthZip(f.healthZip, coresFor, (m) => warnings.push(`${lab} environment: ${m}`)), []) : [];
    health.forEach((h) => h.note && warnings.push(`${lab}: ${h.note}`));
    const pos = (h) => { const k = e.servers.findIndex((x) => x.env.toUpperCase() === h.env && x.hostname.toLowerCase() === h.server.toLowerCase()); return k < 0 ? 1e6 : k; };
    health.sort((a, b) => pos(a) - pos(b)); // stable: unlisted servers keep the DC-then-name order
    const topologies = f.topologyZip ? soft("APIM topology", () => parseTopologyZip(f.topologyZip), []) : [];
    const cassandra = f.cassandraZip ? soft("Cassandra", () => parseCassandraZip(f.cassandraZip, health), []) : [];
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
    ssl_groups: sslJson ? (() => { try { return buildSsl(JSON.parse(sslJson).instances, `${y}-${m}-${d}`, allTopologies); } catch (ex) { warnings.push(`SSL certificates left out: ${ex.message}`); return []; } })() : [],
  };
  const zip = new PizZip(fs.readFileSync(path.join(process.cwd(), "templates/pm-template.docx")));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  const out = doc.getZip();
  out.file("word/document.xml", fitTables(colourCertRows(colourStatus(out.file("word/document.xml").asText()))));
  placeShots(out, shotImgs);
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
  return { buf: out.generate({ type: "nodebuffer", compression: "DEFLATE" }), fileName: data.file_name + ".docx", warnings };
}
