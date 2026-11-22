# The generic half of the private gm:sheets step (RK33 of the room key build). It reads a PDF of playbook sheets with PyMuPDF and writes, per page:
#   page-NN.svg       the page as an SVG with its text as paths (needs no fonts, sharp at any zoom), minified
#   page-NN.raw.json  the sheet map found by reading the page's own text boxes and drawings (no hand measuring)
# and, given the FINAL maps (the raw map with any hand fixes put in), a proof picture of every page with every region outlined.
#
# It holds no art and no book text. The only words it knows are the names of the regions a sheet map needs (STRESS, XP, ITEMS...), the twelve action names,
# and the geometry of the sheet's grid. Everything it writes goes into the folders it is given (scripts/gm-sheets.mjs gives it a work folder and a proofs
# folder under the GM's private _sheets folder, never inside the repository).
#
#   python -I scripts/lib/sheets-map.py extract --pdf <pdf> --work <dir> [--pages 1,2,3]
#   python -I scripts/lib/sheets-map.py proof   --pdf <pdf> --work <dir> --out <dir> [--pages 1,2,3]    (reads <work>/final-NN.json)
#   python -I scripts/lib/sheets-map.py probe   --pdf <pdf>        prints the page count and each page's size, nothing else
#
# `-I` ignores PYTHONIOENCODING, so stdout is reconfigured here. stdout carries one JSON line per command; errors go to stderr with exit 2.
#
# THE MAP SCHEMA (version 1). Rectangles are [x0, y0, x1, y1] in PDF points on the page's own box (the SVG's viewBox is the same box, 841.89 x 595.28 for A4
# landscape). RK32's page.js draws from it. Region keys sit at the top level, as the design's prototype map did:
#   header   v: 1, playbook: <id, set by gm-sheets.mjs>, page: <1-based>, size: [w, h], kinds: { region: kind }
#   kinds    box (a tick box or a capsule), dot (a round mark), diamond, clock, text (a writing line to put words on), mark (a triangle before a name)
#   stress   [rect...]                            the Stress / Drain / Instability boxes, left to right
#   xp       [rect...]  xpi, xpp, xpr             the playbook's xp boxes, and the Insight, Prowess and Resolve xp boxes
#   acts     { Action: { l: rect, d: [rect...] } }   the label and the dots of each of the twelve actions
#   ab       [{ n, b: [rect...], k: rect }]       the special abilities: name, its bubble(s), the block of the page its text takes
#   items    [{ n, s: [rect...], l: rect, i }]    each item line: name, its load squares (their count is the load), the line, i = 1 when it is printed in italics
#                                                 (an item that takes no load: it still has one tick box)
#   stacks, bank  [rect...]                       the diamonds
#   harm     [{ level, name, label, write }]      a writing line for each harm line
#   heal     rect                                 the healing (or repair) clock
#   res      [{ name, squares: [rect...] }]       the resources column (Armor, the playbook's own)
#   keys     [{ hits: [rect...], write, burst }]  four rows: the hit marks, the writing line, the deadlock burst
#   friends  [{ n, m: [rect...] }]                each friend or rival: name, the marks before it
#   coh      { weak, impaired, broken, armor }    a cohort's or pet's harm and armour boxes
#   id       { crew, name, alias, look, wearing, heritage, background, vice }   the writing lines of the identity block
#   load     { quiet, loud }                      the Quiet and Loud labels
# A hand-written fix file may set or replace any of these and add its own regions (scripts/gm-sheets.mjs merges it before it checks the counts).
import sys, os, re, json, argparse

SCHEMA = 1
ACTIONS = ['Hunt', 'Study', 'Survey', 'Tinker', 'Finesse', 'Prowl', 'Skirmish', 'Wreck', 'Attune', 'Command', 'Consort', 'Sway']
KINDS = {'stress': 'box', 'xp': 'box', 'xpi': 'box', 'xpp': 'box', 'xpr': 'box', 'acts': 'dot', 'ab': 'dot', 'items': 'box', 'stacks': 'diamond', 'bank': 'diamond',
         'harm': 'text', 'heal': 'clock', 'res': 'box', 'keys': 'box', 'friends': 'mark', 'coh': 'box', 'id': 'text', 'load': 'text'}
ATTR_XP = [('xpi', 0), ('xpp', 1), ('xpr', 2)]          # the three XP labels in the action column, top to bottom
WHITE = (1.0, 1.0, 1.0)
BLACK = (0.0, 0.0, 0.0)


