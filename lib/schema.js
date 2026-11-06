import { z } from "zod";
const s = z.string().default("");
const ip = z.union([z.string(), z.array(z.string())]).default("");
const Server = z.object({ hostname: z.string(), env: s, function: s, cpu: z.coerce.string().default(""), ram: s, swap: s, disk: s, os: s, ip });
// One environment = one heading + one Servers table, e.g. "Old Production Environment" / "New Production Environment".
// `current` only matters for old-style uploads without an environment (a single health-check / topology / cassandra zip): they go to that environment (default: the last one listed).
// `data_dir` (optional) is the folder / form-field name of the environment's uploads; default: the name in lowercase with hyphens, without "Environment" ("Old Production Environment" -> old-production).
const Environment = z.object({ name: s, current: z.boolean().default(false), data_dir: s, servers: z.array(Server) });

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
  // optional. Without `items` the table is derived: Policy Studio + KPS per topology group, API Portal MySQL per portal host.
  backup: z.object({
    status: s, // written in the Status column of every row (left empty when not set, to fill in by hand)
    items: z.array(z.object({ category: z.string(), subcategories: z.array(z.string()).default([]) })).default([]),
  }).default({}),
}));
