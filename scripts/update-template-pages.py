"""1) Every main section heading (Heading1) starts on a new page (the ones that already did are left alone).
   2) The gap above the 2nd, 3rd ... environment sub-heading is 24 pt instead of the earlier 48 pt.
Run once, optional:  python3 scripts/update-template-pages.py templates/pm-template.docx"""
import re, sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
SECTIONS = ("Introduction", "Architecture", "Servers", "Services List", "Capacity and Performance", "Topology / Architecture",
            "Cassandra", "TLS/SSL Certificates", "SSL Certificates", "Available Patches", "Backup", "Transactions", "Summary")
PARA = re.compile(r'<w:p(?: [^>]*)?>.*?</w:p>', re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()

def convert(x):
    def fix(m):
        p = m.group(0)
        if '<w:pStyle w:val="Heading1"/>' in p and 'pageBreakBefore' not in p and text(p).startswith(SECTIONS):
            p = p.replace('<w:pStyle w:val="Heading1"/>', '<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>', 1)
        return p
    x = PARA.sub(fix, x)
    return x.replace('<w:spacing w:before="960" w:after="120"/>', '<w:spacing w:before="480" w:after="120"/>')

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
print('updated', SRC)
