import { render } from "@/lib/render";
export const runtime = "nodejs";

export async function POST(req) {
  try {
    const f = await req.formData();
    const profile = f.get("profile");
    const img = f.get("architecture");
    const buf_ = async (x) => (x && x.size ? Buffer.from(await x.arrayBuffer()) : null);
    // uploads are numbered per environment: health_0, topology_1, cassandra_1, ssl_0 ... (un-numbered ones belong to the current environment)
    const inputs = {};
    for (const [key, v] of f.entries()) {
      const k = key.match(/^(health|topology|cassandra|ssl)(?:_(\d+))?$/);
      if (!k || !v || typeof v === "string" || !v.size) continue;
      (inputs[k[2] ?? "current"] ||= {})[k[1]] = k[1] === "ssl" ? (await buf_(v)).toString("utf8") : await buf_(v);
    }
    const { buf, fileName, warnings } = await render({
      yamlText: await profile.text(),
      date: f.get("date"), version: f.get("version") || "1.0",
      archPng: await buf_(img),
      inputs,
    });
    return new Response(buf, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "X-Report-Warnings": encodeURIComponent(JSON.stringify(warnings.slice(0, 20))).slice(0, 6000), // files that were skipped (shown on the page)
    }});
  } catch (e) {
    return Response.json({ error: e.errors ? e.errors.map(x => x.path.join(".") + ": " + x.message).join("; ") : e.message }, { status: 400 });
  }
}
