"""Rewrites the per-group SSL tables (QRCB, RTSIST, ...) of templates/pm-template.docx into an
`ssl_groups` docxtemplater loop. Optional, run once:  python3 scripts/update-template-ssl.py templates/pm-template.docx"""
import re, sys, zipfile, os
from xml.sax.saxutils import escape

SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
RPR_H = '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/><w:noProof/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
RPR_B = '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:noProof/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
SHD = '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9" w:themeFill="background1" w:themeFillShade="D9"/>'

def p(text, bold=False, h2=False):
    if h2: return f'<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>{escape(text)}</w:t></w:r></w:p>'
    rpr = '<w:rPr><w:b/><w:bCs/></w:rPr>' if bold else ''
    return f'<w:p><w:pPr><w:spacing w:after="120"/><w:ind w:left="709"/>{rpr}</w:pPr><w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'

def cell(w, text, head=False):
    return (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{SHD if head else ""}' + ('' if head else '<w:vAlign w:val="bottom"/>') + '</w:tcPr>'
            f'<w:p><w:pPr><w:contextualSpacing/><w:jc w:val="center"/>{RPR_H if head else RPR_B}</w:pPr>'
            f'<w:r>{RPR_H if head else RPR_B}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p></w:tc>')

def table(loop):
    cols = [(527, 'No', '{no}'), (3662, 'Alias', '{alias}'), (2473, 'Expiry', '{expiry}'), (1984, 'Status', '{status}')]
    grid = ''.join(f'<w:gridCol w:w="{c[0]}"/>' for c in cols)
    head = '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + ''.join(cell(c[0], c[1], True) for c in cols) + '</w:tr>'
    body = ''
    for i, c in enumerate(cols):
        t = c[2]
        if i == 0: t = '{#' + loop + '}' + t
        if i == len(cols) - 1: t += '{/' + loop + '}'
        body += cell(c[0], t)
    return ('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="8646" w:type="dxa"/><w:tblInd w:w="704" w:type="dxa"/>'
            '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{head}<w:tr><w:trPr><w:cantSplit/></w:trPr>{body}</w:tr></w:tbl>')

block = (p('{#ssl_groups}') + p('{title}', h2=True)
         + p('{#empty}') + p('No expired non-CA certificates') + p('{/empty}')
         + p('{#has_keyed}') + p('Certificates with Keys', bold=True) + table('keyed') + p('{/has_keyed}')
         + p('{#has_plain}') + p('Certificates', bold=True) + table('plain') + p('{/has_plain}')
         + '<w:p><w:pPr><w:ind w:left="709"/></w:pPr></w:p>' + p('{/ssl_groups}'))

zin = zipfile.ZipFile(SRC)
files = {n: zin.read(n) for n in zin.namelist()}; infos = {i.filename: i for i in zin.infolist()}; zin.close()
x = files['word/document.xml'].decode('utf8')
paras = list(re.finditer(r'<w:p[ >](?:(?!</w:p>).)*?</w:p>', x, flags=re.S))
txt = lambda s: re.sub(r'<[^>]+>', '', s).strip()
h1 = [m for m in paras if 'w:val="Heading1"' in m.group(0) and txt(m.group(0)).startswith('SSL Certificates')][-1]
first_h2 = next(m for m in paras if m.start() > h1.start() and 'w:val="Heading2"' in m.group(0))
tail = max(x.rfind('<w:p ', 0, x.index('<w:sectPr', first_h2.start())), x.rfind('<w:p>', 0, x.index('<w:sectPr', first_h2.start())))   # final paragraph carrying the section break
x = x[:first_h2.start()] + block + x[tail:]
files['word/document.xml'] = x.encode('utf8')
with zipfile.ZipFile(SRC + '.tmp', 'w', zipfile.ZIP_DEFLATED) as zo:
    for n, b in files.items(): zo.writestr(infos[n], b)
os.replace(SRC + '.tmp', SRC); print('ok')
