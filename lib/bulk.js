// "Drop all your files at once": works out, from the path (or file name) of every dropped file, which environment and which
// upload slot it belongs to. Dependency-free so it can be tested in Node; the page does the reading and zipping.
//
// Accepted layouts (any depth, any mix, folders or loose files):
//   <Environment>/health-check/DC/*.txt   <Environment>/apim-topology/*   <Environment>/cassandra/Last Repair/DC/*.log
//   <Environment>/fed/<instance>/<id>/META-INF/CertStore.xml   (or .fed files / a .zip of them)   <Environment>/analytics/... (ignored)
//   health-check.zip, new-topology.zip ... (loose zips; the environment comes from the name)

const SLOT_DIR = [
  ["ignore", /analytic|monitor|transaction|backup|patch/],
  ["health", /health|\bhc\b|capacity|performance/],
  ["topology", /topolog|managedomain/],
  ["cassandra", /cassandra|nodetool|repair/],
  ["ssl", /(^|[^a-z])(fed|ssl|tls|certs?|certificates?)([^a-z]|$)/],
];
export const norm = (s) => s.toLowerCase().replace(/\b(environment|env)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** slot from a file name alone: "3-health-check.zip", "4-apim-topology.zip", "5-cassandra.zip", "6-fed-backup.zip", profile.yaml, diagram.png */
export function slotOfName(name) {
  const n = name.toLowerCase(), ext = (n.match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if (ext === "yaml" || ext === "yml") return "profile";
  if (["png", "jpg", "jpeg", "gif", "bmp"].includes(ext)) return "arch";
  if (ext === "fed") return "ssl";
  if (ext !== "zip") return null;
  if (/cassandra|nodetool|repair/.test(n)) return "cassandra";
  if (/topolog|apim-?top|managedomain/.test(n)) return "topology";
  if (/health|capacity|performance|\bhc\b/.test(n)) return "health";
  if (/fed|ssl|cert|backup|tls/.test(n)) return "ssl";
  const lead = (n.match(/^(\d+)[-_ .]/) || [])[1];
  return { 3: "health", 4: "topology", 5: "cassandra", 6: "ssl" }[lead] || null;
}

/** index of the environment a text (folder or file name) names: the whole name ("New Production"), else its distinguishing words ("new"); null if none or ambiguous */
export function envOfText(text, envs) {
  const t = norm(text);
  if (!t) return null;
  const exact = envs.map((e, i) => (norm(e.name || "") === t ? i : -1)).filter((i) => i >= 0);
  if (exact.length === 1) return exact[0];
  const hit = envs.map((e, i) => {
    const w = norm(e.name || "").split(" ").filter((x) => x && x !== "production");
    return w.length && w.every((x) => new RegExp(`(^|[^a-z0-9])${x}([^a-z0-9]|$)`).test(text.toLowerCase())) ? i : -1;
  }).filter((i) => i >= 0);
  return hit.length === 1 ? hit[0] : null;
}

/** → { slot, env (index or null), rel (path inside the slot folder), parent (folder above the slot folder), stray } or { slot: "ignore" } / { slot: null } */
export function classify(path, envs) {
  const segs = path.replace(/\\/g, "/").split("/").filter(Boolean), name = segs[segs.length - 1] || "", dirs = segs.slice(0, -1);
  let k = -1, slot = null;
  for (let i = 0; i < dirs.length && !slot; i++) for (const [s, re] of SLOT_DIR) if (re.test(dirs[i].toLowerCase())) { slot = s; k = i; break; }
  if (slot === "ignore") return { slot };
  if (slot) { // the folder says what it is; the folders above it say which environment
    const above = dirs.slice(0, k);
    let env = null;
    for (let i = above.length - 1; i >= 0 && env === null; i--) env = envOfText(above[i], envs);
    return { slot, env, rel: segs.slice(k + 1).join("/"), parent: above[above.length - 1] || "", stray: env === null && above.length > 0 };
  }
  const byName = slotOfName(name);
  if (!byName) return { slot: null };
  let env = envOfText(name, envs);
  for (let i = dirs.length - 1; i >= 0 && env === null; i--) env = envOfText(dirs[i], envs);
  return { slot: byName, env, rel: name, parent: dirs[dirs.length - 1] || "", stray: false };
}

// ───────────── reading what was dropped / chosen ─────────────
const readAll = (reader) => new Promise((res, rej) => { const out = []; const next = () => reader.readEntries((b) => { if (!b.length) res(out); else { out.push(...b); next(); } }, rej); next(); });
async function walk(entry, out) {
  if (entry.isFile) out.push({ path: entry.fullPath.replace(/^\//, ""), file: await new Promise((r, j) => entry.file(r, j)) });
  else if (entry.isDirectory) for (const c of await readAll(entry.createReader())) await walk(c, out);
}
/** every file of a drop event, folders expanded: [{ path, file }] (call it directly from the drop handler: entries are only valid synchronously) */
export async function collectDrop(dt) {
  const entries = [...(dt.items || [])].map((i) => (i.kind === "file" && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)); // synchronous
  if (entries.some(Boolean)) { const out = []; for (const e of entries) if (e) await walk(e, out); return out; }
  return [...dt.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
}
/** files of an <input type=file multiple> or <input webkitdirectory> */
export const collectInput = (files) => [...files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));

/** Certificates of the fed files found for one environment: list = [{ rel, file }] with rel relative to the fed folder.
 *  Handles extracted .fed folders (<instance>/<id>/.../CertStore.xml, or any XML with certificate entities), .fed files and zips of them.
 *  parse = { fromXml(text) -> certs, fromArchive(bytes, name) -> [{ name, certs }] } → [{ name, certs }] (one per instance folder). */
export async function fedInstances(list, parse) {
  const insts = [];
  let xml = 0;
  for (const x of list) {
    if (!/\.xml$/i.test(x.rel) || x.file.size >= 20e6) continue;
    xml++;
    const text = await x.file.text();
    if (!/type=["']Certificate["']/.test(text)) continue;
    const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const GENERIC = /^(meta-inf|conf|configs?|fed|dc|drc)$/i; // folders that say nothing about the instance
    const name = x.rel.split("/").slice(0, -1).find((d) => !GENERIC.test(d) && !GUID.test(d)) || "fed"; // <instance>/<id>/.../CertStore.xml -> instance
    const certs = parse.fromXml(text), have = insts.find((i) => i.name === name);
    if (have) have.certs.push(...certs); else insts.push({ name, certs, path: x.rel });
  }
  // a .fed is only the zipped copy of an extracted instance folder: when folders are there, use them and ignore the .fed / zip files
  if (insts.length) return insts;
  for (const x of list) if (/\.(zip|fed)$/i.test(x.rel)) insts.push(...parse.fromArchive(new Uint8Array(await x.file.arrayBuffer()), x.file.name, x.rel));
  if (!insts.length) throw new Error(`no certificates found in the fed folder (${list.length} files, ${xml} XML; expected CertStore.xml inside each instance folder, or .fed files)`);
  return insts;
}
