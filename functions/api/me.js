// GET /api/me -> { id, email, name, role, campaign }; records the caller in `members`.

import { getDb } from '../_lib/db.js';
import { json, methodNotAllowed, campaignOf, nowIso } from '../_lib/http.js';

export async function onRequest({ request, env, data }) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const me = data.me;
  const db = await getDb(env);
  await db
    .prepare(
      `INSERT INTO members (email, name, role, last_seen) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, last_seen = excluded.last_seen`
    )
    .bind(me.email, me.name, me.role, nowIso())
    .run();
  return json({ id: me.id, email: me.email, name: me.name, role: me.role, campaign: campaignOf(env) });
}
