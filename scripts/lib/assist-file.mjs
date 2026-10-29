// The assist prefix as a file in Anthropic's Files API ("Claude at the table", functions/api/gm/assist.js).
//
// The Worker must never hold the prefix (Workers Free: 10 ms CPU), so the GM's PC uploads it as a plain-text file when the
// `assist` part is pushed, and the pushed part carries only { file_id, hash, extra }. This module owns that:
//
//   preparePart(body, opts)  -> the small part body to push (or a plan, in a dry run)
//   finishPart(opts)         -> after the part is safely in D1, delete the file the new one replaced
//
// The last upload is remembered in gm-private/assist-file.json as { hash, file_id, replaces? }. The text is uploaded only
// when its SHA-256 differs from the remembered hash. The replaced file is deleted AFTER the new part is in D1 (deleting
// first would leave the Worker pointing at a missing file for the gap); `replaces` keeps that pending delete across a
// crash. A dry run reads the state file and nothing else: no upload, no delete, no key needed.
//
// The key is B68_ANTHROPIC_KEY (never ANTHROPIC_API_KEY). It is only handed to the SDK, never printed or written.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Anthropic, { toFile } from '@anthropic-ai/sdk';

export const STATE_NAME = 'assist-file.json';
export const FILE_NAME = 'assist-prefix.txt';
export const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && typeof s.hash === 'string' && typeof s.file_id === 'string' ? s : null;
  } catch (_) { return null; }
}
function writeState(file, s) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

/** A Files API client from B68_ANTHROPIC_KEY, or null when it is not set. */
export function defaultClient(env = process.env) {
  const key = env.B68_ANTHROPIC_KEY;
  return key ? new Anthropic({ apiKey: key }) : null;
}

/**
 * body: the local assist part body { prefix, extra?, ... }. opts: { stateFile, client (or null), dryRun }.
 * Returns { body, action, note }: body is { file_id, hash, extra?, roster? } to push; action is 'reuse' | 'upload' | 'would-upload'
 * (dry run only) | 'no-key'. A body that has no prefix text (already the small form) passes through as 'as-is'.
 */
export async function preparePart(body, { stateFile, client, dryRun = false }) {
  const extra = body.extra && typeof body.extra === 'object' ? body.extra : undefined;
  const roster = body.roster && typeof body.roster === 'object' ? body.roster : undefined;      // the players and the GM, for Who is who: pushed beside the file id
  if (typeof body.prefix !== 'string') return { body, action: 'as-is', note: '' };
  const hash = sha256(body.prefix);
  const state = readState(stateFile);
  const small = (file_id) => ({ file_id, hash, ...(extra ? { extra } : {}), ...(roster ? { roster } : {}) });
  if (state && state.hash === hash) return { body: small(state.file_id), action: 'reuse', note: 'the prefix is unchanged: file ' + state.file_id + ' is reused' };
  if (dryRun) {
    return { body: small('file_NEW_UPLOAD'), action: 'would-upload', note: 'would upload the prefix (' + body.prefix.length + ' characters) as ' + FILE_NAME + (state ? ' and, once the part is pushed, delete the file it replaces (' + state.file_id + ')' : '') };
  }
  if (!client) return { body: null, action: 'no-key', note: 'pushing the assist part uploads its prefix to Anthropic and needs B68_ANTHROPIC_KEY (a user environment variable)' };
  const up = await client.files.upload({ file: await toFile(Buffer.from(body.prefix, 'utf8'), FILE_NAME, { type: 'text/plain' }) });
  const id = up && up.id;
  if (typeof id !== 'string' || !id) throw new Error('the Files API upload returned no file id');
  const replaces = state ? state.file_id : '';
  writeState(stateFile, { hash, file_id: id, ...(replaces && replaces !== id ? { replaces } : {}) });
  return { body: small(id), action: 'upload', note: 'uploaded the prefix as ' + id };
}

/**
 * After the part is in D1: delete the replaced file. A failed delete is reported, not thrown (the file just lingers;
 * the next push tries again). A 404 counts as deleted. -> { deleted: id | '', note }
 */
export async function finishPart({ stateFile, client }) {
  const s = readState(stateFile);
  const old = s && typeof s.replaces === 'string' ? s.replaces : '';
  if (!old || !client) return { deleted: '', note: '' };
  try {
    await client.files.delete(old);
  } catch (e) {
    if (!(e && e.status === 404)) return { deleted: '', note: 'could not delete the replaced file ' + old + ' (' + (e && Number.isInteger(e.status) ? 'status ' + e.status : 'call failed') + '); the next push retries' };
  }
  const { replaces, ...keep } = s;
  writeState(stateFile, keep);
  return { deleted: old, note: 'deleted the replaced file ' + old };
}
