// GET /api/members -> { members: [ { id, name, role } ] }: everyone who has called /api/me.

import { getDb } from '../_lib/db.js';
import { roleFor } from '../_lib/auth.js';
import { json, methodNotAllowed } from '../_lib/http.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const db = await getDb(env);
  const { results } = await db
    .prepare('SELECT email, COALESCE(name_override, name) AS name FROM members ORDER BY COALESCE(name_override, name) COLLATE NOCASE, email LIMIT 1000')
    .all();
  const members = (results || []).map((r) => ({
    id: r.email,
    name: r.name || String(r.email).split('@')[0],
    // role follows the current GM_EMAILS, not the value stored at the member's last visit
    role: roleFor(r.email, env.GM_EMAILS),
  }));
  return json({ members });
}
