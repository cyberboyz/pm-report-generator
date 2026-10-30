// Browser-side intake of dropped files: folders, a zipped report-input/ folder, or loose files.
// Every file becomes an entry { file, path } where path is its place in the dropped folder ("old-production/health-check.zip") or just its name.
import PizZip from "pizzip";
import { envOfPath, envSlug } from "./envs";

export const SHARED = ["profile", "arch", "ssl"];
export const PER_ENV = ["health", "topology", "cassandra"];
export const TRAFFIC = "traffic"; // screenshots of the API traffic per environment (images, any number): Transactions section

/** Data type named in a file or folder name, whatever the case or separators: "Health Check", "health-check", "HEALTH_CHECK", "HealthCheck", "apim_topology", "Last Repair" ... */
export function kindOfText(text) {
  const spaced = String(text).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const flat = spaced.replace(/[^a-z0-9]+/g, ""), words = spaced.split(/[^a-z0-9]+/);
  if (/traffic|screenshot|transaction/.test(flat) || words.includes("ss")) return "traffic";
  if (/cassandra|nodetool|repair/.test(flat)) return "cassandra";
  if (/topolog|apimtop|managedomain/.test(flat)) return "topology";
  if (/health|capacity|performance/.test(flat) || words.includes("hc")) return "health";
  return null;
}

/** Which slot a file belongs to, from its name: "3-health-check.zip", "4-apim-topology.zip", "5-cassandra.zip", "6-fed-backup.zip" ... */
export function slotOf(name) {
  const n = name.toLowerCase(), ext = (n.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (ext === "yaml" || ext === "yml") return "profile";
  if (["png", "jpg", "jpeg", "gif", "bmp"].includes(ext)) return kindOfText(name.replace(/\.[^.]+$/, "")) === "traffic" ? "traffic" : "arch"; // "traffic-old.png", "SS_Traffic_1.png" ...
  if (ext === "fed") return "ssl";
  if (ext !== "zip") return null;
  const k = kindOfText(name.replace(/\.zip$/i, ""));
  if (k && k !== "traffic") return k;
  if (/fed|ssl|cert|backup|tls/.test(n.replace(/[^a-z0-9]+/g, ""))) return "ssl";
  const lead = (n.match(/^(\d+)[-_ .]/) || [])[1]; // the number in front of the name is optional
  return { 3: "health", 4: "topology", 5: "cassandra", 6: "ssl" }[lead] || null;
}

/** Data type of a loose (unzipped) file from the folders above it: ".../Health Check/DC/x.txt", ".../Last Repair/DRC/x.log" ... Nearest folder wins. */
export function folderKind(path) {
  for (const d of path.split("/").slice(0, -1).reverse()) { const k = kindOfText(d); if (k) return k; }
  return null;
}
const isLoose = (e) => !slotOf(e.file.name) && !!folderKind(e.path) && folderKind(e.path) !== "traffic";

const junk = (p) => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(p);
const baseName = (p) => p.split("/").pop();

/** Entries from a drop event. Must be called synchronously inside the handler (the browser empties the event afterwards). */
export function startDrop(dt) {
  const roots = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  const files = [...dt.files];
  return roots.length ? walk(roots) : Promise.resolve(files.map((file) => ({ file, path: file.name })));
}

async function walk(roots) {
  const out = [];
  const readAll = (reader) => new Promise((res, rej) => {
    const all = [];
    (function more() { reader.readEntries((b) => (b.length ? (all.push(...b), more()) : res(all)), rej); })();
  });
  async function go(entry) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: entry.fullPath.replace(/^\//, "") });
    } else if (entry.isDirectory) for (const e of await readAll(entry.createReader())) await go(e);
  }
  for (const r of roots) await go(r);
  return out;
}

