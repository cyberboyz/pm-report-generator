// Parsers for the three optional zip uploads: health-check, apim-topology, cassandra.
// Each parser is path/content based, so the folder layout inside the zip does not matter.
import PizZip from "pizzip";

const LABELS = { DC: "DC (Data Center/Production)", DRC: "DRC (Disaster Recovery Center/Backup)" };
const label = (env) => LABELS[env] || env;
const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Read every text file of a zip: [{ path, name, text }] */
export function readZip(buf, what) {
  let zip;
  try { zip = new PizZip(buf); } catch { throw new Error(`${what} must be a valid .zip file`); }
  const files = Object.values(zip.files)
    .filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name))
    .map((f) => ({ path: f.name, name: f.name.split("/").pop(), text: f.asText() }));
  if (!files.length) throw new Error(`${what} zip is empty`);
  return files;
}

/** DC / DRC taken from a folder name or file name such as ".../DRC/..." or "new-drc-papimdb1.log" */
export function envOf(path) {
  const parts = path.split("/");
  const dir = parts.slice(0, -1).reverse().find((d) => /^(drc|dc)$/i.test(d));
  if (dir) return dir.toUpperCase();
  const m = parts[parts.length - 1].match(/(?:^|[-_ .])(drc|dc)(?=[-_ .])/i);
  return m ? m[1].toUpperCase() : "";
}

// ───────────────────────── health-check ─────────────────────────
const PSEUDO_FS = new Set(["efivarfs", "tmpfs", "devtmpfs", "squashfs", "overlay", "iso9660", "proc", "sysfs"]);

/** iowait (%) from whichever CPU tool the health-check script prints; null when absent.
 *  Supports mpstat ("%iowait" column), vmstat ("wa" column), top ("12.3 wa") and "iowait : 1.2" lines. */
export function parseIowait(text) {
  const lines = text.split(/\r?\n/);
  // mpstat: prefer the "Average: all" row, else the last "all" row
  const mp = lines.findIndex((l) => /%iowait/.test(l));
  if (mp >= 0) {
    const names = lines[mp].trim().replace(/^\d{1,2}:\d{2}:\d{2}(\s+[AP]M)?\s+/, "").split(/\s+/);
    const idx = names.indexOf("%iowait");
    const all = lines.slice(mp + 1).filter((l) => /(^|\s)all\s/.test(l));
    const row = all.find((l) => /^\s*Average:/.test(l)) || all[all.length - 1];
    if (row && idx >= 0) {
      const cells = row.trim().replace(/^Average:\s+/, "").replace(/^\d{1,2}:\d{2}:\d{2}(\s+[AP]M)?\s+/, "").split(/\s+/);
      const v = parseFloat(cells[idx]); // header and row both start with the CPU column
      if (Number.isFinite(v)) return v;
    }
  }
  // vmstat: header contains " wa " (followed by numeric rows)
  const vm = lines.findIndex((l) => /\bus\s+sy\s+id\s+wa\b/.test(l));
  if (vm >= 0) {
    const names = lines[vm].trim().split(/\s+/), row = lines.slice(vm + 1).filter((l) => /^\s*\d+(\s+\d+){5,}\s*$/.test(l)).pop();
    if (row) { const v = parseFloat(row.trim().split(/\s+/)[names.indexOf("wa")]); if (Number.isFinite(v)) return v; }
  }
  // top: "%Cpu(s):  3.1 us,  1.0 sy,  0.0 ni, 95.5 id,  0.4 wa, ..."
  const top = text.match(/Cpu\(s\):.*?([\d.]+)\s*wa\b/);
  if (top) return parseFloat(top[1]);
  // plain "iowait : 1.01" / "IO Wait = 1.01 %"
  const plain = text.match(/^\s*(?:%?\s*)?(?:cpu\s+)?i\/?o\s*-?wait\s*(?:\(%\))?\s*[:=]\s*([\d.]+)/im);
  return plain ? parseFloat(plain[1]) : null;
}


/** Listening sockets (netstat "Active Processes") and vshell instance names (ps) of one health-check file.
 *  listen: [{ port, loopback, pid, proc }]; names: { pid: "DSP_RINTIS_PROD_1_DC" | "Node Manager on X-DC" | ... } */
export function parseListeners(text) {
  const listen = [], seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^tcp6?\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s+LISTEN\s+(\d+)\/(.*?)\s*$/);
    if (!m) continue;
    const key = `${m[2]}:${m[3]}`;
    if (seen.has(key)) continue; // same port on IPv4 and IPv6
    seen.add(key);
    listen.push({ port: +m[2], loopback: /^(127\.|::1$)/.test(m[1]), pid: m[3], proc: m[4] });
  }
  const names = {};
  for (const line of text.split(/\r?\n/)) {
    // " 5.2    1206       1 root     Ssl  DSP_RINTIS_PROD_1_DC (DSP_RINTIS) (7.7.20250228) (vshell)"
    const m = line.match(/^\s*[\d.]+\s+(\d+)\s+\d+\s+\S+\s+\S+\s+(.+?)\s+\([^()]*\)\s+\([^()]*\)\s+\(vshell\)\s*$/);
    if (m) names[m[1]] = m[2];
  }
  return { listen, names };
}

