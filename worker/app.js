// The hosted build's Worker (see HOSTING.md): static assets from app/ plus the JSON API. The entry
// module is worker/index.js; everything lives here so checks/api/worker.mjs can import the parts
// (named exports of the entry module would count as Worker entrypoints).
//
// Cloudflare serves every file in app/ directly. The Worker runs first only for the paths listed
// in wrangler.toml `assets.run_worker_first` (`/api`, `/api/*`, `/`, `/index.html`), and for any
// path that has no file:
//   /api, /api/*          the Pages-style handlers in functions/api/, unchanged, behind the same
//                         middleware (functions/api/_middleware.js: Access JWT, JSON errors, no-store)
//   /, /index.html        app/index.html with a doctype, charset and viewport put in front of it
//                         (the file itself must stay a bare fragment for the claude.ai artifact)
//   anything else         whatever the asset server answers (a file, a redirect or a 404)
//
// Plain ES module with no Cloudflare-only imports, so node can import it (checks/api/worker.mjs).

import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequest as me, BUILD } from '../functions/api/me.js';
import { onRequest as members } from '../functions/api/members.js';
import { onRequest as exportAll } from '../functions/api/export.js';
import { onRequest as campaign } from '../functions/api/campaign.js';
import { onRequest as characters } from '../functions/api/characters/index.js';
import { onRequest as character } from '../functions/api/characters/[id].js';
import { onRequest as rules } from '../functions/api/rules/index.js';
import { onRequest as rulesImport } from '../functions/api/rules/import.js';
import { onRequest as rulesHouse } from '../functions/api/rules/house/[slug].js';
import { onRequest as npcs } from '../functions/api/npcs/index.js';
import { onRequest as npc } from '../functions/api/npcs/[id].js';
import { onRequest as gmPack } from '../functions/api/gm/pack.js';
import { onRequest as gmState } from '../functions/api/gm/state.js';
import { onRequest as gmDisplay } from '../functions/api/gm/display.js';
import { onRequest as gmAmbient } from '../functions/api/gm/ambient.js';
import { onRequest as gmStt } from '../functions/api/gm/stt.js';
import { onRequest as gmSttToken } from '../functions/api/gm/stt-token.js';
import { onRequest as gmTranscript } from '../functions/api/gm/transcript.js';
import { onRequest as gmAssist } from '../functions/api/gm/assist.js';
import { gmNotFound } from '../functions/_lib/gm.js';
import { onRequest as notFound } from '../functions/api/[[path]].js';

// The same file layout Pages Functions routed: [id] is one path segment, [[path]] the rest.
// A trailing slash is accepted, as Pages did.
export const ROUTES = [
  { re: /^\/api\/me\/?$/, handler: me, path: '/api/me' },
  { re: /^\/api\/members\/?$/, handler: members, path: '/api/members' },
  { re: /^\/api\/export\/?$/, handler: exportAll, path: '/api/export' },
  { re: /^\/api\/campaign\/?$/, handler: campaign, path: '/api/campaign' },
  { re: /^\/api\/characters\/?$/, handler: characters, path: '/api/characters' },
  { re: /^\/api\/characters\/([^/]+)\/?$/, handler: character, path: '/api/characters/:id', params: ['id'] },
  { re: /^\/api\/rules\/?$/, handler: rules, path: '/api/rules' },
  { re: /^\/api\/rules\/import\/?$/, handler: rulesImport, path: '/api/rules/import' },
  { re: /^\/api\/rules\/house\/([^/]+)\/?$/, handler: rulesHouse, path: '/api/rules/house/:slug', params: ['slug'] },
  { re: /^\/api\/npcs\/?$/, handler: npcs, path: '/api/npcs' },
  { re: /^\/api\/npcs\/([^/]+)\/?$/, handler: npc, path: '/api/npcs/:id', params: ['id'] },
  // the GM tools (GM.md), GM only: any other /api/gm path is 403 for a player (404 for the GM), not the plain 404
  { re: /^\/api\/gm\/pack\/?$/, handler: gmPack, path: '/api/gm/pack' },
  { re: /^\/api\/gm\/state\/?$/, handler: gmState, path: '/api/gm/state' },
  { re: /^\/api\/gm\/display\/?$/, handler: gmDisplay, path: '/api/gm/display' },
  { re: /^\/api\/gm\/ambient\/?$/, handler: gmAmbient, path: '/api/gm/ambient' },
  { re: /^\/api\/gm\/stt\/?$/, handler: gmStt, path: '/api/gm/stt' },
  { re: /^\/api\/gm\/stt\/token\/?$/, handler: gmSttToken, path: '/api/gm/stt/token' },
  { re: /^\/api\/gm\/transcript\/?$/, handler: gmTranscript, path: '/api/gm/transcript' },
  // Claude at the table (the assist build plan): POST /api/gm/assist/tick and /fit, GM only
  { re: /^\/api\/gm\/assist\/(tick|fit)\/?$/, handler: gmAssist, path: '/api/gm/assist/:action', params: ['action'] },
  { re: /^\/api\/gm(?:\/.*)?$/, handler: gmNotFound, path: '/api/gm/[[path]]' },
];

