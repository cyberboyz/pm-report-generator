"""Aligns templates/pm-template.docx with the 30-04-2026 report layout. Run once, optional:
    python3 scripts/update-template-layout.py templates/pm-template.docx path/to/new-report.docx
 - Servers table gets Memory -> RAM + Swap (profile field `swap`)
 - the Pre-Production heading + table only appear when the profile lists `servers_preprod`
 - Capacity memory table without the iowait column is used when the health-check has no iowait
   (the original table with iowait is kept for when it does)
"""
import re, sys, zipfile, shutil

SRC, REF = sys.argv[1], sys.argv[2]
TBL = re.compile(r'<w:tbl>.*?</w:tbl>', re.S)
rows = lambda t: re.findall(r'<w:tr[ >].*?</w:tr>', t, re.S)
cells = lambda r: re.findall(r'<w:tc>.*?</w:tc>', r, re.S)
text = lambda x: re.sub(r'<[^>]+>', '', x).strip()
strip_ids = lambda x: re.sub(r' w14:(paraId|textId)="[^"]*"', '', x)
tag_p = lambda t: f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>'

def loop_row(sample_row, tags, loop):
    out = []
    for i, tc in enumerate(cells(sample_row)):
        tcpr = re.sub(r'<w:vMerge[^>]*/>', '', re.search(r'<w:tcPr>.*?</w:tcPr>', tc, re.S).group(0))
        p = re.search(r'<w:p[ >].*?</w:p>', tc, re.S).group(0)
        ppr = (re.search(r'<w:pPr>.*?</w:pPr>', p, re.S) or [''])[0] or '<w:pPr><w:contextualSpacing/><w:jc w:val="center"/></w:pPr>'
        m = re.search(r'<w:r[ >].*?(<w:rPr>.*?</w:rPr>)', p, re.S)
        rpr = m.group(1) if m else '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:noProof/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>'
        t = '{' + tags[i] + '}'
        if i == 0: t = '{#' + loop + '}' + t
        if i == len(tags) - 1: t += '{/' + loop + '}'
        out.append(f'<w:tc>{tcpr}<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{t}</w:t></w:r></w:p></w:tc>')
    return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + ''.join(out) + '</w:tr>'

def transplant(ref_tbl, header_rows, tags, loop):
    r = rows(ref_tbl)
    head = ref_tbl[:ref_tbl.index(r[0])] + ''.join(r[:header_rows])
    return strip_ids(head + loop_row(r[header_rows], tags, loop) + '</w:tbl>')

ref_x = zipfile.ZipFile(REF).read('word/document.xml').decode('utf8')
ref_tbls = TBL.findall(ref_x)
find = lambda pred: next(t for t in ref_tbls if pred([text(c) for c in cells(rows(t)[0])], t))
ref_servers = [t for t in ref_tbls if text(rows(t)[0]).startswith('NoHostname') and 'Swap' in text(rows(t)[1])][-1]   # new production
ref_mem = [t for t in ref_tbls if text(rows(t)[0]).startswith('NoServerEnvMemory') and 'iowait' not in text(t)][-1]

SERVERS = ['no', 'hostname', 'env', 'function', 'cpu', 'ram', 'swap', 'disk', 'os', 'ip']
MEM = ['no', 'server', 'env', 'mem_total', 'mem_avail', 'mem_avail_pct', 'swap_used', 'cpu_load']

def convert(x):
    ts = list(TBL.finditer(x))
    done = {}
    for m in ts:
        t = m.group(0); h = text(rows(t)[0])
        if h.startswith('NoHostnameEnvFunctionCPURAM') and '{#servers}' in t:
            done[m.start()] = (m.end(), transplant(ref_servers, 2, SERVERS, 'servers'))
        elif h.startswith('NoHostnameEnvFunctionCPURAM') and '{#servers_preprod}' in t:
            # wrap the heading paragraph before the table and the table itself
            a = x.rfind('<w:p ', 0, m.start())
            a = x.rfind('<w:p ', 0, a) if 'Pre Production' not in text(x[a:m.start()]) else a
            done[a] = (m.end(), tag_p('{#has_preprod}') + x[a:m.start()] + t + tag_p('{/has_preprod}'))
        elif h.startswith('NoServerEnvMemory') and '{#mem}' in t:
            new = transplant(ref_mem, 3, MEM, 'mem')
            done[m.start()] = (m.end(), tag_p('{#has_iowait}') + t + tag_p('{/has_iowait}') + tag_p('{#no_iowait}') + new + tag_p('{/no_iowait}'))
    out, pos = [], 0
    for s in sorted(done):
        e, rep = done[s]; out.append(x[pos:s]); out.append(rep); pos = e
    out.append(x[pos:]); return ''.join(out)

tmp = SRC + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for it in zin.infolist():
        d = zin.read(it.filename)
        if it.filename == 'word/document.xml': d = convert(d.decode('utf8')).encode('utf8')
        zout.writestr(it, d)
shutil.move(tmp, SRC); print('updated', SRC)
