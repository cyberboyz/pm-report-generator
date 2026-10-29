"""Rewrites the Topology and Cassandra sections of templates/pm-template.docx
into docxtemplater loops (topologies / cassandra). Run once, optional:
    python3 scripts/update-template-sections.py templates/pm-template.docx
"""
import re, sys, zipfile, shutil, os
from xml.sax.saxutils import escape

SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
RPR_H = '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/><w:noProof/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
RPR_B = '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:noProof/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
SHD = '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9" w:themeFill="background1" w:themeFillShade="D9"/>'

def p(text, before=0, bold=False):
    rpr = '<w:rPr><w:b/><w:bCs/></w:rPr>' if bold else ''
    sp = f'<w:spacing w:before="{before}" w:after="0"/>' if before else '<w:spacing w:after="0"/>'
    return f'<w:p><w:pPr>{sp}{rpr}</w:pPr><w:r>{rpr}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'

def cell(w, text, head=False):
    return (f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{SHD if head else ""}</w:tcPr>'
            f'<w:p><w:pPr><w:contextualSpacing/><w:jc w:val="center"/>{RPR_H if head else RPR_B}</w:pPr>'
            f'<w:r>{RPR_H if head else RPR_B}<w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p></w:tc>')

def table(cols, loop):
    """cols: [(width, header, body-tag)]; loop: name of the row loop"""
    total = sum(c[0] for c in cols)
    grid = ''.join(f'<w:gridCol w:w="{c[0]}"/>' for c in cols)
    head = '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + ''.join(cell(c[0], c[1], True) for c in cols) + '</w:tr>'
    body = ''
    for i, c in enumerate(cols):
        t = c[2]
        if i == 0: t = '{#' + loop + '}' + t
        if i == len(cols) - 1: t = t + '{/' + loop + '}'
        body += cell(c[0], t)
    return (f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="{total}" w:type="dxa"/>'
            '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{head}<w:tr><w:trPr><w:cantSplit/></w:trPr>{body}</w:tr></w:tbl>')

topology = (
    p('{#topologies}') + p('{label}', 240, True) + p('Version: {version}') + p('Last updated: {updated}') + p('Domain ID: {domain}') + p('')
    + p('Hosts') + table([(480, 'No', '{no}'), (8871, 'Host', '{host}')], 'hosts')
    + p('Admin Node Managers', 240) + table([(480, 'No', '{no}'), (8871, 'Admin Node Managers', '{item}')], 'admins')
    + p('{#has_nms}') + p('Node Managers', 240) + table([(480, 'No', '{no}'), (8871, 'Node Managers', '{item}')], 'nms') + p('{/has_nms}')
    + p('Groups', 240) + table([(480, 'No', '{no}'), (2492, 'Group', '{group}'), (6379, 'Instance', '{instances}')], 'groups')
    + p('{/topologies}')
)
cassandra = (
    p('{#cassandra}') + p('{label}', 240, True)
    + table([(472, 'No', '{no}'), (1483, 'IP Address', '{ip}'), (1033, 'Load', '{load}'), (841, 'Tokens', '{tokens}'),
             (838, 'Owns', '{owns}'), (1717, 'Host ID', '{host_id}'), (790, 'Rack', '{rack}'), (891, 'State', '{state}'),
             (1286, 'Last Repair', '{last_repair}')], 'nodes')
    + p('{/cassandra}')
)

def heading_end(x, title):
    for m in re.finditer(r'<w:p[ >](?:(?!</w:p>).)*?</w:p>', x, flags=re.S):
        s = m.group(0)
        if 'w:val="Heading1"' in s and re.sub(r'<[^>]+>', '', s).strip() == title:
            last = m
    return last.end(), last.start()

zin = zipfile.ZipFile(SRC)
files = {n: zin.read(n) for n in zin.namelist()}
infos = {i.filename: i for i in zin.infolist()}
zin.close()
x = files['word/document.xml'].decode('utf8')
t_end, _ = heading_end(x, 'Topology / Architecture')
_, c_start = heading_end(x, 'Cassandra')
c_end, _ = heading_end(x, 'Cassandra')
_, s_start = heading_end(x, 'SSL Certificates (Only Show Expired or Expiring in 3 Months)')
x = x[:t_end] + topology + x[c_start:c_end] + cassandra + x[s_start:]
files['word/document.xml'] = x.encode('utf8')
tmp = SRC + '.tmp'
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zo:
    for n, b in files.items(): zo.writestr(infos[n], b)
os.replace(tmp, SRC)
print('ok')
