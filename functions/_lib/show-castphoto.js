// The cast photo and the lair (suite tickets 3.8 and 5.4, switches face.castphoto and between.lair): two kinds for the show contract in show.js, which
// spreads CASTPHOTO_KINDS into SHOW_KINDS. Kept in a file of its own so the contract file gets a few lines; nothing here imports show.js.
//   castphoto { npcIds [0-30], sil? [0-30 digit strings: a silhouette's height in inches], title? (60) }
//       npcIds is joined at read time to the REVEALED NPCs only (npc: 'list', like a rolodex), and the iPad gets { npcs, sil?, title? }. A figure that is not
//       met yet is a silhouette: a height and nothing else, no id, no name, no drawing (the join keeps `sil` and `title`, see `keep`).
//   lair { name (60), front? canal|street, layers [1-24 short strings] }
//       Layers are the crew's own base, read from their crew sheet by the GM page: up:<upgrade>, co:<cohort>, fl:<flair>. Nothing here names an NPC.
import { HttpError, ID_RE } from './http.js';

export const CASTPHOTO_LIMITS = { npcs: 30, sil: 30, title: 60, silMin: 40, silMax: 96, name: 60, layers: 24, layer: 60 };
export const LAIR_FRONTS = ['canal', 'street'];

const bad = (m) => { throw new HttpError(400, m); };
function line(v, name, max, required) {
  if (v === undefined || v === null || v === '') { if (required) bad(name + ' is required'); return undefined; }
  if (typeof v !== 'string') bad(name + ' must be text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) { if (required) bad(name + ' is required'); return undefined; }
  if (t.length > max) bad(name + ' is too long (at most ' + max + ' characters)');
  return t;
}

export const CASTPHOTO_KINDS = {
  castphoto: {
    npc: 'list',
    keep: ['sil', 'title'],
    build: (p) => {
      const ids = p.npcIds === undefined || p.npcIds === null ? [] : p.npcIds;
      if (!Array.isArray(ids)) bad('payload.npcIds must be a list of ids');
      if (ids.length > CASTPHOTO_LIMITS.npcs) bad('payload.npcIds holds at most ' + CASTPHOTO_LIMITS.npcs + ' ids');
      ids.forEach((x) => { if (typeof x !== 'string' || !ID_RE.test(x)) bad('payload.npcIds holds a bad id'); });
      const o = { npcIds: [...new Set(ids)] };
      if (p.sil !== undefined && p.sil !== null) {
        if (!Array.isArray(p.sil) || p.sil.length > CASTPHOTO_LIMITS.sil) bad('payload.sil must be a list of at most ' + CASTPHOTO_LIMITS.sil + ' heights');
        o.sil = p.sil.map((x) => {
          if (typeof x !== 'string' || !/^[0-9]{2,3}$/.test(x)) bad('payload.sil must each be a height in inches, as digits');
          const n = Number(x);
          if (n < CASTPHOTO_LIMITS.silMin || n > CASTPHOTO_LIMITS.silMax) bad('payload.sil heights run from ' + CASTPHOTO_LIMITS.silMin + ' to ' + CASTPHOTO_LIMITS.silMax);
          return String(n);
        });
      }
      if (!o.npcIds.length && !(o.sil && o.sil.length)) bad('payload needs at least one figure');
      const t = line(p.title, 'payload.title', CASTPHOTO_LIMITS.title);
      if (t !== undefined) o.title = t;
      return o;
    },
  },
  lair: {
    build: (p) => {
      const o = { name: line(p.name, 'payload.name', CASTPHOTO_LIMITS.name, true) };
      if (p.front !== undefined && p.front !== null) {
        if (!LAIR_FRONTS.includes(p.front)) bad('payload.front must be one of ' + LAIR_FRONTS.join(', '));
        o.front = p.front;
      }
      if (!Array.isArray(p.layers) || p.layers.length < 1 || p.layers.length > CASTPHOTO_LIMITS.layers) bad('payload.layers must be a list of 1 to ' + CASTPHOTO_LIMITS.layers);
      o.layers = p.layers.map((x) => line(x, 'payload.layers', CASTPHOTO_LIMITS.layer, true));
      return o;
    },
  },
};
