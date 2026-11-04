#!/usr/bin/env node
// A3 (switch ai.batch): turn a night's local recording into a speaker-labelled transcript note in gm-private/batch.
//   npm run gm:batch-stt -- <recording> --fixture <answer.json> [--out <dir>] [--names "0=Name,1=Name"]
// This build runs against a FIXTURE answer only (the shape of the pre-recorded transcription response). The live call, which uses credit, is
// [TODO: not built; wire it once the players agree to recording]. Nothing here reads a key or opens a connection.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBatch } from './lib/batch-stt.mjs';

const args = process.argv.slice(2), opt = {}, rest = [];
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i]; else rest.push(args[i]); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = rest[0];
if (!file || !opt.fixture) { console.error('Usage: npm run gm:batch-stt -- <recording> --fixture <answer.json> [--out <dir>] [--names "0=Name"]'); process.exit(2); }
const names = {};
String(opt.names || '').split(',').forEach((p) => { const m = /^(\d+)=(.+)$/.exec(p.trim()); if (m) names[+m[1]] = m[2]; });
try {
  const r = await runBatch({ file, transcriber: async () => JSON.parse(fs.readFileSync(opt.fixture, 'utf8')), outDir: path.resolve(opt.out || path.join(REPO, 'gm-private', 'batch')), names });
  console.log('Wrote ' + r.out + ' (' + r.lines + ' lines, ' + r.speakers + ' speakers).');
} catch (e) { console.error(e.message); process.exit(1); }
