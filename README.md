# Axway Preventive Maintenance Report Generator

Turns a customer profile (YAML) plus optional server exports into a ready-to-send Preventive Maintenance report (.docx). Built with Next.js, deployed on Vercel. Files are processed in memory and never stored.

## Quick start (Vercel, nothing to install)
1. Create an empty GitHub repository (private recommended) and upload everything in this folder (`app`, `lib`, `templates`, `scripts`, `public`, …).
2. On vercel.com: **Add New → Project →** import the repository **→ Deploy**. No settings needed.
3. Open the app, upload a profile (`.yaml`), add optional attachments, pick the report date and version, click **Generate report**.
4. Word asks to update fields (table of contents) on open: choose **Yes**.

Edits made on GitHub redeploy automatically. The app itself has no login. To open it without a Vercel login, set Vercel → Settings → Deployment Protection → **Vercel Authentication** to *Disabled* (and use the production domain, not a preview URL). Anyone with the link can then use it, and reports contain IPs and host details, so only share the link with people who should have it. Request bodies are limited to ~4.5 MB, so keep the architecture image small.

## Inputs
You can drop every file at once in the top box; each is placed by name: `.yaml/.yml` → profile, images → architecture, `.fed` → SSL, and zips by keyword (`health`, `topology`, `cassandra`, `fed`/`ssl`/`cert`/`backup`), falling back to the leading number (3 health, 4 topology, 5 cassandra, 6 SSL).

| Input | Required | Fills |
|---|---|---|
| Customer profile (`.yaml`) | yes | Cover, contacts, release history, Servers tables, Backup, Transactions headings |
| Architecture diagram (PNG/JPG/GIF/BMP) | no | Architecture section (left empty without it) |
| Health check (`.zip`, `DC/` and `DRC/` folders, one `.txt` per server) | no | Capacity & Performance tables, findings, Services List |
| APIM topology (`.zip`, `managedomain --print_topology` output) | no | Topology, group titles/ports, Backup rows |
| Cassandra (`.zip`, `nodetool status` + `Last Repair/<DC\|DRC>/*.log`) | no | Cassandra table |
| SSL certificates (`.zip` of `.fed` backups, or one `.fed`) | no | SSL/TLS section (read in the browser) |

## What is generated
- **Release History**: the row for the version being generated gets the report date and the author's first name; `releases:` in the profile is only needed for earlier versions.
- **Servers** (one heading + table per environment) with RAM + Swap columns. A profile lists them under `environments:`; `current: true` marks the one the uploaded health-check/topology/Cassandra data describe (default: the last).
  ```yaml
  environments:
    - name: Environment 1
      servers:
        - { hostname: apim-1, env: DC, function: API Gateway + Manager, cpu: 6, ram: 48 GB, swap: 16 GB, disk: 300 GB, os: RHEL 10, ip: 10.10.10.10 }
  ```
- **Capacity & Performance**: memory/CPU/disk tables and Warning/Critical findings (thresholds in `lib/metrics.js`). The iowait column appears only if the health check contains it (mpstat `%iowait`, vmstat `wa`, top `wa`, or `iowait : x`).
- **Services List**: built from the health check (listening ports and `ps`): Cassandra, Node Manager, each instance's API Manager / Endpoint / OAuth / Default ports, API Portal, MySQL, Analytics. Empty without a health-check zip.
- **Cassandra**: node status (`nodetool status`) plus Last Repair from the `last-repair/<DC|DRC>/*.log` files. A log is matched to its node by the `HOST/ip` it prints, else by the health-check host, else (equal numbers of logs and nodes) in order. The value is the newest line mentioning "repair"; if the log has none, its last timestamp is shown.
- **All environments**: Capacity and Performance, Topology, Cassandra and Summary repeat for every environment of the profile (name as sub-heading). The uploaded health-check / topology / Cassandra data belongs to the `current` environment; the others show their heading with empty tables.
- **Tables** (`lib/tables.js`): every table is post-processed: column widths fit their content (text measured per font size, short columns kept on one line, long ones share the rest, total width kept), and consecutive equal cells in the Server / Zone / Env / IP columns are merged vertically (Services List, Capacity, Servers ...).
- **SSL/TLS**: only Expired and Expiring-in-3-Months certificates, with-key and without-key in separate tables per group; status is relative to the report date, times in WIB (UTC+7).
- **Backup** (`lib/backup.js`): Policy Studio and KPS Data per topology group plus API Portal MySQL per portal host. Override with:
  ```yaml
  backup:
    status: Done
    items:
      - category: Policy Studio (.fed)
        subcategories: ["Group: group-1", "Group: group-2"]
  ```
- **Available Patches** (`lib/patches.js`): refreshed on every generation from the Axway release-notes URLs (falls back to the quarterly schedule if docs.axway.com is unreachable). With `current_version: 7.7.20250228` set in the profile, both the patch lists and the Supported API Gateway table show only the installed release (marked `(installed)`) and newer ones; without it, all releases are listed. EoM/EoS dates for newest releases come from the profile once Axway announces them:
  ```yaml
  support_dates:
    - { release: 7.7 February 2026, status: Maintenance, eom: 2027-09-01, eos: 2028-09-01 }
  ```
- **Transactions**: one sentence per environment in the profile, each followed by an empty summary table (Successes / Blocked / Exceptions / Total) to fill in by hand. The analysis window is three months ending on the 1st of the last month of the report date's quarter (Q1: 1 Dec–1 Mar, Q2: 1 Mar–1 Jun, Q3: 1 Jun–1 Sep, Q4: 1 Sep–1 Dec), month names in Indonesian.
- Sections not yet modularized (Capacity text, Summary notes, …) still contain the original sample wording.

## Project layout
- `app/`: UI (`page.js`, plain CSS in `globals.css` with auto dark mode, `icon.svg`) and the `api/generate` route.
- `lib/`: `render.js` (assembles the data and fills the template), `ingest.js`, `metrics.js`, `services.js`, `ssl.js`, `patches.js`, `backup.js`, `schema.js` (profile validation).
- `templates/pm-template.docx`: the report with `{placeholders}`. To use another template, replace the file and keep the placeholder names.
- `scripts/`: one-off Python scripts that built the template (`make-template.py`, `update-template-*.py` incl. `update-template-env-sections.py`; run once, optional, and re-running them overwrites manual template edits such as the Transactions section) and `extract-profile.py` (`python3 scripts/extract-profile.py "report.docx" > profile.yaml` rebuilds a profile from a finished report; check it before use).

## TODO
- [ ] **Automatic parsing from Analytics**: read the API Analytics data (successes, blocked, exceptions, total per environment and period) and fill the Transactions summary tables automatically, instead of leaving them empty. Needs a decision on the input: Analytics export/report upload, or a direct query of the Analytics database/API.
- [ ] Upload health-check / topology / Cassandra data per environment (today only the `current` environment is filled).
- [ ] Modularize the remaining sections that still carry sample data (Capacity text, Summary notes).
- [ ] Add the Transactions chart back, driven by the parsed Analytics data.
