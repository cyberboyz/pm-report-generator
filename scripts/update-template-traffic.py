"""Transactions: adds a marker paragraph after each environment's summary table. The generator (lib/render.js, placeShots)
replaces it with the traffic screenshots uploaded for that environment (nothing when there are none).
Run once, optional, safe to re-run:  python3 scripts/update-template-traffic.py templates/pm-template.docx
"""
import sys, zipfile, os
SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
MARK = '<w:p><w:r><w:t>[[TXIMG:{tx_key}]]</w:t></w:r></w:p>'
END = '<w:p><w:r><w:t>{/tx_items}</w:t></w:r></w:p>'

def convert(x):
    if '[[TXIMG:' in x: return x
    i = x.index(END)
    return x[:i] + MARK + x[i:]

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for i in zin.infolist():
        d = zin.read(i.filename)
        if i.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(i, d)
os.replace(tmp, SRC)
