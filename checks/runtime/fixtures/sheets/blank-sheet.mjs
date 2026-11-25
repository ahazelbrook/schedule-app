// The INVENTED blank sheet that the phone's Full sheet (RK32 of the room key build) is tested on. Nothing here is the publisher's: rectangles, circles, lozenges,
// a clock and invented labels ("act 1", "ability 2"...) on an A4-landscape page, and its sheet map in RK33's schema (scripts/lib/sheets-map.py, the header in
// scripts/gm-sheets.mjs). The map's counts and its item, ability and friend names come from app/content.js at run time, so the page's guard can pair them.
//   blankSheet(content, id, opts) -> { svg, map }   opts: { stress: n (another box count, for the mismatch guard), waived: [check names] }
//   node checks/runtime/fixtures/sheets/blank-sheet.mjs     writes blank.svg and blank.map.json (the Hound's counts) beside this file
// sheet-page.test.mjs checks that the two committed files are what this makes.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SIZE = [841.89, 595.28];
export const KINDS = { stress: 'box', xp: 'box', xpi: 'box', xpp: 'box', xpr: 'box', acts: 'dot', ab: 'dot', items: 'box', stacks: 'lozenge', bank: 'lozenge',
  harm: 'text', heal: 'clock', res: 'box', keys: 'box', friends: 'mark', coh: 'box', id: 'text', load: 'text' };

export function loadContent(file = path.join(HERE, '..', '..', '..', '..', 'app', 'content.js')) {
  const sb = {}; sb.window = sb; sb.self = sb;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  return sb.B68Content;
}

const r1 = (v) => Math.round(v * 10) / 10;
const R = (x0, y0, x1, y1) => [r1(x0), r1(y0), r1(x1), r1(y1)];

