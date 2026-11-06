"""Services List repeats for every environment in the profile (like Capacity, Topology, Cassandra and Summary):
the table is wrapped in {#svc_blocks} ... {/svc_blocks}, starts with the environment name and is followed by a spacer paragraph
so consecutive environments never touch (and Word never fuses two tables into one).
Run once, optional:  python3 scripts/update-template-services-envs.py templates/pm-template.docx
"""
import re, sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
PARA = re.compile(r'<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>.*?</w:p>', re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
NAME = ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
        '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')
SPACER = '<w:p><w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr></w:p>'

def convert(x):
    if '{#svc_blocks}' in x: return x
    h = next(m for m in PARA.finditer(x) if 'w:val="Heading1"' in m.group(0) and text(m.group(0)) == "Services List")
    t0 = x.index('<w:tbl>', h.end()); t1 = x.index('</w:tbl>', t0) + len('</w:tbl>')
    block = tag('{#svc_blocks}') + tag('{#has_name}') + NAME + tag('{/has_name}') + x[t0:t1] + SPACER + tag('{/svc_blocks}')
    return x[:t0] + block + x[t1:]

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
print('updated', SRC)
