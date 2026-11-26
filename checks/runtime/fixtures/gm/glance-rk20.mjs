// RK20 (gm.glance): the crew at a glance. The browser half of the check, run by checks/runtime/glance.e2e.mjs on the demo night (the invented Pelican Rooms; the Dovetail
// Crew: Nell Arbuthnot, Ray Okonjo, Tam Petrakis). No model, no key, $0. The data is checks/runtime/fixtures/gm/glance-crew.mjs.
//   off      the glance files are never fetched, and the rail's first box is the Crew box it always was
//   on       the old desk at 1366x768: the fixture night's recap (harm, stacks, crew type, preferred operations, a deadlock's direction and word) reads off one panel, all on screen;
//            nothing under 12 px; no sideways scroll at 1366, 1024 or 390 wide
//   live     a PC's Stress tick repaints the panel alone (the rail's other boxes stay the same nodes); a crew change repaints it
//   kit      the same recap on the kit desk
//   off live turning gm.glance off on the open page brings the old Crew box back, byte for byte
//   secrecy  the display's GET, a phone's /api/table/screen, the iPad's DOM and a phone's DOM hold none of it, and neither fetches a glance file
//   shots    RK_SHOTS=<dir>: rk20-old-* (kit.desk off) and rk20-kit-* (kit.desk on), 1366x768 and 1536x864, Paper and Night; 1024x768; 390x844
// The part resets gm.glance and kit.desk at its start (the harness does, and so does reset() below), puts back the campaign and the three characters it changed, and leaves both settings off.
import fs from 'node:fs';
import path from 'node:path';
import { CREW, CLOCKS, RAW } from './glance-crew.mjs';

const P2 = 'player2@example.test', P3 = 'player3@example.test';
const L = 'RK20: ';
const FEATS_OFF = { 'gm.glance': false, 'kit.desk': false };
const setFeats = async (c, f) => { await c.api('PATCH', '/gm/state', { features: f }); await c.api('PATCH', '/campaign', { features: f }); };
export const reset = (c) => setFeats(c, FEATS_OFF);

