// Services List built from the health-check listening ports (netstat / ss) and process names (ps).
//
// Which port is which service is DATA, not code: DEFAULT_SERVICES below follows the APIM convention
// (xx75 API Manager, xx65 API Endpoint API Manager, xx89 OAuth, xx80 default endpoint, Node Manager 8090 ...).
// A customer whose ports differ lists its own rules under `services:` in the profile; those are tried first and
// the defaults still apply to everything they do not cover (set `replace_defaults: true` to drop the defaults).
//
//   services:
//     other_ports: none             # none (default) | instances | all : what to do with a port no rule names
//     instance_ports:               # ports of API Gateway instances ("[QRCB_1_DC] <name>")
//       - { ends_with: "75", name: API Manager }
//       - { port: 8443, name: API Endpoint HTTPS }
//     ports:                        # fixed ports of other software; `process` is a regex on the process name
//       - { port: 8090, process: "Node Manager", name: Node Manager, admin_name: Admin Node Manager }

export const DEFAULT_SERVICES = {
  other_ports: "none",
  instance_ports: [
    { ends_with: "75", name: "API Manager" },
    { ends_with: "65", name: "API Endpoint API Manager" },
    { ends_with: "89", name: "OAuth Endpoint" },
    { ends_with: "80", name: "API Endpoint Default" },
  ],
  ports: [
    { port: 8090, process: "Node Manager|nodemanager", name: "Node Manager", admin_name: "Admin Node Manager", order: 0 },
    { port: 7000, process: "java", name: "Cassandra Communication", order: 20, loopback: true },
    { port: 7001, process: "java", name: "Cassandra Communication (SSL)", order: 20, loopback: true },
    { port: 7199, process: "java", name: "Cassandra JMX", order: 20, loopback: true },
    { port: 9042, process: "java", name: "Cassandra DB", order: 20, loopback: true },
    { port: 10009, process: "httpd", name: "Simulator", order: 30 },
    { port: 3306, process: "mysqld", name: "MySQL Server", order: 40 },
    { port: 8040, process: "Axway Analytics|java", name: "Analytics", order: 50 },
    { port: 443, process: "httpd", name: "API Portal HTTPS", order: 60 },
  ],
};

const ORDER_INSTANCE = 10, ORDER_OTHER_INSTANCE = 11, ORDER_CUSTOM = 70, ORDER_ALL = 80;
// processes that are never an API Gateway instance, and system daemons that are not worth a warning
const NOT_INSTANCE = /^(java|httpd|mysqld(_safe)?|python[\d.]*|sshd|chronyd|ntpd|systemd[\w-]*|rpcbind|rpc\.\w+|master|cupsd|dnsmasq|avahi[\w-]*|crond|rsyslogd|named|exim|postfix|sendmail|smtpd|nginx|node_exporter|dockerd|containerd[\w-]*|docker-proxy|polkitd|networkmanager|tuned|sssd[\w-]*|snmpd|nrpe|telegraf|filebeat|dbus[\w-]*|gssproxy|xinetd|vmtoolsd|splunkd|zabbix[\w_]*)$/i;
const NOISE = /^(sshd|chronyd|ntpd|systemd[\w-]*|rpcbind|rpc\.\w+|master|cupsd|dnsmasq|avahi[\w-]*|crond|rsyslogd|named|exim|postfix|sendmail|smtpd|node_exporter|dockerd|containerd[\w-]*|docker-proxy|polkitd|networkmanager|tuned|sssd[\w-]*|snmpd|nrpe|dbus[\w-]*|gssproxy|xinetd|vmtoolsd)$/i;

/** the defaults plus the customer's `services:` block (customer rules first, so they win) */
export function servicesConfig(custom = {}) {
  const c = custom || {};
  const d = c.replace_defaults ? { instance_ports: [], ports: [] } : DEFAULT_SERVICES;
  return {
    other_ports: c.other_ports || DEFAULT_SERVICES.other_ports,
    instance_ports: [...(c.instance_ports || []), ...d.instance_ports],
    ports: [...(c.ports || []), ...d.ports],
  };
}

const portHit = (r, port) => (r.port !== undefined && r.port !== null ? [].concat(r.port).map(Number).includes(port) : !!r.ends_with && String(port).length > String(r.ends_with).length && String(port).endsWith(String(r.ends_with)));
const procHit = (r, ...names) => !r.process || !names.some(Boolean) /* netstat run without root: process unknown, trust the port */ || names.some((n) => n && new RegExp(`^(?:${r.process})`, "i").test(n));
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