def R(r):
    return [round(r[0], 1), round(r[1], 1), round(r[2], 1), round(r[3], 1)]


def cy(r):
    return (r[1] + r[3]) / 2


def lines_of(p):
    out = []
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            t = ''.join(s['text'] for s in l['spans']).strip()
            if t:
                out.append({'t': t, 'r': list(l['bbox']), 'bold': any('Bold' in s['font'] or 'Black' in s['font'] for s in l['spans'][:2]), 'ital': any('Italic' in s['font'] or 'Oblique' in s['font'] for s in l['spans'])})
    return out


def shapes_of(p):
    out = []
    for g in p.get_drawings():
        r = g['rect']
        if r.width > 40 or r.height > 40:
            continue
        out.append({'r': [r.x0, r.y0, r.x1, r.y1], 'w': r.width, 'h': r.height, 'fill': g.get('fill'), 'stroke': g.get('color'), 'n': len(g['items']),
                    'k': g['items'][0][0] if g['items'] else ''})
    return out


def dedupe(rs, tol=1.5):
    out = []
    for r in sorted(rs, key=lambda r: (round(r[1]), r[0])):
        if not any(abs(r[0] - o[0]) < tol and abs(r[1] - o[1]) < tol for o in out):
            out.append(r)
    return out


def find(ls, pat, x_min=-1, x_max=9999, y_min=-1, y_max=9999):
    rx = re.compile(pat)
    c = [l for l in ls if rx.search(l['t']) and x_min <= l['r'][0] <= x_max and y_min <= l['r'][1] <= y_max]
    return c[0] if c else None


def band(sh, row, x0, x1, test, tol=6):
    return dedupe(sorted([s['r'] for s in sh if x0 <= s['r'][0] <= x1 and abs(cy(s['r']) - cy(row)) <= tol and test(s)], key=lambda r: r[0]))


def size_is(s, w0, w1, h0, h1):
    return w0 < s['w'] < w1 and h0 < s['h'] < h1


def slant(s):
    """A mark of the second style some pages use: a slanted, narrow box (about 5 x 14) in place of the upright capsule or tick box."""
    return size_is(s, 4.5, 6.5, 13, 15.5)


def title_of(p):
    best = (0, '')
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                if s['size'] > best[0] and s['text'].strip():
                    best = (s['size'], s['text'].strip())
    return best[1]


