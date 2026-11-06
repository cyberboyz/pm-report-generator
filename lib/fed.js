// Reads Axway .fed files (zip archives containing CertStore.xml). Works in the browser and in Node,
// so the page can extract the certificates locally and upload only a small JSON (Vercel body limit ≈ 4.5 MB).
import PizZip from "pizzip";

const dec = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** [{ dname, content (base64 DER), key (has private key) }] from one .fed */
export function certsFromFed(bytes) {
  const zip = new PizZip(bytes);
  const f = Object.values(zip.files).find((e) => !e.dir && /(^|\/)CertStore[^/]*\.xml$/.test(e.name));
  if (!f) throw new Error("CertStore XML file not found in the .fed file");
  return certsFromCertStore(f.asText());
}

/** [{ dname, content, key }] from the text of a CertStore XML (a .fed that is already unzipped into a folder) */
export function certsFromCertStore(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entity\b[^>]*\btype="Certificate"[^>]*>([\s\S]*?)<\/entity>/g)) {
    const val = (n) => (m[1].match(new RegExp(`<fval name="${n}">\\s*<value[^>]*>([\\s\\S]*?)</value>`)) || [])[1] || "";
    const content = val("content").replace(/&#x?[0-9a-fA-F]+;/g, "").replace(/\s+/g, "");
    if (content) out.push({ dname: dec(val("dname")).trim(), content, key: val("key").trim() !== "" });
  }
  return out;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = /^(meta-inf|conf|configs?|fed|dc|drc)$/i; // folders that say nothing about the instance
/** first folder name that can be an instance name (not an id, not META-INF / conf / DC ...) */
const pick = (dirs) => dirs.find((d) => d && !GENERIC.test(d) && !GUID.test(d));
const dirsOf = (path) => path.replace(/\\/g, "/").split("/").slice(0, -1);
/** instance name stored inside a .fed: its entries are laid out like the extracted folder (<instance>/<id>/META-INF/CertStore.xml) */
function innerName(zip) {
  const e = Object.keys(zip.files).find((n) => /(^|\/)CertStore[^/]*\.xml$/.test(n));
  return e ? pick(dirsOf(e)) : undefined;
}

/** A zip of .fed files (any folder depth) or a single .fed -> [{ name, certs, path }]. The name is read the way a folder's is:
 *  the folder layout inside the .fed, else the folders around the file (rel = its path), else the file name. */
export function certsFromUpload(bytes, fileName = "", rel = "") {
  let zip;
  try { zip = new PizZip(bytes); } catch { throw new Error("SSL upload must be a .zip of .fed files, or a .fed file"); }
  const base = (n) => n.replace(/^.*\//, "").replace(/\.(zip|fed)$/i, "");
  const outer = dirsOf(rel).reverse(); // nearest folder first
  if (Object.keys(zip.files).some((n) => /(^|\/)CertStore[^/]*\.xml$/.test(n)))
    return [{ name: innerName(zip) || pick(outer) || base(fileName) || "fed", certs: certsFromFed(bytes), path: rel || fileName }];
  const feds = Object.values(zip.files).filter((e) => !e.dir && /\.fed$/i.test(e.name) && !/(^|\/)__MACOSX/.test(e.name));
  if (!feds.length) throw new Error("No .fed files found in the SSL zip");
  return feds.map((e) => {
    const data = e.asUint8Array();
    let inner; try { inner = innerName(new PizZip(data)); } catch { /* certsFromFed reports unreadable files */ }
    return { name: inner || pick(dirsOf(e.name).reverse()) || pick(outer) || base(e.name), certs: certsFromFed(data), path: e.name };
  });
}
