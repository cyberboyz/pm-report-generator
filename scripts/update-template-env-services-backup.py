"""Services List and Backup repeat for every environment in the profile (like Capacity, Topology, Cassandra, Summary).
The Services List table and the Backup block are wrapped in {#env_blocks} ... {/env_blocks} and start with the environment name
(omitted for an unnamed one). Needs update-template-env-sections.py to have been run first (it adds the name heading).
Run once, optional:  python3 scripts/update-template-env-services-backup.py templates/pm-template.docx
"""
import re, sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
NAME = ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
        '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')
HEAD = tag('{#env_blocks}') + tag('{#has_name}') + NAME + tag('{/has_name}')
TAIL = tag('{/env_blocks}')

def convert(x):
    if x.count('{#env_blocks}') != 4:
        sys.exit("run update-template-env-sections.py first (expected 4 {#env_blocks} loops, found %d)" % x.count('{#env_blocks}'))
    # Backup first (it is later in the document, so the Services offsets stay valid)
    s = x.index(tag('{#has_backup}')); e = x.index(tag('{/has_backup}')) + len(tag('{/has_backup}'))
    x = x[:s] + HEAD + x[s:e] + TAIL + x[e:]
    # Services List: only the table repeats
    i = x.index('{#services}')
    ts = x.rindex('<w:tbl>', 0, i); te = x.index('</w:tbl>', i) + len('</w:tbl>')
    return x[:ts] + HEAD + x[ts:te] + TAIL + x[te:]

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'word/document.xml':
            data = convert(data.decode('utf8')).encode('utf8')
        zout.writestr(item, data)
os.replace(tmp, SRC)
print("done:", SRC)
