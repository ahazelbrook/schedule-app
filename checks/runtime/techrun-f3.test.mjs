// The tech run fixes, F3 (06/11/2026): the Tonight box's Start and Curfew, and the hard start after a GM page reload (no browser, no network, no key).
// INVENTED data only.
//   1. timesClash: a curfew must come after the start within 12 hours (one past midnight is fine); the line names both times
//   2. the hard start adopts what the ambient document holds: after a reload (a new controller) the start scene arms the sheet again with its time,
//      Test, the faces laid and the names shown; a document with no start leaves it unarmed; one taken down elsewhere disarms it
//   3. the guards: nothing is adopted while the page's own writes are under way, nor from a document no newer than its own last arm or end
//   node checks/runtime/techrun-f3.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const P = req(path.join(ROOT, 'app', 'gm', 'places.js'));
const HS = req(path.join(ROOT, 'app', 'gm', 'hardstart.js'));

await test('timesClash: the curfew after the start, within 12 hours; past midnight is fine; a missing time is never a clash', () => {
  assert.equal(P.timesClash('curfewAt', '19:30', '22:40'), '');
  assert.equal(P.timesClash('curfewAt', '20:00', '00:30'), '', 'a curfew after midnight');
  assert.equal(P.timesClash('startAt', '23:30', '02:00'), '');
  assert.equal(P.timesClash('curfewAt', '19:00', '07:00'), '', 'exactly 12 hours');
  assert.match(P.timesClash('curfewAt', '23:00', '22:00'), /^Not saved: a 22:00 curfew is before the 23:00 start/);
  assert.match(P.timesClash('startAt', '23:00', '22:00'), /^Not saved: a 23:00 start is after the 22:00 curfew/);
  assert.match(P.timesClash('curfewAt', '19:30', '19:30'), /Not saved/, 'the same time is no night');
  assert.match(P.timesClash('curfewAt', '19:30', '07:31'), /Not saved/, 'past 12 hours: an AM/PM slip (07:31 for 19:31)');
  assert.equal(P.timesClash('curfewAt', null, '22:00'), ''); assert.equal(P.timesClash('startAt', '19:30', ''), ''); assert.equal(P.timesClash('curfewAt', 'nonsense', '22:00'), '');
});

/* a host the controller writes through: the ambient document is a plain object the writes change, with a seq that counts them */
const CAST = {
  n_a: { name: 'Mabel Quist', role: 'Fixer', revealed: true, firstSeen: '2026-10-01T10:00:00.000Z' },
  n_b: { name: 'Dov Kessler', role: 'Desk sergeant', revealed: true, firstSeen: '2026-10-08T10:00:00.000Z' },
  n_c: { name: 'Lotte Brand', role: 'Doorwoman', revealed: true, firstSeen: '2026-10-15T10:00:00.000Z' },
  n_d: { name: 'Ada Vell', role: 'Bookmaker', revealed: true, firstSeen: '2026-10-22T10:00:00.000Z' },
  n_h: { name: 'GM-ONLY-NPC-1', role: 'GM-ONLY-ROLE-1', revealed: false }
};
function server() {
  const amb = { seq: 1, layers: { scene: {}, data: {}, band: {} } };
  return {
    amb,
    write(p, v) { const [g, k] = p.split('.'); amb.layers[g] = amb.layers[g] || {}; if (v === null) delete amb.layers[g][k]; else amb.layers[g][k] = JSON.parse(JSON.stringify(v)); amb.seq++; },
    air(doc) { const L = doc.layers, cd = L.data.countdown || {}; return { start: L.scene.mode === 'start', to: cd.to, label: cd.label, previously: L.data.previously, faces: L.band.faces, seq: doc.seq }; }
  };
}
/* the page: its copy of the ambient document (null until read), its layer writer (the response is its new copy, as patchAmbient adopts it) */
function page(srv, o = {}) {
  const pg = { copy: o.unread ? null : JSON.parse(JSON.stringify(srv.amb)), t: o.t || 1_000_000, gate: null };
  pg.ctl = HS.make({
    npcs: () => CAST, now: () => pg.t,
    layer: (p, v) => {
      const go = () => { srv.write(p, v); pg.copy = JSON.parse(JSON.stringify(srv.amb)); pg.ctl.sync(); return { ok: true }; };
      return pg.gate ? pg.gate.then(go) : Promise.resolve(go());
    },
    onAir: () => (pg.copy ? srv.air(pg.copy) : null)
  });
  return pg;
}

