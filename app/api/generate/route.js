import { render } from "@/lib/render";
export const runtime = "nodejs";

export async function POST(req) {
  try {
    const f = await req.formData();
    const profile = f.get("profile");
    const img = f.get("architecture");
    const buf_ = async (x) => (x && x.size ? Buffer.from(await x.arrayBuffer()) : null);
    const { buf, fileName } = await render({
      yamlText: await profile.text(),
      date: f.get("date"), version: f.get("version") || "1.0",
      archPng: await buf_(img),
      sslJson: (await buf_(f.get("ssl")))?.toString("utf8") || null,
      healthZip: await buf_(f.get("health")), topologyZip: await buf_(f.get("topology")), cassandraZip: await buf_(f.get("cassandra")),
    });
    return new Response(buf, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }});
  } catch (e) {
    return Response.json({ error: e.errors ? e.errors.map(x => x.path.join(".") + ": " + x.message).join("; ") : e.message }, { status: 400 });
  }
}