def build(p, idx):
    """The raw sheet map of one page. Finders are by size and place, not by colour, so a box drawn as a white fill plus a stroke (two drawings) or as a black glyph
    (a struck mark) is still found once (dedupe puts the pieces of one mark together)."""
    ls, sh = lines_of(p), shapes_of(p)
    m = {'v': SCHEMA, 'page': idx + 1, 'size': [round(p.rect.width, 2), round(p.rect.height, 2)], 'title': title_of(p), 'warn': []}
    # stress (Drain, Instability): the tall capsules on the label's row
    st = find(ls, r'^(STRESS|DRAIN|INSTABILITY)\b', 0, 300)
    if st:
        m['stress'] = [R(r) for r in band(sh, st['r'], st['r'][0], st['r'][2] + 180, lambda s: size_is(s, 9, 12, 16, 19) or slant(s), 8)]
    # the xp boxes: the playbook's (the XP label in the abilities head) and the three attributes' (the XP labels in the action column)
    xbox = lambda s: size_is(s, 6.5, 8.6, 11, 15) or slant(s)
    xp = find(ls, r'^XP$', 560, 700, 0, 120)
    if xp:
        m['xp'] = [R(r) for r in band(sh, xp['r'], xp['r'][2], xp['r'][2] + 80, xbox)]
    ax = sorted([l for l in ls if l['t'] == 'XP' and l['r'][0] > 720], key=lambda l: l['r'][1])
    for key, i in ATTR_XP:
        if i < len(ax):
            m[key] = [R(r) for r in band(sh, ax[i]['r'], ax[i]['r'][2], ax[i]['r'][2] + 60, xbox)]
    # the action dots: small circles on each action's row, left of its name
    m['acts'] = {}
    for a in ACTIONS:
        l = find(ls, '^' + a + r'\b', 740)
        if not l:
            m['warn'].append('no action ' + a)
            continue
        dots = band(sh, l['r'], l['r'][0] - 60, l['r'][0], lambda s: size_is(s, 5, 7, 5, 7) and s['k'] == 'c', 4)
        m['acts'][a] = {'l': R(l['r']), 'd': [R(r) for r in dots]}
    # the special abilities: each round bubble in the abilities column, joined to the line it starts
    bubbles = dedupe([s['r'] for s in sh if 7 < s['w'] < 9.5 and abs(s['w'] - s['h']) < .7 and s['k'] == 'c' and 420 < s['r'][0] < 470])
    rows = {}
    for b in bubbles:
        rows.setdefault(round(cy(b)), []).append(b)
    abl = []
    for y, bs in sorted(rows.items()):
        line = min((l for l in ls if abs(cy(l['r']) - y) < 5 and 440 < l['r'][0] < 462), key=lambda l: abs(cy(l['r']) - y), default=None)
        name = line['t'].split(':')[0].strip() if line and ':' in line['t'] else (line['t'] if line else '?')
        abl.append({'n': name, 'b': [R(b) for b in sorted(bs)], 'line': R(line['r']) if line else None})
    for i, a in enumerate(abl):
        top = a['line'][1] if a['line'] else a['b'][0][1]
        bot = (abl[i + 1]['line'][1] if i + 1 < len(abl) and abl[i + 1]['line'] else top + 12) - 1
        a['k'] = [430, round(top - 1, 1), 680, round(bot, 1)]
        a.pop('line')
    m['ab'] = abl
    # items: every line in the items column, with the squares to its left (their count is the item's load)
    it = find(ls, r'^ITEMS$', 690)
    items = []
    if it:
        for l in ls:
            if l['r'][0] > 695 and l['r'][1] > it['r'][3] + 4 and not re.match(r'^(x2|\d|ITEMS)', l['t']):
                sq = band(sh, l['r'], 695, l['r'][0], lambda s: size_is(s, 6.5, 8, 6.5, 8) and s['fill'] == BLACK, 3.5)
                sq = dedupe(sq, 4)          # a page may carry a second, offset copy of a square under the first
                items.append({'n': l['t'], 's': [R(r) for r in sq], 'l': R(l['r']), 'i': 1 if l['ital'] else 0})
        m['load'] = {}
        q, lo = find(ls, r'QUIET', 720), find(ls, r'LOUD', 760)
        if q:
            m['load']['quiet'] = R(q['r'])
        if lo:
            m['load']['loud'] = R(lo['r'])
    m['items'] = items
    # stacks (the diamonds on the label's row) and the bank (the diamonds under BANK)
    sk = find(ls, r'^STACKS$')
    if sk:
        dia = lambda s: size_is(s, 6.5, 8, 6.5, 8) and s['k'] == 'l' and s['n'] > 15
        m['stacks'] = [R(r) for r in band(sh, sk['r'], sk['r'][2], sk['r'][2] + 70, dia, 5)]
        m['bank'] = [R(r) for r in dedupe([s['r'] for s in sh if dia(s) and sk['r'][3] + 4 < s['r'][1] < sk['r'][3] + 80 and s['r'][0] > 690])]
    # harm: a writing line after each level's label, to the next label on that row. Only inside the harm block (below its HARM heading), so a numbered
    # question elsewhere on the page is not taken for a harm line.
    hh = find(ls, r'^(HARM|DAMAGE)$', 0, 300)
    harm = []
    for l in ls:
        mm = re.match(r'^([1-4])\. (\w+)', l['t'])
        if not mm or l['r'][0] > 300 or l['t'].endswith('?') or not hh or not (hh['r'][3] - 2 < l['r'][1] < hh['r'][3] + 80):
            continue
        right = [o['r'][0] for o in ls if o is not l and abs(cy(o['r']) - cy(l['r'])) < 4 and o['r'][0] > l['r'][2] + 4]
        x1 = min(min(right) - 8 if right else 345, 345)
        harm.append({'level': int(mm.group(1)), 'name': mm.group(2), 'label': R(l['r']), 'write': [round(l['r'][2] + 6, 1), round(l['r'][1] - 1, 1), round(x1, 1), round(l['r'][3] + 1, 1)]})
    m['harm'] = sorted(harm, key=lambda h: (-h['level'], h['label'][0]))
    he = find(ls, r'^(HEALING|REPAIR)')
    if he:
        c = [s['r'] for s in sh if s['w'] > 15 and abs(cy(s['r']) - cy(he['r'])) < 14 and he['r'][2] - 2 < s['r'][0] < he['r'][2] + 40]
        if c:
            m['heal'] = R(max(c, key=lambda r: r[2] - r[0]))
    # resources: the squares on each row of the RESOURCES column (Armor, the playbook's own)
    rs = find(ls, r'^RESOURCES$')
    res = []
    if rs:
        for l in ls:
            if abs(l['r'][0] - rs['r'][0]) < 3 and rs['r'][3] < l['r'][1] < rs['r'][3] + 40:
                sq = band(sh, l['r'], l['r'][2], l['r'][2] + 80, lambda s: size_is(s, 6.5, 8, 6.5, 8) and s['fill'] == BLACK, 4)
                res.append({'name': l['t'], 'squares': [R(r) for r in sq]})
    m['res'] = res
    # keys: four rows, each three hit marks and the deadlock burst after them; the writing line before them
    kl = find(ls, r'^KEYS\b', 0, 300)
    ky0, ky1 = (kl['r'][3], kl['r'][3] + 140) if kl else (245, 340)
    kh = [s['r'] for s in sh if (size_is(s, 7, 8.5, 12, 14) or slant(s)) and s['r'][0] < 260 and ky0 < s['r'][1] < ky1]
    krows = {}
    for r in dedupe(kh):
        krows.setdefault(round(r[1] / 4), []).append(r)
    keys = []
    for k, rr in sorted(krows.items()):
        rr = sorted(rr)[:3]
        keys.append({'hits': [R(r) for r in rr], 'write': [48, round(rr[0][1] - 1, 1), round(rr[0][0] - 8, 1), round(rr[0][3] + 1, 1)],
                     'burst': [round(rr[-1][2] + 1, 1), round(rr[0][1] - 4, 1), round(rr[-1][2] + 22, 1), round(rr[0][3] + 4, 1)]})
    m['keys'] = keys
    # friends: each pair of triangles in the abilities column, joined to the name on its row. Found by the marks, not by the block's heading (it differs
    # from page to page: friends, contacts, servants, a controller).
    tri = lambda s: 8.8 < s['w'] < 9.6 and 7.4 < s['h'] < 8.2 and s['k'] == 'l' and 430 < s['r'][0] < 690
    ts = sorted(dedupe([s['r'] for s in sh if tri(s)]), key=lambda r: (r[0], r[1]))
    groups = []
    for r in ts:                      # left to right, so the second mark of a pair finds the first (its row may sit 2 pt lower)
        home = next((g for g in groups if abs(cy(g[-1]) - cy(r)) < 4 and 0 < r[0] - g[-1][0] < 14), None)
        if home:
            home.append(r)
        else:
            groups.append([r])
    groups.sort(key=lambda g: (round(cy(g[0]) / 4), g[0][0]))
    friends = []
    for g in groups:
        x1, y = g[-1][2], cy(g[0])
        near = [l for l in ls if abs(cy(l['r']) - y) < 5 and x1 - 2 < l['r'][0] < x1 + 30]
        if near:
            friends.append({'n': min(near, key=lambda l: l['r'][0])['t'], 'm': [R(r) for r in g]})
    m['friends'] = friends
    # a cohort's or a pet's harm and armour boxes
    coh = {}
    for w in ['Weak', 'Impaired', 'Broken', 'Armor']:
        l = find(ls, '^' + w + '$', 250, 420, 420, 480)
        if l:
            b = band(sh, l['r'], l['r'][2], l['r'][2] + 12, lambda s: size_is(s, 7, 9, 12, 15), 5)
            if b:
                coh[w.lower()] = R(b[0])
    m['coh'] = coh
    # the writing lines of the identity block
    ident = {}
    for lab in ['CREW', 'NAME', 'ALIAS', 'LOOK', 'WEARING', 'HERITAGE', 'BACKGROUND', 'VICE / HOOKUP']:
        l = find(ls, '^' + re.escape(lab) + '$', 0, 400, 0, 240)
        if l:
            ident[lab.split(' ')[0].lower()] = [round(l['r'][2] + 6, 1), round(l['r'][1] - 1, 1), round(l['r'][0] + (160 if lab == 'CREW' else 150), 1), round(l['r'][3] + 1, 1)]
    m['id'] = ident
    m['kinds'] = dict(KINDS)
    return m