function decode(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

/** The handler for an /api path and its params, as Pages Functions would have matched it. */
export function matchApi(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = {};
    (r.params || []).forEach((name, i) => { params[name] = decode(m[i + 1]); });
    return { handler: r.handler, params, functionPath: r.path };
  }
  const rest = pathname.replace(/^\/api\/?/, '');
  return { handler: notFound, params: { path: rest ? rest.split('/').filter(Boolean).map(decode) : [] }, functionPath: '/api/[[path]]' };
}

// ---------- DEV_USER only on a loopback address ----------
// auth.js signs every request in as DEV_USER when that binding is set. Only `wrangler dev` sets it
// (package.json "dev", the checks); the production config never does, scripts/deploy.sh refuses to
// ship one and deletes a DEV_USER secret. As a last guard the Worker drops DEV_USER unless the request
// reached it on a loopback address, so a stray binding in production still means "Access token
// required" and never "everyone is the GM".
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopback(request) {
  const host = (request.headers.get('Host') || new URL(request.url).host || '').toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK.has(name);
}

let warnedDevUser = false;
export function effectiveEnv(request, env) {
  if (!env || !env.DEV_USER || isLoopback(request)) return env;
  if (!warnedDevUser) {
    warnedDevUser = true;
    console.error('DEV_USER is bound but the request is not on a loopback address: ignoring it (Access is required)');
  }
  const copy = Object.assign({}, env);
  delete copy.DEV_USER;
  return copy;
}

// ---------- the API: a Pages-compatible context, middleware first ----------
export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const route = matchApi(url.pathname);
  const context = {
    request,
    env,
    params: route.params,
    data: {},
    functionPath: route.functionPath,
    waitUntil: (p) => { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); },
    passThroughOnException: () => { if (ctx && typeof ctx.passThroughOnException === 'function') ctx.passThroughOnException(); },
    next: (input, init) => {
      if (input !== undefined) context.request = input instanceof Request && init === undefined ? input : new Request(input, init);
      return route.handler(context);
    },
  };
  return middleware(context);
}

// ---------- the page: doctype, charset and viewport in front of app/index.html ----------
export const PAGE_HEAD = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1, viewport-fit=cover">';

/** index.html as the browser gets it: the head above, unless the file already starts with a doctype. */
export function withPageHead(html) {
  const text = String(html).replace(/^﻿/, '');
  if (/^\s*<!doctype/i.test(text)) return text;
  return PAGE_HEAD + '\n' + text;
}

export const PAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  // frame-ancestors only: the page loads its own scripts, inline styles and data: images, so a fuller
  // CSP would need care; this one cannot break anything.
  'Content-Security-Policy': "frame-ancestors 'none'",
  // the microphone for this origin only: the table iPad's transcriber (GM.md "Listening"); still never for a frame
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=()',
  // The fuller policy the page could carry, REPORTED ONLY: the browser blocks nothing and names in its console what it
  // would block (no report endpoint). Every script is a same-origin file; 'unsafe-inline' is for styles only (the
  // <style> in index.html, style attributes); data: and blob: images; the transcriber's Deepgram socket; the ambient
  // scenes are same-origin frames. Once the browser checks run with no "[Report Only]" message, it can become the
  // enforced Content-Security-Policy (checks/api/worker.mjs asserts it is report-only until then).
  'Content-Security-Policy-Report-Only': "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss://api.deepgram.com; frame-src 'self'; media-src 'self'; font-src 'self'; frame-ancestors 'none'",
};

export async function handlePage(res) {
  const type = res.headers.get('Content-Type') || '';
  if (res.status !== 200 || !/^text\/html/i.test(type)) return res; // 304s, redirects, errors as they are
  const body = withPageHead(await res.text());
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  for (const [k, v] of Object.entries(PAGE_HEADERS)) headers.set(k, v);
  // The ETag stays the asset's: the same file always gets the same head, so revalidation still works.
  return new Response(body, { status: 200, statusText: res.statusText, headers });
}

function withHeaders(res, extra) {
  let out = res;
  try {
    for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  } catch (_) {
    out = new Response(res.body, res);
    for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  }
  return out;
}

export function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const e = effectiveEnv(request, env);
    if (isApiPath(url.pathname)) {
      // X-B68-Build: the Worker's build stamp (app/routes.js), so a page left open learns that the server moved on
      return withHeaders(await handleApi(request, e, ctx), { 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-B68-Build': BUILD });
    }
    const res = await e.ASSETS.fetch(request);
    if (url.pathname === '/' || url.pathname === '/index.html') return handlePage(res);
    return res;
  },
};
