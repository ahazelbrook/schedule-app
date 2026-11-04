// The opportunity board's show kind (suite ticket 5.1, switch between.board): a kind for the show contract in show.js, which spreads BOARD_KINDS into
// SHOW_KINDS. Kept in a file of its own so the contract file gets two lines; nothing here imports show.js (show.js imports this).
//   board { cards [1-12 short texts], who [same length: the poster's first name], kinds [same length: client | target | operation],
//           carried [same length: '0'..'9', how many nights a card has been carried over], pick? (0-11, the card the table picked) }
// Everything is lists of plain strings (the hidden-name scan reads lists of strings) and one small number. Nothing here names an NPC or carries an id:
// the GM page composes the cards from what the players posted and chose to show.
import { HttpError } from './http.js';

export const BOARD_KINDS_OF_CARD = ['client', 'target', 'operation'];
export const BOARD_LIMITS = { cards: 12, text: 120, who: 40 };

const bad = (m) => { throw new HttpError(400, m); };
function line(v, name, max) {
  if (typeof v !== 'string') bad(name + ' must be text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) bad(name + ' must not be empty');
  if (t.length > max) bad(name + ' is too long (at most ' + max + ' characters)');
  return t;
}
function list(v, name) {
  if (!Array.isArray(v) || v.length < 1 || v.length > BOARD_LIMITS.cards) bad(name + ' must be a list of 1 to ' + BOARD_LIMITS.cards);
  return v;
}

export const BOARD_KINDS = {
  board: {
    build: (p) => {
      const cards = list(p.cards, 'payload.cards').map((x) => line(x, 'payload.cards', BOARD_LIMITS.text));
      const n = cards.length;
      const who = list(p.who, 'payload.who').map((x) => line(x, 'payload.who', BOARD_LIMITS.who));
      const kinds = list(p.kinds, 'payload.kinds').map((x) => (BOARD_KINDS_OF_CARD.includes(x) ? x : bad('payload.kinds must each be client, target or operation')));
      const carried = list(p.carried, 'payload.carried').map((x) => (typeof x === 'string' && /^[0-9]$/.test(x) ? x : bad('payload.carried must each be a digit 0-9')));
      if (who.length !== n || kinds.length !== n || carried.length !== n) bad('payload.cards, who, kinds and carried must be the same length');
      const o = { cards, who, kinds, carried };
      if (p.pick !== undefined && p.pick !== null) {
        if (!Number.isInteger(p.pick) || p.pick < 0 || p.pick >= n) bad('payload.pick must be a whole number naming one of the cards');
        o.pick = p.pick;
      }
      return o;
    },
  },
};