await test('after a reload: the start scene on the iPad arms the sheet again, with its time, Test, the three faces laid and the name shown', async () => {
  const srv = server(), a = page(srv);
  assert.equal(a.ctl.state().armed, false, 'nothing on the iPad: not armed');
  assert.ok(a.ctl.setPick(0, 'n_a'), 'the GM picks a face of their own (not one of the default three)');
  assert.equal(await a.ctl.armTest(2), true);
  assert.equal(await a.ctl.reveal(0), true);
  const at = a.ctl.state().at, picks = a.ctl.state().picks;
  assert.deepEqual(picks, ['n_a', 'n_c', 'n_b']);
  /* the reload: a new controller, knowing nothing but the document */
  const b = page(srv, { unread: true });
  assert.equal(b.ctl.state().armed, false, 'the document not read yet: nothing claimed');
  b.copy = JSON.parse(JSON.stringify(srv.amb));
  assert.equal(b.ctl.sync(), true, 'the document arrives: the sheet changes');
  const s = b.ctl.state();
  assert.equal(s.armed, true); assert.equal(s.at, at); assert.equal(s.test, true, 'a Test arm stays a test');
  assert.deepEqual(s.picks, picks, 'the faces laid on the iPad, not the default three');
  assert.deepEqual(s.shown, [0], 'the name already shown');
  assert.equal(b.ctl.sync(), false, 'nothing new: no redraw');
  assert.equal(await b.ctl.go(), true, 'GO now works after the reload');
  assert.equal(srv.amb.layers.data.countdown.to, b.t);
  assert.equal(await b.ctl.reveal(1), true);
  assert.deepEqual(srv.amb.layers.band.faces.map((f) => f.npcId), [picks[0], picks[1]], 'a second reveal keeps the first name shown');
  /* a reload where the document arrives before the cast does: the faces and the name shown are still the ones laid once the cast is in */
  let cast = {};
  const c = HS.make({ npcs: () => cast, now: () => 1, layer: () => ({ ok: true }), onAir: () => srv.air(srv.amb) });
  assert.equal(c.state().armed, true, 'armed from the document alone');
  cast = CAST;
  assert.deepEqual(c.state().picks, picks); assert.deepEqual(c.state().shown, [0, 1]);
});

await test('after End or Roll, a reload does not come back armed; a start taken down elsewhere disarms the sheet', async () => {
  const srv = server(), a = page(srv);
  await a.ctl.arm(5_000_000);
  assert.equal(await a.ctl.end(), true);
  assert.equal(page(srv).ctl.state().armed, false, 'reload after End: not armed');
  const r = page(srv); await r.ctl.arm(5_000_000);
  let pinned = 0;
  const host = page(srv); assert.equal(host.ctl.state().armed, true);
  const rollable = HS.make({ npcs: () => CAST, now: () => 1, layer: (p, v) => { srv.write(p, v); return { ok: true }; }, onAir: () => srv.air(srv.amb), onTitles: () => { pinned++; return true; } });
  assert.equal(rollable.state().armed, true);
  assert.equal(await rollable.roll(), true); assert.equal(pinned, 1);
  assert.equal(page(srv).ctl.state().armed, false, 'reload after Roll: not armed');
  /* armed here, then the start comes down on another device: the next document disarms this sheet */
  const c = page(srv); await c.ctl.arm(5_000_000);
  const other = page(srv); assert.equal(other.ctl.state().armed, true); await other.ctl.end();
  assert.equal(c.ctl.state().armed, true, 'this page has not seen it yet');
  c.copy = JSON.parse(JSON.stringify(srv.amb));
  assert.equal(c.ctl.sync(), true); assert.equal(c.ctl.state().armed, false);
});

await test('guards: no adopting from a half-written document while this page writes, nor from one no newer than its own End', async () => {
  const srv = server(), a = page(srv);
  let open; a.gate = new Promise((res) => { open = res; });
  const arming = a.ctl.arm(5_000_000);
  /* mid-arm, a document that already says start (another read landing) changes nothing until the arm is done */
  a.copy = { seq: 99, layers: { scene: { mode: 'start' }, data: { countdown: { to: 1, label: 'Station clock' } }, band: {} } };
  assert.equal(a.ctl.sync(), false, 'busy: not adopted');
  open(); assert.equal(await arming, true);
  assert.equal(a.ctl.state().at, 5_000_000, 'its own arm, not the stray read');
  a.gate = null;
  const before = JSON.parse(JSON.stringify(srv.amb));      /* a read taken while it was armed */
  assert.equal(await a.ctl.end(), true);
  a.copy = before;                                          /* lands after the End: seq no newer than the End's own */
  assert.equal(a.ctl.sync(), false); assert.equal(a.ctl.state().armed, false, 'a stale document does not re-arm right after End');
  a.copy = JSON.parse(JSON.stringify(srv.amb)); a.copy.seq += 5; a.copy.layers.scene = { mode: 'start' }; a.copy.layers.data = { countdown: { to: 7_000_000, label: 'Station clock' } };
  assert.equal(a.ctl.sync(), true, 'a newer document with the start (armed on another device) is adopted');
  assert.equal(a.ctl.state().at, 7_000_000);
  /* without a seq, the guard is time: 5 seconds after this page's own End */
  const n = HS.make({ npcs: () => CAST, now: () => n.t, layer: () => ({ ok: true }), onAir: () => n.air });
  n.t = 10_000; n.air = { start: true, to: 50_000, label: 'Station clock', seq: null };
  assert.equal(n.state().armed, true); await n.end(); assert.equal(n.state().armed, false, 'just ended: the old start in the copy is not adopted');
  n.t += 6000; assert.equal(n.state().armed, true, 'later, the document is the truth again');
  assert.equal(HS.make({ npcs: () => CAST, onAir: () => ({ start: true, to: 'x' }) }).state().armed, false, 'a start with no countdown is not an arm');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
