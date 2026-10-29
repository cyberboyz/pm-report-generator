"""Builds a customer profile (profile.yaml) from an existing PM report. Optional:
    python3 scripts/extract-profile.py "report.docx" > profile.yaml
Reads the cover, Contact Details, Document Control, every Servers table (one environment per table, named by the
heading line above it, e.g. "Old Production Environment") and the Backup table. Review the result before using it.
"""
import re, sys, json, zipfile

TBL_OPEN = re.compile(r'<w:tbl>|</w:tbl>')
PARA = re.compile(r'<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>.*?</w:p>', re.S)
txt = lambda x: re.sub(r'<[^>]+>', '', x).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').strip()
clean = lambda s: re.sub(r'\s+', ' ', s).strip()

def blocks(body):
    """top-level ('p', text) and ('t', rows) in document order; a row is a list of cells, a cell a list of paragraph texts"""
    pos, out = 0, []
    pat = re.compile(r'<w:tbl>|<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>')
    while (m := pat.search(body, pos)):
        if m.group(0) == '<w:tbl>':
            depth, end = 0, None
            for t in TBL_OPEN.finditer(body, m.start()):
                depth += 1 if t.group(0) == '<w:tbl>' else -1
                if depth == 0: end = t.end(); break
            out.append(('t', table(body[m.start():end]))); pos = end
        else:
            end = m.end() if m.group(0).endswith('/>') else body.index('</w:p>', m.end()) + 6
            out.append(('p', txt(body[m.start():end]))); pos = end
    return out

def table(t):
    rows = []
    for tr in re.findall(r'<w:tr[ >].*?</w:tr>', t, re.S):
        row = []
        for tc in re.findall(r'<w:tc>.*?</w:tc>', tr, re.S):
            cont = bool(re.search(r'<w:vMerge\s*/>', tc))        # continuation of a vertically merged cell
            row.append((cont, [txt(p) for p in PARA.findall(tc) if txt(p)]))
        rows.append(row)
    return rows

def q(v):
    """YAML scalar: plain when safe, else JSON-quoted (valid YAML)"""
    if isinstance(v, int): return str(v)
    v = str(v)
    return v if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 ._@+()/-]*', v) and not re.fullmatch(r'\d+(\.\d+)?', v) else json.dumps(v, ensure_ascii=False)
flow = lambda d: '{ ' + ', '.join(f'{k}: {q(v) if not isinstance(v, list) else "[" + ", ".join(json.dumps(i) for i in v) + "]"}' for k, v in d.items() if v not in ('', None)) + ' }'

src = sys.argv[1]
x = zipfile.ZipFile(src).read('word/document.xml').decode('utf8')
B = blocks(x[x.index('<w:body>'):])
cell = lambda c: ' '.join(c[1])
tables = [(i, r) for i, (k, r) in enumerate(B) if k == 't']
header = lambda r: [cell(c) for c in r[0]]

# ── cover + document control ──
m = next(re.fullmatch(r'(.+?) for (.+) in (\w+)', t) for k, t in B if k == 'p' and re.fullmatch(r'(.+?) for (.+) in (\w+)', t))
product, customer, environment = m.groups()
cover = next(r for _, r in tables if cell(r[0][0]).startswith('Prepared By'))
author = cover[0][0][1][-1]
company = clean(cover[1][0][1][0])
if company.isupper(): company = ' '.join(w if w == 'PT' else w.capitalize() for w in company.split())
ctl = {}
for _, r in tables:
    if cell(r[0][0]) == 'Customer': ctl = {cell(row[0]): cell(row[1]) for row in r}
fn = re.match(r'\[(.+?)\]\s*\S+\s*Preventive Maintenance\s*\S+\s*(.+?) \((.+?) Environment\)', ctl.get('File Name', ''))
short, product_short = (fn.group(1), fn.group(2)) if fn else (customer.split()[-1], product)
environment = fn.group(3) if fn else environment

