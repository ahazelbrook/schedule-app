// GET   /api/me -> { id, email, name, role, campaign }; records the caller in `members`.
//   name is COALESCE(name_override, name): the name the person chose, else the one from the Access claim / email.
// PATCH /api/me { name } -> the same shape as GET. Sets the caller's own display name (nobody can set another person's:
//   the row is always the caller's email). The name is trimmed, runs of whitespace become one space, 1-40 characters,
//   no control or invisible-format characters, no `<` or `>`. "" or null clears it back to the Access-derived name.
//   Only `name_override` is written: the sign-in upsert below never touches it.

import { getDb } from '../_lib/db.js';
import { HttpError, json, methodNotAllowed, campaignOf, nowIso, readJsonObject } from '../_lib/http.js';

export const NAME_MAX = 40;

// -> the cleaned name, or null when it is empty (clear the override). Throws a 400 for anything not acceptable.
export function cleanName(v) {
  if (v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, 'name must be a string, or null to clear it');
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(s)) throw new HttpError(400, 'name has a control character');
  if (/[<>]/.test(s)) throw new HttpError(400, 'name cannot contain < or >');
  if ([...s].length > NAME_MAX) throw new HttpError(400, 'name is too long (at most ' + NAME_MAX + ' characters)');
  return s;
}

async function shape(db, me, env) {
  const row = await db.prepare('SELECT name_override FROM members WHERE email = ?1').bind(me.email).first();
  const name = (row && row.name_override) || me.name;
  return json({ id: me.id, email: me.email, name, role: me.role, campaign: campaignOf(env) });
}

export async function onRequest({ request, env, data }) {
  const method = request.method;
  if (method !== 'GET' && method !== 'PATCH') return methodNotAllowed(['GET', 'PATCH']);
  const me = data.me;
  let override = null;   // PATCH only: the new override (a string), or null to clear
  if (method === 'PATCH') {
    const body = await readJsonObject(request, 4 * 1024);
    if (!('name' in body)) throw new HttpError(400, 'name is required (null or "" clears it)');
    override = cleanName(body.name);
  }
  const db = await getDb(env);
  // the sign-in upsert: name/role/last_seen only, never name_override
  await db
    .prepare(
      `INSERT INTO members (email, name, role, last_seen) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, last_seen = excluded.last_seen`
    )
    .bind(me.email, me.name, me.role, nowIso())
    .run();
  if (method === 'PATCH') {
    await db.prepare('UPDATE members SET name_override = ?2 WHERE email = ?1').bind(me.email, override).run();
  }
  return shape(db, me, env);
}
