// Browser-side intake of dropped files: folders, a zipped report-input/ folder, or loose files.
// Every file becomes an entry { file, path } where path is its place in the dropped folder ("old-production/health-check.zip") or just its name.
import PizZip from "pizzip";
import { envOfPath } from "./envs";

export const SHARED = ["profile", "arch", "ssl"];
export const PER_ENV = ["health", "topology", "cassandra"];

/** Which slot a file belongs to, from its name: "3-health-check.zip", "4-apim-topology.zip", "5-cassandra.zip", "6-fed-backup.zip" ... */
export function slotOf(name) {
  const n = name.toLowerCase(), ext = (n.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (ext === "yaml" || ext === "yml") return "profile";
  if (["png", "jpg", "jpeg", "gif", "bmp"].includes(ext)) return "arch";
  if (ext === "fed") return "ssl";
  if (ext !== "zip") return null;
  if (/cassandra|nodetool|repair/.test(n)) return "cassandra";
  if (/topolog|apim-?top|managedomain/.test(n)) return "topology";
  if (/health|capacity|performance|\bhc\b/.test(n)) return "health";
  if (/fed|ssl|cert|backup|tls/.test(n)) return "ssl";
  const lead = (n.match(/^(\d+)[-_ .]/) || [])[1]; // the number in front of the name is optional
  return { 3: "health", 4: "topology", 5: "cassandra", 6: "ssl" }[lead] || null;
}

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
  const out = [];
  for (const e of entries) {
    if (junk(e.path)) continue;
    if (!/\.zip$/i.test(e.file.name)) { out.push(e); continue; }
    let zip;
    try { zip = new PizZip(new Uint8Array(await e.file.arrayBuffer())); } catch { out.push(e); continue; }
    const inner = Object.values(zip.files).filter((f) => !f.dir && !junk(f.name));
    const bundle = inner.some((f) => /\.(ya?ml|zip)$/i.test(f.name));
    if (!bundle) { out.push(e); continue; }
    const prefix = e.path.includes("/") ? e.path.replace(/[^/]*$/, "") : "";
    for (const f of inner) out.push({ file: new File([f.asUint8Array()], baseName(f.name)), path: prefix + f.name });
  }
  return out;
}

/** Sort entries into slots. keys: environment keys of the profile (empty = profile not known yet).
 *  → { shared: { profile, arch, ssl: [files] }, env: { "<key>:<kind>": file }, needs: [{ file, kind, path }], waiting: [entries], unknown: [names] } */
export function place(entries, keys) {
  const r = { shared: { ssl: [] }, env: {}, needs: [], waiting: [], unknown: [] };
  for (const e of entries) {
    const kind = slotOf(e.file.name);
    if (!kind) { r.unknown.push(e.file.name); continue; }
    if (kind === "ssl") { r.shared.ssl.push(e.file); continue; }
    if (SHARED.includes(kind)) { if (r.shared[kind]) r.unknown.push(e.file.name); else r.shared[kind] = e.file; continue; }
    if (!keys.length) { r.waiting.push(e); continue; } // profile not loaded yet: keep until it is
    const i = envOfPath(e.path, keys);
    if (i < 0) { r.needs.push({ file: e.file, kind, path: e.path }); continue; }
    const k = `${keys[i]}:${kind}`;
    if (r.env[k]) r.unknown.push(`${e.file.name} (duplicate)`); else r.env[k] = e.file;
  }
  return r;
}
