// thresholds: [warning above, critical above] in % utilization
export const LIMITS = { mem: [70, 90], hdd: [70, 90], cpu: [60, 80] };
const level = (v, [w, c]) => (v > c ? "Critical" : v > w ? "Warning" : "OK");
const NB = "\u00A0"; // non-breaking space: "1.72 / 4 cores" stays on one line
export const MERGE = "\uE000"; // cell text meaning "merge with the cell above" (handled by lib/tables.js)
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const rank = { OK: 0, Warning: 1, Critical: 2 };
const TXT = {
  mem: { name: "memory", Critical: ["Kinerja service bisa menurun jika penggunaan memori beralih dari RAM ke swap (disk) karena kurangnya RAM, sehingga meningkatkan load CPU.", "Memeriksa service dengan utilisasi memori tinggi dan menambahkan RAM jika diperlukan."], Warning: ["Utilisasi memori mendekati batas dan berpotensi menurunkan kinerja jika terus meningkat.", "Memantau tren penggunaan memori."] },
  cpu: { name: "CPU", Critical: ["Kinerja aplikasi menurun dan berpotensi tidak dapat diakses jika utilisasi CPU lebih besar dari resource CPU yang tersedia.", "Load CPU yang tinggi dapat disebabkan oleh available RAM yang kecil, sehingga dapat dilakukan penambahan RAM. Jika masih tinggi, hentikan proses yang tidak diperlukan atau tambahkan CPU."], Warning: ["Utilisasi CPU mendekati batas dan berpotensi menurunkan kinerja.", "Memantau tren load CPU."] },
  hdd: { name: "HDD", Critical: ["Aplikasi dapat berhenti bekerja jika disk penuh.", "Membersihkan file yang tidak diperlukan atau menambah kapasitas disk."], Warning: ["Kapasitas disk mulai terbatas.", "Memantau pertumbuhan penggunaan disk dan merencanakan penambahan kapasitas."] },
};
const STATIC_NOTES = [
  ["Beberapa sertifikat SSL sudah/akan expired", "DC dan DRC", "Berpotensi menimbulkan masalah jika sertifikat SSL yang dipakai sudah tidak valid lagi karena expired", "Memperbarui sertifikat SSL yang sudah expired (warna merah) dan mempersiapkan sertifikat SSL baru untuk sertifikat SSL yang akan expired (warna kuning)"],
  ["Versi API Gateway dan API Portal sudah tidak didukung lagi", "DC dan DRC", "Berpotensi menimbulkan celah keamanan, risiko bug, dan berdampak pada performa sistem", "Update ke versi yang lebih baru dengan versi yang didukung oleh Axway"],
];
export function compute(m, withStatic = true) {
  const mem = [], disk = [], summary = [], bad = { mem: { Critical: [], Warning: [] }, cpu: { Critical: [], Warning: [] }, hdd: { Critical: [], Warning: [] } };
  m.servers.forEach((s, i) => {
    const no = i + 1, availPct = (s.mem_avail_mb / s.mem_total_mb) * 100, cpuPct = s.cores ? (s.load15 / s.cores) * 100 : null; // no core count known: CPU status N/A
    mem.push({ no, server: s.server, env: s.env, mem_total: s.mem_total_mb, mem_avail: s.mem_avail_mb, mem_avail_pct: f2(availPct), swap_used: s.swap_used_mb, cpu_load: s.cores ? `${f2(s.load15)}${NB}/${NB}${s.cores}${NB}cores` : `${f2(s.load15)}${NB}/${NB}n/a`, iowait: s.iowait == null ? "-" : f2(s.iowait) }); // "-" when the source has no iowait (health-check)
    let worst = 0;
    s.disks.forEach(([mount, total, used, avail], j) => {
      worst = Math.max(worst, 100 - (avail / total) * 100);
      disk.push({ no: j ? MERGE : no, server: s.server, env: s.env, mount, total, used, avail, avail_pct: f2((avail / total) * 100) });
    });
    const st = { mem: level(100 - availPct, LIMITS.mem), hdd: level(worst, LIMITS.hdd), cpu: cpuPct == null ? "N/A" : level(cpuPct, LIMITS.cpu) };
    summary.push({ no, server: s.server, env: s.env, mem_status: st.mem, hdd_status: st.hdd, cpu_status: st.cpu });
    for (const k of ["mem", "hdd", "cpu"]) if (st[k] !== "OK" && st[k] !== "N/A") bad[k][st[k]].push(`${s.env}: ${s.server}`);
  });
  const rows = [];
  for (const k of ["mem", "cpu", "hdd"]) for (const lv of ["Critical", "Warning"]) {
    if (!bad[k][lv].length) continue;
    const by = {}; bad[k][lv].forEach((x) => { const [e, sv] = x.split(": "); (by[e] ||= []).push(sv); });
    rows.push([`Load ${TXT[k].name} masuk kategori ‘${lv}’`, Object.entries(by).map(([e, v]) => `${e}: ${v.join(", ")}`).join("\n"), ...TXT[k][lv]]);
  }
  const notes = [...rows, ...(withStatic ? STATIC_NOTES : [])].map((r, i) => ({ no: i + 1, item: r[0], server: r[1], impact: r[2], solution: r[3] }));
  return { mem, disk, summary, notes };
}
const FILL = { OK: "92D050", Warning: "FFFF00", Critical: "FF0000" };
// colour any cell whose whole text is OK / Warning / Critical
export const colourStatus = (xml) => xml.replace(/<w:tc>(?:(?!<\/w:tc>).)*<\/w:tc>/gs, (tc) => {
  const t = tc.replace(/<[^>]+>/g, "").trim();
  if (!FILL[t]) return tc;
  const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${FILL[t]}"/>`;
  return tc.includes("<w:tcPr>") ? tc.replace(/<w:shd [^>]*\/>/, "").replace("</w:tcPr>", shd + "</w:tcPr>") : tc.replace("<w:tc>", `<w:tc><w:tcPr>${shd}</w:tcPr>`);
});