def is_rect(v):
    return isinstance(v, list) and len(v) == 4 and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in v)


def region_rects(m):
    """Every (rect, colour) the proof outlines: any four-number list anywhere in a region of a final map (so a hand fix's own regions are outlined too)."""
    out = []

    def walk(v, col):
        if is_rect(v):
            out.append((v, col))
        elif isinstance(v, list):
            for e in v:
                walk(e, col)
        elif isinstance(v, dict):
            for e in v.values():
                walk(e, col)
    for k, v in m.items():
        if k in ('v', 'playbook', 'page', 'size', 'title', 'warn', 'kinds', 'proof'):
            continue
        col = (1, 0, 0) if k in ('stress', 'harm', 'coh') else (0, 0, 1) if k in ('xp', 'xpi', 'xpp', 'xpr', 'stacks', 'bank', 'heal') else (0, .6, 0) if k in ('ab', 'id') else (1, 0, 1)
        walk(v, col)
    return out


def proof(pdf, p, m, path):
    import pymupdf
    sh = p.new_shape()
    for r, c in region_rects(m):
        sh.draw_rect(pymupdf.Rect(r))
        sh.finish(color=c, width=.8)
    sh.commit()
    p.get_pixmap(dpi=110).save(path)


# the SVG, with its numbers shortened: the Hound's page measured 685 KB raw and 75 KB gzipped
def small_svg(p):
    s = p.get_svg_image(text_as_path=True)

    def f(mt):
        v = float(mt.group(0))
        t = ('%.3f' % v) if abs(v) < 2 else ('%.1f' % v)
        t = t.rstrip('0').rstrip('.') if '.' in t else t
        t = t.replace('0.', '.', 1) if t.startswith('0.') else t.replace('-0.', '-.', 1) if t.startswith('-0.') else t
        return t or '0'
    s = re.sub(r'-?\d*\.\d+', f, s)
    s = re.sub(r'>\s+<', '><', s)
    s = re.sub(r'<\?xml[^>]*>', '', s)
    s = s.replace(' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"', '')
    s = re.sub(r' inkscape:[a-z-]+="[^"]*"', '', s)
    return s.strip()


