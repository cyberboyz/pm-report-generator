// Group names of the SSL section, taken from where a .fed backup sits:  fed-backup/<rtsist_1_dc>/....fed  ->  group RTSIST.
// No imports: used by the browser (fed.js, intake.js) and by the server (ssl.js).

// "_1_dc", "-2-DRC", " 1 dc", "1dc", "_dc", "_dc1", "_dc_2" at the end of a folder / instance name
const ENV_END = /(?:[-_ .]*\d+[-_ .]*|[-_ .]+)(?:drc|dc)(?:[-_ .]*\d+)?$/i;
const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The folder that names a .fed's instance, from its path inside the dropped folder / zip. In order:
 *  the directory right below a "fed-backup" folder (any spelling: fed-backup, Fed Backup, 3-fed_backup, ssl-fed-backup ...; the first one
 *  ending in _N_dc / _N_drc if there are several levels), else the outermost folder ending in _N_dc / _N_drc, else the folder holding
 *  the .fed, else the file name itself. */
export function fedInstanceName(path) {
  const segs = String(path || "").split("/").filter(Boolean), file = segs.pop() || "";
  const base = file.replace(/\.(fed|zip)$/i, "");
  const a = segs.findIndex((s) => flat(s).includes("fedbackup"));
  const below = a >= 0 ? segs.slice(a + 1) : segs;
  return below.find((s) => ENV_END.test(s)) || (a >= 0 ? below[0] : below[below.length - 1]) || base;
}

/** "rtsist_1_dc" -> "rtsist", "DSP_RINTIS_PROD_2_DRC" -> "DSP_RINTIS_PROD", "qrcb_1" -> "qrcb": the name before the instance number and DC / DRC */
export function groupOf(name) {
  const n = String(name || "").trim();
  const g = n.replace(ENV_END, "");
  return (g !== n ? g : n.replace(/[-_ .]+\d+$/, "")) || n;
}

/** comparison key of an instance name, without DC / DRC and with one kind of separator: "dsp_rintis_prod_1_dc" and "DSP_RINTIS_PROD_1" are the same instance */
export const instanceKey = (name) => String(name || "").toUpperCase().replace(/[-_ .]*(?:DRC|DC)$/, "").replace(/[-_ .]+/g, "_");
