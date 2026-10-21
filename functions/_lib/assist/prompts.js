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
export const STORY_SEATS = ['mystery', 'showrunner', 'meanwhile', 'ask'];   // the seats that look past the last few minutes (Ask Blade needs the night: an epilogue is not ten minutes long)
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

// ---------- the Screen seats (portrait, prop, wire) and the case board ----------
export const SCREEN_WINDOW_MIN = 5;         // minutes of talk the Screen seats read
export const SCREEN_NAME_MAX = 80;          // the typed NPC name for a portrait
export const SCREEN_ASK_MAX = 200;          // the typed one-line ask for a prop
export const VOCAB_MAX = 5000;              // the figure kit's vocabulary text the page sends with a portrait request
export const SPEC_JSON_MAX = 8 * 1024;      // the portrait seat's spec, as the Worker will parse it
export const PROP_MAX = 1200;               // characters of a prop's text (it must fit in one gatekeeper check)
export const PROP_TITLE_MAX = 80;
export const WIRE_MAX = 240;                // characters of a bulletin
export const WIRE_ITEMS_MAX = 6;            // bulletins on the iPad's wire at once
export const BOARD_MAX = 1450;              // characters of the case board's text

/** The Portrait turn: the typed name (maybe), the figure kit's vocabulary, then the last few minutes of talk. */
export function portraitUser({ name = '', vocab, stamp, talk }) {
  return (name ? 'Draw this NPC (typed by the GM): ' + name + '.\n' : 'Draw the NPC the GM has just described.\n') +
    'Vocabulary (use only these names):\n' + vocab + '\nLast ' + SCREEN_WINDOW_MIN + ' minutes, up to ' + stamp + ':\n' + talk;
}

/** The Prop turn: the typed ask (maybe), then the last few minutes of talk. */
export function propUser({ ask = '', stamp, talk }) {
  return (ask ? 'The GM asks for: ' + ask + '\n' : 'Make the prop that fits this moment.\n') + 'Last ' + SCREEN_WINDOW_MIN + ' minutes, up to ' + stamp + ':\n' + talk;
}

/** The Wire turn: the last few minutes of talk. */
export function wireUser({ stamp, talk }) {
  return 'Write one bulletin. Last ' + SCREEN_WINDOW_MIN + ' minutes, up to ' + stamp + ':\n' + talk;
}

// ---------- Ask Blade (the GM's typed question in the box) ----------
export const ASK_MAX = 600;                 // characters in the question
export const ASK_WINDOW_MIN = 10;           // minutes of talk Ask Blade reads (the story so far covers the rest of the night)
export const ANSWER_MAX = 4000;             // characters of an answer kept; longer is cut at the last line break before the limit
export const ASK_HISTORY = 2;               // earlier exchanges of tonight handed back, so "make it darker" has something to work on
export const ASK_HISTORY_MIN = 45;          // ... and only from the last 45 minutes
export const ASK_HISTORY_ANSWER_MAX = 1200; // characters of each earlier answer handed back

/** An answer, trimmed and cut to ANSWER_MAX: at the last line break before the limit when there is one, with an ellipsis. */
export function clipAnswer(text, max = ANSWER_MAX) {
  const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max), nl = head.lastIndexOf('\n');
  return (nl > 0 ? head.slice(0, nl) : head).trimEnd() + '…';
}

/**
 * The Ask turn: the earlier exchanges (history: [{ q, text }], oldest first, may be empty), the talk of the last ASK_WINDOW_MIN minutes,
 * then the question. Each earlier answer is clipped to ASK_HISTORY_ANSWER_MAX characters.
 */
export function askUser({ q, history = [], stamp, talk }) {
  const earlier = history.length
    ? 'Earlier this session, the GM asked and you answered (newest last):\n' + history.map((h) => 'GM: ' + h.q + '\nYou: ' + String(h.text || '').slice(0, ASK_HISTORY_ANSWER_MAX)).join('\n\n') + '\n\n'
    : '';
  return earlier + 'Talk of the last ' + ASK_WINDOW_MIN + ' minutes, up to ' + stamp + ':\n' + (talk || '(nothing heard)') + '\n\nThe GM asks: ' + q;
}