export function blankSheet(CT, id = 'hound', opts = {}) {
  const pb = [].concat(CT.PLAYBOOKS || [], CT.PARANORMAL || []).find((p) => p.id === id);
  if (!pb) throw new Error('no playbook ' + id);
  const drain = /\((\d+) boxes/.exec(String(pb.resource || ''));
  const nStress = opts.stress || pb.stressMax || (drain ? +drain[1] : 9);
  const nDots = pb.maxDot || 4;
  const abNames = (pb.abilities || []).map((a) => a[0]).concat(pb.fixedAbility ? [pb.fixedAbility[0]] : [], pb.paranormal ? [] : ['Versatile']);
  const own = (pb.items || []).map((i) => ({ n: i[0], load: i[1], own: true }));
  const items = pb.itemsRule && !own.length ? [] : own.concat((CT.STANDARD_ITEMS || []).map((i) => ({ n: i[0], load: i[1], own: false })));
  /* as many friend lines as the playbook has contacts, named from the invented fixtures (the page only counts them; a test character's contacts use these names) */
  const FRIENDS = ['Mabel Quist, a ferryman', 'Dov Kessler, a clerk', 'Ada Vell, a typist', 'Lotte Brand, a driver', 'Ray Okonjo, a cousin'];
  const friends = (pb.contacts || []).map((c, i) => FRIENDS[i % FRIENDS.length] + (i >= FRIENDS.length ? ' ' + (i + 1) : ''));

  const svg = [];
  const box = (r) => svg.push('<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r1(r[2] - r[0]) + '" height="' + r1(r[3] - r[1]) + '" fill="#fff" stroke="#3a3a3a" stroke-width=".6"/>');
  const dot = (r) => svg.push('<circle cx="' + r1((r[0] + r[2]) / 2) + '" cy="' + r1((r[1] + r[3]) / 2) + '" r="' + r1((r[2] - r[0]) / 2) + '" fill="#fff" stroke="#3a3a3a" stroke-width=".6"/>');
  const loz = (r) => { const cx = r1((r[0] + r[2]) / 2), cy = r1((r[1] + r[3]) / 2); svg.push('<polygon points="' + cx + ',' + r[1] + ' ' + r[2] + ',' + cy + ' ' + cx + ',' + r[3] + ' ' + r[0] + ',' + cy + '" fill="#fff" stroke="#3a3a3a" stroke-width=".6"/>'); };
  const line = (r) => svg.push('<line x1="' + r[0] + '" y1="' + r[3] + '" x2="' + r[2] + '" y2="' + r[3] + '" stroke="#9a9a9a" stroke-width=".5"/>');
  const text = (x, y, s, size = 7, w = 400) => svg.push('<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-weight="' + w + '" fill="#3a3a3a" font-family="Arial, sans-serif">' + s + '</text>');
  const tri = (r, up) => svg.push('<polygon points="' + (up ? r1((r[0] + r[2]) / 2) + ',' + r[1] + ' ' + r[2] + ',' + r[3] + ' ' + r[0] + ',' + r[3] : r[0] + ',' + r[1] + ' ' + r[2] + ',' + r[1] + ' ' + r1((r[0] + r[2]) / 2) + ',' + r[3]) + '" fill="#fff" stroke="#3a3a3a" stroke-width=".6"/>');

  const map = { v: 1, page: 1, size: SIZE.slice(), title: 'INVENTED SHEET', playbook: id, kinds: Object.assign({}, KINDS) };
  text(36, 28, 'INVENTED SHEET', 16, 700); text(220, 28, 'a blank page for tests, with made-up labels', 7);

  /* the identity block: writing lines */
  const id0 = { crew: R(90, 42, 380, 54), name: R(90, 64, 230, 76), alias: R(270, 64, 380, 76), look: R(90, 86, 230, 98), wearing: R(290, 86, 380, 98), heritage: R(90, 108, 230, 120), background: R(300, 108, 380, 120), vice: R(90, 130, 380, 142) };
  for (const [k, r] of Object.entries(id0)) { line(r); text(k === 'alias' || k === 'wearing' || k === 'background' ? 240 : 40, r[3] - 2, 'line ' + (Object.keys(id0).indexOf(k) + 1), 6.5); }
  map.id = id0;

  /* the track */
  text(40, 172, 'TRACK', 8, 700);
  map.stress = []; for (let i = 0; i < nStress; i++) { const r = R(90 + 12 * i, 160, 99 + 12 * i, 176); box(r); map.stress.push(r); }

  /* four key rows: the writing line, three hit marks, the burst */
  text(40, 196, 'ROWS', 8, 700);
  map.keys = [];
  for (let i = 0; i < 4; i++) {
    const y = 188 + 20 * i, w = R(90, y, 230, y + 14), hits = [0, 1, 2].map((j) => R(236 + 9 * j, y + 1, 243 + 9 * j, y + 13)), b = R(266, y - 2, 284, y + 16);
    line(w); hits.forEach(box); dot(R(269, y + 1, 281, y + 13));
    map.keys.push({ hits, write: w, burst: b });
  }

  /* six writing lines by level, a clock, two resource rows */
  text(40, 288, 'LEVELS', 8, 700);
  map.harm = [];
  const lv = (level, n, y) => { for (let k = 0; k < n; k++) { const x0 = n === 2 ? (k ? 200 : 66) : 66, x1 = n === 2 ? (k ? 330 : 196) : 330; const label = R(40, y, 62, y + 12), write = R(x0, y, x1, y + 12); line(write); if (!k) text(42, y + 10, String(level), 8, 700); map.harm.push({ level, name: 'level ' + level, label, write }); } };
  lv(4, 1, 294); lv(3, 1, 310); lv(2, 2, 326); lv(1, 2, 342);
  map.heal = R(340, 300, 376, 336);
  svg.push('<circle cx="358" cy="318" r="17" fill="#fff" stroke="#3a3a3a" stroke-width=".8"/><path d="M358 301V335M341 318H375" stroke="#3a3a3a" stroke-width=".5"/>');
  text(340, 296, 'CLOCK', 6.5, 700);
  map.res = [{ name: 'Armor', squares: [R(340, 352, 348, 360), R(352, 352, 360, 360)] }, { name: String(pb.resource || 'resource'), squares: [R(340, 368, 348, 376), R(352, 368, 360, 376)] }];
  map.res.forEach((x) => x.squares.forEach(box)); text(364, 359, 'res a', 6.5); text(364, 375, 'res b', 6.5);

  /* a cohort's four boxes */
  text(40, 382, 'GROUP', 8, 700);
  map.coh = { weak: R(90, 372, 98, 384), impaired: R(130, 372, 138, 384), broken: R(170, 372, 178, 384), armor: R(210, 372, 218, 384) };
  Object.values(map.coh).forEach(box);

  /* abilities: a bubble each, and the block its text takes */
  text(420, 52, 'ABILITIES', 8, 700);
  map.ab = abNames.map((n, i) => { const y = 62 + 30 * i, b = R(426, y, 434, y + 8), k = R(420, y - 4, 690, y + 24); dot(b); text(440, y + 7, 'ability ' + (i + 1), 7.5, 700); line(R(440, y + 9, 680, y + 18)); return { n, b: [b], k }; });

  /* friends: two marks before each name */
  const fy = 62 + 30 * abNames.length + 10;
  text(420, fy, 'FRIENDS', 8, 700);
  map.friends = friends.map((n, i) => { const y = fy + 6 + 12 * i, m = [R(426, y, 434, y + 8), R(437, y, 445, y + 8)]; tri(m[0], true); tri(m[1], false); text(450, y + 7, 'friend ' + (i + 1), 7); return { n, m }; });

  /* playbook xp */
  text(420, 556, 'XP', 8, 700);
  map.xp = []; for (let i = 0; i < 8; i++) { const r = R(450 + 8 * i, 546, 456 + 8 * i, 558); box(r); map.xp.push(r); }

  /* stacks and bank */
  text(700, 30, 'STACKS', 7, 700);
  map.stacks = []; for (let i = 0; i < 4; i++) { const r = R(740 + 10 * i, 22, 748 + 10 * i, 30); loz(r); map.stacks.push(r); }
  map.bank = [];
  if (pb.bank !== false) { text(700, 44, 'BANK', 7, 700); for (let k = 0; k < 40; k++) { const c = k % 10, rr = Math.floor(k / 10), r = R(704 + 11 * c, 50 + 10 * rr, 711 + 11 * c, 57 + 10 * rr); loz(r); map.bank.push(r); } }

  /* three attributes: their xp and four actions with their dots */
  map.acts = {};
  ['xpi', 'xpp', 'xpr'].forEach((key, a) => {
    const y0 = 104 + 72 * a;
    text(700, y0 + 8, 'GROUP ' + (a + 1), 7, 700);
    map[key] = []; for (let i = 0; i < 6; i++) { const r = R(760 + 7 * i, y0, 766 + 7 * i, y0 + 10); box(r); map[key].push(r); }
    (CT.ACTIONS[a][1]).forEach((name, rI) => {
      const y = y0 + 16 + 13 * rI, d = []; for (let j = 0; j < nDots; j++) { const r = R(704 + 11 * j, y, 711 + 11 * j, y + 7); dot(r); d.push(r); }
      const l = R(764, y - 1, 815, y + 9); text(766, y + 7, 'act ' + (a * 4 + rI + 1), 7);
      map.acts[name] = { l, d };
    });
  });

  /* load and items: a square per load; an item that takes none has one box and is printed in italics */
  map.load = { quiet: R(760, 322, 782, 330), loud: R(790, 322, 815, 330) };
  text(762, 329, 'calm', 7); text(792, 329, 'noisy', 7);
  map.items = items.map((it, i) => {
    const y = 338 + 12 * i, n = it.own && it.load === 0 ? 1 : it.load, s = [];
    for (let k = 0; k < n; k++) { const r = R(702 + 7 * k, y, 707.5 + 7 * k, y + 5.5); box(r); s.push(r); }
    const l = R(726, y - 2, 820, y + 8); svg.push('<text x="728" y="' + r1(y + 5.5) + '" font-size="6.5" fill="#3a3a3a" font-family="Arial, sans-serif"' + (n === 1 && it.own && it.load === 0 ? ' font-style="italic"' : '') + '>gear ' + (i + 1) + '</text>');
    const o = { n: it.n, s, l }; if (it.own && it.load === 0) o.i = 1; return o;
  });

  if (opts.waived && opts.waived.length) map.waived = opts.waived.slice();
  const out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + SIZE[0] + ' ' + SIZE[1] + '" width="' + SIZE[0] + '" height="' + SIZE[1] + '">' +
    '<rect width="' + SIZE[0] + '" height="' + SIZE[1] + '" fill="#fff"/><rect x="18" y="12" width="806" height="571" fill="none" stroke="#3a3a3a" stroke-width="1"/>' + svg.join('') + '</svg>\n';
  return { svg: out, map };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { svg, map } = blankSheet(loadContent(), 'hound');
  fs.writeFileSync(path.join(HERE, 'blank.svg'), svg);
  fs.writeFileSync(path.join(HERE, 'blank.map.json'), JSON.stringify(map) + '\n');
  console.log('wrote blank.svg (' + svg.length + ' bytes) and blank.map.json');
}
