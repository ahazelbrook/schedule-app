// room-seat (the Blade tap that tailors one room): Registered as a stub by RK01 of the room key build; RK16 fills it.
// It starts no Worker yet: it prints "stub", checks that the seat file is there and that the seat throws "not built" and is wired nowhere.
// RK16 tests the seat with the handler's injected fake client only; nothing here reads B68_ANTHROPIC_KEY. Its default port will be 9506.
//   node checks/api/room-seat.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEAT = 'functions/_lib/assist/room-seat.js';
assert.ok(fs.existsSync(path.join(ROOT, SEAT)), SEAT + ' exists');
const seat = await import('../../' + SEAT);
assert.equal(typeof seat.roomSeat, 'function', 'it exports roomSeat');
assert.throws(() => seat.roomSeat(), /not built/, 'and it throws "not built"');
for (const f of ['functions/api/gm/assist.js', 'functions/_lib/assist/seats.js']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) assert.ok(!/room-seat/.test(fs.readFileSync(p, 'utf8')), f + ' does not import the stub: RK16 wires it');
}
console.log('stub: room-seat fills in at RK16');
console.log('PASS room-seat: a stub');
