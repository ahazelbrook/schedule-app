// The fresh-talk (user) turn for the Fixer, shared by the Worker (functions/api/gm/assist.js) and the replay script, so a
// replay reads exactly what the table agent would. Generic text only: the draws and the talk arrive as arguments.

/**
 * position, effect: what the GM set. draws: { low, mid }, the console's own 1-3 and 4-5 draws as text.
 * stamp: "HH:MM" the talk runs up to. talk: the last five minutes as "[HH:MM] Name: text" lines.
 */
export function fitUser({ position, effect = '', draws, stamp, talk }) {
  const named = 'The GM names the position: ' + position + (effect ? '. Effect: ' + effect : '') + '.';
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

export const ITEM_KINDS = ['portrait', 'prop', 'wire', 'board', 'card'];
export const ITEM_MAX = 1500;               // characters in an item the gatekeeper checks
export const CITES_MAX = 8;                 // page cites per item
export const CITE_MAX = 60;                 // characters per cite

/** The gatekeeper turn: the kind, the item's text, and any page cites to spot-check. */
export function gatekeeperUser({ kind, text, cites = [] }) {
  return 'Item kind: ' + kind + '.\nItem text:\n' + text + (cites.length ? '\nPage cites to check against the rules reference:\n' + cites.map((c) => '- ' + c).join('\n') : '') +
    '\nCheck this item.';
}
