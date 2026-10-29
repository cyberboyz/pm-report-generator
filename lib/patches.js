// "Available Patches" section: release list, reference URLs and support status, refreshed at generation time.
// docs.axway.com is a JavaScript-rendered portal, so the index page rarely lists the releases in its raw HTML.
// Releases ship quarterly (7.7.YYYY0228 / 0530 / 0830 / 1130) and the release-notes URLs follow that pattern,
// so each candidate is confirmed by requesting its URL; the index page is also scanned for any extra links.
const BASE = "https://docs.axway.com/bundle/axway-open-docs/page/docs/apim_relnotes/";
const INDEX = BASE + "index.html";
const QUARTERS = [["02", "28", "February"], ["05", "30", "May"], ["08", "30", "August"], ["11", "30", "November"]];
const FIRST_YEAR = 2022, FIRST_MONTH = "08"; // the list starts at 7.7 August 2022, like the original report
const MONTH_NAME = { "02": "February", "05": "May", "08": "August", "11": "November" };

// End of Maintenance / End of Support published by Axway. Newer releases are not in here (dates are announced later):
// add them in the profile under `support_dates`.
const SUPPORT = {
  "20220830": ["2023-11-30", "2024-11-30"], "20221130": ["2024-02-28", "2025-02-28"], "20230228": ["2024-06-01", "2025-06-01"],
  "20230530": ["2024-08-28", "2025-08-28"], "20230830": ["2024-11-30", "2025-11-30"], "20231130": ["2025-03-07", "2026-03-07"],
  "20240228": ["2025-05-30", "2026-05-30"], "20240530": ["2025-10-23", "2026-10-23"], "20240830": ["2026-03-05", "2027-03-05"],
  "20250228": ["2026-06-11", "2027-06-11"], "20250530": ["2026-10-15", "2027-10-15"], "20250830": ["2027-03-05", "2028-03-05"],
};

const label = (code) => `7.7 ${MONTH_NAME[code.slice(4, 6)]} ${code.slice(0, 4)}`;
const iso = (code) => `${code.slice(0, 4)}-${code.slice(4, 6)}-${code.slice(6, 8)}`;

async function get(url, ms = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "pm-report-generator" } }); }
  catch { return null; }
  finally { clearTimeout(t); }
}

/** All quarterly release codes (YYYYMMDD) from 7.7 August 2022 up to `today` (YYYY-MM-DD). */
function schedule(today) {
  const out = [];
  for (let y = FIRST_YEAR; y <= +today.slice(0, 4); y++) for (const [m, d] of QUARTERS) {
    if (y === FIRST_YEAR && m < FIRST_MONTH) continue;
    if (m === "11" && y >= 2024) continue; // no November release since 2024 (Feb / May / Aug only)
    const code = `${y}${m}${d}`;
    if (iso(code) <= today) out.push(code);
  }
  return out;
}

/** installed: release code (YYYYMMDD) of the installed version, or "" when unknown. */
export async function checkPatches({ today, reportDate, overrides = [], installed = "" }) {
  const found = new Set();
  let source = "release schedule";
  const idx = await get(INDEX);
  if (idx && idx.ok) {
    const html = await idx.text();
    for (const m of html.matchAll(/(\d{8})_(?:apimgr|apip)_relnotes/g)) if (/^\d{8}$/.test(m[1]) && iso(m[1]) <= today) found.add(m[1]);
    if (found.size) source = "release notes index";
  }
  const codes = new Set([...schedule(today), ...found]);
  const missing = new Map(); // code -> true when both pages answered 404
  await Promise.all([...codes].map(async (code) => {
    if (found.has(code)) return;
    const [a, b] = await Promise.all(["apimgr", "apip"].map((k) => get(`${BASE}${code}_${k}_relnotes/index.html`)));
    if (a && b && a.status === 404 && b.status === 404) missing.set(code, true); // not published (yet)
    else if (a && a.ok) { if (source === "release schedule") source = "release-notes URLs"; }
  }));
  const list = [...codes].filter((c) => !missing.has(c)).sort();
  const latest = list[list.length - 1];

  const ov = new Map(overrides.map((o) => [o.release.toLowerCase(), o]));
  // Supported-release table: only the installed release and newer ones (older releases are irrelevant to this customer).
  const shown = installed ? list.filter((c) => c >= installed) : list;
  const support = shown.map((code, i) => {
    const name = label(code), o = ov.get(name.toLowerCase());
    const [eom, eos] = o ? [o.eom || "n/a", o.eos || "n/a"] : SUPPORT[code] || ["n/a", "n/a"];
    let status = o?.status;
    if (!status) {
      if (code === latest) status = "General Availability";
      else if (eos !== "n/a" && reportDate > eos) status = "End of Support";
      else if (eom !== "n/a" && reportDate > eom) status = "Supported";
      else status = "Maintenance";
    }
    return { no: i + 1, release: code === installed ? `${name} (installed)` : name, status, eom, eos };
  });
  const newer = installed ? list.filter((c) => c > installed) : list; // patches to offer: only releases after the installed one
  const urls = (kind) => newer.map((code, i) => ({ no: i + 1, name: label(code), url: `${BASE}${code}_${kind}_relnotes/index.html` }));
  return { support, gw_patches: urls("apimgr"), portal_patches: urls("apip"), patch_source: source, installed_release: installed ? label(installed) : "", latest_release: latest ? label(latest) : "" };
}
