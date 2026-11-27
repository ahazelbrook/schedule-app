// RK24 (gm.glance): any NPC by name. The browser half of the check, run by checks/runtime/glance.e2e.mjs on the demo night (the invented Pelican Rooms cast: Mabel Quist,
// Dov Kessler, Ada Vell and Lotte Brand revealed; two hidden, GM-ONLY-Silent Partner and GM-ONLY-Night Clerk). No model, no key, $0: Who is goes to Blade's Ask seat
// (POST /api/gm/assist/ask), which the page here answers from a routed fixture (the browser's equivalent of the handler's injected fake client).
//   off      the Cast panel is today's: no search box, the module is never fetched, every row and its buttons are there
//   find     N opens the Cast panel with the box first; typing "dov" (real key presses, so no page key fires) opens the card of Dov Kessler: the look, the Tell, the Signature and
//            the other notes, and a Who is button. Several matches list; a tap or Enter opens one. Accents and partial words. Clear. Esc shuts the card (B68GmEsc), then leaves the field.
//            Ctrl+K is still Prep's Find. A cast redraw (another NPC's edit) keeps the query, the card and the focus. Every row's buttons are still there.
//   who      Who is asks the Ask seat once, with the name; the answer is in the card; a failure is a plain line
//   hidden   a hidden NPC is found and wears Hidden; the card has no reveal, stage or iPad control; the NPC stays hidden, the stage and the iPad's screen stay as they were
//   secrecy  the display's GET and a phone's GET hold none of the card's text or Blade's answer, and the page made no request outside itself
//   kit      the same on the kit desk, the box and its buttons B68Ui parts
//   shots    RK_SHOTS=<dir>: 1366x768 and 1536x864 and 1024x768 and 390x844, Paper and Night, kit.desk off and on
// Every part sets the settings it uses at its start and leaves gm.glance and kit.desk off at its end.
const SITE = 'The Pelican Rooms';
const CREW = { 'pc-nell': 'Cocktail lounge', 'pc-ray': 'Showroom', 'pc-tam': 'Showroom' };
const ANSWER = { kind: 'note', q: 'Who is Dov Kessler?', text: 'RK24-FIXTURE-ANSWER: a tired guard on the doors.', bullets: ['Wants a quiet shift'], more: 'Knows who holds the lift key.' };

async function resetState(c, on, extra) {
  const { api, sleep } = c;
  await api('PATCH', '/gm/state', { features: { 'gm.glance': on, 'kit.desk': false, 'kit.stage': null, ...(extra || {}) } });
  await api('PATCH', '/campaign', { features: { 'gm.glance': on } });
  const crew = {}; for (const [id, room] of Object.entries(CREW)) crew[id] = { room, disguise: 'guest', moved: null, noticed: null };
  await api('PATCH', '/gm/state', { ball: { site: SITE, v: 2, crew, view: null, start: null, t: null }, con: { live: { pc: '' } }, cues: null });
  await api('PATCH', '/gm/ambient', { overlay: null });
  await sleep(300);
}
export const reset = (c) => resetState(c, false);