def pages_arg(s, n):
    if not s:
        return list(range(n))
    out = [int(x) - 1 for x in s.split(',') if x.strip()]
    for i in out:
        if not 0 <= i < n:
            raise ValueError('page %d is not in a %d-page pdf' % (i + 1, n))
    return out


def main(argv):
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['extract', 'proof', 'probe'])
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--work')
    ap.add_argument('--out')
    ap.add_argument('--pages')
    a = ap.parse_args(argv)
    import pymupdf
    doc = pymupdf.open(a.pdf)
    if a.cmd == 'probe':
        print(json.dumps({'pages': doc.page_count, 'sizes': [[round(p.rect.width, 2), round(p.rect.height, 2)] for p in doc]}))
        return 0
    pages = pages_arg(a.pages, doc.page_count)
    if a.cmd == 'extract':
        if not a.work:
            raise ValueError('extract needs --work')
        os.makedirs(a.work, exist_ok=True)
        done = []
        for i in pages:
            p = doc[i]
            svg = small_svg(p)
            with open(os.path.join(a.work, 'page-%02d.svg' % (i + 1)), 'w', encoding='utf-8') as f:
                f.write(svg)
            m = build(p, i)
            with open(os.path.join(a.work, 'page-%02d.raw.json' % (i + 1)), 'w', encoding='utf-8') as f:
                json.dump(m, f, ensure_ascii=False)
            done.append({'page': i + 1, 'svg_bytes': len(svg.encode('utf-8')), 'warn': m['warn']})
        print(json.dumps({'extracted': done}))
        return 0
    if not a.work or not a.out:
        raise ValueError('proof needs --work and --out')
    os.makedirs(a.out, exist_ok=True)
    done = []
    for i in pages:
        fp = os.path.join(a.work, 'final-%02d.json' % (i + 1))
        if not os.path.exists(fp):
            continue
        m = json.load(open(fp, encoding='utf-8'))
        name = re.sub(r'[^a-z0-9-]', '', str(m.get('playbook') or 'page-%02d' % (i + 1)).lower())
        proof(a.pdf, doc[i], m, os.path.join(a.out, 'proof-%s.png' % name))
        done.append(name)
    print(json.dumps({'proofs': done}))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as e:
        sys.stderr.write('sheets-map: %s: %s\n' % (type(e).__name__, e))
        sys.exit(2)