export function parseHealth({ path, text }) {
  const g = (re) => (text.match(re) || [])[1]?.trim();
  const host = g(/^Hostname\s*:\s*(.+)$/m);
  const mem = text.match(/^Mem:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
  const swap = text.match(/^Swap:\s+(\d+)\s+(\d+)/m);
  const cores = g(/^CPU\(s\):\s+(\d+)/m);
  const load = text.match(/Current Load Average\s*:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const env = envOf(path);
  const bad = !host ? "Hostname" : !mem ? "memory (free)" : !cores ? "CPU(s)" : !load ? "load average" : !env ? "DC/DRC (folder or file name)" : "";
  if (bad) throw new Error(`Health check ${path}: cannot find ${bad}`);

  const sec = text.split(/Check for Disk Usage on Mounted File System\[s\]/)[1] || "";
  const disks = [];
  for (const line of (sec.split(/^-{10,}$/m)[0] || "").split("\n")) {
    // Type 1M-blocks Used Avail Use% Mounted-on Avail(%) Filesystem
    const m = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(\S+)\s+\d+%\s+\S+/);
    if (m && !PSEUDO_FS.has(m[1])) disks.push([m[5], +m[2], +m[3], +m[4]]);
  }
  if (!disks.length) throw new Error(`Health check ${path}: no disk usage rows found`);
  return {
    server: host, env, ips: (g(/^IP Address\s*:\s*(.+)$/m) || "").split(/[,\s]+/).filter(Boolean),
    ...parseListeners(text),
    metrics: { server: host, env, mem_total_mb: +mem[1], mem_avail_mb: +mem[6], swap_used_mb: swap ? +swap[2] : 0, load15: +load[3], cores: +cores, iowait: parseIowait(text), disks },
  };
}

export function parseHealthZip(buf) {
  const files = readZip(buf, "Health check").filter((f) => /\.txt$/i.test(f.name) && /Hostname\s*:/.test(f.text));
  if (!files.length) throw new Error("Health check zip has no health-check .txt files");
  const servers = files.map(parseHealth);
  servers.sort((a, b) => cmp(a.env === "DC" ? "0" : a.env, b.env === "DC" ? "0" : b.env) || cmp(a.server, b.server));
  return servers;
}

// ───────────────────────── apim topology ─────────────────────────
function parseTopologyText(text, env) {
  const get = (re) => (text.match(re) || [])[1]?.trim() || "";
  const sections = { Hosts: [], "Admin Node Managers": [], "Node Managers": [], Groups: [] };
  let cur = null, group = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^(Hosts|Admin Node Managers|Node Managers|Groups):\s*$/);
    if (h) { cur = sections[h[1]]; group = null; continue; }
    const m = line.match(/^(\s*)---(.+)$/);
    if (!m || !cur) continue;
    if (cur === sections.Groups) {
      if (m[1].length <= 1) { group = { group: m[2].trim(), instances: [] }; cur.push(group); }
      else if (group) group.instances.push(m[2].trim());
    } else cur.push(m[2].trim());
  }
  // one domain file may cover DC and DRC: keep only this environment's items (DC_1_DC, host-DRC …)
  const mine = new RegExp(`[-_]${env}\\b`, "i"), other = new RegExp(`[-_]${env === "DC" ? "DRC" : "DC"}\\b`, "i");
  const all = [...sections.Hosts, ...sections["Admin Node Managers"], ...sections.Groups.flatMap((g) => g.instances)];
  const split = all.some((s) => mine.test(s)) && all.some((s) => other.test(s));
  const keep = (s) => !split || (mine.test(s) && !other.test(s));
  const num = (arr) => arr.map((item, i) => ({ no: i + 1, item }));
  const groups = sections.Groups
    .map((g) => ({ group: g.group, instances: g.instances.filter(keep) }))
    .filter((g) => g.instances.length)
    .map((g, i) => ({ no: i + 1, group: g.group, instances: g.instances.join("\n") }));
  const nms = sections["Node Managers"].filter(keep);
  const instances = sections.Groups.flatMap((g) => g.instances.map((i) => {
    const m = i.match(/^(\S+)\s+\[instance-\d+\]\s+\(https?:\/\/[^:/]+:(\d+)\)/);
    return m && { name: m[1], group: g.group.replace(/\s*\[.*$/, ""), port: m[2] };
  })).filter(Boolean);
  return {
    instances, label: label(env), version: get(/^Version:\s*(.+)$/m), updated: get(/^Last updated:\s*(.+)$/m), domain: get(/^Domain ID:\s*(.+)$/m),
    hosts: sections.Hosts.filter(keep).map((host, i) => ({ no: i + 1, host })),
    admins: num(sections["Admin Node Managers"].filter(keep)), nms: num(nms), has_nms: nms.length > 0, groups,
  };
}

