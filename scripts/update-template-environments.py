"""Environments, Backup and Transactions in templates/pm-template.docx. Run once, optional:
    python3 scripts/update-template-environments.py templates/pm-template.docx
 - Servers: one heading + table per entry of the profile's `environments` (replaces the DC-DRC / Pre-Production pair);
   every environment after the first starts on a new page so its table is not split
 - Backup: the hand-made table (blank rows, empty Environment column, customer groups) becomes `{@backup_table}`,
   built in lib/backup.js and left out when there is nothing to list
 - Transactions: emptied, only the heading stays (sample sentence and chart removed, including the picture in the package)
 - the empty Heading 1 and the page-break paragraphs in front of these headings become `pageBreakBefore`
"""
import re, sys, zipfile, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
PARA = re.compile(r'<w:p(?: [^>]*?)?/>|<w:p(?: [^>]*)?>.*?</w:p>', re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
tag = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'
NAME = lambda brk: ('<w:p><w:pPr><w:keepNext/>' + ('<w:pageBreakBefore/>' if brk else '') + '<w:spacing w:before="120" w:after="120"/><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>'
                    '<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>{name}</w:t></w:r></w:p>')

def heading(x, title):
    """(start, end) of the last Heading 1 paragraph with this text"""
    hit = [m for m in PARA.finditer(x) if 'w:val="Heading1"' in m.group(0) and text(m.group(0)) == title]
    return hit[-1].span()

def page_break_before(p):
    return p if 'pageBreakBefore' in p else re.sub(r'(<w:pStyle [^>]*/>(?:<w:keepNext/>)?(?:<w:keepLines/>)?)', r'\1<w:pageBreakBefore/>', p, 1)

def convert(x):
    # ── Servers ──
    if '{#environments}' not in x:
        _, h_end = heading(x, 'Servers')
        ps = [m for m in PARA.finditer(x, h_end)]
        start = next(m.start() for m in ps if text(m.group(0)) == 'DC-DRC')
        end = next(m.end() for m in ps if text(m.group(0)) == '{/has_preprod}')
        table = re.search(r'<w:tbl>.*?</w:tbl>', x[start:end], re.S).group(0)
        assert '{#servers}' in table
        x = x[:start] + tag('{#environments}') + tag('{#has_name}') + tag('{#new_page}') + NAME(True) + tag('{/new_page}') + tag('{^new_page}') + NAME(False) + tag('{/new_page}') + tag('{/has_name}') + table + '<w:p/>' + tag('{/environments}') + x[end:]
    # ── Backup / Transactions / Summary ──
    if '{@backup_table}' not in x:
        b_s, b_e = heading(x, 'Backup'); t_s, t_e = heading(x, 'Transactions'); s_s, s_e = heading(x, 'Summary')
        # drop the empty Heading 1 + page-break paragraphs that sit between the last table before Backup and the heading
        gap_s = x.rindex('</w:tbl>', 0, b_s) + len('</w:tbl>')
        stray = PARA.findall(x[gap_s:b_s]); assert all(not text(p) for p in stray), 'unexpected text before Backup'
        new = (x[:gap_s] + page_break_before(x[b_s:b_e])
               + tag('{#has_backup}') + tag('{@backup_table}') + tag('{/has_backup}')
               + page_break_before(x[t_s:t_e])          # Transactions: heading only
               + page_break_before(x[s_s:s_e]) + x[s_e:])
        x = new
    return x

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin:
    files = {i.filename: (i, zin.read(i.filename)) for i in zin.infolist()}
doc = convert(files['word/document.xml'][1].decode('utf8'))
files['word/document.xml'] = (files['word/document.xml'][0], doc.encode('utf8'))
# the Transactions sample chart is no longer referenced: remove it from the package
rels = files['word/_rels/document.xml.rels'][1].decode('utf8')
for rid in re.findall(r'<Relationship [^>]*Id="(rId\d+)"[^>]*Target="(media/[^"]+)"', rels):
    if f'r:embed="{rid[0]}"' not in doc and rid[1] not in ('media/image1.jpeg',) and 'architecture' not in rid[1]:
        if rid[0] == 'rId15': continue          # architecture diagram: handled by render.js
        rels = re.sub(rf'<Relationship [^>]*Id="{rid[0]}"[^>]*/>', '', rels)
        files.pop('word/' + rid[1], None)
        print('removed', rid[1])
files['word/_rels/document.xml.rels'] = (files['word/_rels/document.xml.rels'][0], rels.encode('utf8'))
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zo:
    for n, (info, data) in files.items(): zo.writestr(info, data)
os.replace(tmp, SRC); print('updated', SRC)
