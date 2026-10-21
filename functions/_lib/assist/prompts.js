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