export function parseTopologyZip(buf) {
  const files = readZip(buf, "APIM topology").filter((f) => /Topology contents/i.test(f.text));
  if (!files.length) throw new Error("APIM topology zip has no managedomain --print_topology output");
  return files
    .map((f) => ({ env: envOf(f.path) || "DC", f }))
    .sort((a, b) => cmp(a.env === "DC" ? "0" : a.env, b.env === "DC" ? "0" : b.env))
    .map(({ env, f }) => parseTopologyText(f.text, env));
}

// ───────────────────────── cassandra ─────────────────────────
const ipNum = (ip) => ip.split(".").reduce((a, o) => a * 256 + +o, 0);
const ROW = /^([UD][NLJM])\s+(\S+)\s+([\d.,]+\s+\S+)\s+(\d+)\s+([\d.]+%)\s+([0-9a-f-]{36})\s+(\S+)/i;

function parseNodetool(text) {
  const dcs = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const d = line.match(/^Datacenter:\s*(\S+)/i);
    if (d) { cur = dcs[d[1].toUpperCase()] = []; continue; }
    const m = cur && line.match(ROW);
    if (m) cur.push({ state: m[1].toUpperCase(), ip: m[2], load: m[3], tokens: m[4], owns: m[5], host_id: m[6], rack: m[7].toUpperCase() });
  }
  return dcs;
}

/** Latest "repair" line of a Cassandra log, as "YYYY-MM-DD HH:MM:SS,mmm" (or a note if there is none). */
function lastRepair(text) {
  const ts = /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d{3}/;
  let last = "", end = "";
  for (const line of text.split(/\r?\n/)) {
    const t = (line.match(ts) || [])[1];
    if (t) end = t;
    if (t && /repair/i.test(line)) last = t;
  }
  // "last-repair" logs are captured right after a repair: without an explicit repair line, show the log's last timestamp
  return last || (end ? end : "No repair entry in log");
}

export function parseCassandraZip(buf, health = []) {
  const files = readZip(buf, "Cassandra");
  const status = files.filter((f) => /Datacenter:/i.test(f.text) && /Status=Up\/Down/i.test(f.text));
  if (!status.length) throw new Error("Cassandra zip has no nodetool status output");
  const parsed = status.map((f) => ({ env: envOf(f.path), dcs: parseNodetool(f.text) }));
  const envs = [...new Set(parsed.flatMap((p) => Object.keys(p.dcs)))].sort((a, b) => cmp(a === "DC" ? "0" : a, b === "DC" ? "0" : b));

  // last-repair logs: <anything>-<dc|drc>-<hostname>.log (or inside a DC/ DRC folder); keyed by environment + node IP
  const logs = {}, hosts = [];
  for (const f of files.filter((f) => /\.log$/i.test(f.name))) {
    const m = f.name.match(/(?:^|[-_])(drc|dc)[-_](.+?)\.log$/i);
    const env = m ? m[1].toUpperCase() : envOf(f.path), host = m ? m[2].toLowerCase() : f.name.replace(/\.log$/i, "").toLowerCase();
    if (!env) continue;
    const value = lastRepair(f.text);
    logs[`${env}:${host}`] = value;
    const entry = { env, host, value }; hosts.push(entry);
    // the log names its own node as "HOST/10.x.x.x:7000": that gives the IP without needing the health check
    const own = f.text.match(new RegExp(`${host.replace(/[^a-z0-9]/g, ".")}/(\\d+\\.\\d+\\.\\d+\\.\\d+)`, "i"));
    if (own) logs[`${env}:ip:${own[1]}`] = value;
    entry.ip = own?.[1];
  }
  const hostOf = (env, ip) => health.find((h) => h.env === env && h.ips.includes(ip))?.server.toLowerCase();

  return envs.map((env) => {
    // prefer the status taken from the same DC, otherwise any file that lists it
    const src = parsed.find((p) => p.env === env && p.dcs[env]) || parsed.find((p) => p.dcs[env]);
    const nodes = [...src.dcs[env]].sort((a, b) => ipNum(a.ip) - ipNum(b.ip)).map((n, i) => ({
      no: i + 1, ...n, last_repair: logs[`${env}:ip:${n.ip}`] || logs[`${env}:${hostOf(env, n.ip)}`] || "",
    }));
    // a log that names neither its IP nor a known host (no health check): when logs and nodes are equal in number,
    // pair them in order (papimdb1 -> lowest IP ...)
    const left = nodes.filter((n) => !n.last_repair);
    const taken = (h) => nodes.some((n) => n.last_repair && (h.ip === n.ip || hostOf(env, n.ip) === h.host));
    const free = hosts.filter((h) => h.env === env && !taken(h)).sort((a, b) => cmp(a.host, b.host));
    if (left.length && free.length === left.length) left.forEach((n, i) => { n.last_repair = free[i].value; });
    nodes.forEach((n) => { n.last_repair ||= "-"; });
    return { label: label(env), nodes };
  });
}
