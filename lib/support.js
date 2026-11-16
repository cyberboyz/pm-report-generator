// Parses the pasted Axway life-cycle table (support-data.js) -> { "20260830"?: ... } keyed by release code YYYYMMDD.
import { SUPPORT_TEXT } from "./support-data";
const CODE = { february: "0228", may: "0530", august: "0830", november: "1130" }; // quarterly release-notes codes
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const ROW = new RegExp(`7\\.7\\s+(February|May|August|November)\\s+(\\d{4})\\s+(General Availability|Maintenance|Supported|End of Support)(?:\\s+${DATE})?(?:\\s+${DATE})?(?:\\s+${DATE})?`, "gi");

/** { [code]: { ga, eom, eos, status } } ; a missing date is "" (the newest release has only its GA date so far) */
export function parseSupport(text = SUPPORT_TEXT) {
  const out = {};
  for (const m of text.matchAll(ROW)) out[m[2] + CODE[m[1].toLowerCase()]] = { ga: m[4] || "", eom: m[5] || "", eos: m[6] || "", status: m[3] };
  return out;
}
