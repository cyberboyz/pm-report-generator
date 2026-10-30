"""Tidies the "CPU Load Average (15-min)" column of the Capacity and Performance tables (both variants: with / without iowait).
  - header: one centered paragraph "CPU Load Average" / "(15-min)" (explicit line break, non-breaking hyphen so it never wraps as "(15-" / "min)"),
    without the stray hanging indent and the left-aligned first line the "without iowait" table had
  - the "without iowait" table gets the TableGrid style like every other table, so its rows are no longer double height
Optional, safe to re-run:  python3 scripts/update-template-cpu-header.py templates/pm-template.docx"""
import re, sys, zipfile, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "templates/pm-template.docx"
RPR = '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/><w:noProof/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>'
PARA = (f'<w:p><w:pPr><w:contextualSpacing/><w:jc w:val="center"/>{RPR}</w:pPr>'
        f'<w:r>{RPR}<w:t>CPU Load Average</w:t><w:br/><w:t>(15</w:t><w:noBreakHyphen/><w:t>min)</w:t></w:r></w:p>')

zin = zipfile.ZipFile(SRC)
files = {n: zin.read(n) for n in zin.namelist()}; infos = {i.filename: i for i in zin.infolist()}; zin.close()
x = files['word/document.xml'].decode('utf8')
txt = lambda s: re.sub(r'<[^>]+>', '', s)
done = [0]

def fix_table(tbl):
    if '{cpu_load}' not in tbl:
        return tbl
    def fix_cell(tc):
        t = txt(tc)
        if 'CPU' not in t or 'Load Average' not in t:
            return tc
        done[0] += 1
        tcpr = re.match(r'<w:tc>(<w:tcPr>.*?</w:tcPr>)', tc, flags=re.S).group(1)
        return f'<w:tc>{tcpr}{PARA}</w:tc>'
    first_row = re.search(r'<w:tr[ >].*?</w:tr>', tbl, flags=re.S).group(0)
    new_row = re.sub(r'<w:tc>.*?</w:tc>', lambda m: fix_cell(m.group(0)), first_row, flags=re.S)
    tbl = tbl.replace(first_row, new_row, 1)
    if '<w:tblStyle ' not in tbl:
        tbl = tbl.replace('<w:tblPr>', '<w:tblPr><w:tblStyle w:val="TableGrid"/>', 1)
        done[0] += 1
    return tbl

x = re.sub(r'<w:tbl>.*?</w:tbl>', lambda m: fix_table(m.group(0)), x, flags=re.S)
files['word/document.xml'] = x.encode('utf8')
with zipfile.ZipFile(SRC + '.tmp', 'w', zipfile.ZIP_DEFLATED) as zo:
    for n, b in files.items(): zo.writestr(infos[n], b)
os.replace(SRC + '.tmp', SRC); print('ok,', done[0], 'changes')
