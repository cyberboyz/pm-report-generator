"use client";
import { useState, useEffect, useRef } from "react";
import { parse } from "yaml";
import { certsFromUpload } from "@/lib/fed";
import { envKeys, envLabel } from "@/lib/envs";
import { startDrop, fromInput, expand, packLoose, place, PER_ENV } from "@/lib/intake";

const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const I = {
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M9 9.5h.01",
  pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
  topology: "M12 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M5 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M19 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M12 8.5v3 M12 11.5H5v4 M12 11.5h7v4",
  db: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  cert: "M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.300-7-9.500V6z M8.800 12l2.200 2.200 4.200-4.400",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  check: "M5 12.5l4.5 4.5L19 7.5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  auto: "M3 5h18v11H3z M8 20h8 M12 16v4",
  dl: "M12 4v11 M7 11l5 5 5-5 M5 20h14",
};

function ThemeToggle() {
  const [mode, setMode] = useState("system");
  useEffect(() => { try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") setMode(t); } catch {} }, []);
  function pick(m) {
    setMode(m);
    const r = document.documentElement;
    if (m === "system") delete r.dataset.theme; else r.dataset.theme = m;
    try { m === "system" ? localStorage.removeItem("theme") : localStorage.setItem("theme", m); } catch {}
  }
  return (
    <div className="theme" role="group" aria-label="Theme">
      {[["light", "Light", I.sun], ["system", "System", I.auto], ["dark", "Dark", I.moon]].map(([m, label, d]) => (
        <button key={m} type="button" title={label} aria-label={label} aria-pressed={mode === m} onClick={() => pick(m)}><Icon d={d} size={15} /></button>
      ))}
    </div>
  );
}

function Drop({ file, onFile, accept, title, hint, icon, required }) {
  const [over, setOver] = useState(false);
  const ref = useRef();
  const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  return (
    <div className={`drop ${file ? "has" : ""} ${over ? "over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <input ref={ref} type="file" accept={accept} aria-label={title} onChange={(e) => onFile(e.target.files[0] || null)} />
      <div className="ico"><Icon d={file ? I.check : icon} /></div>
      <div className="dt">
        <b>{file ? file.name : title}</b>
        <span>{file ? size(file.size) : hint}</span>
      </div>
      {file
        ? <button type="button" className="rm" aria-label="Remove file" onClick={(e) => { e.stopPropagation(); ref.current.value = ""; onFile(null); }}>×</button>
        : <span className="tag">{required ? "Required" : "Optional"}</span>}
    </div>
  );
}

const SLOTS = {
  health: { icon: I.pulse, title: "Health check", hint: "ZIP · memory, CPU and disk per server (DC/ and DRC/ folders)" },
  topology: { icon: I.topology, title: "APIM topology", hint: "ZIP · managedomain --print_topology output" },
  cassandra: { icon: I.db, title: "Cassandra", hint: "ZIP · nodetool status + last repair logs" },
};

export default function Page() {
  const [profile, setProfile] = useState(null);
  const [arch, setArch] = useState(null);
  const [files, setFiles] = useState({}); // "<environment key>:<kind>" -> File, kind = health | topology | cassandra
  const [envs, setEnvs] = useState([]);   // [{ key, label }] from the profile: the form shows slots for exactly these
  const envRef = useRef([]);              // same list, readable inside async handlers
  const [needs, setNeeds] = useState([]); // files that don't say which environment they belong to
  const waiting = useRef([]);             // per-environment files dropped before the profile
  const [nWaiting, setNWaiting] = useState(0);
  const [ssl, setSsl] = useState([]);     // .fed / zip files
  const [sslData, setSslData] = useState(null); // certificates extracted in the browser (keeps the upload small)
  const [date, setDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const [version, setVersion] = useState("1.0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);
  const [info, setInfo] = useState(null);
  const setFile = (key, f) => setFiles((o) => { const n = { ...o }; if (f) n[key] = f; else delete n[key]; return n; });

  /** Reads the profile and, from it, the environments: slots follow the profile. Files stay where the environment key still exists. */
  async function pickProfile(f) {
    setProfile(f); setDone(null); setErr(""); setInfo(null);
    if (!f) { envRef.current = []; setEnvs([]); return []; }
    try {
      const y = parse(await f.text());
      const raw = y.environments || (y.servers ? [{ servers: y.servers }] : []); // a flat `servers:` list counts as one environment
      const keys = envKeys(raw);
      const list = raw.map((e, i) => ({ key: keys[i], label: envLabel(e, i, raw.length) }));
      envRef.current = list; setEnvs(list);
      setFiles((o) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k.split(":")[0]))));
      setNeeds([]);
      setInfo({
        customer: y.customer?.name, product: y.customer?.product, env: y.customer?.environment,
        servers: raw.reduce((n, e) => n + (e.servers || []).length, 0), contacts: (y.contacts || []).length, envs: raw.length,
      });
      return list;
    } catch { setErr("This file doesn't look like valid YAML. Check the formatting and try again."); return []; }
  }

  async function addSsl(list, replace) {
    const next = replace ? list : [...ssl, ...list];
    setSsl(next); setSslData(null); setErr("");
    if (!next.length) return;
    try {
      const inst = [];
      for (const f of next) inst.push(...certsFromUpload(new Uint8Array(await f.arrayBuffer()), f.name));
      setSslData(inst);
    } catch (ex) { setSsl([]); setErr(ex.message); }
  }

  const [bulk, setBulk] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  const folderRef = useRef();
  const envName = (k) => envRef.current.find((e) => e.key === k)?.label || k;

  /** entries: [{ file, path }] from a drop of files, a folder, or a zipped folder */
  async function dropMany(raw) {
    setErr("");
    const entries = [...(await expand(raw)), ...waiting.current];
    waiting.current = [];
    const prof = entries.find((e) => /\.ya?ml$/i.test(e.file.name));
    const list = prof ? await pickProfile(prof.file) : envRef.current;
    const keys = list.map((e) => e.key);
    const r = place(await packLoose(entries.filter((e) => e !== prof), keys), keys);
    if (r.shared.arch) setArch(r.shared.arch);
    if (r.shared.ssl.length) await addSsl(r.shared.ssl, true);
    setFiles((o) => ({ ...o, ...r.env }));
    waiting.current = r.waiting; setNWaiting(r.waiting.length);
    setNeeds((n) => [...(prof ? [] : n), ...r.needs]);
    const placed = Object.keys(r.env).length + (prof ? 1 : 0) + (r.shared.arch ? 1 : 0) + r.shared.ssl.length;
    const bits = [`${placed} file${placed === 1 ? "" : "s"} placed`];
    if (r.waiting.length) bits.push(`${r.waiting.length} waiting for the profile`);
    if (r.needs.length) bits.push(`${r.needs.length} need an environment`);
    if (r.unknown.length) bits.push(`not recognised: ${r.unknown.join(", ")}`);
    setBulkMsg(bits.join(" · "));
  }
  function assign(i, key) {
    const n = needs[i];
    setFile(`${key}:${n.kind}`, n.file);
    setNeeds(needs.filter((_, j) => j !== i));
  }

  async function submit(e) {
    e.preventDefault(); setErr(""); setDone(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("profile", profile); fd.append("date", date); fd.append("version", version || "1.0");
      if (arch) fd.append("architecture", arch);
      for (const [k, f] of Object.entries(files)) { const [env, kind] = k.split(":"); fd.append(`env.${env}.${kind}`, f); }
      if (sslData) fd.append("ssl", new Blob([JSON.stringify({ instances: sslData })], { type: "application/json" }), "ssl.json");
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = "Something went wrong.";
        try { msg = (await res.json()).error || msg; } catch { if (res.status === 413) msg = "Files are too large (limit ~4.5 MB). Try a smaller diagram."; }
        throw new Error(msg);
      }
      const name = decodeURIComponent((res.headers.get("Content-Disposition") || "").split("''")[1] || "report.docx");
      const url = URL.createObjectURL(await res.blob());
      let notes = []; try { notes = JSON.parse(decodeURIComponent(res.headers.get("X-Report-Warnings") || "[]")); } catch {}
      setDone({ name, url, notes });
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  const slots = (key) => PER_ENV.map((kind) => (
    <Drop key={kind} file={files[`${key}:${kind}`]} onFile={(f) => setFile(`${key}:${kind}`, f)} accept=".zip" icon={SLOTS[kind].icon}
      title={SLOTS[kind].title} hint={SLOTS[kind].hint} />
  ));
  const nCerts = sslData ? sslData.reduce((n, i) => n + i.certs.length, 0) : 0;

  return (
    <main className="wrap">
      <div className="brand">
        <div className="logo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><path d="M14 3v5h5" /><path d="M19 8v3" /><path d="M17.5 21.5l-2-1a3 3 0 0 1-1.5-2.6V16l3.5-1.5L20.5 16v1.9a3 3 0 0 1-1.5 2.6z" transform="translate(0.5 -0.5)" /><path d="M16 18.2l1.2 1.2 2.3-2.4" /></svg></div>
        <div><h1>Axway Preventive Maintenance Report Generator</h1><p>Turn a customer profile into a ready-to-send Word report.</p></div>
        <ThemeToggle />
      </div>

      <form className="card" onSubmit={submit}>
        <div className={`drop bulk ${bulk ? "over" : ""}`} style={{ margin: "16px 0 4px" }}
          onDragOver={(e) => { e.preventDefault(); setBulk(true); }} onDragLeave={() => setBulk(false)}
          onDrop={(e) => { e.preventDefault(); setBulk(false); startDrop(e.dataTransfer).then(dropMany); }}>
          <input type="file" multiple aria-label="Drop all files" onChange={(e) => { dropMany(fromInput(e.target.files)); e.target.value = ""; }} />
          <div className="ico"><Icon d={I.dl} /></div>
          <div className="dt"><b>Drop all your files at once</b><span>{bulkMsg || "Files, a report-input/ folder or its zip: the profile first, then each file is placed by name and environment folder"}</span></div>
        </div>
        <div className="bulk-more">
          <button type="button" className="link" onClick={() => folderRef.current.click()}>Choose a folder…</button>
          <input ref={folderRef} type="file" webkitdirectory="" multiple hidden onChange={(e) => { dropMany(fromInput(e.target.files)); e.target.value = ""; }} />
          {nWaiting > 0 && <span>{nWaiting} file{nWaiting === 1 ? "" : "s"} waiting for the profile</span>}
        </div>
        {needs.length > 0 && (
          <div className="needs" role="group" aria-label="Files that need an environment">
            {needs.map((n, i) => (
              <div key={i} className="need">
                <span title={n.path}>{n.file.name}</span>
                <select value="" aria-label={`Environment for ${n.file.name}`} onChange={(e) => e.target.value && assign(i, e.target.value)}>
                  <option value="">Which environment?</option>
                  {envs.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        <section className="sec">
          <div className="sec-h"><span className="num">1</span><h2>Customer profile</h2></div>
          <Drop file={profile} onFile={pickProfile} accept=".yaml,.yml" required icon={I.doc}
            title="Drop profile.yaml or click to browse" hint="Customer, contacts, environments with servers, releases" />
          {info && (<>
            <div className="who"><b>{info.customer || "Unnamed customer"}</b> <span>· {info.product || "—"} · {info.env || "Production"}</span></div>
            <div className="preview">
              <div className="stat"><b>{info.servers}</b><span>Servers</span></div>
              <div className="stat"><b>{info.envs}</b><span>{info.envs === 1 ? "Environment" : "Environments"}</span></div>
              <div className="stat"><b>{info.contacts}</b><span>Contacts</span></div>
            </div>
          </>)}
        </section>

        <section className="sec">
          <div className="sec-h"><span className="num">2</span><h2>Attachments</h2><span className="sub">Optional</span></div>
          <div className="stack">
            <Drop file={arch} onFile={setArch} accept="image/png,image/jpeg,image/gif,image/bmp,.png,.jpg,.jpeg,.gif,.bmp" icon={I.image}
              title="Architecture diagram" hint="PNG, JPG, GIF or BMP · keep under 4 MB" />
            <Drop file={ssl[0] ? { name: ssl.length > 1 ? `${ssl.length} files` : ssl[0].name, size: ssl.reduce((n, f) => n + f.size, 0) } : null} onFile={(f) => addSsl(f ? [f] : [], true)} accept=".zip,.fed" icon={I.cert}
              title="SSL certificates" hint={sslData ? `${nCerts} certificates in ${sslData.length} .fed file(s)` : "ZIP of .fed backups (or one .fed) · read in your browser"} />
          </div>
          {!profile && <p className="note">Drop the profile to get the health-check, topology and Cassandra slots of each environment.</p>}
          {envs.length === 1 && <div className="stack" style={{ marginTop: 10 }}>{slots(envs[0].key)}</div>}
          {envs.length > 1 && envs.map((env) => (
            <div key={env.key} className="envbox">
              <div className="env-h"><b>{env.label}</b><span>{env.key}/</span></div>
              <div className="stack">{slots(env.key)}</div>
            </div>
          ))}
        </section>

        <section className="sec">
          <div className="sec-h"><span className="num">3</span><h2>Report details</h2></div>
          <div className="grid2">
            <div><div className="lbl">Report date</div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div><div className="lbl">Version</div><input type="text" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" /></div>
          </div>
        </section>

        <section className="sec">
          <button className="btn" disabled={busy || !profile}>
            {busy ? <><span className="spin" />Generating…</> : <><Icon d={I.dl} />Generate report</>}
          </button>
          {err && <div className="alert err" role="alert">{err}</div>}
          {done && (
            <div className="alert ok" role="status">
              <Icon d={I.check} /> <span>Downloaded {done.name}</span>
              <button type="button" onClick={() => Object.assign(document.createElement("a"), { href: done.url, download: done.name }).click()}>Download again</button>
            </div>
          )}
          {done?.notes?.length > 0 && (
            <div className="alert warn" role="status"><b>The report was generated, but check these:</b><ul>{done.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
          )}
        </section>
      </form>
      <p className="hint">Files are processed in memory and never stored. Word may ask to update fields on open — choose Yes.</p>
    </main>
  );
}
