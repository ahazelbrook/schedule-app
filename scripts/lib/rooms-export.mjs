// scripts/lib/rooms-export.mjs: the room tables in the vault into the pack's `rooms` part (room.tables).
// Registered as a stub by RK01 of the room key build; RK12 builds it. scripts/gm-pack.mjs does not call it yet.
//
//   exportRooms(dir) -> { part, errors, warnings }
//     part      the `rooms` part: { v: 1, T: { rooms: {}, roles: {}, aliases: {} } } (the shape is checks/runtime/fixtures/gm/rooms-pack.json; T so the CHECKED loop can call check(body.T))
//     errors    strings; the check mode (npm run gm:rooms-check <folder>) exits 1 on any
//     warnings  strings
//   Until RK12 the part is empty and there are no errors.
//
// Check mode: node scripts/lib/rooms-export.mjs --check <folder>
import { fileURLToPath } from 'node:url';

export function emptyPart() {
  return { v: 1, T: { rooms: {}, roles: {}, aliases: {} } };
}

export function exportRooms(dir) {
  void dir;
  return { part: emptyPart(), errors: [], warnings: [] };
}

function main(argv) {
  const i = argv.indexOf('--check');
  const dir = i >= 0 ? argv[i + 1] : argv.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node scripts/lib/rooms-export.mjs --check <folder of room table pages>'); return 2; }
  const r = exportRooms(dir);
  r.warnings.forEach((w) => console.log('warning: ' + w));
  r.errors.forEach((e) => console.log('ERROR: ' + e));
  console.log('rooms: ' + Object.keys(r.part.T.rooms).length + ' room(s), ' + r.errors.length + ' error(s), ' + r.warnings.length + ' warning(s) (stub until RK12)');
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
