"""1) Gives the environment sub-headings of Services List, Capacity, Topology, Cassandra, SSL and Summary a normal gap above them
      from the second environment on (the first one stays close to its section heading): the heading paragraph becomes
      {#first} ...small gap... {/first}{#later} ...large gap... {/later}.
   2) Renames the section "SSL Certificates" to "TLS/SSL Certificates".
Run once, optional:  python3 scripts/update-template-env-spacing.py templates/pm-template.docx"""
import re, sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
PARA = re.compile(r'<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>.*?</w:p>', re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
def name(before):
    return (f'<w:p><w:pPr><w:keepNext/><w:spacing w:before="{before}" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
            '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')
REPL = tag('{#first}') + name(120) + tag('{/first}') + tag('{#later}') + name(480) + tag('{/later}')

def convert(x):
    if '{#later}' not in x:
        ms = list(PARA.finditer(x)); skip = {k + 1 for k, m in enumerate(ms) if text(m.group(0)) in ('{#new_page}', '{^new_page}')}  # the Servers section has its own page-break headings
        out, last = [], 0
        for k, m in enumerate(ms):
            if k not in skip and text(m.group(0)) == '{name}' and '<w:keepNext/><w:spacing' in m.group(0) and 'w:val="24"' in m.group(0):
                out += [x[last:m.start()], REPL]; last = m.end()
        x = ''.join(out) + x[last:]
    return x.replace('>SSL Certificates', '>TLS/SSL Certificates')

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
print('updated', SRC)
