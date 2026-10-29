"""Turns the original PM report .docx into a docxtemplater template.
Usage: python scripts/make-template.py original.docx templates/pm-template.docx"""
import re, sys, zipfile, os, tempfile
src, out = sys.argv[1], sys.argv[2]
tmp = tempfile.mkdtemp(); zipfile.ZipFile(src).extractall(tmp)
P = os.path.join(tmp, 'word/document.xml'); d = open(P, encoding='utf8').read()

def rebuild_p(p, text):
    head = re.match(r'<w:p(?: [^>]*)?>', p).group(0)
    m = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S); ppr = m.group(0) if m else ''
    run = next((r for r in re.findall(r'<w:r[ >].*?</w:r>', p, re.S) if '<w:t' in r), '')
    m = re.search(r'<w:rPr>.*?</w:rPr>', run, re.S); rpr = m.group(0) if m else ''
    rpr = rpr.replace('<w:rStyle w:val="Hyperlink"/>', '')
    return f'{head}{ppr}<w:r>{rpr}<w:t>{text}</w:t></w:r></w:p>'

def rebuild_cell(tc, text):
    m = re.search(r'<w:tcPr>.*?</w:tcPr>', tc, re.S); tcpr = m.group(0) if m else ''
    p = re.search(r'<w:p[ >].*?</w:p>', tc, re.S).group(0)
    return f'<w:tc>{tcpr}{rebuild_p(p, text)}</w:tc>'

def loop_table(t, name, fields, hdr=1):
    rows = re.findall(r'<w:tr[ >].*?</w:tr>', t, re.S)
    data = rows[hdr]
    cells = re.findall(r'<w:tc>.*?</w:tc>', data, re.S)
    assert len(cells) == len(fields), (name, len(cells))
    new = []
    for i, (c, f) in enumerate(zip(cells, fields)):
        txt = '{' + f + '}'
        if i == 0: txt = '{#' + name + '}' + txt
        if i == len(cells) - 1: txt += '{/' + name + '}'
        new.append(re.sub(r'<w:vMerge[^>]*/>|<w:gridSpan[^>]*/>', '', rebuild_cell(c, txt)))
    row_open = re.match(r'<w:tr(?: [^>]*)?>(<w:trPr>.*?</w:trPr>)?', data, re.S).group(0)
    return t[:t.find(rows[0])] + ''.join(rows[:hdr]) + row_open + ''.join(new) + '</w:tr></w:tbl>'

def set_text(t, old, new):
    for p in re.findall(r'<w:p[ >].*?</w:p>', t, re.S):
        if re.sub(r'<[^>]+>', '', p).strip() == old:
            return t.replace(p, rebuild_p(p, new), 1)
    raise SystemExit('not found: ' + old)

tbls = [(m.start(), m.end()) for m in re.finditer(r'<w:tbl>.*?</w:tbl>', d, re.S)]
T = lambda i: d[tbls[i][0]:tbls[i][1]]
rep = {}
t = T(0)
for o, n in [('Fattah Azzuhry Rahadian', '{author_name}'), ('25/02/2026', '{date_short}'), ('1.0', '{version}')]:
    t = set_text(t, o, n)
rep[0] = t
t = T(2)
for o, n in [('PT Rintis Sejahtera', '{customer}'), ('Preventive Maintenance Report Regular', '{doc_title}'),
             ('Fattah Azzuhry Rahadian', '{author_name}'),
             ('[Rintis] – Preventive Maintenance – Axway APIM (Production Environment) 25-02-2026', '{file_name}')]:
    t = set_text(t, o, n)
rep[2] = t
rep[1] = loop_table(T(1), 'contacts', ['no', 'name', 'position', 'email'])
rep[3] = loop_table(T(3), 'releases', ['version', 'author', 'date', 'description'])
rep[4] = loop_table(T(4), 'distribution', ['name', 'org', 'note'])
cols = ['no', 'hostname', 'env', 'function', 'cpu', 'ram', 'disk', 'os', 'ip']
rep[5] = loop_table(T(5), 'servers', cols)
rep[6] = loop_table(T(6), 'servers_preprod', cols)
rep[8] = loop_table(T(8), 'mem', ['no','server','env','mem_total','mem_avail','mem_avail_pct','swap_used','cpu_load','iowait'], 3)
rep[9] = loop_table(T(9), 'disk', ['no','server','env','mount','total','used','avail','avail_pct'], 2)
rep[31] = loop_table(T(31), 'summary', ['no','server','env','mem_status','hdd_status','cpu_status'], 2)
rep[32] = loop_table(T(32), 'notes', ['no','item','server','impact','solution'])
for i in sorted(rep, reverse=True):
    d = d[:tbls[i][0]] + rep[i] + d[tbls[i][1]:]
d = set_text(d, 'Preventive Maintenance Document - Axway APIM Rintis',
             'Preventive Maintenance Document - {product_short} {customer_short}')
d = set_text(d, 'Axway API Management for PT Rintis Sejahtera in Production',
             '{product} for {customer} in {environment}')
open(P, 'w', encoding='utf8').write(d)
S = os.path.join(tmp, 'word/settings.xml'); s = open(S, encoding='utf8').read()
if 'updateFields' not in s:
    s = re.sub(r'(<w:settings[^>]*>)', r'\1<w:updateFields w:val="true"/>', s, 1); open(S, 'w', encoding='utf8').write(s)
if os.path.exists(out): os.remove(out)
z = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
names = ['[Content_Types].xml'] + [os.path.relpath(os.path.join(r, f), tmp) for r, _, fs in os.walk(tmp) for f in fs]
for n in dict.fromkeys(names): z.write(os.path.join(tmp, n), n)
z.close(); print('ok', out)
