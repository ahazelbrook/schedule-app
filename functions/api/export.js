// GET /api/export (GM only): a backup of this deployment's campaign as one JSON download.
//   -> { exportedAt, campaign: { id, doc, updatedAt }, characters: [ { id, doc, updatedAt } ],
//        members: [ { id, name, role } ] }
// Every live character of the campaign (not capped), sent as an attachment.

import { getDb } from '../_lib/db.js';
import { roleFor } from '../_lib/auth.js';
import { HttpError, json, methodNotAllowed, campaignOf } from '../_lib/http.js';
import { loadCampaignRow, campaignDoc } from '../_lib/campaign.js';
import { parseDoc } from '../_lib/characters.js';

export async function onRequest({ request, env, data }) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  if (data.me.role !== 'gm') throw new HttpError(403, 'only the GM can export');
  const id = campaignOf(env);
  const db = await getDb(env);
  const [row, chars, people] = await Promise.all([
    loadCampaignRow(db, id),
    db
      .prepare(
        `SELECT id, updated_at, doc FROM characters
         WHERE campaign = ?1 AND deleted = 0 ORDER BY updated_at DESC`
      )
      .bind(id)
      .all(),
    db.prepare('SELECT email, name FROM members ORDER BY name COLLATE NOCASE, email').all(),
  ]);
  const now = new Date().toISOString();
  const body = {
    exportedAt: now,
    campaign: { id, doc: campaignDoc(row), updatedAt: row ? row.updated_at : null },
    characters: (chars.results || []).map((r) => ({ id: r.id, doc: parseDoc(r), updatedAt: r.updated_at })),
    members: (people.results || []).map((r) => ({
      id: r.email,
      name: r.name || String(r.email).split('@')[0],
      role: roleFor(r.email, env.GM_EMAILS),
    })),
  };
  const safe = id.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'campaign';
  return json(body, 200, {
    'Content-Disposition': 'attachment; filename="blades68-' + safe + '-' + now.slice(0, 10) + '.json"',
  });
}
