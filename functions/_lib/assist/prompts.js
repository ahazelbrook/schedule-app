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
