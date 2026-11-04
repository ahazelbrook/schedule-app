// The score title card's show kind (suite ticket 2.10, switch map.title): a kind for the show contract in show.js, which spreads TITLE_KINDS into SHOW_KINDS. Kept in a file of
// its own so the contract file gets two lines; nothing here imports show.js (show.js imports this).
//   scoretitle { text (80), sub? (120), floors? [1-6 strings "x,y,w,d"] }
// floors are the building's outside, from the ground up: the footprint of each storey as four whole numbers on a 0 to 100 grid (x + w and y + d at most 100, w and d at least 1).
// It is lists of plain strings (the hidden-name scan reads lists of strings), nothing that names a room, an NPC or an id, and no storey below the ground.
import { HttpError } from './http.js';

export const TITLE_LIMITS = { text: 80, sub: 120, floors: 6 };
const FLOOR = /^\d{1,3},\d{1,3},\d{1,3},\d{1,3}$/;

const bad = (m) => { throw new HttpError(400, m); };
function line(v, name, max, required) {
  if (v === undefined || v === null || v === '') { if (required) bad(name + ' is required'); return undefined; }
  if (typeof v !== 'string') bad(name + ' must be text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) { if (required) bad(name + ' is required'); return undefined; }
  if (t.length > max) bad(name + ' is too long (at most ' + max + ' characters)');
  return t;
}
function floor(s) {
  if (typeof s !== 'string' || !FLOOR.test(s)) bad('payload.floors must each be four whole numbers: x,y,w,d');
  const [x, y, w, d] = s.split(',').map(Number);
  if (w < 1 || d < 1 || x + w > 100 || y + d > 100) bad('payload.floors must each sit inside the 0 to 100 grid, at least 1 wide and deep');
  return s;
}

export const TITLE_KINDS = {
  scoretitle: {
    build: (p) => {
      const o = { text: line(p.text, 'payload.text', TITLE_LIMITS.text, true) };
      const sub = line(p.sub, 'payload.sub', TITLE_LIMITS.sub);
      if (sub !== undefined) o.sub = sub;
      if (p.floors !== undefined && p.floors !== null) {
        if (!Array.isArray(p.floors) || p.floors.length < 1 || p.floors.length > TITLE_LIMITS.floors) bad('payload.floors must be a list of 1 to ' + TITLE_LIMITS.floors);
        o.floors = p.floors.map(floor);
      }
      return o;
    },
  },
};
