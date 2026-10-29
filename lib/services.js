// Services List built from the health-check listening ports (netstat) and process names (ps).
// Instance ports follow the APIM convention: xx75 API Manager, xx65 API Endpoint API Manager, xx89 OAuth, xx80 default endpoint.
const INSTANCE_SVC = [["75", "API Manager"], ["65", "API Endpoint API Manager"], ["89", "OAuth Endpoint"], ["80", "API Endpoint Default"]];
const CASSANDRA = [[7000, "Cassandra Communication"], [7199, "Cassandra JMX"], [9042, "Cassandra DB"]];

function servicesOf(h, adminHosts, known) {
  const out = [], seen = new Set();
  const add = (order, name, port) => { const k = `${name}|${port}`; if (!seen.has(k)) { seen.add(k); out.push({ order, name, port }); } };
  const ports = h.listen || [], names = h.names || {};
  // ps only lists the busiest processes, so fall back to the (15-character) name netstat prints and complete it
  // from the full names seen anywhere in the health-checks.
  const resolve = (l) => {
    if (names[l.pid]) return names[l.pid];
    if (/^Node Manager/i.test(l.proc)) return "Node Manager";
    if (/^Axway Analytics/i.test(l.proc)) return "Axway Analytics";
    const tok = (l.proc.match(/^[A-Z][A-Z0-9_]*/) || [])[0]; // instances are upper case; sshd, java, httpd ... are not
    if (!tok) return "";
    if (/_(DC|DRC)$/.test(tok)) return tok;
    const c = known.filter((n) => n.startsWith(tok));
    return c.find((n) => n.endsWith("_" + h.env)) || c[0] || tok;
  };
  const cass = ports.filter((l) => /java/i.test(l.proc) && CASSANDRA.some(([p]) => p === l.port));
  if (cass.some((l) => l.port === 7000)) for (const [port, name] of CASSANDRA) if (cass.some((l) => l.port === port)) add(`2|${port}`, name, port);
  for (const l of ports) {
    const vs = resolve(l);
    if (/^httpd/.test(l.proc) && l.port === 443) add("6|", "API Portal HTTPS", l.port);
    else if (/^httpd/.test(l.proc) && l.port === 10009) add("3|", "Simulator", l.port);
    else if (/^mysqld/.test(l.proc) && l.port === 3306) add("4|", "MySQL Server", l.port);
    else if (/^Node Manager/i.test(vs) && !l.loopback && l.port === 8090) add("0|", adminHosts.has(h.server.toLowerCase()) ? "Admin Node Manager" : "Node Manager", l.port);
    else if (/^Axway Analytics/i.test(vs) && l.port === 8040) add("5|", "Analytics", l.port);
    else if (vs && !/^Node Manager|^Axway Analytics/i.test(vs) && !l.loopback && /^\d{4}$/.test(String(l.port))) {
      const k = INSTANCE_SVC.findIndex(([suffix]) => String(l.port).endsWith(suffix));
      if (k >= 0) add(`1|${vs}|${k}`, `[${vs}] ${INSTANCE_SVC[k][1]}`, l.port);
    }
  }
  return out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)); // plain string order (numeric collation would misplace the Cassandra rows)
}

/** health: parsed health-check servers; topologies (optional) tell which hosts run the Admin Node Manager. */
export function buildServices(health, topologies = []) {
  const rows = [], known = [...new Set(health.flatMap((h) => Object.values(h.names || {})))];
  for (const h of health) {
    const admin = new Set(topologies.filter((t) => t.label.startsWith(h.env)).flatMap((t) => t.admins.map((a) => a.item.toLowerCase().split(/[\s(]/)[0].replace(/[-_](dc|drc)$/, ""))));
    const svcs = servicesOf(h, admin, known);
    const ip = h.ips.filter((x) => !x.startsWith("172.17.")).join("\n"); // skip the docker bridge address
    svcs.forEach((s, i) => rows.push({ no: rows.length + 1, name: s.name, ip, server: h.server, zone: h.env, port: s.port, active: "V" }));
  }
  return rows;
}
