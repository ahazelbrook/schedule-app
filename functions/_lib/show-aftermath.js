// The Aftermath show's two brief beats (suite ticket 1.6, switch spine.aftermath): kinds for the show contract in show.js, which spreads AFTERMATH_KINDS into
// SHOW_KINDS. Kept in a file of its own so the contract file gets two lines; nothing here imports show.js (show.js imports this).
//   aftermath { step, n?, stacks?, tithe?, kept?, exposure?, mods?, heat?, after?, siren?, wanted?, lines?, who?, line?, secs? }
//       step is one of AFTERMATH_STEPS. Every other key is optional and bounded; a step draws the keys it uses and ignores the rest.
//       lines is at most 6 short lines (a status change, a harm complication): free text, scanned for hidden names like any beat's words.
//   credits { npcIds [1-30] }   joined at read time to the REVEALED NPCs only, exactly like a rolodex; the iPad gets { npcs: [...] }.
import { HttpError, ID_RE } from './http.js';

export const AFTERMATH_STEPS = ['payout', 'tithe', 'heat', 'status', 'harm', 'unwind', 'xp'];
export const AFTERMATH_LIMITS = { stacks: 99, lines: 6, line: 80, who: 60, one: 120, secs: [10, 180], credits: 30 };

const bad = (m) => { throw new HttpError(400, m); };
function text(v, name, max) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') bad(name + ' must be text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (t.length > max) bad(name + ' is too long (at most ' + max + ' characters)');
  return t;
}
function whole(v, name, lo, hi) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) bad(name + ' must be a whole number from ' + lo + ' to ' + hi);
  return v;
}
const put = (o, k, v) => { if (v !== undefined) o[k] = v; return o; };
function lineList(v, name) {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) bad(name + ' must be a list of lines');
  if (v.length > AFTERMATH_LIMITS.lines) bad(name + ' holds at most ' + AFTERMATH_LIMITS.lines + ' lines');
  const out = v.map((x) => text(x, name, AFTERMATH_LIMITS.line)).filter((x) => x !== undefined);
  return out.length ? out : undefined;
}

export const AFTERMATH_KINDS = {
  aftermath: {
    build: (p) => {
      if (typeof p.step !== 'string' || !AFTERMATH_STEPS.includes(p.step)) bad('payload.step must be one of ' + AFTERMATH_STEPS.join(', '));
      if (p.siren !== undefined && p.siren !== null && typeof p.siren !== 'boolean') bad('payload.siren must be true or false');
      const o = { step: p.step };
      put(o, 'n', whole(p.n, 'payload.n', 1, 8));
      put(o, 'stacks', whole(p.stacks, 'payload.stacks', 0, AFTERMATH_LIMITS.stacks));
      put(o, 'tithe', whole(p.tithe, 'payload.tithe', 0, AFTERMATH_LIMITS.stacks));
      put(o, 'kept', whole(p.kept, 'payload.kept', 0, AFTERMATH_LIMITS.stacks));
      put(o, 'exposure', whole(p.exposure, 'payload.exposure', 0, 6));
      put(o, 'mods', whole(p.mods, 'payload.mods', -6, 6));
      put(o, 'heat', whole(p.heat, 'payload.heat', 0, 9));
      put(o, 'after', whole(p.after, 'payload.after', 0, 9));
      if (p.siren === true) o.siren = true;
      put(o, 'wanted', whole(p.wanted, 'payload.wanted', 0, 4));
      put(o, 'lines', lineList(p.lines, 'payload.lines'));
      put(o, 'who', text(p.who, 'payload.who', AFTERMATH_LIMITS.who));
      put(o, 'line', text(p.line, 'payload.line', AFTERMATH_LIMITS.one));
      put(o, 'secs', whole(p.secs, 'payload.secs', AFTERMATH_LIMITS.secs[0], AFTERMATH_LIMITS.secs[1]));
      return o;
    },
  },
  credits: {
    npc: 'list',
    build: (p) => {
      if (!Array.isArray(p.npcIds)) bad('payload.npcIds is required');
      if (p.npcIds.length > AFTERMATH_LIMITS.credits) bad('payload.npcIds holds at most ' + AFTERMATH_LIMITS.credits + ' ids');
      p.npcIds.forEach((x) => { if (typeof x !== 'string' || !ID_RE.test(x)) bad('payload.npcIds holds a bad id'); });
      const out = [...new Set(p.npcIds)];
      if (!out.length) bad('payload.npcIds is required');
      return { npcIds: out };
    },
  },
};
