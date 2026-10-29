"""Capacity and Performance, Topology / Architecture, Cassandra and Summary repeat for every environment in the profile.
Each section body is wrapped in {#env_blocks} ... {/env_blocks} and starts with the environment name (omitted for an unnamed one).
Run once, optional:  python3 scripts/update-template-env-sections.py templates/pm-template.docx
"""
import re, sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
PARA = re.compile(r'<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>.*?</w:p>', re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
NAME = ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
        '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')
SECTIONS = ["Capacity and Performance", "Topology / Architecture", "Cassandra", "Summary"]

def h1s(x): return [m for m in PARA.finditer(x) if 'w:val="Heading1"' in m.group(0) and text(m.group(0))]

def convert(x):
    if '{#env_blocks}' in x: return x
    for title in reversed(SECTIONS):          # last first, so earlier offsets stay valid
        hs = h1s(x)
        i = next(k for k, m in enumerate(hs) if text(m.group(0)) == title)
        start = hs[i].end()
        end = hs[i + 1].start() if i + 1 < len(hs) else x.index('<w:sectPr', start)
        if title == "Summary":  # only the status table repeats; the notes ("Beberapa hal ...") are written once
            end = next(m.start() for m in PARA.finditer(x, start) if text(m.group(0)).startswith("Beberapa"))
        x = x[:start] + tag('{#env_blocks}') + tag('{#has_name}') + NAME + tag('{/has_name}') + x[start:end] + tag('{/env_blocks}') + x[end:]
    return x

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
