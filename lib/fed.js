// Reads Axway .fed files (zip archives containing CertStore.xml). Works in the browser and in Node,
// so the page can extract the certificates locally and upload only a small JSON (Vercel body limit ≈ 4.5 MB).
import PizZip from "pizzip";
import { fedInstanceName } from "./groups";

const dec = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** [{ dname, content (base64 DER), key (has private key) }] from one .fed */
export function certsFromFed(bytes) {
  const zip = new PizZip(bytes);
  const f = Object.values(zip.files).find((e) => !e.dir && /(^|\/)CertStore[^/]*\.xml$/.test(e.name));
  if (!f) throw new Error("CertStore XML file not found in the .fed file");
  const out = [];
  for (const m of f.asText().matchAll(/<entity\b[^>]*\btype="Certificate"[^>]*>([\s\S]*?)<\/entity>/g)) {
    const val = (n) => (m[1].match(new RegExp(`<fval name="${n}">\\s*<value[^>]*>([\\s\\S]*?)</value>`)) || [])[1] || "";
    const content = val("content").replace(/&#x?[0-9a-fA-F]+;/g, "").replace(/\s+/g, "");
    if (content) out.push({ dname: dec(val("dname")).trim(), content, key: val("key").trim() !== "" });
  }
  return out;
}

/** A zip of .fed files (any folder depth) or a single .fed → [{ name, certs }].
 *  fileName: the name, or better the path inside the dropped folder, of the upload ("fed-backup/rtsist_1_dc/policy.fed").
 *  name = the folder that names the instance, e.g. "rtsist_1_dc" (see lib/groups.js). */
export function certsFromUpload(bytes, fileName = "") {
  let zip;
  try { zip = new PizZip(bytes); } catch { throw new Error("SSL upload must be a .zip of .fed files, or a .fed file"); }
  if (Object.keys(zip.files).some((n) => /(^|\/)CertStore[^/]*\.xml$/.test(n)))
    return [{ name: fedInstanceName(fileName) || "fed", certs: certsFromFed(bytes) }];
  const feds = Object.values(zip.files).filter((e) => !e.dir && /\.fed$/i.test(e.name) && !/(^|\/)__MACOSX/.test(e.name));
  if (!feds.length) throw new Error("No .fed files found in the SSL zip");
  const above = String(fileName).split("/").slice(0, -1).join("/"); // folders the zip itself was dropped from
  return feds.map((e) => ({ name: fedInstanceName((above ? above + "/" : "") + e.name), certs: certsFromFed(e.asUint8Array()) }));
}
