// The fresh-talk (user) turn for the Fixer, shared by the Worker (functions/api/gm/assist.js) and the replay script, so a
// replay reads exactly what the table agent would. Generic text only: the draws and the talk arrive as arguments.

/**
 * position, effect, dots: what the GM set (dots: the dice for the roll, 0-4; left out when the GM has not set them). draws: { low, mid }, the console's own 1-3 and 4-5 draws as text.
 * stamp: "HH:MM" the talk runs up to. talk: the last five minutes as "[HH:MM] Name: text" lines.
 */
export function fitUser({ position, effect = '', dots, draws, stamp, talk }) {
  const named = 'The GM names the position: ' + position + (effect ? '. Effect: ' + effect : '') + '.' + (Number.isInteger(dots) ? ' Dots: ' + dots + '.' : '');
  return 'A roll is about to be made. ' + named + '\nThe console has drawn these. Fit them to the scene and keep what each one says happens.\n1-3 draw:\n' + draws.low +
    '\n4-5 draw:\n' + draws.mid + '\nLast five minutes, up to ' + stamp + ':\n' + talk;
}

export const NPC_MAX = 80;                  // characters in the on-stage NPC's name the page sends
export const SHOWN_MAX = 6;                 // lines already shown that Another is told about
export const SHOWN_LINE_MAX = 400;          // characters per shown line

/** The Voice turn: who the GM's page says is on stage, then the last four minutes of talk. */
export function voiceUser({ npc, stamp, talk }) {
  return 'The GM has this NPC on stage: ' + npc + '.\nLast four minutes, up to ' + stamp + ':\n' + talk;
}

/** The Another turn: the NPC, the lines already shown (all to be avoided), then the last four minutes of talk. */
export function anotherUser({ npc, shown, stamp, talk }) {
  return 'The GM asks for one more line for this NPC: ' + npc + '.\nLines already shown (write something different from every one):\n' +
    shown.map((s, i) => (i + 1) + '. ' + s).join('\n') + '\nLast four minutes, up to ' + stamp + ':\n' + talk;
}

export const SHOWRUNNER_MIN = 20;           // minutes of talk the Showrunner reads (it runs every ten; the Worker cannot afford the whole night)
export const MYSTERY_MIN = 15;              // minutes of talk the Mystery keeper reads, plus what it reported known earlier
export const KNOWN_MAX = 12;                // earlier "known" items handed back to the Mystery keeper
export const KNOWN_ITEM_MAX = 160;          // characters per item

/** The Showrunner turn: the talk of the last SHOWRUNNER_MIN minutes. */
export function showrunnerUser({ stamp, talk }) {
  return 'Talk of the last ' + SHOWRUNNER_MIN + ' minutes, up to ' + stamp + ' (earlier talk is not shown):\n' + talk;
}

/** The Mystery turn: what the seat reported known earlier (short list, may be empty), then the last MYSTERY_MIN minutes of talk. */
export function mysteryUser({ stamp, talk, known = [] }) {
  return (known.length ? 'You reported these as known earlier tonight (already learned):\n' + known.map((k) => '- ' + k).join('\n') + '\n' : '') +
    'Talk of the last ' + MYSTERY_MIN + ' minutes, up to ' + stamp + ' (earlier talk is not shown):\n' + talk;
}

// ---------- the Scribe's story so far, and Meanwhile ----------

export const STORY_MAX = 8000;               // characters in the story so far (about 2k tokens): a hard cap the Worker enforces
export const STORY_SEATS = ['mystery', 'showrunner', 'meanwhile'];   // the seats that look past the last few minutes
export const SCRIBE_SLICE_MAX = 12000;       // characters of new talk handed to the Scribe in one run (the newest, if more)
export const SCRIBE_FIRST_MIN = 10;          // the first run of a night reads this many minutes at most
export const MEANWHILE_MIN = 8;              // minutes of talk Meanwhile reads
export const CLOCKS_MAX = 12;                // live clocks handed to Meanwhile
export const CLOCK_NAME_MAX = 80;

/** The story, trimmed to STORY_MAX: a long one loses its oldest lines first (the Scribe is told to compress, this is the backstop). */
export function capStory(text, max = STORY_MAX) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= max) return s;
  const mark = '[earlier story trimmed]\n';
  const tail = s.slice(s.length - (max - mark.length));
  const nl = tail.indexOf('\n');
  return mark + (nl >= 0 && nl < tail.length / 2 ? tail.slice(nl + 1) : tail);
}

/** The block the story rides in: appended to a seat's own instructions, so it sits after the cache breakpoint, never in the prefix. */
export function storyBlock(story) {
  const s = String(story || '').trim();
  if (!s) return '';
  return '\n\nStory so far (a running summary of this session before the talk in the message, kept by the scribe; names in it are corrected against the cast, but it can be wrong, and the talk in the message wins where they differ):\n' + s;
}

/** The Scribe turn: the story so far (may be empty), then the new talk. */
export function scribeUser({ story = '', stamp, talk }) {
  return (story ? 'Story so far:\n' + story : 'Story so far: (nothing yet)') + '\n\nNew talk, up to ' + stamp + ':\n' + talk + '\n\nReturn the whole updated story.';
}

/** The table's live clocks from the campaign document -> [{ name, kind, filled, size }], open clocks only, at most CLOCKS_MAX. */
export function cleanClocks(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const c of v) {
    if (out.length >= CLOCKS_MAX) break;
    if (!c || typeof c !== 'object') continue;
    const name = typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim().slice(0, CLOCK_NAME_MAX) : '';
    const size = Number.isInteger(c.size) && c.size > 0 && c.size <= 12 ? c.size : 0, filled = Number.isInteger(c.filled) && c.filled >= 0 ? c.filled : 0;
    if (!name || !size || filled >= size) continue;                 // a full or nameless clock is not one the GM can still tick
    out.push({ name, kind: typeof c.kind === 'string' ? c.kind.slice(0, 16) : '', filled, size });
  }
  return out;
}

/** The Meanwhile turn: the live clocks, then the last minutes of talk. */
export function meanwhileUser({ clocks = [], stamp, talk }) {
  const cl = clocks.length ? 'Live clocks on the table (name, kind, filled/size):\n' + clocks.map((c) => '- ' + c.name + (c.kind ? ' (' + c.kind + ')' : '') + ' ' + c.filled + '/' + c.size).join('\n') : 'Live clocks on the table: none.';
  return 'The scene has just changed.\n' + cl + '\nTalk of the last ' + MEANWHILE_MIN + ' minutes, up to ' + stamp + ':\n' + talk;
}

/** The Stall turn when the table has gone silent: how long, and the talk just before the silence. */
export function silenceUser({ minutes, since, stamp, talk }) {
  return 'The table has been silent for about ' + minutes + ' minutes (nothing heard since ' + since + '; now ' + stamp + ').\nThe last talk before the silence:\n' + talk;
}

export const ITEM_KINDS =['portrait', 'prop', 'wire', 'board', 'card'];
export const ITEM_MAX = 1500;               // characters in an item the gatekeeper checks
export const CITES_MAX = 8;                 // page cites per item
export const CITE_MAX = 60;                 // characters per cite

/** The gatekeeper turn: the kind, the item's text, and any page cites to spot-check. */
export function gatekeeperUser({ kind, text, cites = [] }) {
  return 'Item kind: ' + kind + '.\nItem text:\n' + text + (cites.length ? '\nPage cites to check against the rules reference:\n' + cites.map((c) => '- ' + c).join('\n') : '') +
    '\nCheck this item.';
}
