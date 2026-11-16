"""Backup repeats for every environment in the profile (like Services List, SSL, Capacity ...): the {#has_backup}{@backup_table}{/has_backup}
block is wrapped in {#backup_blocks} ... {/backup_blocks} and starts with the environment name (omitted for an unnamed one),
so "Old Production", "New Production", "FICT" ... each get their own heading + table (built in lib/backup.js).
Run once, optional:  python3 scripts/update-template-backup-envs.py templates/pm-template.docx
(replaces the older update-template-env-services-backup.py, which wrapped Backup in {#env_blocks})
"""
import sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
def name(before):
    return ('<w:p><w:pPr><w:keepNext/><w:spacing w:before="%d" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
            '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>' % before)
HEAD = (tag('{#backup_blocks}') + tag('{#has_name}') + tag('{#first}') + name(120) + tag('{/first}') + tag('{#later}') + name(480) + tag('{/later}') + tag('{/has_name}'))

def convert(x):
    if '{#backup_blocks}' in x: return x
    s = x.index(tag('{#has_backup}')); e = x.index(tag('{/has_backup}')) + len(tag('{/has_backup}'))
    return x[:s] + HEAD + x[s:e] + tag('{/backup_blocks}') + x[e:]

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
print('updated', SRC)
