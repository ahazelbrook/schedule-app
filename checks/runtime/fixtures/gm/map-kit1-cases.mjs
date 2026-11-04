// The sites and render options map kit 1.0's backward-compatibility check draws (checks/runtime/map-kit1.test.mjs). The golden
// hashes beside this file (map-kit1-golden.json) were taken from map kit 0.9.0 itself, before 1.0 touched it:
//   node checks/runtime/map-kit1.test.mjs --write-golden      (only ever against a 0.9 kit)
// INVENTED data only: the Pelican Rooms (plain, and extended with the kit 1.0 fields), the Goose House and the fixture tables' rolls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
export const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
export const PELICAN_K1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-kit1.json'), 'utf8'));

const PELICAN_ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const GOOSE = {
  name: 'The Goose House', district: 'Nowhere Ward', styleName: 'Old relic',
  rooms: [{ name: 'The grand lobby', band: 'public' }, { name: 'Main floor', band: 'public' }, { name: 'Kitchens', band: 'working' },
    { name: 'Private card rooms', band: 'controlled' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true }],
  vectors: [{ n: 'The front', how: 'A door on the square.', know: 'free', room: 'The grand lobby', level: 'street', means: 'door' }],
  skips: [{ from: 'Kitchens', to: 'Luxury penthouse', via: 'a goose chute' }], physThreatName: 'Heron', socThreatName: 'Egret',
};
const LOBBY = { name: 'The Pelican Rooms', rooms: [{ name: 'The grand lobby', band: 'public', w: 9 }, { name: 'Main floor', band: 'public' }, { name: 'Kitchens', band: 'working' },
  { name: 'Private card rooms', band: 'controlled' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true }],
  vectors: [{ n: 'The front', how: 'A door on the square.', know: 'free', room: 'The grand lobby', level: 'street', means: 'door' }] };

/* the authored sites, as the GM page rolls them (base roll + patch) */
export function sites() {
  return {
    pelican: P.authoredRoll(L, FIXL, { name: 'The Pelican Rooms', patch: { district: 'Nowhere Ward', rooms: PELICAN_ROOMS } }),
    pelicanK1: P.authoredRoll(L, FIXL, PELICAN_K1),
    goose: P.authoredRoll(L, FIXL, { name: 'The Goose House', patch: GOOSE }),
    lobby: P.authoredRoll(L, FIXL, { name: 'The Pelican Rooms', patch: LOBBY }),
  };
}
export const rolled = (seed) => L.generate(FIXL, {}, { seed, mem: {} });

const VIEWS = ['iso', 'plan', 'rings', 'section', 'street'], THEMES = ['rulebook', 'blueprint', 'casefile', 'board', 'plate'];
const REVEALS = [['public'], ['public', 'working'], ['public', 'room:Private card rooms', 'room:Kitchens']];
/* every case: [key, roll name or seed, opts] */
export function cases() {
  const out = [];
  for (const s of ['pelican', 'pelicanK1', 'goose', 'lobby']) {
    for (const view of VIEWS) for (const theme of THEMES) out.push([s + ':' + view + ':' + theme + ':gm', s, { view, theme, layer: 'gm', layout: 'ipad' }]);
    for (const view of VIEWS.slice(0, 4)) REVEALS.forEach((reveal, i) => out.push([s + ':' + view + ':player' + i, s, { view, theme: 'rulebook', layer: 'player', reveal, layout: 'ipad' }]));
    for (const view of ['iso', 'section']) for (const layout of ['print', 'sheet', 'phone']) out.push([s + ':' + view + ':' + layout, s, { view, theme: 'rulebook', layer: 'gm', layout }]);
  }
  for (let seed = 1; seed <= 8; seed++) for (const view of VIEWS.slice(0, 4)) out.push(['seed' + seed + ':' + view, seed, { view, layer: 'gm', width: 1000 }]);
  return out;
}
export const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