/** → { rows: [{ order, sub, k, name, port }], unmatched: [{ port, proc }], generic: [port] } for one health-check server. */
function servicesOf(h, adminHosts, known, cfg, topoByPort = new Map()) {
  const out = [], seen = new Set(), unmatched = [], generic = [];
  const add = (key, name, port) => { const k = `${name}|${port}`; if (!seen.has(k)) { seen.add(k); out.push({ key, name, port }); } };
  const ports = h.listen || [], names = h.names || {};
  const hostNames = Object.values(names), hostNo = (h.server.match(/(\d+)$/) || [])[1];
  const hostCands = (c) => c.find((n) => hostNames.includes(n)) // the full name ps printed on this very server
    || (hostNo && c.find((n) => new RegExp(`_${hostNo}_${h.env}$`, "i").test(n))) // QRCB_2_DC on PAPIMManager2
    || c.find((n) => n.toUpperCase().endsWith("_" + h.env)) || c[0];
  // ps only lists the busiest processes, so fall back to the (15-character) name netstat prints and complete it
  // from the full names seen anywhere in the health-checks / the topology.
  // Without process names (netstat / ss not run as root) an instance is recognised by its management port xx85 (loopback):
  // 4085 -> every port of the form 4xxx (and 2xxxx: 27065 belongs to 7085) is that instance; its name comes from the topology.
  const mgmt = new Set(ports.filter((l) => l.port >= 1000 && l.port % 100 === 85).map((l) => Math.floor((l.port % 10000) / 100)));
  const resolve = (l) => {
    if (names[l.pid]) return names[l.pid];
    if (!l.proc && !l.pid) {
      const pre = Math.floor((l.port % 10000) / 100);
      if (!mgmt.has(pre) || l.port < 1000) return "";
      const c = topoByPort.get(pre * 100 + 85) || [];
      return c.length ? hostCands(c) : `Instance ${pre}xx`;
    }
    if (/^Node Manager/i.test(l.proc)) return "Node Manager";
    if (/^Axway Analytics/i.test(l.proc)) return "Axway Analytics";
    if (!l.proc) return "";
    if (/^vshell$/i.test(l.proc)) return "Instance"; // the name is not printed anywhere: still an API Gateway instance
    if (NOT_INSTANCE.test(l.proc)) return "";
    const tok = (l.proc.match(/^[A-Za-z][A-Za-z0-9_]*/) || [])[0];
    if (!tok) return "";
    const c = known.filter((n) => n.toLowerCase().startsWith(tok.toLowerCase()));
    if (c.length) return hostCands(c);
    return /^[A-Z]/.test(tok) || /_/.test(tok) ? tok : ""; // instances are upper case or contain "_"; sshd, java, httpd ... do not
  };
  for (const l of ports) {
    const vs = resolve(l);
    const fixed = cfg.ports.find((r) => portHit(r, l.port) && procHit(r, ...(l.proc ? [l.proc, vs] : [])) && (r.loopback || !l.loopback));
    if (fixed) {
      const name = fixed.admin_name && adminHosts.has(h.server.toLowerCase()) ? fixed.admin_name : fixed.name;
      add([fixed.order ?? ORDER_CUSTOM, "", 0, l.port], name, l.port);
      continue;
    }
    if (l.loopback) continue;
    const isInst = vs && !/^Node Manager|^Axway Analytics/i.test(vs);
    if (isInst) {
      const k = cfg.instance_ports.findIndex((r) => portHit(r, l.port));
      if (k >= 0) add([ORDER_INSTANCE, vs, k, l.port], `[${vs}] ${cfg.instance_ports[k].name}`, l.port);
      else if (cfg.other_ports !== "none") { add([ORDER_OTHER_INSTANCE, vs, 0, l.port], `[${vs}] Port ${l.port}`, l.port); generic.push(l.port); }
      else unmatched.push({ port: l.port, proc: vs });
    } else if (cfg.other_ports === "all") add([ORDER_ALL, l.proc || "", 0, l.port], `${l.proc || "Unknown process"} Port ${l.port}`, l.port);
    else if (!NOISE.test(l.proc) && l.proc) unmatched.push({ port: l.port, proc: l.proc || "unknown process" });
  }
  return { rows: out.sort((a, b) => cmpKey(a.key, b.key)), unmatched, generic };
}

/** health: parsed health-check servers; topologies (optional) tell which hosts run the Admin Node Manager and which instance names exist;
 *  custom: the profile's `services:` block (optional).
 *  → { rows, unmatched: [{ port, proc, servers }], generic: [port] } : unmatched = listening ports that no rule names (not in the table),
 *  generic = ports of an instance shown as "Port NNNN" because no rule names them. */
export function buildServices(health, topologies = [], custom = {}) {
  const cfg = servicesConfig(custom);
  const known = [...new Set([...health.flatMap((h) => Object.values(h.names || {})), ...topologies.flatMap((t) => (t.instances || []).map((i) => i.name))])];
  const rows = [], un = new Map(), gen = new Set();
  const topoByPort = new Map(); // management port (4085) -> instance names from the topology
  for (const t of topologies) for (const i of t.instances || []) { const k = +i.port; if (!topoByPort.has(k)) topoByPort.set(k, []); topoByPort.get(k).push(i.name); }
  for (const h of health) {
    const admin = new Set(topologies.filter((t) => t.label.startsWith(h.env)).flatMap((t) => t.admins.map((a) => a.item.toLowerCase().split(/[\s(]/)[0].replace(/[-_](dc|drc)$/, ""))));
    const { rows: svcs, unmatched, generic } = servicesOf(h, admin, known, cfg, topoByPort);
    const ip = h.ips.filter((x) => !x.startsWith("172.17.")).join("\n"); // skip the docker bridge address
    svcs.forEach((s) => rows.push({ no: rows.length + 1, name: s.name, ip, server: h.server, zone: h.env, port: s.port, active: "V" }));
    for (const u of unmatched) { const k = `${u.port}|${u.proc}`; if (!un.has(k)) un.set(k, { ...u, servers: [] }); un.get(k).servers.push(h.server); }
    generic.forEach((p) => gen.add(p));
  }
  return { rows, unmatched: [...un.values()].sort((a, b) => a.port - b.port), generic: [...gen].sort((a, b) => a - b) };
}
