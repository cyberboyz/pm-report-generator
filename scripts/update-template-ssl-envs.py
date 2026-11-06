"""SSL Certificates repeat for every environment: the {#ssl_groups} loop is wrapped in {#ssl_envs} ... {/ssl_envs} and starts with the
environment name (omitted for an unnamed one). Run once, optional:  python3 scripts/update-template-ssl-envs.py templates/pm-template.docx
"""
import re, sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
PARA = re.compile(r'<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>.*?</w:p>', re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
NAME = ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
        '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')

def convert(x):
    if '{#ssl_envs}' in x: return x
    s = next(m for m in PARA.finditer(x) if text(m.group(0)) == '{#ssl_groups}')
    e = next(m for m in PARA.finditer(x, s.end()) if text(m.group(0)) == '{/ssl_groups}')
    return x[:s.start()] + tag('{#ssl_envs}') + tag('{#has_name}') + NAME + tag('{/has_name}') + x[s.start():e.end()] + tag('{/ssl_envs}') + x[e.end():]

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
print('updated', SRC)
