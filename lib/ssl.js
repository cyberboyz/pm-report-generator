// Turns extracted certificates into the SSL section: classify like ssl-tls-certificate-checker.sh,
// categorize/sort like categorize-sort-cert-output.py, keep only Expired / Expiring in 3 Months.
import { X509Certificate } from "node:crypto";

// dates are shown in WIB (UTC+7), like the report server's local time
const WIB = 7 * 3600 * 1000;
const wib = (d) => new Date(d.getTime() + WIB);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d0) => { const d = wib(d0); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const dmy = (d0) => { const d = wib(d0); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const field = (dn, k) => (dn.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();

function analyze({ dname, content, key }, today, soon) {
  let x;
  try { x = new X509Certificate(`-----BEGIN CERTIFICATE-----\n${content.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`); } catch { return null; }
  const end = new Date(x.validTo);
  // organization = issuer O (text before the first "/"), else "CN=<issuer CN>"
  let org = (field(x.issuer, "O") || "").replace(/\/.*/, "");
  if (!org) org = "CN=" + (field(x.issuer, "CN") || "");
  const endStr = iso(end);
  return {
    dname, key, org: org.replace(/^"+/, ""),
    ca: x.ca || x.issuer === x.subject, // basicConstraints CA:TRUE, or self-signed
    expiry: dmy(end),
    status: endStr < today ? "Expired" : endStr < soon ? "Expiring in 3 Months" : "Valid",
  };
}

const sortCerts = (a, b) => (a.org.toLowerCase() < b.org.toLowerCase() ? -1 : a.org.toLowerCase() > b.org.toLowerCase() ? 1 : a.org < b.org ? -1 : a.org > b.org ? 1 : a.dname < b.dname ? -1 : a.dname > b.dname ? 1 : 0);

function resolve(name, topologies) {
  const up = name.toUpperCase();
  for (const t of topologies) for (const i of t.instances || []) if (i.name.toUpperCase() === up) return { group: i.group, port: i.port };
  return { group: up.replace(/_\d+_(DC|DRC)$/, "").replace(/_PROD$/, ""), port: null };
}

/** instances: [{name, certs}] ; today: "YYYY-MM-DD" (report date) */
export function buildSsl(instances, today, topologies = []) {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 3);
  const soon = d.toISOString().slice(0, 10);
  const groups = new Map();
  for (const inst of instances) {
    const { group, port } = resolve(inst.name, topologies);
    const title = port ? `${group} (${port.slice(0, -2)}xx)` : group;
    const g = groups.get(title) || groups.set(title, { title, port: port ? +port : Infinity, seen: new Set(), certs: [] }).get(title);
    for (const c of inst.certs) {
      if (g.seen.has(c.content)) continue; // same certificate in DC and DRC (or twice)
      g.seen.add(c.content);
      const a = analyze(c, today, soon);
      if (a) g.certs.push(a);
    }
  }
  return [...groups.values()].sort((a, b) => a.port - b.port || a.title.localeCompare(b.title)).map((g) => {
    const due = g.certs.filter((c) => c.status !== "Valid").sort(sortCerts);
    const rows = (list) => list.map((c, i) => ({ no: i + 1, alias: c.dname, expiry: c.expiry, status: c.status }));
    const keyed = rows(due.filter((c) => c.key));
    const plain = rows(due.filter((c) => !c.key && !c.ca)); // CA certificates without keys are not reported
    return { title: g.title, empty: !keyed.length && !plain.length, has_keyed: keyed.length > 0, keyed, has_plain: plain.length > 0, plain };
  });
}

const FILL = { Expired: "FF9F9F", "Expiring in 3 Months": "F5FF93" };
/** shade a whole table row when its last cell is Expired / Expiring in 3 Months */
export const colourCertRows = (xml) => xml.replace(/<w:tr[ >](?:(?!<\/w:tr>).)*<\/w:tr>/gs, (tr) => {
  const cells = tr.match(/<w:tc>(?:(?!<\/w:tc>).)*<\/w:tc>/gs);
  if (!cells || tr.includes("<w:shd ")) return tr;
  const fill = FILL[cells[cells.length - 1].replace(/<[^>]+>/g, "").trim()];
  if (!fill) return tr;
  return tr.replace(/(<w:tcPr>\s*<w:tcW [^>]*\/>)/g, `$1<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
});
