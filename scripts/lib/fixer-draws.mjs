// The console's two draws (a 1-3 and a 4/5) for a replay of the Fixer, either read from a small JSON file or drawn from a GM
// pack's console part with the console's own function and fixed seeds. Generic: it holds no table text itself.
//   drawsFor = makeDrawsFor({ moments: ['22:09', ...], file?, packFile?, seed?, position?, positionAt? })
//   drawsFor('22:09') -> { position, low, mid }   (low/mid in the text form the GM page sends: drawTextOf)
// The same moment list, seed and pack always give the same pairs.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function parsePositionAt(spec) {
  return Object.fromEntries(String(spec || '').split(',').filter(Boolean).map((x) => x.split('=').map((y) => y.trim())));
}

export function makeDrawsFor({ moments = [], file, packFile = path.join('gm-private', 'b68-gm-pack.json'), seed = 1, position = 'risky', positionAt = {} } = {}) {
  if (file) {
    const f = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (hhmm) => {
      const d = f[hhmm] || f.default;
      if (!d || typeof d.low !== 'string' || typeof d.mid !== 'string') throw new Error(`no draws for ${hhmm} in ${file}`);
      return { position: positionAt[hhmm] || d.position || position, low: d.low, mid: d.mid };
    };
  }
  const require = createRequire(import.meta.url);
  const Con = require('../../app/gm/console.js');
  const drawText = require('../../app/gm-page.js')._pure.drawTextOf;
  if (!fs.existsSync(packFile)) throw new Error(`no draws: give a draws file, or a GM pack at ${packFile}`);
  const parts = JSON.parse(fs.readFileSync(packFile, 'utf8')).parts || {};
  if (!parts.console || !parts.console.T) throw new Error('that pack has no console part');
  return (hhmm) => {
    const i = Math.max(0, moments.indexOf(hhmm)), pos = positionAt[hhmm] || position;
    const con = Con.create({ T: parts.console.T, campaign: parts.campaign || {}, mem: {} });
    const ui = { ...con.situationDefaults(), pos };
    return {
      position: pos,
      low: drawText(con.situation('onetothree', ui, { seed: seed + 2 * i, mem: {} })),
      mid: drawText(con.situation('fourfive', ui, { seed: seed + 2 * i + 1, mem: {} })),
    };
  };
}
