"""Turns the Services List, Supported-releases and Patch tables of templates/pm-template.docx into docxtemplater loops
(services / support / gw_patches / portal_patches). Run once, optional:
    python3 scripts/update-template-services-patches.py templates/pm-template.docx
"""
import re, sys, zipfile, shutil, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
TABLES = {  # first header cell text, second header cell text -> (loop, [tags per column])
    ("No", "Service Name"): ("services", ["no", "name", "ip", "server", "zone", "port", "active"]),
    ("No", "Release"): ("support", ["no", "release", "status", "eom", "eos"]),
}
PATCH = {"apimgr": "gw_patches", "apip": "portal_patches"}

def rows(t): return re.findall(r'<w:tr[ >].*?</w:tr>', t, re.S)
def cells(r): return re.findall(r'<w:tc>.*?</w:tc>', r, re.S)
def text(x): return re.sub(r'<[^>]+>', '', x).strip()

def loop_row(sample_row, tags, loop, link_col=None):
    out = []
    for i, tc in enumerate(cells(sample_row)):
        tcpr = re.search(r'<w:tcPr>.*?</w:tcPr>', tc, re.S).group(0)
        tcpr = re.sub(r'<w:vMerge[^>]*/>', '', tcpr)
        p = re.search(r'<w:p[ >].*?</w:p>', tc, re.S).group(0)
        ppr = (re.search(r'<w:pPr>.*?</w:pPr>', p, re.S) or [''])[0] if re.search(r'<w:pPr>', p) else '<w:pPr><w:contextualSpacing/><w:jc w:val="center"/></w:pPr>'
        ppr = re.sub(r'<w:pPr>', '<w:pPr>', ppr)
        rpr = '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:noProof/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
        m = re.search(r'<w:r[ >].*?(<w:rPr>.*?</w:rPr>)', p, re.S)
        if m: rpr = m.group(1)
        if i == link_col: rpr = rpr.replace('<w:rPr>', '<w:rPr><w:rStyle w:val="Hyperlink"/>', 1)
        t = '{' + tags[i] + '}'
        if i == 0: t = '{#' + loop + '}' + t
        if i == len(tags) - 1: t += '{/' + loop + '}'
        out.append(f'<w:tc>{tcpr}<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{t}</w:t></w:r></w:p></w:tc>')
    return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + ''.join(out) + '</w:tr>'

def convert(tbl):
    r = rows(tbl)
    h = [text(c) for c in cells(r[0])]
    loop = tags = link = None
    key = tuple(h[:2])
    if key in TABLES: loop, tags = TABLES[key]
    elif key == ("No", "Patch Name"):
        kind = re.search(r'_(apimgr|apip)_relnotes', ''.join(r[1:]))
        loop, tags, link = PATCH[kind.group(1)], ["no", "name", "url"], 2
    else: return tbl
    body = loop_row(r[1], tags, loop, link)
    head = tbl[:tbl.index(r[0])] + r[0]
    return head + body + '</w:tbl>'

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'word/document.xml':
            x = data.decode('utf8')
            x = re.sub(r'<w:tbl>.*?</w:tbl>', lambda m: convert(m.group(0)), x, flags=re.S)
            data = x.encode('utf8')
        zout.writestr(item, data)
shutil.move(tmp, SRC)
print('updated', SRC)
