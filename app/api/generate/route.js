import { render } from "@/lib/render";
export const runtime = "nodejs";

// Form fields: profile, date, version, architecture, ssl, and per environment `env.<key>.health|topology|cassandra`
// (key = see lib/envs.js, e.g. env.old-production.health). The old fields `health`, `topology`, `cassandra` (no environment) still work.
const KIND = { health: "healthZip", topology: "topologyZip", cassandra: "cassandraZip" };

export async function POST(req) {
  try {
    const f = await req.formData();
    const profile = f.get("profile");
    const img = f.get("architecture");
    const buf_ = async (x) => (x && x.size ? Buffer.from(await x.arrayBuffer()) : null);
    const envFiles = {}, legacy = {};
    for (const [name, v] of f.entries()) {
      const m = name.match(/^env\.([a-z0-9-]+)\.(health|topology|cassandra)$/);
      if (m) { const b = await buf_(v); if (b) (envFiles[m[1]] ||= {})[KIND[m[2]]] = b; }
      else if (KIND[name]) { const b = await buf_(v); if (b) legacy[KIND[name]] = b; }
    }
    const { buf, fileName, warnings } = await render({
      yamlText: await profile.text(),
      date: f.get("date"), version: f.get("version") || "1.0",
      archPng: await buf_(img),
      sslJson: (await buf_(f.get("ssl")))?.toString("utf8") || null,
      envFiles, legacy,
    });
    return new Response(buf, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Report-Warnings": encodeURIComponent(JSON.stringify(warnings || [])),
    }});
  } catch (e) {
    return Response.json({ error: e.errors ? e.errors.map(x => x.path.join(".") + ": " + x.message).join("; ") : e.message }, { status: 400 });
  }
}
