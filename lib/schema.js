import { z } from "zod";
const s = z.string().default("");
const ip = z.union([z.string(), z.array(z.string())]).default("");
const Server = z.object({ hostname: z.string(), env: s, function: s, cpu: z.coerce.string().default(""), ram: s, swap: s, disk: s, os: s, ip });
// One environment = one heading + one Servers table, e.g. "Old Production Environment" / "New Production Environment".
// `current` marks the environment the uploaded health-check, topology and cassandra data belong to (default: the last one listed).
// Backup of one environment (optional): its own `items`, and a `status` that overrides the profile-wide one.
const BackupItem = z.object({ category: z.string(), subcategories: z.array(z.string()).default([]) });
const Backup = z.object({ status: s, items: z.array(BackupItem).default([]) });
const Environment = z.object({ name: s, current: z.boolean().default(false), servers: z.array(Server), backup: Backup.optional() });

// Services List port rules (see lib/services.js for the defaults and what the fields mean).
const text = z.union([z.string(), z.number()]).transform(String);
const PortRule = z.object({
  port: z.union([z.array(z.coerce.number().int()), z.coerce.number().int()]).optional(), // exact port(s) ...
  ends_with: text.optional(), // ... or the last digits of an instance port ("75" matches 8075, 9075 ...)
  process: s, // regex on the process name (fixed `ports:` rules only; empty = any process)
  name: z.string(),
  admin_name: s, // name used on the host that runs the Admin Node Manager
  order: z.coerce.number().optional(), // position in the table: Node Manager 0, instances 10, Cassandra 20, Simulator 30, MySQL 40, Analytics 50, Portal 60
  loopback: z.boolean().default(false), // also list the port when it only listens on 127.0.0.1
}).refine((r) => r.port !== undefined || r.ends_with, "give `port` or `ends_with`");
const Services = z.object({
  other_ports: z.enum(["instances", "all", "none"]).default("none"), // ports no rule names: leave them out but warn (default), list those of API Gateway instances as "Port NNNN", or list every port
  replace_defaults: z.boolean().default(false), // true: use only the rules written here
  instance_ports: z.array(PortRule).default([]),
  ports: z.array(PortRule).default([]),
});

// Earlier profiles had a flat `servers:` list (and `servers_preprod:`): treat that as a single, unnamed environment.
const upgrade = (raw) => {
  if (!raw || typeof raw !== "object" || raw.environments || !raw.servers) return raw;
  const { servers, servers_preprod, ...rest } = raw;
  return { ...rest, environments: [{ servers }] };
};

export const Profile = z.preprocess(upgrade, z.object({
  customer: z.object({ name: z.string(), short: z.string(), product: z.string(), product_short: z.string(), environment: z.string().default("Production") }),
  author: z.object({ name: z.string(), company: s }),
  // installed API Gateway / API Portal version, e.g. 7.7.20250228 (7.7 February 2025): Available Patches then lists only newer releases
  current_version: z.string().regex(/^(7\.7\.\d{8})?$/, "use the form 7.7.YYYYMMDD, e.g. 7.7.20250228").default(""),
  doc_title: z.string().default("Preventive Maintenance Report Regular"),
  contacts: z.array(z.object({ name: z.string(), position: s, email: s })),
  releases: z.array(z.object({ version: z.string(), author: s, date: s, description: s })).default([]), // optional: earlier versions only, the current version is added automatically
  support_dates: z.array(z.object({ release: z.string(), status: s, eom: s, eos: s })).default([]),
  distribution: z.array(z.object({ name: z.string(), org: s, note: s })).default([]),
  environments: z.array(Environment).min(1, "list at least one environment"),
  // optional. Backup is listed for every environment. Without `items` a table is derived from that environment's topology:
  // Policy Studio + KPS per topology group, API Portal MySQL per portal host. `items` here apply to the `current` environment only;
  // give the others their own `backup:` inside the environment. `status` applies to all of them.
  backup: Backup.default({}), // status: written in the Status column of every row (left empty when not set, to fill in by hand)
  // optional: customer-specific ports for the Services List
  services: Services.default({}),
}));
