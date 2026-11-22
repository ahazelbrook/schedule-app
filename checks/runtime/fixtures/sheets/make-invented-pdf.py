# Makes the INVENTED one-page PDF that checks/runtime/gm-sheets.test.mjs maps (RK33 of the room key build). Nothing here is the publisher's: rectangles,
# circles, polygons and made-up words (the Dovetail crew, Mabel Quist and Dov Kessler), set out on the same A4-landscape grid the sheet map reads. It is written
# to a temp folder at test time and is never committed as a file.
#   python -I make-invented-pdf.py <out.pdf> [--stress N] [--no-friends]
import sys
import pymupdf

out = sys.argv[1]
stress = int(sys.argv[sys.argv.index('--stress') + 1]) if '--stress' in sys.argv else 9
friends = '--no-friends' not in sys.argv

doc = pymupdf.open()
p = doc.new_page(width=841.89, height=595.28)
BLACK, WHITE = (0, 0, 0), (1, 1, 1)


def text(x, y, s, size=9, font='helv'):
    p.insert_text((x, y), s, fontsize=size, fontname=font)


def box(x, y, w, h, fill=WHITE, stroke=BLACK):
    p.draw_rect(pymupdf.Rect(x, y, x + w, y + h), color=stroke, fill=fill, width=.5)


def diamond(x, y, s=7.3):
    cx, cy = x + s / 2, y + s / 2
    corners = [(cx, y), (x + s, cy), (cx, y + s), (x, cy)]
    pts = []
    for i in range(4):
        a, b = corners[i], corners[(i + 1) % 4]
        for k in range(5):
            pts.append((a[0] + (b[0] - a[0]) * k / 5, a[1] + (b[1] - a[1]) * k / 5))
    p.draw_polyline(pts + [pts[0]], color=BLACK, width=.5)


def triangle(x, y):
    p.draw_polyline([(x, y + 7.8), (x + 9.2, y + 7.8), (x + 4.6, y), (x, y + 7.8)], color=BLACK, fill=(.9, .4, 0), width=.4)


text(430, 60, 'DOVETAIL', 40, 'hebo')
text(42, 224, 'STRESS')
for i in range(stress):
    box(75.7 + 9.4 * i, 213.3, 10.4, 17.7)
text(610, 99, 'XP', 6.5)
for i in range(8):
    box(623.6 + 6.1 * i, 90, 7.5, 12.8)
for label_y, name_row in ((128, 132.5), (196, 199.8), (265, 268.5)):
    text(742, label_y, 'XP', 7)
    for i in range(6):
        box(757.6 + 6.1 * i, label_y - 8.8, 7.5, 12.8)
    for r in range(4):
        row = name_row + 11.5 * r
        text(764.9, row + 9, ['Hunt', 'Study', 'Survey', 'Tinker', 'Finesse', 'Prowl', 'Skirmish', 'Wreck', 'Attune', 'Command', 'Consort', 'Sway'][(0 if name_row == 132.5 else 4 if name_row == 199.8 else 8) + r], 9.4)
        for j in range(4):
            p.draw_circle((714.1 + 12.5 * j + 3.05, row + 3.4 + 3.05), 3.05, color=BLACK, fill=WHITE, width=.5)
for k, y in enumerate((106.7, 144.8, 184, 221.8)):
    p.draw_circle((436.3 + 3.95, y + 3.95), 3.95, color=(.93, .31, 0), fill=WHITE, width=.7)
    text(448.7, y + 8.2, ['ALPHA', 'BRAVO', 'CHARLIE', 'VERSATILE'][k] + ': an invented rule, nothing more.', 8, 'hebo')
text(702, 44, 'STACKS', 7)
for i in range(4):
    diamond(731.8 + 9.6 * i, 38.2)
text(41, 350, 'HARM', 9, 'hebo')
for lv, nm, y in ((4, 'Grim', 363), (3, 'Dire', 380), (2, 'Rough', 397), (1, 'Light', 413)):
    text(42.5, y, '%d. %s' % (lv, nm), 9)
    if lv < 3:
        text(244, y, '%d. %s' % (lv, nm), 9)
text(278, 350, 'HEALING', 9, 'hebo')
p.draw_rect(pymupdf.Rect(330, 335, 354.5, 359), color=BLACK, fill=WHITE, width=1)
text(352, 345, 'RESOURCES', 9, 'hebo')
text(352, 358, 'Armor')
box(400, 351, 7.2, 7.2, fill=BLACK)
text(41, 250, 'KEYS', 9, 'hebo')
for y in (258.7, 278.1, 297.4, 316.8):
    for x in (205.5, 211.6, 217.7):
        box(x, y, 7.5, 12.8)
if friends:
    text(436, 392, 'INVENTED FRIENDS', 8, 'hebo')
    for y, name in ((401.5, 'Mabel Quist, a ferryman'), (414.5, 'Dov Kessler, a clerk')):
        triangle(435.4, y)
        triangle(445.5, y + 2.1)
        text(458.4, y + 8.2, name, 8.5)
text(700.6, 340, 'ITEMS', 9, 'hebo')
rows = [('Brass lantern', 1, 'helv'), ('Silk rope', 1, 'heit'), ('Crowbar', 1, 'helv'), ('Heavy coat', 2, 'helv')]
for n, (name, sq, font) in enumerate(rows):
    y = 359 + 11.4 * n
    for q in range(sq):
        box(700.3 + 9.2 * q, y - 6.8, 7.2, 7.2, fill=BLACK)
    text(710.4 + 9.2 * (sq - 1), y, name, 9, font)
doc.save(out)