export async function rk20(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, SHOTS } = c;
  const OWNERS = { 'pc-nell': [P1, RAW[0]], 'pc-ray': [P2, RAW[1]], 'pc-tam': [P3, RAW[2]] };
  const saved = { campaign: null, chars: {} };
  const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, 'rk20-' + name + '.png'), animations: 'disabled' }); };
  /* the GM page with the drawer open on its Table tab (the rail lives there) */
  async function open({ w = 1366, h = 768, theme = 'paper', kit = false } = {}) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await ctx.addInitScript({ content: 'window.__B68_POLL_MS = 1000; try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); localStorage.setItem("b68.gm.drawer", "1"); } catch (e) {}' });
    const page = await ctx.newPage(), fetched = [];
    page.on('request', (r) => fetched.push(r.url()));
    page.on('pageerror', (e) => errors.push('rk20 gm: ' + e.message));
    page.on('dialog', (d) => d.dismiss());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me && window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 40000 });
    if (kit) await page.waitForFunction(() => window.B68Kit && window.B68Kit.ready('desk') && window.B68KitRun, null, { timeout: 30000 });
    await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); }); await page.waitForTimeout(600);
    return { ctx, page, fetched };
  }
  const panelText = (page) => page.evaluate(() => { const e = document.querySelector('#gl-crew'); return e ? e.innerHTML.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').replace(/(\d) \/(\d)/g, '$1/$2') : ''; });
  const railBox = (page) => page.evaluate(() => { const b = document.querySelector('#gm-rail .gm-box'); return b ? b.outerHTML : ''; });
  const kitOf = (page) => page.evaluate(() => document.documentElement.getAttribute('data-kit') || '');
  const recap = async (page, where) => {
    const t = await panelText(page);
    for (const s of ['Crew: The Dovetail Crew', 'Shadows', 'Tier 1', 'Surveillance', 'Heists', 'Subterfuge', 'Cleanup', 'Hunting grounds: The ferry quays', 'Hidden', 'Vault 1/2', 'The Lamplighters', 'gang', 'weak', 'Ada Vell',
      '4 held', 'Turf ×2', 'Informants', 'Buy the ferry office', '3/8', 'Heat 3/9', 'Wanted 1/4', 'Rep 5/12', 'Stacks 6', 'Vault 6/16',
      'Nell Arbuthnot', 'Stress 5/9', 'XP 4/8', 'Stacks 2', '3 Critical Broken arm', '2 Major Cracked jaw', '1 Passing Bruised ribs', 'Deadlocks KEY-1 ▼ reversed Takes the long way round',
      'Ray Okonjo', 'Stress 2/9', 'XP 6/8', '2 Major Cut hand', 'Tam Petrakis', 'Stress 9/9 full', 'Stacks 5', 'No harm']) {
      if (!t.includes(s)) { check(false, L + where + ': the panel shows "' + s + '" in: ' + t); return false; }
    }
    return true;
  };
  const geoOf = (page) => page.evaluate(() => {
    const e = document.querySelector('#gl-crew'), r = e.getBoundingClientRect(), pane = e.closest('.gm-dpane'), small = [], pips = [...e.querySelectorAll('.gl-crew-proj .gm-clock i')].map((i) => Math.round(i.getBoundingClientRect().width * 10) / 10);
    e.querySelectorAll('*').forEach((n) => { if ([...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 12) small.push(n.className + ':' + parseFloat(getComputedStyle(n).fontSize)); });
    return { top: r.top, bottom: r.bottom, vh: innerHeight, over: e.scrollWidth - e.clientWidth, paneOver: pane.scrollWidth - pane.clientWidth, docOver: document.documentElement.scrollWidth - innerWidth, small, pips, first: !!document.querySelector('#gm-rail > .gm-box:first-of-type#gl-crew') };
  });

  try {
    /* the invented night: the Dovetail Crew with a playbook, grounds, upgrades, cohorts, claims and a project clock; three PCs with Stress, harm, xp and a deadlocked key. The originals go back at the end. */
    const camp = (await api('GET', '/campaign', undefined, P1)).json.doc; saved.campaign = camp;
    check((await api('PUT', '/campaign', { v: 1, session: camp.session, crew: CREW, clocks: CLOCKS, log: [] })).status === 200, L + 'the table is set up: the Dovetail Crew, a project clock, a hidden one');
    for (const [id, [who, raw]] of Object.entries(OWNERS)) {
      const doc = (await api('GET', '/characters/' + id)).json.doc; saved.chars[id] = [who, doc];
      const play = { ...doc.play, stress: raw.play.stress, harm: raw.play.harm, xp: raw.play.xp, stacks: raw.play.stacks };
      play.keys = (doc.play.keys || []).map((k, i) => (raw.play.keys[i] ? { ...k, deadlock: raw.play.keys[i].deadlock } : k));
      check((await api('PUT', '/characters/' + id, { ...doc, play }, who)).status === 200, L + 'a player files ' + doc.name + ' (Stress ' + raw.play.stress + ', xp ' + raw.play.xp.playbook + ')');
    }

    /* ---- 1. off ---- */
    await setFeats(c, FEATS_OFF);
    const A = await open();
    await A.page.waitForSelector('#gm-rail .gm-stats', { timeout: 20000 }); await A.page.waitForTimeout(1500);
    check(!A.fetched.some((u) => /\/gm\/glance(-crew)?\.(js|css)/.test(u)) && !(await A.page.evaluate(() => !!window.B68GmGlanceCrew)), L + 'off: the GM page fetches no glance file and has no glance-crew module');
    const off = await railBox(A.page);
    check(/Crew: The Dovetail Crew/.test(off) && (off.match(/class="gm-stat"/g) || []).length === 5 && /read-only here; change it on <a href="#t">the table<\/a>/.test(off) && !(await A.page.$('#gl-crew')), L + 'off: the rail\'s first box is the old Crew box (the five stats, the table link), and there is no glance panel');
    await A.ctx.close();

    /* ---- 2. on, the old desk ---- */
    await setFeats(c, { 'gm.glance': true, 'kit.desk': false });
    const B = await open(), p = B.page;
    check(B.fetched.some((u) => /\/gm\/glance-crew\.js/.test(u)) && B.fetched.some((u) => /\/gm\/glance\.css/.test(u)), L + 'on: the gm-glance bundle (glance-crew.js, glance.css) is fetched');
    await p.waitForSelector('#gl-crew', { timeout: 20000 }); await p.waitForTimeout(800);
    check(await recap(p, 'old desk'), L + 'old desk 1366x768: the fixture night\'s recap (harm, stacks, crew type, preferred operations, a deadlock\'s direction and word) reads off the one panel');
    const geo = await geoOf(p);
    check(!/desk/.test(await kitOf(p)), L + 'old desk: kit.desk is off on this page');
    check(geo.small.length === 0, L + 'old desk: nothing in the panel is under 12 px (' + geo.small.slice(0, 4).join(', ') + ')');
    check(geo.over <= 0 && geo.paneOver <= 0, L + 'old desk: no sideways scroll (' + geo.over + ', ' + geo.paneOver + ')');
    check(geo.bottom <= geo.vh && geo.top >= 0, L + 'old desk 1366x768: the whole panel is on screen at once (top ' + Math.round(geo.top) + ', bottom ' + Math.round(geo.bottom) + ' of ' + geo.vh + ')');
    check(geo.pips.length === 14 && geo.pips.every((w) => w >= 6), L + 'old desk: the project clocks\' segments have a real width (' + geo.pips.join(', ') + ')');
    check(geo.first, L + 'the panel is the rail\'s first box, where the Crew box was');
    await shot(p, 'old-paper-1366x768');

    /* ---- 3. live: a tick repaints the panel alone; a crew change repaints it too ---- */
    await p.evaluate(() => { const s = document.querySelector('#gm-rail .gm-clocks') || document.querySelector('#gm-rail .gm-box:last-of-type'); window.__keep = s; s.setAttribute('data-keep', '1'); });
    check((await api('PATCH', '/characters/pc-nell', { play: { stress: 7 } }, P1)).status === 200, L + 'Nell\'s player ticks her Stress to 7');
    check(await until(async () => /Stress 7\/9/.test(await panelText(p)), 15000), L + 'the panel follows, with no reload');
    check(await p.evaluate(() => !!document.querySelector('#gm-rail [data-keep="1"]') && window.__keep.isConnected), L + 'and only the panel was redrawn (the rail\'s other boxes are the same nodes)');
    check((await api('PATCH', '/campaign', { crew: { heat: 5 } })).status === 200 && await until(async () => /Heat 5\/9/.test(await panelText(p)), 15000), L + 'a crew change (Heat 5) repaints it');
    check((await api('PATCH', '/campaign', { crew: { heat: 3 } })).status === 200 && (await api('PATCH', '/characters/pc-nell', { play: { stress: 5 } }, P1)).status === 200 && await until(async () => /Heat 3\/9/.test(await panelText(p)) && /Stress 5\/9/.test(await panelText(p)), 15000), L + 'and back');
    await B.ctx.close();

    /* ---- 4. the old desk's other shots (kit.desk is off here), then the kit desk ---- */
    for (const [w, hh, theme] of [[1366, 768, 'night'], [1536, 864, 'paper'], [1536, 864, 'night']]) {
      const O = await open({ w, h: hh, theme }); await O.page.waitForSelector('#gl-crew', { timeout: 20000 });
      check(!/desk/.test(await kitOf(O.page)), L + 'shot old-' + theme + '-' + w + 'x' + hh + ' is the old desk (kit.desk off)');
      await shot(O.page, 'old-' + theme + '-' + w + 'x' + hh); await O.ctx.close();
    }
    for (const [w, hh, name] of [[1024, 768, 'ipad'], [390, 844, 'phone']]) {
      const S = await open({ w, h: hh }); await S.page.waitForSelector('#gl-crew', { timeout: 20000 }); await S.page.waitForTimeout(600);
      const g3 = await geoOf(S.page);
      check(g3.over <= 0 && g3.docOver <= 0, L + name + ' width: the panel fits (no sideways scroll: ' + g3.over + ', page ' + g3.docOver + ')');
      await shot(S.page, 'old-paper-' + name + '-' + w + 'x' + hh); await S.ctx.close();
    }
    await setFeats(c, { 'gm.glance': true, 'kit.desk': true });
    for (const [w, hh] of [[1366, 768], [1536, 864]]) for (const theme of ['paper', 'night']) {
      const K = await open({ w, h: hh, theme, kit: true }); await K.page.waitForSelector('#gl-crew', { timeout: 20000 }); await K.page.waitForTimeout(700);
      if (w === 1366 && theme === 'paper') {
        check(await recap(K.page, 'kit desk'), L + 'kit desk 1366x768: the same recap reads off the one panel');
        const g2 = await geoOf(K.page);
        check(/desk/.test(await kitOf(K.page)) && g2.small.length === 0 && g2.over <= 0 && g2.bottom <= g2.vh, L + 'kit desk: the kit is on, nothing under 12 px, no sideways scroll, the whole panel on screen (bottom ' + Math.round(g2.bottom) + ' of ' + g2.vh + ')');
        check(g2.pips.length === 14 && g2.pips.every((x) => x >= 6), L + 'kit desk: the project clocks\' segments have a real width (' + g2.pips.join(', ') + ')');
      } else check(/desk/.test(await kitOf(K.page)), L + 'shot kit-' + theme + '-' + w + 'x' + hh + ' is the kit desk');
      await shot(K.page, 'kit-' + theme + '-' + w + 'x' + hh); await K.ctx.close();
    }
    await setFeats(c, { 'gm.glance': true, 'kit.desk': false });

    /* ---- 5. off again, live ---- */
    const C = await open(); await C.page.waitForSelector('#gl-crew', { timeout: 20000 });
    await setFeats(c, FEATS_OFF);
    /* the GM page takes another device's state change when the window gets focus again (gm-page.js refetch), so the test gives it that */
    check(await until(async () => { await C.page.evaluate(() => window.dispatchEvent(new Event('focus'))); return !(await C.page.$('#gl-crew')); }, 30000, 1500), L + 'gm.glance goes off on the open page: the panel goes');
    const back = await railBox(C.page);
    check(back === off, L + 'and the rail\'s first box is the old Crew box again, byte for byte' + (back === off ? '' : '\n  off:  ' + off.slice(0, 300) + '\n  back: ' + back.slice(0, 300)));
    await C.ctx.close();

    /* ---- 6. secrecy ---- */
    await setFeats(c, { 'gm.glance': true, 'kit.desk': false });
    const G = await open(); await G.page.waitForSelector('#gl-crew', { timeout: 20000 });
    const SECRET = /GM-ONLY-PROJECT|gl-crew|glance-crew|Broken arm|Cracked jaw|Bruised ribs|Cut hand|KEY-1/;
    const disp = await api('GET', '/gm/display', undefined, IPAD), scr = await api('GET', '/table/screen', undefined, P1), tam = await api('GET', '/characters/pc-tam', undefined, P2);
    check(disp.status === 200 && scr.status === 200 && !SECRET.test(disp.text + scr.text), L + 'secrecy: the display\'s GET and a phone\'s /api/table/screen hold none of the glance (no panel, no harm text, no hidden project clock)');
    check(tam.status === 403 || tam.status === 404 || !/Broken arm|Cracked jaw/.test(tam.text), L + 'secrecy: another player\'s character GET holds no Nell harm text');
    const ip = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' }), ipUrls = [];
    const dp = await ip.newPage(); dp.on('request', (r) => ipUrls.push(r.url())); await dp.goto(BASE + '/#display'); await dp.waitForTimeout(6000);
    const ph = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P2 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }), phUrls = [];
    const pp = await ph.newPage(); pp.on('request', (r) => phUrls.push(r.url())); await pp.goto(BASE + '/#c/pc-ray'); await pp.waitForTimeout(6000);
    const dom = (await dp.evaluate(() => document.documentElement.outerHTML)) + (await pp.evaluate(() => document.documentElement.outerHTML));
    check(dom.length > 2000 && !/gl-crew|GM-ONLY-PROJECT|Broken arm|Cracked jaw|Bruised ribs/.test(dom), L + 'secrecy: the iPad\'s and a phone\'s DOM hold no glance panel and no one else\'s harm text');
    check(![...ipUrls, ...phUrls].some((u) => /glance-crew|\/gm\/glance\.css/.test(u)), L + 'secrecy: neither the iPad nor a phone fetches a glance file');
    await ip.close(); await ph.close(); await G.ctx.close();
  } finally {
    /* put back what the part changed, and leave both settings off (the harness resets them again) */
    try {
      await setFeats(c, FEATS_OFF);
      if (saved.campaign) { const d = saved.campaign; await api('PUT', '/campaign', { v: d.v, session: d.session, crew: d.crew, clocks: d.clocks, log: d.log || [] }); }
      for (const [id, [who, doc]] of Object.entries(saved.chars)) await api('PUT', '/characters/' + id, doc, who);
    } catch (e) { check(false, L + 'putting the night back: ' + (e && e.message || e)); }
  }
}