export async function rk24(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots } = c;

  async function open(w, h, scheme, theme, on, desk, answer) {
    await resetState(c, on, { 'kit.desk': !!desk });
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w || 1366, height: h || 768 }, serviceWorkers: 'block', colorScheme: scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 700; });
    if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('b68.theme', t); } catch (e) { /* none */ } }, theme === 'night' ? 'dark' : 'light');
    const p = await ctx.newPage(), requests = [], outside = [], asks = [];
    p.on('pageerror', (e) => errors.push('rk24 gm: ' + e.message));
    p.on('request', (r) => { const u = r.url(); requests.push(u); if (!/^(?:http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) outside.push(u); });
    p.on('dialog', (d) => d.accept());
    await p.route('**/api/gm/assist/ask', (route) => {
      asks.push(JSON.parse(route.request().postData() || '{}'));
      if (answer === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: { ...ANSWER, at: new Date().toISOString() }, spend: { tonight: 1, cap: 20, tier: 'all', tick: 0 } }) });
    });
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    return { p, ctx, requests, outside, asks };
  }
  const toCast = async (p) => { await p.keyboard.press('n'); await p.waitForFunction(() => document.querySelector('#gm-root') && document.querySelector('#gm-root').getAttribute('data-panel') === 'npc' && document.querySelector('#gm-npc .gm-npcrow'), null, { timeout: 20000 }); };
  const panel = (p) => p.$eval('#gm-root', (r) => r.getAttribute('data-panel'));
  const typeIn = async (p, text) => { await p.click('#gl-find-q'); await p.keyboard.type(text, { delay: 25 }); };
  const cardName = (p) => p.evaluate(() => { const k = document.querySelector('#gm-npc .gl-find-card'); return k ? k.getAttribute('data-gl-card') : null; });
  const cardText = (p) => p.evaluate(() => { const k = document.querySelector('#gm-npc .gl-find-card'); return k ? k.innerText.replace(/\s+/g, ' ').trim() : null; });
  const rows = (p) => p.evaluate(() => ({ rows: document.querySelectorAll('#gm-npc .gm-npcrow').length, ipad: document.querySelectorAll('#gm-npc [data-gm="npcipad"]').length, stage: document.querySelectorAll('#gm-npc [data-gm="npcstage"]').length }));
  let r0 = null;
  const sixRows = async (p) => { await until(async () => (await rows(p)).rows >= 6, 6000); return rows(p); };
  const minFont = (p) => p.evaluate(() => { let m = 99, who = ''; for (const n of document.querySelectorAll('[data-gl-panel="find"]')) for (const e of [n, ...n.querySelectorAll('*')]) { if (![...e.childNodes].some((k) => k.nodeType === 3 && k.textContent.trim())) continue; const z = parseFloat(getComputedStyle(e).fontSize); if (z < m) { m = z; who = e.tagName + '.' + e.className; } } return { m, who }; });
  const spill = (p) => p.evaluate(() => { const n = document.querySelector('[data-gl-panel="find"]'); return n ? n.scrollWidth - n.clientWidth : 0; });

  /* ---- off ---- */
  {
    const { p, ctx, requests } = await open(1366, 768, 'light', 'light', false, false);
    await toCast(p);
    check((await p.$$('[data-gl-panel="find"], #gl-find-q')).length === 0, 'rk24 off: no search box in the Cast panel');
    check(await p.evaluate(() => typeof window.B68GmNpcFind === 'undefined'), 'rk24 off: the module is not on the page');
    check(!requests.some((u) => /npc-find|glance\.css/.test(u)), 'rk24 off: no request for the bundle (' + requests.filter((u) => /npc-find|glance/.test(u)) + ')');
    r0 = await sixRows(p);
    check(r0.rows >= 6 && r0.ipad === r0.rows && r0.stage === r0.rows, 'rk24 off: every row has with Show on iPad and Put on stage, as today (' + JSON.stringify(r0) + ')');
    check(await p.evaluate(() => document.querySelector('#gm-npc').firstElementChild.id === 'gm-npcgen'), 'rk24 off: the NPC generator is still the first thing in the panel');
    await ctx.close();
  }

  async function onPart(desk, tag) {
    const { p, ctx, outside, asks } = await open(1366, 768, 'light', 'light', true, desk);
    const hiddenBefore = JSON.stringify((await api('GET', '/npcs/npc-hidden-partner')).json || {});
    const stageBefore = JSON.stringify((((await api('GET', '/campaign')).json || {}).doc || {}).scene || null);
    check(!!(await until(() => p.evaluate(() => !!window.B68GmNpcFind && !window.B68GmNpcFind.stub), 10000)), tag + 'on: the gm-glance bundle loads npc-find.js');
    await toCast(p);
    await p.waitForSelector('#gm-npc [data-gl-panel="find"] #gl-find-q', { timeout: 15000 });
    check(await p.evaluate(() => { const n = document.querySelector('#gm-npc'), f = n.firstElementChild; return f && f.getAttribute('data-gl-panel') === 'find' && f.nextElementSibling && f.nextElementSibling.id === 'gm-npcgen'; }), tag + 'on: the box is the first thing in the Cast panel, above the generator');
    check(await p.evaluate(() => { const f = document.querySelector('[data-gl-panel="find"]'); return f.hasAttribute('data-ui-scope') && !!f.querySelector('input[type="search"]') && [...f.querySelectorAll('button')].every((b) => b.classList.contains('ui-btn') || b.className.indexOf('ui-') >= 0); }), tag + 'on: a ui scope, a search field, every button a B68Ui part');
    const r1 = await sixRows(p);
    check(r1.rows === r0.rows && r1.ipad === r1.rows && r1.stage === r1.rows, tag + 'nothing lost: as many rows as with it off, each with Show on iPad and Put on stage (' + JSON.stringify(r1) + ')');

    /* typing "dov": real key presses, the page's own letter keys (d is Downtime) do not fire */
    await typeIn(p, 'dov');
    check(!!(await until(async () => (await cardName(p)) === 'npc-dov', 6000)), tag + 'find: typing "dov" opens the card of Dov Kessler (' + await cardName(p) + ')');
    check((await panel(p)) === 'npc', tag + 'find: the keys typed in the box went to the box (the Cast panel is still open)');
    const t = await cardText(p);
    check(/Dov Kessler/.test(t) && /House security/.test(t) && /Watches the doors/.test(t) && /Tell tired/i.test(t) && /Signature cross/i.test(t) && /Relation: staff/.test(t) && /takes a bribe once/.test(t), tag + 'find: the card holds the look, the Tell, the Signature and the other notes (' + t + ')');
    check(!/Wants|Knows|Voice/i.test(t), tag + 'find: a field the notes do not hold is not shown');
    check((await p.$$eval('[data-gl-panel="find"] .gl-find-pick', (l) => l.length)) === 1, tag + 'find: one match, one row');
    await p.click('[data-glf="clear"]');
    check((await cardName(p)) === null && (await p.$eval('#gl-find-q', (e) => e.value)) === '' && (await p.evaluate(() => document.activeElement.id)) === 'gl-find-q', tag + 'find: Clear empties the box, takes the card down and keeps the focus there');
    await p.keyboard.type('e', { delay: 25 });
    const rows = await p.$$eval('[data-gl-panel="find"] .gl-find-pick', (l) => l.map((b) => b.textContent.trim()));
    check(rows.length >= 4 && (await cardName(p)) === null, tag + 'find: "e" lists several and opens none (' + rows + ')');
    await p.keyboard.press('Enter');
    check(!!(await until(async () => (await cardName(p)) !== null, 4000)), tag + 'find: Enter opens the first match (' + await cardName(p) + ')');
    /* picked from several: the list is one line (the count and Show the list), the card is capped and scrolls inside itself, and the way back works */
    check((await p.$$('[data-gl-panel="find"] .gl-find-pick')).length === 0 && !!(await p.$('[data-gl-panel="find"] [data-glf="list"]')), tag + 'fold: once one is picked the list is one line with Show the list');
    check(await p.evaluate(() => { const k = document.querySelector('.gl-find-body'); return !!k && k.getAttribute('tabindex') === '0' && k.getBoundingClientRect().height <= window.innerHeight * 0.25 + 2; }), tag + 'fold: the notes are no taller than a quarter of the window, and focusable to scroll');
    await p.click('[data-glf="list"]');
    check((await p.$$('[data-gl-panel="find"] .gl-find-pick')).length >= 4 && (await cardName(p)) !== null, tag + 'fold: Show the list brings the rows back and keeps the card');
    check(await p.evaluate(() => [...document.querySelectorAll('.gl-find-li')].every((li) => { const h = li.querySelector('.gl-find-hid'); return !h || h.getBoundingClientRect().top < li.querySelector('.gl-find-pick').getBoundingClientRect().bottom; })), tag + 'fold: a Hidden badge stays on its row’s line');
    await p.fill('#gl-find-q', ''); await p.keyboard.type('zoe', { delay: 20 });
    check((await p.$$eval('[data-gl-panel="find"] .gl-find-note', (l) => l.map((n) => n.textContent).join(' '))).includes('No one'), tag + 'find: a name that is not in the cast says so');
    await p.fill('#gl-find-q', ''); await p.keyboard.type('MAB', { delay: 20 });
    check(!!(await until(async () => (await cardName(p)) === 'npc-mabel', 4000)), tag + 'find: upper case and an alias ("MAB") find Mabel Quist');
    await p.fill('#gl-find-q', ''); await p.keyboard.type('kess', { delay: 20 });
    check(!!(await until(async () => (await cardName(p)) === 'npc-dov', 4000)), tag + 'find: part of a surname finds him');

    /* a redraw of the cast (another NPC edited) keeps the query, the card and the focus */
    await p.click('#gl-find-q'); await p.keyboard.press('End');
    await api('PATCH', '/npcs/npc-ada', { description: 'Deals the high table, edited by the check.' });
    await sleep(2500);
    check(await p.evaluate(() => { const q = document.querySelector('#gl-find-q'); return q && q.value === 'kess' && document.activeElement === q && !!document.querySelector('#gm-npc .gl-find-card[data-gl-card="npc-dov"]'); }), tag + 'find: a redraw of the cast keeps the query, the card and the focus');
    check((await p.$$('[data-gl-panel="find"]')).length === 1 && (await p.$$('#gl-find-q')).length === 1, tag + 'find: still one box after the redraw');

    /* Ctrl+K is still Prep's Find; Esc shuts the card, then leaves the field */
    await p.keyboard.press('Escape');
    check((await cardName(p)) === null, tag + 'esc: Esc shuts the open card (through B68GmEsc)');
    check((await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'gl-find-q', tag + 'esc: the field still has the focus after the card is shut');
    await p.keyboard.press('Escape');
    check((await p.evaluate(() => document.activeElement && document.activeElement.id)) !== 'gl-find-q', tag + 'esc: the next Esc leaves the field');
    await p.keyboard.press('Control+k');
    check(!!(await p.waitForSelector('#gm-find-q', { timeout: 4000 }).catch(() => null)), tag + 'keys: Ctrl+K opens Prep’s Find, as it always did');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('#gm-find-q') || document.querySelector('#gm-find-q').offsetParent === null, null, { timeout: 4000 }).catch(() => {});

    /* who is */
    await p.fill('#gl-find-q', ''); await p.click('#gl-find-q'); await p.keyboard.type('dov', { delay: 25 });
    await p.waitForSelector('.gl-find-card[data-gl-card="npc-dov"] [data-glf="who"]:not([disabled])', { timeout: 10000 });
    await p.click('[data-glf="who"]');
    check(!!(await until(async () => /RK24-FIXTURE-ANSWER/.test((await cardText(p)) || ''), 8000)), tag + 'who: Who is puts Blade’s answer in the card (' + (await cardText(p) || '').slice(-120) + ')');
    check(asks.length === 1 && /^Who is Dov Kessler\?/.test(asks[0].q || ''), tag + 'who: one call to the Ask seat, naming him (' + JSON.stringify(asks) + ')');
    check(/Wants a quiet shift/.test((await cardText(p)) || '') && /lift key/.test((await cardText(p)) || ''), tag + 'who: the answer’s bullets and More are in the card');
    await shots(p, 'RK24-who-' + (desk ? 'kit' : 'old'));

    /* hidden */
    await p.fill('#gl-find-q', ''); await p.keyboard.type('silent', { delay: 20 });
    check(!!(await until(async () => (await cardName(p)) === 'npc-hidden-partner', 6000)), tag + 'hidden: a hidden NPC is found by name (' + await cardName(p) + ')');
    const ht = await cardText(p);
    check(/Hidden/i.test(ht) && /Not shown to the players/.test(ht), tag + 'hidden: the card says Hidden and that nothing on it is sent');
    check((await p.$$eval('.gl-find-card button', (l) => l.map((b) => b.getAttribute('data-glf')).sort().join(','))) === 'close,who', tag + 'hidden: the card has Who is and Close, no reveal, stage or iPad control');
    await shots(p, 'RK24-hidden-' + (desk ? 'kit' : 'old'));
    await sleep(800);
    check(JSON.stringify((await api('GET', '/npcs/npc-hidden-partner')).json || {}) === hiddenBefore, tag + 'hidden: the NPC is exactly as it was (still hidden)');
    const camp = (await api('GET', '/campaign')).json.doc || {};
    check(JSON.stringify(camp.scene || null) === stageBefore, tag + 'hidden: nothing went on the stage');
    const amb = ((await api('GET', '/gm/ambient')).json || {}).doc || {};
    check(!amb.overlay, tag + 'hidden: nothing is up on the iPad (no overlay)');

    /* secrecy: nothing of the card, the notes or the answer is on the display or a phone */
    const dg = await api('GET', '/gm/display', undefined, IPAD), pc = await api('GET', '/campaign', undefined, P1), pn = await api('GET', '/npcs', undefined, P1);
    const leaks = ['GM-ONLY-NOTE the money', 'GM-ONLY-Silent', 'GM-ONLY-DESCRIPTION', 'RK24-FIXTURE-ANSWER', 'gl-find', 'takes a bribe once'].filter((s) => [dg.text, pc.text, pn.text].some((x) => (x || '').includes(s)));
    check(leaks.length === 0, tag + 'secrecy: the display’s GET, a phone’s campaign and a phone’s cast hold none of the card, the notes or the answer (' + leaks + ')');
    check(outside.length === 0, tag + 'secrecy: no request left the page (' + outside.slice(0, 3) + ')');
    check((await minFont(p)).m >= 12, tag + 'quiet: nothing in the box is under 12 px (' + JSON.stringify(await minFont(p)) + ')');
    check((await spill(p)) <= 1, tag + 'quiet: the box does not spill sideways (' + await spill(p) + ')');
    await ctx.close();
  }
  await onPart(false, 'rk24 old desk: ');
  await onPart(true, 'rk24 kit desk: ');

  /* ---- a failure is a plain line; the setting off on a live page takes the box down ---- */
  {
    const { p, ctx, asks } = await open(1366, 768, 'light', 'light', true, false, 'fail');
    await toCast(p); await p.waitForSelector('#gl-find-q', { timeout: 15000 });
    await typeIn(p, 'dov'); await p.waitForSelector('.gl-find-card [data-glf="who"]:not([disabled])', { timeout: 10000 });
    await p.click('[data-glf="who"]');
    check(!!(await until(async () => /nothing to say|cannot be asked/i.test((await cardText(p)) || ''), 8000)), 'rk24 fail: a failed ask is one plain line in the card (' + (await cardText(p) || '').slice(-100) + ')');
    check(asks.length === 1, 'rk24 fail: it asked once');
    await api('PATCH', '/gm/state', { features: { 'gm.glance': false } }); await api('PATCH', '/campaign', { features: { 'gm.glance': false } });
    check(!!(await until(() => p.evaluate(() => { window.dispatchEvent(new Event('focus')); return !document.querySelector('[data-gl-panel="find"]'); }), 30000, 1500)), 'rk24 live off: turning gm.glance off takes the box down on an open page');
    check((await sixRows(p)).rows === r0.rows, 'rk24 live off: the rows are all still there (' + JSON.stringify(await rows(p)) + ')');
    await ctx.close();
  }

  /* ---- shots ---- */
  if (c.SHOTS) {
    const sizes = [[1366, 768], [1536, 864], [1024, 768], [390, 844]];
    for (const desk of [false, true]) for (const theme of ['light', 'night']) for (const [w, h] of sizes) {
      const { p, ctx } = await open(w, h, theme === 'night' ? 'dark' : 'light', theme, true, desk);
      await toCast(p); await p.waitForSelector('#gl-find-q', { timeout: 20000 });
      await typeIn(p, 'e'); await sleep(400);
      await shots(p, 'RK24-' + (desk ? 'kit' : 'old') + '-' + theme + '-' + w + '-list');
      await p.fill('#gl-find-q', ''); await p.keyboard.type('dov', { delay: 25 }); await p.waitForSelector('.gl-find-card [data-glf="who"]', { timeout: 10000 });
      /* Blade’s Ask seat is not offered at a phone’s width (assist-panel.js isPhone, 599 px): there Who is is shown off, with its reason */
      if (w >= 600) { await p.click('[data-glf="who"]:not([disabled])'); await sleep(900); } else {
        check(await p.$eval('[data-glf="who"]', (b) => b.disabled), 'rk24 shots: Who is is off at a phone’s width');
        check(await p.evaluate(() => { const e = document.querySelector('.gl-find-why'); return !!e && /phone/.test(e.textContent) && e.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(e).fontSize) >= 12; }), 'rk24 shots: the reason is visible text, 12 px or more');
      }
      await shots(p, 'RK24-' + (desk ? 'kit' : 'old') + '-' + theme + '-' + w + '-card');
      check((await spill(p)) <= 1 && (await minFont(p)).m >= 12, 'rk24 shots ' + (desk ? 'kit' : 'old') + ' ' + theme + ' ' + w + ': no sideways spill, nothing under 12 px');
      await ctx.close();
    }
  }
  await resetState(c, false);
}
