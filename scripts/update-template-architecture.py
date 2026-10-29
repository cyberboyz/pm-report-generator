"""Wraps the architecture picture paragraph of templates/pm-template.docx in {#has_arch}...{/has_arch}
so the sample diagram only appears when one is uploaded. Run once, optional:
    python3 scripts/update-template-architecture.py templates/pm-template.docx
"""
import re, sys, zipfile, shutil
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
def fix(x):
    for m in re.finditer(r'<w:drawing>.*?</w:drawing>', x, re.S):
        if 'r:embed="rId15"' in m.group(0):
            a = x.rfind('<w:p ', 0, m.start()); b = x.find('</w:p>', m.end()) + 6
            return x[:a] + tag('{#has_arch}') + x[a:b] + tag('{/has_arch}') + x[b:]
    raise SystemExit('architecture drawing not found (already converted?)')
tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        d = zin.read(it.filename)
        if it.filename == 'word/document.xml': d = fix(d.decode('utf8')).encode('utf8')
        zout.writestr(it, d)
shutil.move(tmp, SRC); print('updated', SRC)