/** Entries from <input type=file> (webkitdirectory gives the relative path). */
export const fromInput = (list) => [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

/** A zip that holds a profile or other zips is a zipped report-input/ folder: unpack it into entries. Other zips stay as they are. */
export async function expand(entries) {
  const out = [], stores = new Map();
  for (const e of entries) {
    if (junk(e.path)) continue;
    // an unzipped .fed (folder holding CertStore*.xml): pack it back into <folder>.fed
    if (/^CertStore[^/]*\.xml$/i.test(e.file.name)) { const dir = e.path.split("/").slice(0, -1).join("/"); if (!stores.has(dir)) stores.set(dir, []); stores.get(dir).push(e); continue; }
    if (!/\.zip$/i.test(e.file.name)) { out.push(e); continue; }
    let zip;
    try { zip = new PizZip(new Uint8Array(await e.file.arrayBuffer())); } catch { out.push(e); continue; }
    const inner = Object.values(zip.files).filter((f) => !f.dir && !junk(f.name));
    const bundle = inner.some((f) => /\.(ya?ml|zip)$/i.test(f.name));
    if (!bundle) { out.push(e); continue; }
    const prefix = e.path.includes("/") ? e.path.replace(/[^/]*$/, "") : "";
    for (const f of inner) out.push({ file: new File([f.asUint8Array()], baseName(f.name)), path: prefix + f.name });
  }
  for (const [dir, list] of stores) {
    const zip = new PizZip();
    for (const e of list) zip.file(e.file.name, new Uint8Array(await e.file.arrayBuffer()));
    const name = (dir.split("/").pop() || "cert") + ".fed";
    out.push({ file: new File([zip.generate({ type: "uint8array", compression: "DEFLATE" })], name), path: dir ? dir + ".fed" : name }); // keep the folders: they name the SSL group
  }
  return out;
}

/** Unzipped folders: loose files sitting in health-check / apim-topology / cassandra folders are packed, per environment and
 *  type, into one zip in memory (the folders below the environment, e.g. DC/ and DRC/, are kept). Needs the environment keys of the profile;
 *  without them the files stay loose and wait. */
export async function packLoose(entries, keys) {
  if (!keys.length) return entries;
  const out = [], groups = new Map();
  for (const e of entries) {
    if (!isLoose(e)) { out.push(e); continue; }
    const i = envOfPath(e.path, keys), kind = folderKind(e.path), g = `${i}:${kind}`;
    if (!groups.has(g)) groups.set(g, { i, kind, items: [] });
    groups.get(g).items.push(e);
  }
  for (const { i, kind, items } of groups.values()) {
    const zip = new PizZip();
    for (const e of items) {
      const parts = e.path.split("/"), at = i < 0 ? -1 : parts.findIndex((d, k) => k < parts.length - 1 && envSlug(d).replace(/-/g, "") === keys[i].replace(/-/g, ""));
      zip.file(parts.slice(at + 1).join("/"), new Uint8Array(await e.file.arrayBuffer()));
    }
    const file = new File([zip.generate({ type: "uint8array", compression: "DEFLATE" })], `${kind}.zip`, { type: "application/zip" });
    out.push({ file, path: i < 0 ? file.name : `${keys[i]}/${file.name}` });
  }
  return out;
}

/** A File remembers where it sat in the dropped folder ("fed-backup/rtsist_1_dc/policy.fed"): the folders name the SSL group. */
export const withPath = (file, path) => { try { file.relPath = path; } catch { /* read-only File: the name is used */ } return file; };
export const pathOf = (file) => file.relPath || file.name;

/** Sort entries into slots. keys: environment keys of the profile (empty = profile not known yet).
 *  → { shared: { profile, arch, ssl: [files] }, env: { "<key>:<kind>": file }, needs: [{ file, kind, path }], waiting: [entries], unknown: [names] } */
export function place(entries, keys) {
  const r = { shared: { ssl: [] }, env: {}, shots: {}, needs: [], waiting: [], unknown: [] };
  entries = [...entries].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true })); // screenshots keep their numbered order
  for (const e of entries) {
    let kind = slotOf(e.file.name) || (isLoose(e) ? folderKind(e.path) : null);
    if (kind === "arch" && folderKind(e.path) === "traffic") kind = "traffic"; // an image inside a traffic/ or screenshots/ folder
    if (!kind) { r.unknown.push(e.file.name); continue; }
    if (kind === "ssl") { r.shared.ssl.push(withPath(e.file, e.path)); continue; }
    if (SHARED.includes(kind)) { if (r.shared[kind]) r.unknown.push(e.file.name); else r.shared[kind] = e.file; continue; }
    if (!keys.length) { r.waiting.push(e); continue; } // profile not loaded yet: keep until it is
    const i = envOfPath(e.path, keys);
    if (i < 0) { r.needs.push({ file: e.file, kind, path: e.path }); continue; }
    if (kind === "traffic") { (r.shots[keys[i]] ||= []).push(e.file); continue; }
    const k = `${keys[i]}:${kind}`;
    if (r.env[k]) r.unknown.push(`${e.file.name} (duplicate)`); else r.env[k] = e.file;
  }
  return r;
}
