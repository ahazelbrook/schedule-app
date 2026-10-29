// GET /api/table/screen: a copy of what the iPad is showing, for the phones' Table button (MM1, design 2.4). Any signed-in member may
// read it: a player, the GM, and the table display's own sign-in (auth.js DISPLAY_ALLOWED and the middleware's DISPLAY_FUNCTIONS).
// The rule is the same for all of them, because nobody is handed anything but a copy of the stored display:
//   { seq, kind: 'svg', svg, title?, caption? }   a map: the very string the iPad was given
//   { seq, kind: 'handout', file, title? }         a handout: the plain image file name (the page loads media/handouts/<file>, which
//                                                  the static server serves to every signed-in member); title only when the iPad shows it
//   { seq, kind: 'none' }                          everything else: blank (the ambient scene), lights out, an NPC, text, a rule,
//                                                  cards; the mirror switch off; nothing stored; a hidden name found in what would go
// The route takes no parameter at all, so there is no way to ask for another file or another part of the display. GET only; no body.
// functions/_lib/table-screen.js says how the answer is made and how the hidden-name scan works.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { loadTableScreen } from '../../_lib/table-screen.js';

export async function onRequest({ request, env, data }) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const role = data && data.me && data.me.role;
  if (role !== 'player' && role !== 'gm' && role !== 'display') return json({ error: 'not signed in' }, 401);
  return json(await loadTableScreen(await getDb(env), campaignOf(env)));
}