def rows_of(first, second):
    r = next(r for _, r in tables if header(r)[:2] == [first, second])
    return [[cell(c) for c in row] for row in r[1:]]
contacts = [dict(name=r[1], position=r[2], email=r[3]) for r in rows_of('No', 'Name')]
releases = [dict(version=r[0], author=r[1], date=r[2], description=r[3]) for r in rows_of('Release', 'Author')]
distribution = [dict(name=r[0], org=r[1], note=r[2]) for r in rows_of('Name', 'Organization')]

# ── servers: one environment per table, named by the last non-empty paragraph above it ──
KEYS = ['no', 'hostname', 'env', 'function', 'cpu', 'ram', 'swap', 'disk', 'os', 'ip']
envs = []
for i, r in tables:
    if header(r)[:2] != ['No', 'Hostname']: continue
    name = next((t for k, t in reversed(B[:i]) if k == 'p' and t and not t.startswith('{')), '')
    servers = []
    for row in r:
        if not row[0][1] or not row[0][1][0].isdigit(): continue
        v = {k: c[1] for k, c in zip(KEYS, row)}
        ips = [p.strip() for line in v['ip'] for p in line.split(',') if p.strip()]
        servers.append(dict(hostname=cell(row[1]), env=cell(row[2]), function=cell(row[3]), cpu=int(cell(row[4])), ram=cell(row[5]),
                            swap=cell(row[6]), disk=cell(row[7]), os=cell(row[8]), ip=ips if len(ips) > 1 else ips[0]))
    envs.append((name, servers))

# ── backup: Category cells are vertically merged ──
backup, status = [], set()
b = next((r for _, r in tables if header(r)[:3] == ['No', 'Category', 'Subcategory']), None)
for row in (b or [])[1:]:
    c = {k: cell(row[i]) for k, i in (('cat', 1), ('sub', 2), ('st', 3))}
    if row[1][1] and not row[1][0]: backup.append(dict(category=c['cat'], subcategories=[]))
    if c['sub']: backup[-1]['subcategories'].append(c['sub'])
    if c['st']: status.add(c['st'])

# ── write ──
o = [f'# Customer profile for {customer} ({", ".join(n for n, _ in envs if n) or environment}).',
     f'# Extracted from {src.split("/")[-1]} with scripts/extract-profile.py; check it before use.',
     '# - environments: one heading + Servers table each; the one marked `current` (default: the last) is the environment',
     '#   the health-check / topology / cassandra uploads describe',
     '# - releases is optional: the row for the version you generate is added automatically',
     '# - backup is optional: without items the table is derived from the topology groups and the API Portal hosts',
     'customer:', f'  name: {q(customer)}', f'  short: {q(short)}', f'  product: {q(product)}', f'  product_short: {q(product_short)}', f'  environment: {q(environment)}',
     'author:', f'  name: {q(author)}', f'  company: {q(company)}', '# current_version: 7.7.YYYYMMDD   # installed version (not in the report): Available Patches then lists only newer releases',
     f'doc_title: {q(ctl.get("Title", "Preventive Maintenance Report Regular"))}', 'contacts:']
o += [f'  - {flow(c)}' for c in contacts]
o += ['# Release History is generated (version + author first name + report date); list only earlier versions here:', '# releases:'] + [f'#   - {flow(r)}' for r in releases]
o += ['distribution:'] + [f'  - {flow(d)}' for d in distribution]
o += ['environments:']
for n, (name, servers) in enumerate(envs):
    o += [f'  - name: {q(name)}'] if name else ['  -']
    if len(envs) > 1 and n == len(envs) - 1: o += ['    current: true']
    o += ['    servers:'] + [f'      - {flow(s)}' for s in servers]
if backup:
    o += ['backup:'] + ([f'  status: {q(next(iter(status)))}'] if len(status) == 1 else [])
    o += ['  items:'] + sum(([f'    - category: {q(c["category"])}', '      subcategories: [' + ', '.join(json.dumps(s) for s in c['subcategories']) + ']'] for c in backup), [])
print('\n'.join(o))
