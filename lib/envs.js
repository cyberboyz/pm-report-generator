// Environment keys shared by the form (browser) and the generator (server): the folder / form-field name of an environment.
// "Old Production Environment" -> "old-production". An optional `data_dir:` in the profile overrides the name.
export const envSlug = (s) => String(s || "").toLowerCase().replace(/\s*environment\s*$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** One unique key per environment of the profile, in order. Works on the raw YAML objects as well as the validated profile. */
export function envKeys(envs) {
  const used = new Set();
  return envs.map((e, i) => {
    let k = envSlug(e.data_dir) || envSlug(e.name) || (envs.length > 1 ? `environment-${i + 1}` : "environment");
    if (used.has(k)) k = `${k}-${i + 1}`;
    used.add(k);
    return k;
  });
}

/** Display label of an environment ("Old Production Environment" -> "Old Production"). */
export const envLabel = (e, i, n) => (e.name || "").replace(/\s*environment\s*$/i, "").trim() || (n > 1 ? `Environment ${i + 1}` : "Environment");

/** Which environment a dropped file belongs to, from its path: a folder named like the environment
 *  ("old-production/health-check.zip"), the full key in the file name, or a word only that environment has ("old-cassandra.zip").
 *  Returns an index into keys, or -1 when the path doesn't say. A single environment always matches. */
export function envOfPath(path, keys) {
  if (keys.length === 1) return 0;
  const parts = path.split("/").filter(Boolean), file = parts.pop() || "";
  for (const dir of parts.reverse()) { const k = envSlug(dir); const i = keys.indexOf(k); if (i >= 0) return i; }
  const base = "-" + envSlug(file.replace(/\.[^.]+$/, "")) + "-";
  const full = keys.filter((k) => base.includes(`-${k}-`));
  if (full.length === 1) return keys.indexOf(full[0]);
  const words = (k) => new Set(k.split("-"));
  const own = keys.map((k) => [...words(k)].filter((w) => keys.every((o) => o === k || !words(o).has(w))));
  const hit = own.map((ws) => ws.some((w) => base.includes(`-${w}-`)));
  return hit.filter(Boolean).length === 1 ? hit.indexOf(true) : -1;
}
