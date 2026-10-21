/* Blades '68 figure kit. Browser: window.B68Figure. Node: require(). Built from src/ by tools/bundle.js (no date, so rebuilds are byte-identical). */
"use strict";
var B68Figure = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/core/registry.js
  var require_registry = __commonJS({
    "src/core/registry.js"(exports, module) {
      "use strict";
      var PARTS = {};
      var KINDS = {
        body: "Skin layer: neck, arms, legs (default 'standard').",
        hands: "Hands, chosen per arm pose.",
        head: "Head shapes (skull, jaw, chin). Sets the face landmarks.",
        ears: "Ears.",
        eyes: "Eyes (whites, iris, lids).",
        brows: "Eyebrows.",
        nose: "Noses.",
        mouth: "Mouths and lips.",
        expression: "Expression presets that modulate brows, lids and mouth.",
        age: "Age lines (forehead, crow's feet, folds, jowls).",
        mark: "Scars, freckles, moles, spots, tattoos, plasters.",
        facialHair: "Stubble, moustaches, beards.",
        makeup: "Eyeliner, eyeshadow, lipstick, blush.",
        eyewear: "Glasses, sunglasses, eyepatches.",
        mask: "Face coverings (face.mask): balaclava, stocking, domino, bandana, gas mask. A mask declares `covers`, the face kinds it hides.",
        hair: "Hairstyles (back and front layers).",
        hat: "Hats and headwear.",
        top: "Base-layer tops (outfit.base).",
        mid: "Mid layers: waistcoats, sweaters, vests, bibs (outfit.mid).",
        outer: "Outerwear: jackets, coats (outfit.outer).",
        bottom: "Trousers, jeans, shorts, skirts (outfit.bottom).",
        dress: "Dresses and one-piece garments (outfit.dress).",
        legwear: "Tights and socks (outfit.legs).",
        footwear: "Shoes and boots (outfit.feet).",
        neckwear: "Ties, scarves, neckerchiefs, chains (outfit.neck).",
        belt: "Belts (outfit.waist).",
        gloves: "Gloves (outfit.hands).",
        jewellery: "Earrings, necklaces, bracelets, watches, rings (spec.jewellery[]).",
        prop: "Props (spec.props).",
        companion: "Animals that stand with the figure (spec.companion).",
        textile: "Fabric patterns for piece.pattern."
      };
      var DUPES = [];
      function register(part) {
        const { kind, name } = part;
        if (!KINDS[kind]) throw new Error(`register(): unknown kind "${kind}". Kinds: ${Object.keys(KINDS).join(", ")}`);
        if (!name) throw new Error(`register(): ${kind} part needs a name`);
        if (kind === "textile" ? typeof part.pattern !== "function" : typeof part.draw !== "function")
          throw new Error(`register(): ${kind}/${name} needs a ${kind === "textile" ? "pattern" : "draw"}() function`);
        const bucket = PARTS[kind] = PARTS[kind] || {};
        const clash = (n) => bucket[n] && bucket[n].name !== name;
        if (clash(name)) DUPES.push(`${kind} "${name}" registered twice (was ${bucket[name].name})`);
        bucket[name] = { describe: "", params: {}, tags: [], ...part };
        for (const a of part.aliases || []) {
          if (clash(a)) DUPES.push(`${kind} alias "${a}" of ${name} is already taken by ${bucket[a].name}`);
          else bucket[a] = bucket[name];
        }
        return PARTS[kind][name];
      }
      var get = (kind, name) => (PARTS[kind] || {})[name] || null;
      var list = (kind) => Object.entries(PARTS[kind] || {}).filter(([n, p]) => p.name === n).map(([, p]) => p);
      var kinds = () => KINDS;
      var DOCS = typeof __FIG_DOCS__ === "undefined" || __FIG_DOCS__;
      function catalog() {
        var _a;
        if (!DOCS) {
          const lines2 = ["# Figure kit catalogue (names only)", "", "This is figure-kit.min.js, built without the parts' catalogue text. What each part is and its params are in figure-kit.js (catalog()) and CATALOG.md.", ""];
          for (const k of Object.keys(KINDS)) {
            const ps = list(k);
            if (ps.length) lines2.push(`## ${k}`, "", ps.map((p) => {
              var _a2;
              return `\`${p.name}\`${((_a2 = p.aliases) == null ? void 0 : _a2.length) ? ` (${p.aliases.map((a) => "`" + a + "`").join(", ")})` : ""}`;
            }).join(", "), "");
          }
          return lines2.join("\n");
        }
        const lines = ["# Figure kit catalogue", "", "Generated from the part registry: every option the spec can name.", ""];
        for (const k of Object.keys(KINDS)) {
          const ps = list(k);
          if (!ps.length) continue;
          lines.push(`## ${k}`, "", KINDS[k], "");
          lines.push("| name | what it is | params |", "|---|---|---|");
          for (const p of ps) {
            const cell = (t) => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ");
            const params = Object.entries(p.params || {}).map(([a, b]) => `\`${a}\`: ${cell(b)}`).join("; ");
            lines.push(`| \`${p.name}\`${((_a = p.aliases) == null ? void 0 : _a.length) ? ` (${p.aliases.map((a) => "`" + a + "`").join(", ")})` : ""} | ${cell(p.describe || "")} | ${params} |`);
          }
          lines.push("");
        }
        return lines.join("\n");
      }
      module.exports = { register, get, list, kinds, catalog, PARTS, KINDS, DUPES };
    }
  });

  // src/parts/nose-mouth/_util.js
  var require_util = __commonJS({
    "src/parts/nose-mouth/_util.js"(exports, module) {
      "use strict";
      var REG = require_registry();
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var lerp = (a, b, t) => a + (b - a) * t;
      var hpx = (ctx, n) => ctx.px(n) / ctx.R.head.k;
      var bold = (ctx) => (ctx.lod === "lo" ? 1.7 : ctx.lod === "mid" ? 1.3 : 1) * 1.18;
      var atLeast = (ctx, v, n) => Math.max(v, hpx(ctx, n));
      function hsD(ctx, d, depth) {
        return ctx.G.mapPath(d, (p) => ctx.hp(p, { depth: typeof depth === "function" ? depth(p) : depth || 0 }));
      }
      function table(tab, x) {
        if (x <= tab[0][0]) return tab[0][1];
        for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) return lerp(tab[i - 1][1], tab[i][1], (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0] || 1));
        return tab[tab.length - 1][1];
      }
      function outlinePoly(ctx, per = 6) {
        const d = ctx.head.outline;
        const pts = [];
        if (d) {
          const segs = ctx.G.parse(d);
          let cur = null;
          for (const s of segs) {
            if (s.c === "M") {
              cur = s.p[0];
              pts.push(cur);
            } else if (s.c === "L") {
              cur = s.p[0];
              pts.push(cur);
            } else if (s.c === "C" && cur) {
              const [a, b, p] = s.p;
              for (let i = 1; i <= per; i++) {
                const t = i / per, u = 1 - t;
                pts.push([u * u * u * cur[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p[0], u * u * u * cur[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p[1]]);
              }
              cur = p;
            }
          }
        }
        if (pts.length < 8) {
          const H = ctx.head, out = [];
          const L = [[0, -0.5], [-H.w * 0.6, -0.46], [-H.w * 0.95, -0.33], [-H.w * 0.94, -0.16], [-H.w, 0.02], [-H.w * 0.97, 0.13], [-H.jawW, H.jawY], [-H.chinW * 1.5, 0.44], [-H.chinW, 0.48], [-H.chinW * 0.35, 0.5]];
          for (const p of L) out.push(p);
          for (const p of L.slice(0, -1).reverse()) out.push([-p[0], p[1]]);
          return out;
        }
        return pts;
      }
      function edgeAt(poly, y) {
        let l = Infinity, r = -Infinity;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
          const t = (y - a[1]) / (b[1] - a[1]), x = a[0] + (b[0] - a[0]) * t;
          if (x < l) l = x;
          if (x > r) r = x;
        }
        return l === Infinity ? null : { l, r };
      }
      function underAt(poly, x) {
        let best = -Infinity;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
          const t = (x - a[0]) / (b[0] - a[0]), y = a[1] + (b[1] - a[1]) * t;
          if (y > best) best = y;
        }
        return best === -Infinity ? null : best;
      }
      function jawLine(poly, y0, step = 1) {
        const n = poly.length;
        let iMin = 0;
        for (let i = 0; i < n; i++) if (poly[i][1] > poly[iMin][1]) iMin = i;
        const cut = (idx, dir) => {
          let i = idx;
          const out = [];
          for (let k = 0; k < n; k++) {
            const p = poly[(i + n) % n], q = poly[(i + dir + n) % n];
            out.push(p);
            if (q[1] < y0) {
              const t = (y0 - p[1]) / (q[1] - p[1] || 1);
              out.push([p[0] + (q[0] - p[0]) * t, y0]);
              break;
            }
            i += dir;
          }
          return out;
        };
        const a = cut(iMin, -1).reverse(), b = cut(iMin, 1).slice(1);
        let line = [...a, ...b];
        if (line[0][0] > line[line.length - 1][0]) line = line.reverse();
        return step > 1 ? line.filter((_, i) => i % step === 0 || i === line.length - 1) : line;
      }
      function pushOut(pts, amt, cy = 0.14) {
        return pts.map((p) => {
          const dx = p[0], dy = (p[1] - cy) * 0.85, l = Math.hypot(dx, dy) || 1;
          const k = typeof amt === "function" ? amt(p) : amt;
          return [p[0] + dx / l * k, p[1] + dy / l * k];
        });
      }
      function withHole(G, outerPts, innerPts, tension = 0.5) {
        return G.smooth(outerPts, true, tension) + " " + G.smooth(innerPts.slice().reverse(), true, tension);
      }
      function inside(poly, x, y) {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j];
          if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
      }
      function dot(x, y, r) {
        const f = (n) => Math.round(n * 100) / 100;
        const k = 0.5, h = 0.866;
        return `M${f(x + r)} ${f(y)} L${f(x + r * k)} ${f(y + r * h)} L${f(x - r * k)} ${f(y + r * h)} L${f(x - r)} ${f(y)} L${f(x - r * k)} ${f(y - r * h)} L${f(x + r * k)} ${f(y - r * h)} Z`;
      }
      function halftone(ctx, region, density, o = {}) {
        var _a;
        const k = ctx.R.head.k;
        const step = Math.max(o.step || 0.0125, hpx(ctx, o.minStepPx || 2.3));
        const rMax = (o.rMax || 62e-4) * (step / (o.step || 0.0125) > 1 ? 1 : 1);
        const rMinPx = hpx(ctx, o.minRPx || 0.55);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of region) {
          x0 = Math.min(x0, p[0]);
          x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1]);
          y1 = Math.max(y1, p[1]);
        }
        let d = "", row = 0, n = 0;
        const jit = (_a = o.jitter) != null ? _a : 0.18;
        for (let y = y0; y <= y1; y += step * 0.866, row++) {
          for (let x = x0 + (row % 2 ? step / 2 : 0); x <= x1; x += step) {
            const jx = (ctx.rng() - 0.5) * step * jit, jy = (ctx.rng() - 0.5) * step * jit;
            const px = x + jx, py = y + jy;
            if (!inside(region, px, py)) continue;
            const dn = density(px, py);
            if (dn <= 0.02) continue;
            const r = Math.max(rMinPx * (dn > 0.15 ? 1 : 0.7), rMax * Math.sqrt(clamp(dn, 0, 1.2)) * (step / 0.0125 > 1.4 ? 1.2 : 1));
            const c = ctx.hp([px, py], { depth: o.depth || 0 });
            d += dot(c[0], c[1], r * k);
            if (++n > (o.max || 2600)) return d;
          }
        }
        return d;
      }
      function mouthBox(ctx, opts = {}) {
        const name = ctx.S.face && ctx.S.face.mouth || "neutral";
        const p = REG.get("mouth", name) || REG.get("mouth", "neutral");
        if (p && p.metrics) return p.metrics(ctx, { ...ctx.S.face || {}, ...opts });
        const H = ctx.head, M = ctx.expr.mouth, mw = H.mouthW / 2 * (M.width || 1);
        return { mw, yTop: H.mouthY - 0.02, y: H.mouthY, yl: H.mouthY, yr: H.mouthY, yBot: H.mouthY + 0.035, open: M.open || 0 };
      }
      function toneOf(ctx, colour, k = 0.5) {
        const hm = ctx.hairMat(colour);
        return ctx.C.mix(ctx.skin.deep, hm.base, k);
      }
      var hexA = (hex, a) => hex + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, "0");
      module.exports = { hexA, clamp, lerp, hpx, bold, atLeast, hsD, table, outlinePoly, edgeAt, underAt, jawLine, pushOut, withHole, inside, dot, halftone, mouthBox, toneOf };
    }
  });

  // src/parts/age/lines.js
  var require_lines = __commonJS({
    "src/parts/age/lines.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var U = require_util();
      function ageLines(ctx, level, rough) {
        const { G, skin, C } = ctx;
        const H = ctx.head;
        const R = ctx.R;
        const L = Math.max(1, Math.min(3, level || 1));
        const lod = ctx.lod;
        if (lod === "lo") return [];
        const hi = lod === "hi", b = U.bold(ctx), px = (n) => U.hpx(ctx, n);
        const rk = rough ? 1.5 : 1, rg = rough ? 1 : 0;
        const jit = (a) => rough ? (ctx.rng() - 0.5) * a : 0;
        const hs = (d) => U.hsD(ctx, d, 0.025);
        const lineC = C.mix(skin.shade, skin.deep, 0.3);
        const ow = (base) => Math.max(base * b * rk * 2.3, px(1.8));
        const vo = (o) => o * 0.62;
        const out = [], over = [], under = [];
        const mb = U.mouthBox(ctx, ctx.S.face);
        const poly = U.outlinePoly(ctx);
        const nF = rough ? 3 : L === 1 ? 1 : 2;
        const fw = (H.templeW || H.w * 0.93) * 0.62;
        for (let i = 0; i < nF; i++) {
          const y = H.brow - 0.07 - i * 0.052 + jit(6e-3);
          const xl = -fw * (0.92 - i * 0.2) + (i % 2 ? 0.03 : -0.01), xr = fw * (0.86 - i * 0.12) + (i % 2 ? -0.02 : 0.02), tilt = (i % 2 ? -1 : 1) * 5e-3;
          const sag = 8e-3 * (1 + rg), w = ow(85e-4 + (L - 1) * 1e-3);
          const pts = [[xl, y + 5e-3 - tilt + jit(4e-3)], [xl * 0.45, y - sag * 0.4 + jit(3e-3)], [0.01, y - sag + jit(3e-3)], [xr * 0.5, y - sag * 0.4 + tilt + jit(3e-3)], [xr, y + 5e-3 + tilt + jit(4e-3)]];
          over.push({ d: hs(G.brush(pts, [1e-3, w, w * 1.15, w, 1e-3])), fill: lineC, o: vo(hi ? 0.62 : 0.78) });
        }
        if (rough || L === 3) for (const s of [-1, 1]) over.push({ d: hs(G.brush([[s * 0.022, H.brow + 0.012], [s * 0.026, H.brow - 0.022], [s * 0.02, H.brow - 0.05]], [1e-3, ow(8e-3), 1e-3])), fill: lineC, o: vo(0.75) });
        for (const s of [-1, 1]) {
          const ex = s * H.eyeX, ey = H.eyeY + (H.eyeH || 0.05) * 0.55;
          if (L >= 2 || rough || hi) {
            const k = L >= 2 ? 1 : 0.6;
            under.push({ d: hs(G.smooth([[ex - s * 0.07, ey + 0.012], [ex - s * 0.02, ey + 0.024 * k + 8e-3], [ex + s * 0.05, ey + 0.02 * k + 8e-3], [ex + s * 0.075, ey + 0.012], [ex + s * 0.02, ey + 0.012], [ex - s * 0.03, ey + 0.012]], true, 0.5)), fill: skin.shade, o: s < 0 ? 0.4 : 0.6 });
            over.push({ d: hs(G.brush([[ex - s * 0.06, ey + 0.026 + 6e-3 * k], [ex, ey + 0.036 + 8e-3 * k], [ex + s * 0.072, ey + 0.026 + 4e-3 * k]], [1e-3, ow(75e-4), 1e-3])), fill: lineC, o: vo(rough ? 0.8 : 0.6) });
          }
          const n = !hi ? 0 : rough || L === 3 ? 3 : 2;
          const ox = ex + s * (H.eyeW / 2 + 0.014), oy = H.eyeY - 2e-3;
          for (let i = 0; i < n; i++) {
            const a = -0.45 + i * (0.9 / Math.max(1, n - 1)) + jit(0.15), len = 0.04 - Math.abs(i - (n - 1) / 2) * 6e-3 + jit(8e-3);
            const p0 = [ox + s * 4e-3, oy + (i - (n - 1) / 2) * 6e-3], p1 = [ox + s * Math.cos(a) * len, oy + Math.sin(a) * len + 4e-3];
            over.push({ d: hs(G.brush([p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + jit(3e-3)], p1], [ow(68e-4), ow(6e-3), 1e-3])), fill: lineC, o: vo(0.7) });
          }
        }
        const nwx = H.noseW * 1.04, mc = mb.mw + 0.012;
        for (const s of [-1, 1]) {
          const w = ow(0.0105 + (L - 1) * 15e-4) * (s > 0 ? 1.1 : 1);
          const pts = [[s * nwx * 1.02, H.noseY - 0.012], [s * (nwx + 0.034), (H.noseY + mb.y) / 2 - 0.012], [s * (mb.mw + 0.034), mb.y + 4e-3], [s * (mb.mw + 0.026 + (L > 1 ? 6e-3 : 0)), mb.y + 0.045 + L * 8e-3]];
          const hl = L >= 2 || rough || hi;
          if (hl || lod === "mid") over.push({ d: hs(G.brush(pts, [1e-3, w, w * 1.15, w * 0.8, 1e-3])), fill: lineC, o: vo(L === 1 && !rough ? 0.5 : 0.78) });
          if (hi && L >= 2) over.push({ d: hs(G.brush(pts.map((p) => [p[0] - s * 0.014, p[1] + 6e-3]), [1e-3, 5e-3, 5e-3, 1e-3])), fill: skin.light, o: s < 0 ? 0.45 : 0.15 });
          if (L >= 2 || rough) {
            const wm = ow(75e-4 + (L - 2) * 15e-4);
            const mp = [[s * (mb.mw * 0.99), (s < 0 ? mb.yl : mb.yr) + 0.014], [s * (mb.mw * 1 + 4e-3), mb.y + 0.055], [s * (mb.mw * 0.92), mb.y + 0.1 + L * 8e-3]];
            over.push({ d: hs(G.brush(mp, [1e-3, wm, wm * 0.9, 1e-3])), fill: lineC, o: vo(0.65) });
          }
        }
        if (rough) for (const s of [-1, 1]) {
          const cw = ow(45e-4);
          over.push({ d: hs(G.brush([[s * (H.cheekW - 0.06), 0.1], [s * (H.cheekW - 0.095), 0.15], [s * (H.cheekW - 0.12), 0.2]], [1e-3, cw, 1e-3])), fill: lineC, o: vo(0.5) });
          if (hi) over.push({ d: hs(G.brush([[s * (H.cheekW - 0.045), 0.15], [s * (H.cheekW - 0.08), 0.2], [s * (H.cheekW - 0.1), 0.25]], [1e-3, cw * 0.8, 1e-3])), fill: lineC, o: vo(0.4) });
        }
        const pieces = [];
        if (L >= 3 || rough) {
          const jowl = [];
          for (const s of [-1, 1]) {
            const y0 = mb.y + 0.07, e = U.edgeAt(poly, y0 + 0.06), ex = e ? s < 0 ? -e.l : e.r : H.jawW;
            jowl.push({ d: hs(G.smooth([[s * (mb.mw + 0.02), y0], [s * ex * 0.97, y0 - 0.02], [s * ex * 1, y0 + 0.1], [s * ex * 0.66, y0 + 0.17], [s * (mb.mw * 0.8), y0 + 0.1]], true, 0.5)), fill: skin.shade, o: s < 0 ? 0.28 : 0.5 });
          }
          pieces.push({ id: "age-jowls", z: ctx.Z.face - 0.3, d: ctx.hs(ctx.head.outline || G.ellipse(0, 0.1, 0.3, 0.4)), mat: skin, fill: "transparent", light: false, lines: jowl });
        }
        pieces.push({ id: "age-under", z: ctx.Z.face + 0.05, over: under });
        pieces.push({ id: "age-lines", z: ctx.Z.face + 0.35, over });
        if (L >= 2 || rough) {
          const c0 = R.head.cx, wt = R.w.neck, top = R.y.chin + 0.04 * ctx.hh, bot = R.y.neckBase - 0.01 * ctx.hh;
          const lines = [];
          for (const s of [-1, 1]) {
            const wgt = (L === 3 || rough ? 0.02 : 0.014) * ctx.hh;
            lines.push({ d: G.brush([[c0 + s * wt * 0.42, top], [c0 + s * wt * 0.4, (top + bot) / 2], [c0 + s * wt * 0.34, bot]], [3e-3 * ctx.hh, wgt, 4e-3 * ctx.hh]), fill: "shade", o: s > 0 ? 0.8 : 0.55 });
          }
          pieces.push({ id: "neck-cords", z: ctx.Z.neck + 0.2, d: ctx.body.neck().d, mat: skin, fill: "transparent", light: false, lines });
        }
        return pieces;
      }
      register({
        kind: "age",
        name: "lines",
        params: { level: "1\u20133 (set from spec.age: 40s=1, 50s=2, 60+=3)" },
        example: { age: 58, face: { age: 2 } },
        describe: "Age lines: forehead arcs, crow's feet ticks, under-eye bags, nasolabial and marionette folds, jowls at level 3 and neck cords. A few confident strokes.",
        draw: (ctx, opts) => ageLines(ctx, opts.level, false)
      });
      register({
        kind: "age",
        name: "weathered",
        params: { level: "1\u20133, scales the depth" },
        example: { age: 54, face: { ageStyle: "weathered", age: 2 } },
        describe: "Weathered face: deeper, rougher lines, a brow furrow, cheek creases, double bags, heavy neck cords. Booker, dock heavies, old soldiers.",
        draw: (ctx, opts) => ageLines(ctx, Math.max(2, opts.level || 2), true)
      });
      module.exports = { ageLines };
    }
  });

  // src/parts/belts/belts.js
  var require_belts = __commonJS({
    "src/parts/belts/belts.js"() {
      "use strict";
      var { register } = require_registry();
      var REG = require_registry();
      function waistLine(ctx, o) {
        const { R, hh } = ctx, y = R.y, S = ctx.S.outfit || {};
        if (o.at === "hip") return y.hip - 0.02 * hh;
        if (o.at === "waist") return y.waist + 0.02 * hh;
        const b = S.bottom;
        if (!S.dress && b && /trousers|jeans|slacks|pants|shorts|culottes/.test(b.type)) {
          const top = b.rise === "high" || b.type === "slacks" ? y.waist - 0.12 * hh : b.rise === "low" ? y.hip - 0.12 * hh : y.waist + 0.05 * hh;
          return top + 0.06 * hh;
        }
        if (S.bottom && /pencil/.test(S.bottom.type)) return y.waist - 0.06 * hh;
        return y.waist + 0.02 * hh;
      }
      function untuckedHem(ctx) {
        const O = ctx.S.outfit || {}, Z = ctx.Z;
        if (!O.base || O.outer || O.dress || !REG.get("top", O.base.type)) return null;
        let pcs;
        try {
          pcs = ctx.part("top", O.base.type, O.base);
        } catch (e) {
          return null;
        }
        const body = pcs.filter((p) => p.d && p.z === Z.top && !/sleeve|cuff|arm|collar|neck|hand/.test(p.id || ""));
        if (!body.length || pcs.some((p) => p.d && p.z === Z.tucked)) return null;
        return Math.max(...body.map((p) => ctx.G.bbox(p.d).y1));
      }
      register({
        kind: "belt",
        name: "belt",
        describe: "Leather belt with a buckle, a stitched edge and a tucked tail. Aligns to the trouser rise. Goes under an untucked tee, knit or blouse (the hem hangs over it); skipped when the outer coat has its own belt (trench, leather jacket).",
        params: { color: "leather token (default cloth-brown)", buckle: "metal token (metal-brass, metal-steel)", width: "0.05\u20130.1 head-heights", at: "waist|hip" },
        example: { outfit: { base: { type: "shirt", color: "cloth-cream", tucked: true }, waist: { type: "belt", color: "cloth-brown" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          if (ctx.outerBelt) {
            ctx.warn("belt: the outer layer already has its own belt, so the separate belt was skipped (set outfit.outer.belt:false to use this one)");
            return [];
          }
          const mat = ctx.mat(o.color || "cloth-brown", "leather");
          const y = waistLine(ctx, o), bh = ((_a = o.width) != null ? _a : 0.068) * hh;
          const outer = !!(ctx.S.outfit && (ctx.S.outfit.outer || ctx.S.outfit.mid));
          const hw = R.widthAt(y) + (outer ? 0.115 : 0.055) * hh;
          const a = R.torsoPt(-hw, y), b = R.torsoPt(hw, y), c = R.centerAt(y);
          const lines = [];
          lines.push({ d: G.brush([[a[0], a[1] - bh * 0.4], [c, y - bh * 0.4], [b[0], b[1] - bh * 0.4]], bh * 0.14), fill: "light", o: 0.5 });
          lines.push({ d: G.brush([[a[0], a[1] + bh * 0.46], [c, y + bh * 0.46], [b[0], b[1] + bh * 0.46]], bh * 0.18), fill: "deep", o: 0.55 });
          if (ctx.lodAtLeast("mid")) {
            const t0 = c + 0.1 * hh, t1 = c + 0.3 * hh;
            lines.push({ d: G.poly([[t0, y - bh * 0.5], [t1, y - bh * 0.5], [t1, y + bh * 0.5], [t0, y + bh * 0.5]]), fill: "shade", o: 0.4 });
            lines.push({ d: G.poly([[t1 - 0.018 * hh, y - bh * 0.55], [t1 + 0.012 * hh, y - bh * 0.55], [t1 + 0.012 * hh, y + bh * 0.55], [t1 - 0.018 * hh, y + bh * 0.55]]), fill: "deep", o: 0.65 });
          }
          if (ctx.lodAtLeast("hi")) lines.push({ d: `M${G.f(a[0])} ${G.f(a[1] - bh * 0.3)} L${G.f(b[0])} ${G.f(b[1] - bh * 0.3)}`, c: "light", dash: [0.012 * hh, 0.012 * hh], px: 0.8, o: 0.55 });
          const hem = untuckedHem(ctx), under = hem != null;
          if (under && hem > y + bh / 2) ctx.warn("belt: the untucked base top hangs over the belt and hides it; set outfit.base.tucked:true to show the belt");
          const zb = under ? ctx.Z.top - 0.5 : ctx.Z.belt;
          const out = [{ id: "belt", z: zb, d: G.poly([[a[0], a[1] - bh / 2], [c, y - bh / 2], [b[0], b[1] - bh / 2], [b[0], b[1] + bh / 2], [c, y + bh / 2], [a[0], a[1] + bh / 2]]), mat, lines, spot: o.spot, light: { form: 1 } }];
          const bm = ctx.mat(o.buckle || "metal-brass", "metal");
          const bw = 0.15 * hh, bhh = bh * 1.45;
          const R4 = (cx, cy, w, h) => G.poly([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]);
          out.push({ id: "belt-buckle", z: zb + 0.1, d: R4(c, y, bw, bhh), mat: bm, lines: [{ d: R4(c - 4e-3 * hh, y, bw * 0.62, bhh * 0.56), fill: "deep", o: 0.9 }, { d: G.brush([[c - bw * 0.2, y], [c + bw * 0.42, y]], bh * 0.14), fill: "light", o: 0.9 }], light: { form: 0.8 } });
          return out;
        }
      });
      register({
        kind: "belt",
        name: "chain-belt",
        describe: "Sixties chain belt: loose ring links slung low across the hip with a hanging tail. Over a shift dress it is the Crews silhouette.",
        params: { color: "metal token (default metal-chrome; metal-brass)", at: "waist|hip", links: "number of links (default 20)" },
        example: { outfit: { waist: { type: "chain-belt", color: "metal-chrome" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "metal-chrome", "metal");
          const y = o.at === "waist" ? R.y.waist + 0.05 * hh : R.y.hip - 0.04 * hh;
          const hw = R.widthAt(y) + 0.045 * hh, c = R.centerAt(y);
          const curve = G.resample([R.torsoPt(-hw, y), [c - hw * 0.5, y + 0.06 * hh], [c, y + 0.085 * hh], [c + hw * 0.5, y + 0.06 * hh], R.torsoPt(hw, y)], 60, 0.5);
          const n = (_a = o.links) != null ? _a : 20, rx = 0.034 * hh, ry = 0.022 * hh;
          let d = "";
          const link = (p, ang, i) => {
            const ring = i % 2 === 0;
            const x = ring ? rx : rx * 0.45;
            const outer = G.ellipse(p[0], p[1], x, ry, ang);
            const hole = G.mirrorX(G.ellipse(p[0], p[1], x * 0.5, ry * 0.45, -ang), p[0]);
            return outer + " " + hole;
          };
          for (let i = 0; i < n; i++) {
            const t = (i + 0.5) / n, j = Math.min(curve.length - 2, Math.floor(t * (curve.length - 1)));
            const p = curve[j], q = curve[j + 1];
            d += link(p, Math.atan2(q[1] - p[1], q[0] - p[0]), i) + " ";
          }
          const t0 = [c + hw * 0.22, y + 0.08 * hh];
          for (let i = 0; i < 5; i++) d += link([t0[0] + i * 4e-3 * hh, t0[1] + 0.03 * hh + i * 0.055 * hh], Math.PI / 2, i + 1) + " ";
          d += G.circle(t0[0] + 0.02 * hh, t0[1] + 0.34 * hh, 0.04 * hh);
          return [{ id: "chain-belt", z: ctx.Z.belt, d: d.trim(), mat, spot: o.spot, light: { dx: 0.012 * hh, dy: 8e-3 * hh, sheen: true } }];
        }
      });
    }
  });

  // src/parts/tops/_shared.js
  var require_shared = __commonJS({
    "src/parts/tops/_shared.js"(exports, module) {
      "use strict";
      var clamp01 = (t) => Math.max(0, Math.min(1, t));
      var sstep = (a, b, x) => {
        const t = clamp01((x - a) / (b - a));
        return t * t * (3 - 2 * t);
      };
      var NECK = {
        crew: [0.02, 0.1, 2.2],
        scoop: [0.1, 0.38, 2],
        boat: [0.34, 0.06, 3],
        square: [0.16, 0.28, 8],
        v: [0.01, 0.7, 1],
        high: [0, 0.02, 2],
        turtle: [0, 0, 2]
      };
      function bodice(ctx, o = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
        const { R, G } = ctx;
        const hh = R.hh, w = R.w, y = R.y;
        const cap = ctx.underCaps ? ctx.underCaps() : null;
        const e = Math.min((_a = o.ease) != null ? _a : 0.045, cap ? cap.ease : 9) * hh, eW = Math.min((_c = (_b = o.waistEase) != null ? _b : o.ease) != null ? _c : 0.045, cap ? cap.waist : 9) * hh;
        const dr = Math.max(o.drop || 0, cap ? cap.drop : 0) * hh, slope = (_d = o.slope) != null ? _d : 1;
        const nl = o.neckline || "crew";
        const hem = (_e = o.hem) != null ? _e : y.hip + 0.12 * hh;
        const flare = (o.flare || 0) * hh;
        const cut = o.armhole === "cut";
        const sp = NECK[nl] || NECK.crew;
        const nbw = w.neckBase;
        const nx = nbw + ((_f = o.neckX) != null ? _f : sp[0]) * hh;
        const depth = ((_g = o.depth) != null ? _g : sp[1]) * hh, pw = sp[2];
        const turtle = nl === "turtle";
        const neckH = ((_h = o.neckH) != null ? _h : 0.3) * hh;
        const neckY0 = y.neckBase - 0.03 * hh;
        const sides = {};
        let yC = neckY0;
        for (const s of ["R", "L"]) {
          const k = R.sx(s), A = R.arms[s];
          const P = (x, Y) => R.torsoPt(k * x, Y);
          const edgeX = w.shoulder + 0.08 * A.widths.top + e;
          const xTip = edgeX - 0.12 * hh;
          const yTip = neckY0 + (y.shoulder - 5e-3 * hh - neckY0) * slope;
          const shY = (x) => {
            const f = clamp01((x - nbw) / (xTip - nbw));
            return neckY0 + (yTip - neckY0) * f - 0.02 * hh * Math.sin(Math.PI * f);
          };
          yC = shY(nx);
          const pts = {};
          if (turtle) pts.neckTop = P(w.neck * 1.2 + ((_i = o.neckFlare) != null ? _i : 0.03) * hh, y.neckBase - neckH);
          pts.neck = turtle ? P(nbw + 0.025 * hh, shY(nbw + 0.025 * hh)) : [...P(nx, yC), true];
          const xt = nx + (xTip - nx) * 0.55;
          pts.trap = P(xt, shY(xt));
          const xa = w.chest * 0.98 + e;
          if (cut) {
            const xs = nx + (xTip - nx) * ((_j = o.strap) != null ? _j : 0.5);
            pts.strapTop = [...P(xs, shY(xs)), true];
            const ci = (x, Y, lo) => o.armInner ? Math.max(lo, Math.min(x, o.armInner(s, Y))) : x;
            const yB = y.chest - 0.36 * hh, yP = y.chest - 0.27 * hh, xA = xs + 0.03 * hh;
            pts.armA = P(xA, y.shoulder + 0.22 * hh);
            pts.armB = P(ci(xs + (xa - xs) * 0.45, yB, xA + 0.02 * hh), yB);
            pts.armpit = P(ci(xa - 0.02 * hh, yP, xA + 0.05 * hh), yP);
          } else {
            pts.shTop = P(xTip, yTip);
            pts.shPt = P(edgeX - 0.04 * hh, y.shoulder + 0.1 * hh + dr * 0.6);
            pts.shOut = P(edgeX - 4e-3 * hh, y.shoulder + 0.3 * hh + dr * 0.4);
            pts.armpit = P(xa, y.chest - 0.24 * hh);
          }
          pts.chest = P(w.chest + e, y.chest);
          pts.waist = P(w.waist + eW, y.waist);
          pts.hip = P(w.hip + e, y.hip);
          const hl = Math.min(hem, y.crotch);
          if (hem > y.hip + 0.05 * hh) pts.hipLow = P(R.widthAt(hl) + e + flare * Math.min(1, (hl - y.hip) / Math.max(1, hem - y.hip)), hl - (hem > y.crotch ? 0 : 0.02 * hh));
          pts.hem = [...P(R.widthAt(Math.min(hem, y.crotch + 3 * hh)) + e + flare, hem), true];
          if (hem < y.waist + 0.05 * hh) {
            delete pts.hip;
            delete pts.hipLow;
            pts.hem = [...P(R.widthAt(hem) + e + flare, hem), true];
          }
          if (hem < y.chest + 0.05 * hh) delete pts.waist;
          sides[s] = pts;
        }
        const order = ["neckTop", "neck", "trap", "strapTop", "armA", "armB", "shTop", "shPt", "shOut", "armpit", "chest", "waist", "hip", "hipLow", "hem"];
        const Rp = order.filter((n) => sides.R[n]).map((n) => sides.R[n]);
        const Lp = order.filter((n) => sides.L[n]).map((n) => sides.L[n]).reverse();
        const hemDrop = ((_k = o.hemDrop) != null ? _k : 0.02) * hh;
        const hm = R.torsoPt(0, hem + hemDrop);
        const hemMid = o.hemPoint ? [hm[0], hm[1], true] : hm;
        const across = [];
        if (turtle) across.push(R.torsoPt(0, y.neckBase - neckH + 0.012 * hh));
        else if (pw === 1) across.push([...R.torsoPt(0, yC + depth), true]);
        else for (const t of [0.8, 0.5, 0.25, 0, -0.25, -0.5, -0.8]) across.push(R.torsoPt(t * nx, yC + depth * Math.pow(1 - Math.pow(Math.abs(t), pw), 1 / pw)));
        const all = [...Rp, hemMid, ...Lp, ...across];
        const neckPts = turtle ? [sides.L.neckTop, ...across, sides.R.neckTop] : [sides.L.neck, ...across, sides.R.neck];
        return { d: G.smooth(all, true, (_l = o.tension) != null ? _l : 0.45), pts: sides, L: sides.L, R: sides.R, hem, hemMid, neckMid: turtle ? across[0] : across[Math.floor(across.length / 2)] || [0, yC + depth], neckPts, yC, nx, depth };
      }
      function sleeves(ctx, mat, o = {}) {
        var _a, _b, _c;
        const { R, G, hh } = ctx;
        const out = [];
        const to = (_a = o.to) != null ? _a : 0.32, ease = (_b = o.ease) != null ? _b : 0.05;
        const capK = (_c = o.cap) != null ? _c : Math.max(0.55, 1 - ease / 0.22), flare = o.flare || 0;
        const hwf = (u, base) => {
          let b = o.hw ? o.hw(u, base) : base;
          b *= capK + (1 - capK) * sstep(0, 0.13, u);
          if (flare) b *= 1 + flare * sstep(Math.max(0, to - 0.2), to, u);
          return b;
        };
        const pre = o.prefix || "top";
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          const lb = ctx.body.limb("arm", s, { ease, to, capStart: "round", hw: hwf });
          lb.pieces.forEach((pc) => {
            var _a2, _b2, _c2, _d;
            const lines = [];
            const last = pc.seg === "lower" || pc.seg === "whole";
            if (ctx.lodAtLeast("mid") && to > 0.6) {
              const e = lb.at(lb.split), up = lb.at(lb.split - 0.08), dn = lb.at(lb.split + 0.06);
              const n = G.perp(G.norm(G.sub(dn, up))), hw = lb.hw(lb.split);
              lines.push({ d: G.brush([G.add(e, G.mul(n, -hw * 0.9)), G.add(G.lerp(e, dn, 0.5), G.mul(n, -hw * 0.1))], [4e-3 * hh, 0.022 * hh, 2e-3 * hh], { samples: 5 }), fill: "deep", o: 0.7 });
              lines.push({ d: G.brush([G.add(up, G.mul(n, hw * 0.8)), G.add(G.lerp(up, e, 0.6), G.mul(n, hw * 0.05))], [3e-3 * hh, 0.016 * hh, 2e-3 * hh], { samples: 5 }), fill: "shade", o: 0.8 });
            }
            if (last && o.cuff !== false && ctx.lodAtLeast("mid")) {
              const p = lb.at(to), q = lb.at(Math.max(0, to - 0.03)), dir = G.norm(G.sub(p, q)), n = G.perp(dir);
              const hw = lb.hw(to) * 1.15, bw = ((_a2 = o.hemBand) != null ? _a2 : 0.034) * hh;
              const c = G.sub(p, G.mul(dir, bw * 0.45));
              lines.push({ d: G.brush([G.add(c, G.mul(n, -hw)), G.add(c, G.mul(n, hw))], bw, { samples: 5 }), fill: "shade", o: (_b2 = o.hemO) != null ? _b2 : 0.8 });
            }
            out.push({ id: `${pre}-sleeve-${s}-${pc.seg}`, z: A.z + ((_c2 = o.zAdd) != null ? _c2 : 0.2) + (pc.seg === "lower" ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat, lines, pattern: o.pattern, light: { form: (_d = o.form) != null ? _d : 1 } });
          });
          if (o.shadow !== false && to < 0.92 && ctx.lodAtLeast("mid")) {
            const sb = ctx.body.limb("arm", s, { from: to - 0.01, to: Math.min(1, to + 0.07), capStart: "flat" });
            sb.pieces.forEach((pc, i) => out.push({ id: `${pre}-arm-${s}-hemshadow${i}`, z: A.z + 0.1 + (pc.seg === "lower" ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat: ctx.skin, fill: "deep", light: false, opacity: 0.32 }));
          }
        }
        return out;
      }
      function torsoFolds(ctx, t, o = {}) {
        const { R, G, hh } = ctx;
        const lines = [];
        if (!ctx.lodAtLeast("mid")) return lines;
        const W = (pts, ws, fill, op) => lines.push({ d: G.brush(pts, ws.map((v) => v * hh), { samples: 5 }), fill, o: op });
        for (const s of ["R", "L"]) {
          const k = R.sx(s), P = t.pts[s], ap = P.armpit, lit = s === "R";
          const sh = lit ? "shade" : "deep";
          W([[ap[0] - k * 0.02 * hh, ap[1] + 0.05 * hh], [ap[0] - k * 0.22 * hh, ap[1] + 0.2 * hh], [ap[0] - k * (lit ? 0.32 : 0.4) * hh, ap[1] + (lit ? 0.26 : 0.3) * hh]], [2e-3, lit ? 0.016 : 0.024, 2e-3], sh, lit ? 0.6 : 0.8);
          if (!lit && o.strong !== false) W([[ap[0] - k * 0.03 * hh, ap[1] + 0.2 * hh], [ap[0] - k * 0.16 * hh, ap[1] + 0.38 * hh], [ap[0] - k * 0.22 * hh, ap[1] + 0.52 * hh]], [2e-3, 0.016, 2e-3], "shade", 0.7);
          if (o.armShadow !== false) {
            const lb = ctx.body.limb("arm", s, { ease: 0.04, to: 0.46 });
            const pts = [];
            for (const u of [0.07, 0.19, 0.31, 0.43]) {
              const c = lb.at(u), c2 = lb.at(u + 0.02), c0 = lb.at(Math.max(0, u - 0.02));
              let n = G.perp(G.norm(G.sub(c2, c0)));
              if ((R.centerAt(c[1]) - c[0]) * n[0] < 0) n = [-n[0], -n[1]];
              pts.push(G.add(c, G.mul(n, lb.hw(u) + 0.03 * hh)));
            }
            lines.push({ d: G.brush(pts, [2e-3 * hh, 0.06 * hh, 0.06 * hh, 2e-3 * hh], { samples: 7 }), fill: lit ? "deep" : "shade", o: lit ? 0.5 : 0.3 });
          }
          if (o.waist && P.waist) {
            const wp = P.waist;
            W([[wp[0] - k * 0.01 * hh, wp[1] - 0.05 * hh], [wp[0] - k * 0.16 * hh, wp[1] - 0.01 * hh], [wp[0] - k * 0.3 * hh, wp[1] + 0.04 * hh]], [2e-3, 0.016, 2e-3], "shade", lit ? 0.55 : 0.8);
            W([[wp[0] - k * 0.01 * hh, wp[1] + 0.07 * hh], [wp[0] - k * 0.14 * hh, wp[1] + 0.11 * hh], [wp[0] - k * 0.24 * hh, wp[1] + 0.14 * hh]], [2e-3, 0.012, 2e-3], "shade", 0.5);
          }
          if (o.hemFolds !== false && P.hem) {
            const hp = P.hem;
            W([[hp[0] - k * 0.06 * hh, hp[1] - 0.02 * hh], [hp[0] - k * 0.2 * hh, hp[1] - 0.2 * hh], [hp[0] - k * 0.26 * hh, hp[1] - 0.3 * hh]], [0.018, 0.01, 2e-3], "shade", 0.8);
          }
        }
        return lines;
      }
      function collarFlaps(ctx, mat, o = {}) {
        var _a, _b, _c, _d, _e, _f;
        const { R, G, hh } = ctx;
        const nb = R.y.neckBase, nx0 = R.w.neckBase * 0.97;
        const len = ((_a = o.len) != null ? _a : 0.28) * hh, spread = ((_b = o.spread) != null ? _b : 0.14) * hh, rise = ((_c = o.rise) != null ? _c : 0.13) * hh, gap = ((_d = o.gap) != null ? _d : 0.03) * hh, throat = ((_e = o.throat) != null ? _e : 0.06) * hh;
        const pieces = [], shadow = [];
        for (const s of ["R", "L"]) {
          const k = R.sx(s), P = (x, Y) => R.torsoPt(k * x, Y);
          const A = P(nx0 * 0.92, nb - rise), B = P(nx0 + 0.09 * hh, nb - rise * 0.6), M = P(nx0 + spread * 0.92, nb + len * 0.5);
          const C = [...P(nx0 + spread, nb + len), true], D = [...P(gap, nb + throat), true];
          const E = G.lerp(D, A, 0.55);
          const Dm = G.lerp(C, D, 0.5);
          Dm[1] -= 0.012 * hh;
          const poly = [A, B, M, C, Dm, D, E];
          const d = G.smooth(poly, true, 0.4);
          const lines = [];
          if (ctx.lodAtLeast("mid")) lines.push({ d: G.brush([G.lerp(A, E, 0.15), G.lerp(A, E, 0.6), G.lerp(D, E, 0.2)], [2e-3 * hh, 0.02 * hh, 2e-3 * hh], { samples: 5 }), fill: "shade", o: 0.55 });
          pieces.push({ id: `${o.id || "collar"}-${s}`, z: (_f = o.z) != null ? _f : 31.8, d, mat, pattern: o.pattern, lines, light: { form: 0.55 } });
          shadow.push({ d: G.translate(d, 0.012 * hh, 0.024 * hh), fill: "deep", o: 0.55 });
        }
        return { pieces, shadow };
      }
      function buttons(ctx, ys, o = {}) {
        var _a, _b;
        const { R, G, hh } = ctx;
        if (!ctx.lodAtLeast("mid")) return [];
        const r = ((_a = o.r) != null ? _a : 0.014) * hh, out = [];
        for (const Y of ys) {
          const c = R.torsoPt(((_b = o.dx) != null ? _b : 0) * hh, Y);
          out.push({ d: G.ellipse(c[0], c[1], r, r), fill: o.fill || "deep", o: 0.9 });
          if (ctx.lodAtLeast("hi")) out.push({ d: G.ellipse(c[0] - r * 0.3, c[1] - r * 0.3, r * 0.35, r * 0.35), fill: "light", o: 0.8 });
        }
        return out;
      }
      function centreLine(ctx, y0, y1, o = {}) {
        var _a, _b, _c;
        const { R, G, hh } = ctx;
        const dx = ((_a = o.dx) != null ? _a : 0.02) * hh;
        const pts = [0, 0.5, 1].map((f) => R.torsoPt(dx, y0 + (y1 - y0) * f));
        return { d: G.brush(pts, [2e-3 * hh, ((_b = o.w) != null ? _b : 0.01) * hh, 4e-3 * hh]), fill: o.fill || "shade", o: (_c = o.o) != null ? _c : 0.7 };
      }
      function ribLines(ctx, a, b, o = {}) {
        var _a, _b;
        const { G, hh } = ctx;
        const out = [];
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) out.push({ d: G.brush([a[i], G.lerp(a[i], b[i], 0.5), b[i]], ((_a = o.w) != null ? _a : 6e-3) * hh), fill: o.fill || "shade", o: (_b = o.o) != null ? _b : 0.4 });
        return out;
      }
      function ribBody(ctx, halfW, y0, y1, o = {}) {
        var _a, _b;
        const { R, G, hh } = ctx;
        const sp = ((_a = o.spacing) != null ? _a : 0.055) * hh, out = [];
        for (let x = -halfW; x <= halfW; x += sp) {
          const pts = [y0, (y0 + y1) / 2, y1].map((Y) => R.torsoPt(x, Y));
          const lit = x < 0;
          out.push({ d: G.brush(pts, ((_b = o.w) != null ? _b : 7e-3) * hh), fill: lit ? "light" : "shade", o: lit ? 0.32 : 0.4 });
        }
        return out;
      }
      function cuffs(ctx, mat, o = {}) {
        var _a, _b, _c;
        const { R, G, hh } = ctx;
        const out = [], u0 = (_a = o.from) != null ? _a : 0.9, u1 = (_b = o.to) != null ? _b : 1, ease = (_c = o.ease) != null ? _c : 0.055;
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          const lb = ctx.body.limb("arm", s, { ease, from: u0, to: u1, capStart: "flat", hw: o.hw });
          lb.pieces.forEach((pc, i) => {
            const lines = [];
            if (ctx.lodAtLeast("mid")) {
              const p = lb.at(u0), q = lb.at(u0 + 0.03), dir = G.norm(G.sub(q, p)), n = G.perp(dir), hw = lb.hw(u0);
              lines.push({ d: G.brush([G.add(p, G.mul(n, -hw * 1.1)), G.add(p, G.mul(n, hw * 1.1))], 0.022 * hh, { samples: 3 }), fill: "deep", o: 0.55 });
              if (o.button !== false) {
                const bp = G.add(G.lerp(p, q, 1.6), G.mul(n, hw * 0.4 * (s === "R" ? 1 : -1)));
                lines.push({ d: G.ellipse(bp[0], bp[1], 0.012 * hh), fill: "deep", o: 0.8 });
              }
            }
            out.push({ id: `${o.prefix || "top"}-cuff-${s}${lb.pieces.length > 1 ? i : ""}`, z: A.z + 0.6 + (pc.seg === "lower" ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat, lines, pattern: o.pattern, light: { form: 0.8 } });
          });
        }
        return out;
      }
      function hemBand(ctx, b, h = 0.08, fill = "shade") {
        const { G, hh } = ctx;
        const a = [b.pts.R.hem, b.hemMid, b.pts.L.hem].map((p) => [p[0], p[1] - h * 0.5 * hh]);
        const lines = [{ d: G.brush(a, [h * hh, h * hh, h * hh]), fill, o: 0.5 }];
        if (ctx.lodAtLeast("mid")) {
          const n = ctx.lodAtLeast("hi") ? 26 : 14;
          const pts = G.resample([b.pts.R.hem, b.hemMid, b.pts.L.hem], n, 0.5);
          for (const p of pts) lines.push({ d: G.brush([[p[0], p[1] - h * hh], [p[0], p[1]]], 7e-3 * hh), fill: "deep", o: 0.35 });
        }
        return lines;
      }
      function flatten(G, d) {
        const pts = [];
        let cur = null;
        for (const sg of G.parse(d)) {
          if (sg.c === "M" || sg.c === "L") {
            cur = sg.p[0];
            pts.push(cur);
          } else if (sg.c === "C") {
            const [a, b, p] = sg.p;
            for (let i = 1; i <= 16; i++) {
              const t = i / 16, u = 1 - t;
              pts.push([u * u * u * cur[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p[0], u * u * u * cur[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p[1]]);
            }
            cur = p;
          } else if (sg.c === "Q") {
            const [a, p] = sg.p;
            for (let i = 1; i <= 8; i++) {
              const t = i / 8, u = 1 - t;
              pts.push([u * u * cur[0] + 2 * u * t * a[0] + t * t * p[0], u * u * cur[1] + 2 * u * t * a[1] + t * t * p[1]]);
            }
            cur = p;
          }
        }
        return pts;
      }
      function topAt(pts, x) {
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
            const y = a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));
            if (best === null || y < best) best = y;
          }
        }
        return best;
      }
      function edgeAt(pts, y, side) {
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
            const x = a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1]));
            if (best === null || (side === "R" ? x < best : x > best)) best = x;
          }
        }
        return best;
      }
      module.exports = { cuffs, hemBand, bodice, sleeves, torsoFolds, collarFlaps, buttons, centreLine, ribLines, ribBody, sstep, clamp01, NECK, flatten, topAt, edgeAt };
    }
  });

  // src/parts/body/standard.js
  var require_standard = __commonJS({
    "src/parts/body/standard.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var shared = null;
      try {
        shared = require_shared();
      } catch (e) {
      }
      var sstep = (a, b, x) => {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      function chestSkin(ctx) {
        var _a;
        const { R, G, hh } = ctx;
        const t = ctx.body.torso({ ease: 0, hem: R.y.waist, neckline: "high" });
        if (!shared || !shared.bodice) return t.d;
        const b = shared.bodice(ctx, { ease: 0, waistEase: 0, neckline: "high", neckX: 0, hem: R.y.waist });
        const line = shared.flatten(G, b.d), margin = 8e-3 * hh;
        const down = (p) => {
          const y = shared.topAt(line, p[0]);
          return y === null ? p : [p[0], Math.max(p[1], y + margin), ...p.slice(2)];
        };
        const own = shared.flatten(G, t.d), skinTop = (x) => shared.topAt(own, x);
        const P = { R: { ...t.pts.R }, L: { ...t.pts.L } };
        let moved = false;
        for (const s of ["R", "L"]) {
          const g = b.pts[s], p = P[s];
          const n0 = p.neck, t0 = p.trap;
          p.neck = down(p.neck);
          p.trap = down(p.trap);
          const x1 = p.neck[0] + (g.trap[0] - p.neck[0]) * 0.3;
          const q0 = [x1, (_a = skinTop(x1)) != null ? _a : p.neck[1]];
          p.q1 = down(q0);
          if (p.neck[1] !== n0[1] || p.trap[1] !== t0[1] || p.q1[1] !== q0[1]) moved = true;
        }
        if (!moved) return t.d;
        const order = ["neck", "q1", "trap", "shTop", "shPt", "armpit", "chest", "waist", "hip", "hipLow", "hem"];
        const Rp = order.filter((n) => P.R[n]).map((n) => P.R[n]);
        const Lp = order.filter((n) => P.L[n]).map((n) => P.L[n]).reverse();
        return G.smooth([...Rp, t.hemMid, ...Lp, t.neckMid], true, 0.45);
      }
      function build(ctx, V) {
        const { R, G, Z, skin, hh } = ctx;
        const fem = R.fem;
        const out = [];
        const mid = ctx.lodAtLeast("mid"), hi = ctx.lodAtLeast("hi");
        const B = (pts, ws, fill, o) => ({ d: G.brush(pts, ws), fill, o });
        const nw = (fem ? 0.93 : 1) * V.neck;
        const nk = ctx.body.neck({ width: nw });
        const c0 = R.head.cx, c1 = R.centerAt(R.y.neckBase), wn = R.w.neck * nw;
        const yaw = R.head.yaw || 0;
        const jawTop = R.y.neckTop;
        const jawShadow = G.smooth([
          [c0 - wn * 0.86, jawTop],
          [c0 - wn * 0.8, R.y.chin + 0.025 * hh],
          [c0 - wn * 0.36, R.y.chin + 0.085 * hh],
          [c0 + yaw * 0.05 * hh, R.y.chin + 0.12 * hh],
          [c0 + wn * 0.5, R.y.chin + 0.1 * hh],
          [c0 + wn * 0.8, R.y.chin + 0.03 * hh],
          [c0 + wn * 0.86, jawTop]
        ], true, 0.5);
        const jawCore = G.smooth([
          [c0 - wn * 0.8, jawTop],
          [c0 - wn * 0.45, R.y.chin + 0.012 * hh],
          [c0 + yaw * 0.04 * hh, R.y.chin + 0.055 * hh],
          [c0 + wn * 0.6, R.y.chin + 0.015 * hh],
          [c0 + wn * 0.8, jawTop]
        ], true, 0.5);
        const neckLines = [];
        if (mid) {
          for (const s of ["R", "L"]) {
            const k = R.sx(s), lit = s === "R";
            const a = [c0 + k * wn * 0.92, R.y.chin + 0.03 * hh], b = [c0 + k * wn * 0.55, R.y.chin + 0.28 * hh], e = [c1 + k * 0.05 * hh, R.y.neckBase + 0.05 * hh];
            neckLines.push(B([a, b, e], [3e-3 * hh, 0.03 * V.neck * hh, 4e-3 * hh], lit ? "shade" : "deep", lit ? 0.35 : 0.55));
            if (hi) neckLines.push(B([[a[0] - k * 0.015 * hh, a[1] + 0.05 * hh], [b[0] - k * 0.02 * hh, b[1]]], [3e-3 * hh, 0.014 * hh, 2e-3 * hh], "light", 0.4));
          }
          if (hi && !fem) neckLines.push(B([[c1 - 0.015 * hh, R.y.chin + 0.3 * hh], [c1 + 0.01 * hh, R.y.chin + 0.36 * hh]], [0.012 * hh, 0.02 * hh, 4e-3 * hh], "light", 0.3));
        }
        out.push({ id: "neck", z: Z.neck, d: nk.d, mat: skin, shade: [jawShadow], deep: [jawCore], lines: neckLines, light: { form: 1.2 } });
        const chestD = chestSkin(ctx);
        const cl = [];
        const nb = R.y.neckBase, c = R.centerAt(nb);
        if (mid) {
          for (const s of ["R", "L"]) {
            const k = R.sx(s), lit = s === "R";
            const sx = R.w.shoulder * 0.62;
            const pts = [[c + k * 0.06 * hh, nb + 0.1 * hh], [c + k * 0.22 * hh, nb + 0.085 * hh], [c + k * (sx * 0.65 + 0.1 * hh), nb + 0.115 * hh], [c + k * sx, nb + 0.17 * hh]];
            cl.push(B(pts, [3e-3 * hh, 0.017 * V.clav * hh, 0.011 * hh, 3e-3 * hh], "shade", lit ? 0.6 : 0.85));
            if (hi) cl.push(B(pts.map((p) => [p[0], p[1] - 0.016 * hh]), [2e-3 * hh, 0.011 * hh, 8e-3 * hh, 2e-3 * hh], "light", 0.45));
            cl.push(B([[c + k * 0.34 * hh, nb + 0.17 * hh], [c + k * (sx * 0.8), nb + 0.25 * hh]], [2e-3 * hh, 0.03 * hh, 2e-3 * hh], "shade", 0.4));
            if (V.pec) cl.push(B([[c + k * 0.12 * hh, nb + 0.66 * hh], [c + k * 0.4 * hh, nb + 0.74 * hh], [c + k * 0.66 * hh, nb + 0.62 * hh]], [2e-3 * hh, 0.04 * hh, 3e-3 * hh], "shade", 0.55));
          }
          cl.push({ d: G.ellipse(c, nb + 0.075 * hh, R.w.neckBase * 0.28, 0.035 * hh), fill: "deep", o: 0.55 });
        }
        out.push({ id: "chest-skin", noYoke: true, z: Z.torso, d: chestD, mat: skin, lines: cl, deep: [G.ellipse(c, nb - 0.02 * hh, R.w.neckBase * 1.1, 0.1 * hh)] });
        const femA = fem ? 0.95 : 1;
        const armTaper = (u) => V.arm * femA * (1 - 0.1 * sstep(0.8, 1, u)) * (1 - 0.04 * Math.exp(-Math.pow((u - 0.52) / 0.05, 2)));
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          const lb = ctx.body.limb("arm", s, { hw: (u, base) => base * Math.min(1, armTaper(u)) });
          lb.pieces.forEach((pc, i) => {
            const fore = pc.seg === "lower" || pc.seg === "whole";
            const up = pc.seg === "upper" || pc.seg === "whole";
            const lines = [];
            if (mid) {
              const segName = pc.seg === "whole" ? "whole" : pc.seg;
              const bn = ctx.bone("arm", s, segName === "whole" ? "whole" : segName);
              const nx = segName === "whole" ? 1 : bn.n[0];
              const sh = nx > 0 ? 1 : -1;
              if (fore) {
                const u0 = segName === "whole" ? lb.split + 0.06 : 0.12, u1 = segName === "whole" ? 0.96 : 0.92;
                lines.push({ d: bn.bs(G.brush([[u0, sh * 0.15], [(u0 + u1) / 2, sh * 0.5], [u1, sh * 0.35]], [0.02, 0.4, 0.02])), fill: "shade", o: 0.5 });
                if (hi) lines.push({ d: bn.bs(G.brush([[u0 + 0.05, -sh * 0.55], [(u0 + u1) / 2, -sh * 0.62], [u1 - 0.08, -sh * 0.5]], [0.02, 0.22, 0.02])), fill: "light", o: 0.4 });
              }
              if (up && V.delt) lines.push({ d: bn.bs(G.brush(segName === "whole" ? [[0.05, -sh * 0.3], [0.2, -sh * 0.05], [0.34, -sh * 0.2]] : [[0.12, -sh * 0.3], [0.4, sh * 0], [0.7, -sh * 0.2]], [0.02, 0.3 * V.delt, 0.02])), fill: "shade", o: 0.5 });
              if (pc.seg === "lower" || pc.seg === "upper") {
                const d1 = G.norm(G.sub(A.elbow, A.shoulder)), d2 = G.norm(G.sub(A.wrist, A.elbow));
                const cz = d1[0] * d2[1] - d1[1] * d2[0];
                const inner = G.mul(G.perp(d1), cz > 0 ? 1 : -1);
                const hw = lb.hw(lb.split), e = A.elbow;
                const ip = G.add(e, G.mul(inner, hw * 0.95));
                lines.push({ d: G.brush([ip, G.lerp(ip, e, 0.55), G.add(e, G.mul(d2, 0.1 * hh))], [0.03 * hh, 0.022 * hh, 2e-3 * hh]), fill: "deep", o: 0.35 });
              }
            }
            if (hi && fore) {
              const e = A.wrist;
              const d2 = G.norm(G.sub(A.wrist, A.elbow));
              lines.push({ d: G.ellipse(e[0] - d2[0] * 0.04 * hh + A.k * 0, e[1] - d2[1] * 0.04 * hh, 0.028 * hh, 0.02 * hh), fill: "light", o: 0.45 });
            }
            out.push({ id: `arm-${s}-${pc.seg}`, z: A.z + (pc.seg === "lower" ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat: skin, lines, light: { form: 1 } });
          });
        }
        const femL = fem ? 0.94 : 1;
        const legTaper = (u) => V.leg * femL * (1 - 0.1 * sstep(0.86, 1, u)) * (1 + 0.025 * Math.exp(-Math.pow((u - 0.49) / 0.04, 2))) * (fem ? 1 - 0.04 * sstep(0.5, 0.8, u) : 1);
        for (const s of ["R", "L"]) {
          const L = R.legs[s];
          const lb = ctx.body.limb("leg", s, { capStart: "flat", hw: (u, base) => base * legTaper(u) });
          const lines = [];
          if (mid) {
            const k = R.sx(s);
            const kn = L.knee, kw = lb.hw(lb.split);
            lines.push({ d: G.ellipse(kn[0] - kw * 0.1, kn[1] - 0.02 * hh, kw * 0.62, 0.05 * hh), fill: "light", o: 0.28 });
            lines.push({ d: G.brush([[kn[0] - kw * 0.7, kn[1] + 0.07 * hh], [kn[0], kn[1] + 0.1 * hh], [kn[0] + kw * 0.7, kn[1] + 0.07 * hh]], [2e-3 * hh, 0.022 * hh, 2e-3 * hh]), fill: "shade", o: 0.5 });
            const c02 = lb.at(lb.split + 0.14), c12 = lb.at(0.86);
            lines.push({ d: G.brush([[c02[0] + kw * 0.2, c02[1]], [G.lerp(c02, c12, 0.5)[0] + kw * 0.55, G.lerp(c02, c12, 0.5)[1]], [c12[0] + kw * 0.2, c12[1]]], [2e-3 * hh, 0.05 * hh, 2e-3 * hh]), fill: "shade", o: 0.45 });
            if (hi) lines.push({ d: G.ellipse(L.ankle[0] + k * lb.hw(0.96) * 0.5, L.ankle[1] - 0.015 * hh, 0.022 * hh, 0.028 * hh), fill: "light", o: 0.4 });
          }
          lb.pieces.forEach((pc) => out.push({ id: `leg-${s}-${pc.seg}`, z: Z.legs, d: pc.d, mat: skin, lines, light: { form: 1 } }));
        }
        return out;
      }
      var VAR = {
        standard: { neck: 1, clav: 1, pec: false, delt: 0, arm: 1, leg: 1 },
        muscular: { neck: 1.12, clav: 1.15, pec: true, delt: 1.3, arm: 1, leg: 1 },
        bony: { neck: 0.9, clav: 1.9, pec: false, delt: 0, arm: 0.9, leg: 0.92 }
      };
      register({
        kind: "body",
        name: "standard",
        describe: "Skin layer: neck with jaw cast-shadow and sternocleidomastoids, collarbones and sternal notch, tapered arms with elbow crease and wrist bone, knees and calves. Slimmer neck, arms and legs on fem figures.",
        example: {},
        draw: (ctx) => build(ctx, VAR.standard)
      });
      register({
        kind: "body",
        name: "muscular",
        describe: "Standard skin layer with a thicker neck, deltoid and pectoral planes (brawlers, dock heavies).",
        example: { body: { type: "muscular" } },
        draw: (ctx) => build(ctx, VAR.muscular)
      });
      register({
        kind: "body",
        name: "bony",
        describe: "Standard skin layer, thinner limbs and neck, hard collarbones (the wiry, the old, the starved).",
        example: { body: { type: "bony" } },
        draw: (ctx) => build(ctx, VAR.bony)
      });
      module.exports = { build };
    }
  });

  // src/core/geom.js
  var require_geom = __commonJS({
    "src/core/geom.js"(exports, module) {
      "use strict";
      var f = (n) => {
        const a = Math.abs(n);
        if (a < 1e-9) return "0";
        const k = a < 10 ? 1e4 : 100;
        return (Math.round(n * k) / k).toString();
      };
      var add = (a, b) => [a[0] + b[0], a[1] + b[1]];
      var sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
      var mul = (a, k) => [a[0] * k, a[1] * k];
      var len = (a) => Math.hypot(a[0], a[1]);
      var norm = (a) => {
        const l = len(a) || 1;
        return [a[0] / l, a[1] / l];
      };
      var perp = (a) => [-a[1], a[0]];
      var lerp = (a, b, t) => Array.isArray(a) ? [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] : a + (b - a) * t;
      var dist = (a, b) => len(sub(a, b));
      var rot = (p, ang, c = [0, 0]) => {
        const s = Math.sin(ang), co = Math.cos(ang), x = p[0] - c[0], y = p[1] - c[1];
        return [c[0] + x * co - y * s, c[1] + x * s + y * co];
      };
      function poly(pts, closed = true) {
        return "M" + pts.map((p) => f(p[0]) + " " + f(p[1])).join(" L") + (closed ? " Z" : "");
      }
      function smooth(pts, closed = true, tension = 0.5) {
        const n = pts.length;
        if (n < 2) return "";
        if (n === 2) return poly(pts, closed);
        const k = tension / 3 * 2;
        const P = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
        let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
        const segs = closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
          const sharp1 = p1[2] === true, sharp2 = p2[2] === true;
          const c1 = sharp1 ? p1 : [p1[0] + (p2[0] - p0[0]) * k / 2, p1[1] + (p2[1] - p0[1]) * k / 2];
          const c2 = sharp2 ? p2 : [p2[0] - (p3[0] - p1[0]) * k / 2, p2[1] - (p3[1] - p1[1]) * k / 2];
          d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
        }
        return d + (closed ? " Z" : "");
      }
      function ellipse(cx, cy, rx, ry = rx, rotRad = 0) {
        const k = 0.5523;
        const P = (x, y) => rot([cx + x, cy + y], rotRad, [cx, cy]);
        const pts = [
          [P(rx, 0)],
          [P(rx, ry * k), P(rx * k, ry), P(0, ry)],
          [P(-rx * k, ry), P(-rx, ry * k), P(-rx, 0)],
          [P(-rx, -ry * k), P(-rx * k, -ry), P(0, -ry)],
          [P(rx * k, -ry), P(rx, -ry * k), P(rx, 0)]
        ];
        let d = `M${f(pts[0][0][0])} ${f(pts[0][0][1])}`;
        for (let i = 1; i < 5; i++) d += " C" + pts[i].map((p) => f(p[0]) + " " + f(p[1])).join(" ");
        return d + " Z";
      }
      var circle = (cx, cy, r) => ellipse(cx, cy, r, r);
      function brush(pts, widths, opts = {}) {
        var _a;
        const n = pts.length;
        if (n < 2) return "";
        const dense = resample(pts, opts.samples || Math.max(7, Math.min(16, n * 3 + 1)), (_a = opts.tension) != null ? _a : 0.5);
        if (Array.isArray(widths) && widths.length < 2) widths = widths.length ? widths[0] : 1;
        if (widths == null || typeof widths === "number" && !isFinite(widths)) widths = 1;
        const W = typeof widths === "function" ? widths : Array.isArray(widths) ? (t) => {
          const m = widths.length - 1;
          const s = t * m, i = Math.min(m - 1, Math.floor(s));
          return lerp(widths[i], widths[i + 1], s - i);
        } : () => widths;
        const L = [], R = [];
        for (let i = 0; i < dense.length; i++) {
          const t = i / (dense.length - 1);
          const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
          const nrm = perp(norm(sub(b, a)));
          const w = W(t) / 2;
          L.push(add(dense[i], mul(nrm, w)));
          R.push(sub(dense[i], mul(nrm, w)));
        }
        return smooth([...L, ...R.reverse()], true, 0.3);
      }
      function resample(pts, n, tension = 0.5) {
        const out = [];
        const m = pts.length;
        n = Math.max(2, n | 0);
        if (m < 2) return m ? [pts[0], pts[0]] : [];
        const P = (i) => pts[Math.max(0, Math.min(m - 1, i))];
        const k = tension;
        const seg = (i, t) => {
          const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
          const t2 = t * t, t3 = t2 * t;
          const m1 = [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k], m2 = [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
          const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
          return [h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0], h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1]];
        };
        for (let j = 0; j < n; j++) {
          const s = j / (n - 1) * (m - 1);
          const i = Math.min(m - 2, Math.floor(s));
          out.push(seg(i, s - i));
        }
        return out;
      }
      function tube(center, hw, opts = {}) {
        var _a, _b, _c;
        const dense = resample(center, opts.samples || 24, (_a = opts.tension) != null ? _a : 0.5);
        const L = [], R = [];
        const sl = (_b = opts.left) != null ? _b : 1, sr = (_c = opts.right) != null ? _c : 1;
        for (let i = 0; i < dense.length; i++) {
          const t = i / (dense.length - 1);
          const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
          const nrm = perp(norm(sub(b, a)));
          const w = typeof hw === "function" ? hw(t) : hw;
          L.push(add(dense[i], mul(nrm, w * (typeof sl === "function" ? sl(t) : sl))));
          R.push(sub(dense[i], mul(nrm, w * (typeof sr === "function" ? sr(t) : sr))));
        }
        const pts = [...L];
        if (opts.capEnd === "round") {
          const e = dense[dense.length - 1], dir = norm(sub(e, dense[dense.length - 2])), w = typeof hw === "function" ? hw(1) : hw;
          pts.push(add(e, mul(dir, w * 0.9)));
        } else if (L.length) {
          pts[pts.length - 1] = [...pts[pts.length - 1], true];
          R[R.length - 1] = [...R[R.length - 1], true];
        }
        pts.push(...R.reverse());
        if (opts.capStart === "round") {
          const s0 = dense[0], dir = norm(sub(dense[0], dense[1])), w = typeof hw === "function" ? hw(0) : hw;
          pts.push(add(s0, mul(dir, w * 0.9)));
        } else if (pts.length) {
          pts[0] = [...pts[0].slice(0, 2), true];
          pts[pts.length - 1] = [...pts[pts.length - 1].slice(0, 2), true];
        }
        return smooth(pts, true, 0.35);
      }
      function parse(d) {
        const toks = String(d).match(/[a-df-zA-DF-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
        const out = [];
        let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, lc = null, lq = null;
        const bad = (why) => {
          throw new Error(`Bad path (${why}) in: ` + String(d).slice(0, 80));
        };
        const num = () => {
          if (i >= toks.length || /^[a-zA-Z]$/.test(toks[i])) bad("missing operand");
          return parseFloat(toks[i++]);
        };
        while (i < toks.length) {
          if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
          else if (cmd === null) bad("starts with a number");
          else if (cmd === "Z" || cmd === "z") bad("number after Z");
          const rel = cmd === cmd.toLowerCase();
          const C = cmd.toUpperCase();
          const ox = rel ? cx : 0, oy = rel ? cy : 0;
          if (C === "Z") {
            out.push({ c: "Z", p: [] });
            cx = sx;
            cy = sy;
            lc = lq = null;
            continue;
          }
          if (C === "M") {
            const p = [num() + ox, num() + oy];
            out.push({ c: "M", p: [p] });
            cx = sx = p[0];
            cy = sy = p[1];
            cmd = rel ? "l" : "L";
            lc = lq = null;
            continue;
          }
          if (C === "L") {
            const p = [num() + ox, num() + oy];
            out.push({ c: "L", p: [p] });
            [cx, cy] = p;
            lc = lq = null;
            continue;
          }
          if (C === "H") {
            const x = num() + (rel ? cx : 0);
            out.push({ c: "L", p: [[x, cy]] });
            cx = x;
            lc = lq = null;
            continue;
          }
          if (C === "V") {
            const y = num() + (rel ? cy : 0);
            out.push({ c: "L", p: [[cx, y]] });
            cy = y;
            lc = lq = null;
            continue;
          }
          if (C === "C") {
            const a = [num() + ox, num() + oy], b = [num() + ox, num() + oy], p = [num() + ox, num() + oy];
            out.push({ c: "C", p: [a, b, p] });
            lc = b;
            lq = null;
            [cx, cy] = p;
            continue;
          }
          if (C === "S") {
            const a = lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy];
            const b = [num() + ox, num() + oy], p = [num() + ox, num() + oy];
            out.push({ c: "C", p: [a, b, p] });
            lc = b;
            lq = null;
            [cx, cy] = p;
            continue;
          }
          if (C === "Q") {
            const a = [num() + ox, num() + oy], p = [num() + ox, num() + oy];
            out.push({ c: "Q", p: [a, p] });
            lq = a;
            lc = null;
            [cx, cy] = p;
            continue;
          }
          if (C === "T") {
            const a = lq ? [2 * cx - lq[0], 2 * cy - lq[1]] : [cx, cy];
            const p = [num() + ox, num() + oy];
            out.push({ c: "Q", p: [a, p] });
            lq = a;
            lc = null;
            [cx, cy] = p;
            continue;
          }
          if (C === "A") throw new Error("Arc commands are not supported in figure parts: use geom.ellipse() or a C curve.");
          throw new Error("Bad path command " + cmd + " in: " + String(d).slice(0, 80));
        }
        return out;
      }
      function serialise(segs) {
        return segs.map((s) => s.c + (s.p.length ? s.p.map((p) => f(p[0]) + " " + f(p[1])).join(" ") : "")).join(" ");
      }
      function mapPath(d, fn) {
        if (!d) return d;
        return serialise(parse(d).map((s) => ({ c: s.c, p: s.p.map((p) => fn(p)) })));
      }
      function bbox(d) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of parse(d)) for (const p of s.p) {
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
        }
        if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0, x1: 0, y1: 0, cx: 0, cy: 0 };
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
      }
      var translate = (d, dx, dy) => mapPath(d, (p) => [p[0] + dx, p[1] + dy]);
      var scale = (d, sx, sy = sx, c = [0, 0]) => mapPath(d, (p) => [c[0] + (p[0] - c[0]) * sx, c[1] + (p[1] - c[1]) * sy]);
      var rotate = (d, ang, c = [0, 0]) => mapPath(d, (p) => rot(p, ang, c));
      var mirrorX = (d, cx = 0) => mapPath(d, (p) => [2 * cx - p[0], p[1]]);
      var hasNaN = (d) => /NaN|Infinity/.test(String(d));
      module.exports = { f, add, sub, mul, len, norm, perp, lerp, dist, rot, poly, smooth, ellipse, circle, brush, resample, tube, parse, serialise, mapPath, bbox, translate, scale, rotate, mirrorX, hasNaN };
    }
  });

  // src/parts/bottoms/_lower.js
  var require_lower = __commonJS({
    "src/parts/bottoms/_lower.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var ss = (t) => {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
      };
      var TUCK_FRAC = 0.42;
      function legFrame(ctx, s, extra = 0.14) {
        const { R } = ctx;
        const L = R.legs[s];
        const lb = ctx.body.limb("leg", s, {});
        const U1 = 1 + extra, N = 20;
        const dl = G.norm(G.sub(L.ankle, L.knee));
        const total = G.dist(L.hip, L.knee) + G.dist(L.knee, L.ankle);
        const at0 = (u) => u <= 1 ? lb.at(u) : G.add(L.ankle, G.mul(dl, (u - 1) * total));
        const pts = [];
        for (let i = 0; i <= N; i++) pts.push(at0(U1 * i / N));
        const dense = G.resample(pts, N * 4 + 1, 0.5);
        const M = dense.length - 1;
        const at = (u) => {
          const f = Math.max(0, Math.min(1, u / U1)) * M;
          const i = Math.min(M - 1, Math.floor(f));
          return G.lerp(dense[i], dense[i + 1], f - i);
        };
        const dir = (u) => G.norm(G.sub(at(Math.min(U1, u + 0.015)), at(Math.max(0, u - 0.015))));
        const nrm = (u) => {
          const d = dir(u);
          let n = [d[1], -d[0]];
          if (n[0] * L.k < 0) n = [-n[0], -n[1]];
          return n;
        };
        const nAbs = (u) => {
          const d = dir(u);
          let n = [d[1], -d[0]];
          if (n[0] < 0) n = [-n[0], -n[1]];
          return n;
        };
        const sk = (u) => lb.hw(Math.max(0, Math.min(1, u)));
        const uAtY = (y) => {
          let a = 0, b = U1;
          for (let i = 0; i < 24; i++) {
            const m = (a + b) / 2;
            if (at(m)[1] < y) a = m;
            else b = m;
          }
          return (a + b) / 2;
        };
        return { L, k: L.k, at, dir, nrm, nAbs, sk, uAtY, split: lb.split, U1, total };
      }
      function legProfile(ctx, F, cut, e, o = {}) {
        const hh = ctx.hh, lw = F.L.widths, kn = F.split;
        const thighW = lw.thigh + e, kneeW = lw.knee + e * 0.8, ankW = lw.ankle + e * 0.5;
        const C = {
          straight: { t: 1, k: 1.08, h: kneeW * 1.08, p: 1 },
          slim: { t: 1, k: 1, h: Math.max(ankW * 1.3, kneeW * 0.78), p: 1 },
          tapered: { t: 1.06, k: 1.03, h: Math.max(ankW * 1.22, kneeW * 0.7), p: 1.1 },
          skinny: { t: 0.99, k: 0.93, h: ankW * 1.1, p: 1 },
          cigarette: { t: 1, k: 0.96, h: Math.max(ankW * 1.15, kneeW * 0.74), p: 1 },
          flare: { t: 1, k: 1, h: kneeW * 1.85, p: 1.5 },
          bootcut: { t: 1, k: 1, h: kneeW * 1.32, p: 1.3 },
          wide: { t: 1.04, k: 1.3, h: kneeW * 1.75, p: 1.25 },
          baggy: { t: 1.18, k: 1.2, h: thighW * 1.1, p: 1 },
          culotte: { t: 1.15, k: 1.3, h: thighW * 1.32, p: 1 }
        }[cut] || { t: 1, k: 1.08, h: kneeW * 1.08, p: 1 };
        const blouse = o.blouse || 0, hemU = o.hemU || 1;
        const prof = (u) => {
          let w;
          if (u < kn) w = G.lerp(thighW * C.t, kneeW * C.k, Math.pow(u / kn, 0.9));
          else w = G.lerp(kneeW * C.k, C.h, Math.pow(Math.min(1.2, (u - kn) / (1 - kn)), C.p));
          if (blouse) w *= 1 + blouse * ss((u - (hemU - 0.14)) / 0.14);
          return Math.max(w, F.sk(u) + 0.014 * hh);
        };
        return prof;
      }
      function remember(ctx, d) {
        if (ctx.slot === "bottom" || ctx.slot === "dress") ctx.lowerOutline = d;
      }
      function lowerBody(ctx, o = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const { R, hh } = ctx, y = R.y;
        const e = ((_a = o.ease) != null ? _a : 0.04) * hh;
        const top = (_b = o.topY) != null ? _b : o.rise === "high" ? y.waist - 0.12 * hh : o.rise === "low" ? y.hip - 0.12 * hh : y.waist + 0.05 * hh;
        const topE = ((_d = o.waistEase) != null ? _d : Math.min((_c = o.ease) != null ? _c : 0.04, 0.05)) * hh;
        const hemSpec = (_e = o.hem) != null ? _e : "ankle";
        const hemYs = { ankle: y.ankle + 0.03 * hh, floor: -0.03 * hh, crop: y.ankle - 0.3 * hh };
        const cy = y.crotch + ((_f = o.crotchDrop) != null ? _f : 0.03) * hh, cx = R.pelvisShift;
        const legs = {};
        for (const s of ["R", "L"]) {
          const F = legFrame(ctx, s);
          let hemU;
          if (o.hemY != null) hemU = F.uAtY(o.hemY);
          else if (o.hemFn) hemU = o.hemFn(F);
          else if (typeof hemSpec === "number") hemU = hemSpec;
          else if (hemSpec === "knee") hemU = F.split * 1.05;
          else if (hemSpec === "shorts") hemU = F.split * 0.56;
          else hemU = F.uAtY((_g = hemYs[hemSpec]) != null ? _g : hemYs.ankle);
          const prof0 = legProfile(ctx, F, o.cut || "straight", e, { blouse: o.blouse, hemU });
          const lk = o.legK && o.legK[s] || 1, prof1 = lk === 1 ? prof0 : (u) => prof0(u) * lk;
          const prof = o.legStraight && o.legStraight[s] ? (u) => Math.max(prof1(u), prof1(0) + (prof1(hemU) - prof1(0)) * Math.min(1, u / hemU)) : prof1;
          const outer = [], inner = [], M = 18;
          for (let i = 0; i <= M; i++) {
            const u = hemU * i / M, p = F.at(u), n = F.nrm(u), w = prof(u);
            outer.push(G.add(p, G.mul(n, w)));
            inner.push(G.sub(p, G.mul(n, w)));
          }
          legs[s] = { outer, inner, atU: F.at, prof, hemTo: hemU, F };
        }
        const topL = R.torsoPt(-(R.widthAt(top) + topE), top), topR = R.torsoPt(R.widthAt(top) + topE, top);
        const hipL = R.torsoPt(-(R.w.hip + e), y.hip), hipR = R.torsoPt(R.w.hip + e, y.hip);
        hipL[0] = Math.min(hipL[0], legs.R.outer[1][0] - 0.01 * hh);
        hipR[0] = Math.max(hipR[0], legs.L.outer[1][0] + 0.01 * hh);
        const mark = (p) => [p[0], p[1], true];
        const arch = (Lg, k) => {
          let j0 = 0;
          while (j0 < Lg.inner.length - 2 && Lg.inner[j0][1] < cy + 0.14 * hh) j0++;
          const q = Lg.inner[j0];
          const mid = [G.lerp(q[0], cx, 0.5), G.lerp(q[1], cy, 0.62) - 0.01 * hh];
          return { j0, mid };
        };
        const aR = arch(legs.R, -1), aL = arch(legs.L, 1);
        const Ls = legs.R, Rs = legs.L;
        const up = o.upper ? o.upper({ topL, topR, hipL, hipR, top, mark }) : { L: [mark(topL), hipL], R: [hipR, mark(topR)] };
        const upL = up.L, upR = up.R;
        const hemPts = (Lg, rev) => {
          const a = mark(Lg.outer[Lg.outer.length - 1]), b = mark(Lg.inner[Lg.inner.length - 1]);
          const mid = o.hemSag ? [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + o.hemSag * hh]] : [];
          return rev ? [b, ...mid, a] : [a, ...mid, b];
        };
        const pts = [
          ...upL,
          ...Ls.outer.slice(1, -1),
          ...hemPts(Ls),
          ...Ls.inner.slice(aR.j0 + 1, -1).reverse(),
          aR.mid,
          [cx, cy, true],
          aL.mid,
          ...Rs.inner.slice(aL.j0 + 1, -1),
          ...hemPts(Rs, true),
          ...Rs.outer.slice(1, -1).reverse(),
          ...upR
        ];
        const d = G.smooth(pts, true, 0.42);
        remember(ctx, d);
        return { d, legs, top, crotch: [cx, cy], topL, topR, hipL, hipR, e };
      }
      function skirtShape(ctx, o = {}) {
        var _a, _b, _c, _d, _e, _f;
        const { R, hh } = ctx, y = R.y;
        const e = ((_a = o.ease) != null ? _a : 0.04) * hh;
        const topY = (_b = o.topY) != null ? _b : o.rise === "high" ? y.waist - 0.1 * hh : y.waist + 0.04 * hh;
        const FR = { mini: 0.15, short: 0.28, aline: 0.4, knee: 0.5, midi: 0.72 };
        let hemY;
        if (o.hemY != null) hemY = o.hemY;
        else if (o.hem === "maxi") hemY = -0.12 * hh;
        else if (o.hem === "floor") hemY = -0.03 * hh;
        else hemY = y.crotch + (typeof o.hem === "number" ? o.hem : (_c = FR[o.hem || "aline"]) != null ? _c : 0.4) * (y.ankle - y.crotch);
        const hipW = R.w.hip + e;
        const hemW = hipW + ((_d = o.flare) != null ? _d : 0.2) * hh - (o.taper || 0) * hh;
        const pw = (_e = o.pow) != null ? _e : 1.1;
        const wAt = (Y) => Y <= y.hip ? R.widthAt(Y) + e : hipW + (hemW - hipW) * Math.pow(Math.min(1, (Y - y.hip) / Math.max(1, hemY - y.hip)), pw);
        const P = (k, Y) => Y <= y.hip + 0.02 * hh ? R.torsoPt(k * wAt(Y), Y) : [R.pelvisShift + k * wAt(Y), Y];
        const side = (k) => {
          const pts2 = [[...P(k, topY), true]];
          if (topY < y.waist - 0.02 * hh) pts2.push(P(k, y.waist));
          pts2.push(P(k, y.hip));
          for (const t of [0.35, 0.7]) pts2.push(P(k, y.hip + (hemY - y.hip) * t));
          pts2.push([...P(k, hemY), true]);
          return pts2;
        };
        const sR = side(-1), sL = side(1);
        const sag = ((_f = o.sag) != null ? _f : 0.012) * hh;
        const hemMid = [R.pelvisShift, hemY + sag];
        const pts = [...sR, hemMid, ...sL.slice().reverse()];
        const d = G.smooth(pts, true, 0.4);
        remember(ctx, d);
        return { d, topY, hemY, topL: sR[0], topR: sL[0], hemL: sR[sR.length - 1], hemR: sL[sL.length - 1], hipW, hemW, wAt, P, hemMid };
      }
      function hemYOf(ctx, o = {}) {
        var _a;
        const { R, hh } = ctx, y = R.y;
        const FR = { mini: 0.15, short: 0.26, aline: 0.4, knee: 0.5, midi: 0.72 };
        if (o.hemY != null) return o.hemY;
        if (o.hem === "maxi") return -0.12 * hh;
        if (o.hem === "floor") return -0.03 * hh;
        return y.crotch + (typeof o.hem === "number" ? o.hem : (_a = FR[o.hem || "aline"]) != null ? _a : 0.4) * (y.ankle - y.crotch);
      }
      function plane(p0, p1, w, bend = 0, w0 = 2e-3) {
        const m = G.lerp(p0, p1, 0.5), d = G.norm(G.sub(p1, p0)), n = [-d[1], d[0]];
        return G.brush([p0, [m[0] + n[0] * bend, m[1] + n[1] * bend], p1], [w0, w, w0 * 0.6]);
      }
      function legPt(F, prof, u, v) {
        const p = F.at(u), n = F.nrm(u);
        return G.add(p, G.mul(n, v * prof(u)));
      }
      module.exports = { hemYOf, legFrame, legProfile, lowerBody, skirtShape, plane, legPt, ss, TUCK_FRAC };
    }
  });

  // src/parts/bottoms/trousers.js
  var require_trousers = __commonJS({
    "src/parts/bottoms/trousers.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { lowerBody, plane, legPt, TUCK_FRAC } = require_lower();
      function pocketHands(ctx, T, mat) {
        const { R, G, hh } = ctx, extra = [];
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          if (A.pose !== "pocket") continue;
          const k = R.sx(s), wr = A.wrist;
          const pa = [R.centerAt(T.top) + k * (R.widthAt(T.top) * 0.55), T.top + 0.07 * hh], pb = [k * (R.w.hip * 0.98) + R.pelvisShift, R.y.hip + 0.12 * hh];
          ctx.cut(`(arm|sleeve|cuff|hand)-${s}`, G.poly([pa, pb, [pb[0] + k * 0.6 * hh, pb[1] + 0.2 * hh], [pb[0] + k * 0.6 * hh, wr[1] + 1.2 * hh], [pa[0] - k * 0.6 * hh, wr[1] + 1.2 * hh], [pa[0] - k * 0.6 * hh, pa[1] + 0.05 * hh]]));
          extra.push({ id: `pocket-mouth-${s}`, z: A.z + 0.9, over: [{ d: G.brush([pa, G.lerp(pa, pb, 0.5), pb], [6e-3 * hh, 0.02 * hh, 8e-3 * hh]), fill: mat.deep }] });
        }
        return extra;
      }
      function trouserDetail(ctx, T, mat, o = {}) {
        const { R, G, hh } = ctx;
        const lines = [], over = [];
        const c = R.centerAt(T.top);
        const mid = ctx.lodAtLeast("mid"), hi = ctx.lodAtLeast("hi");
        const wb = 0.07 * hh, band = o.band !== false;
        if (band) lines.push({ d: G.poly([T.topL, T.topR, [T.topR[0], T.topR[1] + wb], [T.topL[0], T.topL[1] + wb]]), fill: "shade", o: 0.5 });
        if (band) lines.push({ d: G.brush([[T.topL[0], T.topL[1] + wb], [c, T.top + wb + 6e-3 * hh], [T.topR[0], T.topR[1] + wb]], 0.011 * hh), fill: "deep", o: 0.55 });
        const slimCut = /slim|skinny|cigarette|tapered/.test(o.cut || "");
        if (mid) {
          if (o.loops !== false && band) {
            const hw = R.widthAt(T.top);
            for (const f of [-0.8, -0.42, 0.42, 0.8]) {
              const x = c + f * hw, y0 = T.top - 4e-3 * hh;
              lines.push({ d: G.poly([[x - 0.011 * hh, y0], [x + 0.011 * hh, y0], [x + 0.011 * hh, y0 + 0.1 * hh], [x - 0.011 * hh, y0 + 0.1 * hh]]), fill: "shade", o: 0.8 });
            }
          }
          if (o.fly !== false) lines.push({ d: G.brush([[c + 8e-3 * hh, T.top + 0.08 * hh], [c + 0.03 * hh, T.top + 0.4 * hh], [c - 0.012 * hh, T.top + 0.52 * hh]], [8e-3 * hh, 0.011 * hh, 4e-3 * hh]), fill: "shade" });
          if (hi && o.fly !== false) over.push({ d: G.circle(c, T.top + 0.12 * hh, 8e-3 * hh), fill: "light", o: 0.8 });
          const cr = T.crotch;
          for (const s of ["R", "L"]) {
            const k = R.sx(s), L = T.legs[s], F = L.F, hemTo = L.hemTo, sh = k > 0 ? 0.85 : 0.5;
            if (o.pockets !== "none" && band) {
              const pa = [c + k * (R.widthAt(T.top) * 0.55), T.top + 0.07 * hh], pb = [k * (R.w.hip * 0.98) + R.pelvisShift, R.y.hip + 0.12 * hh];
              lines.push({ d: G.brush([pa, G.lerp(pa, pb, 0.5), pb], [4e-3 * hh, 0.013 * hh, 4e-3 * hh]), fill: "deep", o: 0.85 });
              lines.push({ d: G.brush([G.add(pa, [-k * 0.012 * hh, 4e-3 * hh]), G.add(G.lerp(pa, pb, 0.5), [-k * 0.012 * hh, 4e-3 * hh]), G.add(pb, [-k * 0.012 * hh, 4e-3 * hh])], [1e-3 * hh, 6e-3 * hh, 1e-3 * hh]), fill: "light", o: 0.5 });
            }
            const nW = slimCut ? 1 : 2;
            for (let i = 0; i < nW; i++) {
              const p1 = legPt(F, L.prof, 0.2 + i * 0.1, 0.5 + i * 0.4);
              lines.push({ d: plane([cr[0] + k * 0.02 * hh, cr[1] + 0.02 * hh], p1, (0.034 - i * 8e-3) * hh, -0.01 * hh), fill: "shade", o: sh * (1 - i * 0.2) });
            }
            if (o.crease !== false) {
              const p0 = F.at(0.1), p1 = F.at(hemTo * 0.97), pm = G.lerp(p0, p1, 0.5);
              lines.push({ d: G.brush([p0, pm, p1], [1e-3 * hh, 7e-3 * hh, 3e-3 * hh]), fill: "light", o: 0.6 });
              lines.push({ d: G.brush([G.add(p0, [0.01 * hh, 0]), G.add(pm, [0.011 * hh, 0]), G.add(p1, [0.011 * hh, 0])], [1e-3 * hh, 5e-3 * hh, 2e-3 * hh]), fill: "shade", o: 0.5 });
            }
            if (hemTo > F.split + 0.1) {
              const kA = legPt(F, L.prof, F.split - 0.07, 0.9), kB = legPt(F, L.prof, F.split + 0.03, -0.2 * k);
              lines.push({ d: plane(kA, kB, 0.016 * hh, 6e-3 * hh), fill: "shade", o: 0.6 });
              lines.push({ d: plane(legPt(F, L.prof, F.split + 0.09, 0.7), legPt(F, L.prof, F.split + 0.15, -0.1), 0.01 * hh, 4e-3 * hh), fill: "shade", o: 0.4 });
            }
            if (hemTo > 0.95) {
              for (const [u, f, w] of [[hemTo - 0.07, 1, 0.026], [hemTo - 0.035, 0.7, 0.016]]) {
                lines.push({ d: plane(legPt(F, L.prof, u, 0.95), legPt(F, L.prof, u + 0.018, 0.95 - 1.7 * f), w * hh, 4e-3 * hh), fill: "shade", o: 0.85 });
              }
            }
            if (o.cuff) {
              const a = legPt(F, L.prof, hemTo - 0.045, 1.05), b = legPt(F, L.prof, hemTo - 0.045, -1.05), a2 = legPt(F, L.prof, hemTo, 1.05), b2 = legPt(F, L.prof, hemTo, -1.05);
              lines.push({ d: G.poly([a, b, b2, a2]), fill: "light", o: 0.28 });
              lines.push({ d: G.brush([a, b], 8e-3 * hh), fill: "deep", o: 0.6 });
            }
          }
          if (band) for (const f of [-0.5, 0.5]) lines.push({ d: plane([c + f * R.widthAt(T.top), T.top + 0.1 * hh], [c + f * R.widthAt(T.top) * 0.8, T.top + 0.38 * hh], 0.012 * hh), fill: "shade", o: 0.45 });
        }
        return { lines, extra: pocketHands(ctx, T, mat), over };
      }
      function buildTrousers(ctx, o, d = {}) {
        var _a, _b;
        const mat = ctx.mat(o.color || d.color || "cloth-charcoal", o.kind || d.kind || "wool");
        const feet = ctx.S.outfit && ctx.S.outfit.feet || {};
        const tucked = !!feet.tucked && /boots/.test(feet.type || "");
        const lo = {
          ease: (_b = (_a = o.ease) != null ? _a : d.ease) != null ? _b : 0.04,
          cut: o.cut || d.cut || "straight",
          rise: o.rise || d.rise,
          hem: o.hem || d.hem
        };
        if (tucked) {
          lo.hemFn = (F) => 1 - TUCK_FRAC * (1 - F.split) + 0.03;
          lo.blouse = 0.2;
          lo.hemSag = 0.03;
        }
        const T = lowerBody(ctx, lo);
        const det = trouserDetail(ctx, T, mat, { ...d, ...o, cut: lo.cut });
        return { mat, T, det, tucked };
      }
      register({
        kind: "bottom",
        name: "trousers",
        describe: "Flat-front trousers: slant pockets, fly, pressed crease, crotch whiskers, knee drag and an ankle break. Tucks into boots.",
        params: { color: "fabric token", cut: "slim|tapered|straight|flare|bootcut|wide|skinny", rise: "high|mid|low", hem: "ankle|floor|crop", pattern: "textile name (e.g. houndstooth)", cuff: "true for turn-ups", crease: "false to drop the crease" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-charcoal", cut: "slim" } } },
        trouserDetail,
        pocketHands,
        draw(ctx, o) {
          const { mat, T, det } = buildTrousers(ctx, o);
          return [{ id: "trousers", z: ctx.Z.bottom, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines: det.lines, over: det.over, light: { form: 1 } }, ...det.extra];
        }
      });
      module.exports = { trouserDetail, pocketHands, buildTrousers };
    }
  });

  // src/parts/bottoms/skirts.js
  var require_skirts = __commonJS({
    "src/parts/bottoms/skirts.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { skirtShape, plane } = require_lower();
      var { pocketHands } = require_trousers();
      function skirtDetail(ctx, S, o = {}) {
        var _a;
        const { R, G, hh } = ctx, y = R.y;
        const lines = [];
        const c = R.pelvisShift, hip = y.hip;
        const topY = S.topY;
        if (o.band !== false) {
          lines.push({ d: G.poly([S.topL, S.topR, [S.topR[0], S.topR[1] + 0.065 * hh], [S.topL[0], S.topL[1] + 0.065 * hh]]), fill: "shade", o: 0.5 });
          lines.push({ d: G.brush([[S.topL[0], S.topL[1] + 0.065 * hh], [R.centerAt(topY), topY + 0.07 * hh], [S.topR[0], S.topR[1] + 0.065 * hh]], 0.01 * hh), fill: "deep", o: 0.5 });
        }
        if (ctx.lodAtLeast("mid")) {
          const len = S.hemY - hip, flare = S.hemW - S.hipW;
          const fans = (_a = o.fans) != null ? _a : 2;
          for (const k of [-1, 1]) {
            const shadowSide = k > 0;
            for (let i = 0; i < fans; i++) {
              const f = (i + 0.7) / (fans + 0.3);
              const p0 = [c + k * S.hipW * (0.18 + 0.62 * f), y.waist + 0.1 * hh + 0.1 * hh * f];
              const p1 = [c + k * (S.hipW + flare * f * 1.05) * (0.7 + 0.3 * f), S.hemY - 0.012 * hh];
              lines.push({ d: plane(p0, p1, (0.05 - i * 0.012) * hh * Math.min(1.3, len / (1.2 * hh)), k * 0.01 * hh), fill: "shade", o: shadowSide ? 0.78 - i * 0.12 : 0.4 - i * 0.08 });
            }
          }
          lines.push({ d: plane([c - S.hipW * 0.5, hip - 0.05 * hh], [c - S.hemW * 0.62, S.hemY - 0.02 * hh], 0.05 * hh), fill: "light", o: 0.22 });
          lines.push({ d: G.brush([[S.hemL[0], S.hemL[1] - 0.03 * hh], [S.hemMid[0], S.hemMid[1] - 0.03 * hh], [S.hemR[0], S.hemR[1] - 0.03 * hh]], 0.01 * hh), fill: "deep", o: 0.32 });
          lines.push({ d: G.brush([[S.hemL[0], S.hemL[1] - 0.045 * hh], [S.hemMid[0], S.hemMid[1] - 0.045 * hh], [S.hemR[0], S.hemR[1] - 0.045 * hh]], 6e-3 * hh), fill: "light", o: 0.3 });
        }
        return lines;
      }
      function skirtPiece(ctx, o, d) {
        var _a, _b;
        const mat = ctx.mat(o.color || d.color, o.kind || d.kind || "wool");
        const S = skirtShape(ctx, { ease: d.ease, hem: o.hem || d.hem, flare: (_a = o.flare) != null ? _a : d.flare, taper: d.taper, pow: d.pow, rise: o.rise || d.rise, sag: d.sag });
        const lines = skirtDetail(ctx, S, d);
        const pocketArm = ["R", "L"].some((sd) => ctx.R.arms[sd].pose === "pocket");
        if (pocketArm && o.pockets === false) ctx.warn(`${d.id}: pockets:false with a pocket arm pose leaves the hand lying over the skirt front; drop pockets:false`);
        const extra = ((_b = o.pockets) != null ? _b : pocketArm) ? pocketHands(ctx, { top: S.topY }, mat) : [];
        return [{ id: d.id, z: ctx.Z.bottom, d: S.d, mat, pattern: o.pattern, spot: o.spot, lines, light: { form: 1 } }, ...extra];
      }
      register({
        kind: "bottom",
        name: "a-line-skirt",
        describe: "Knee-grazing A-line skirt: waistband, long fold planes fanning from the hip, crisp hem.",
        params: { color: "fabric token", hem: "short|aline|knee|midi|maxi", flare: "extra hem half-width in head-heights (0.1\u20130.5)", rise: "mid|high", pockets: "side pockets (automatic when an arm is posed pocket; false to omit)", pattern: "textile name" },
        example: { outfit: { bottom: { type: "a-line-skirt", color: "cloth-rust" } } },
        draw: (ctx, o) => skirtPiece(ctx, o, { id: "skirt-aline", color: "cloth-rust", hem: "aline", flare: 0.26, ease: 0.035, pow: 1.1 })
      });
      register({
        kind: "bottom",
        name: "mini-skirt",
        describe: "Sixties mini: a crisp short A-line a hand above the knee. Bare legs or tights below.",
        params: { color: "fabric token", hem: "mini|short", flare: "0.1\u20130.3", pockets: "side pockets (automatic when an arm is posed pocket; false to omit)", pattern: "textile name" },
        example: { outfit: { bottom: { type: "mini-skirt", color: "cloth-mustard" } } },
        draw: (ctx, o) => skirtPiece(ctx, o, { id: "skirt-mini", color: "cloth-mustard", hem: "mini", flare: 0.16, ease: 0.03, pow: 0.9, fans: 2 })
      });
      register({
        kind: "bottom",
        name: "pencil-skirt",
        describe: "Straight pencil skirt to just below the knee, hem tapering in, with hip pull wrinkles.",
        params: { color: "fabric token", hem: "knee|midi", pockets: "side pockets (automatic when an arm is posed pocket; false to omit)", pattern: "textile name" },
        example: { outfit: { bottom: { type: "pencil-skirt", color: "cloth-charcoal" } } },
        draw(ctx, o) {
          const out = skirtPiece(ctx, o, { id: "skirt-pencil", color: "cloth-charcoal", hem: "knee", flare: 0, taper: 0.2, ease: 0.025, pow: 0.75, fans: 1, sag: 6e-3, rise: "high" });
          return out;
        }
      });
      module.exports = { skirtDetail };
    }
  });

  // src/parts/bottoms/trousers-more.js
  var require_trousers_more = __commonJS({
    "src/parts/bottoms/trousers-more.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { buildTrousers, trouserDetail, pocketHands } = require_trousers();
      var { lowerBody, plane, legPt } = require_lower();
      function patchPocket(ctx, L, o = {}) {
        var _a, _b, _c, _d, _e;
        const { G, hh } = ctx, F = L.F, P = (u, v) => legPt(F, L.prof, u, v);
        const u0 = (_a = o.u0) != null ? _a : 0.2, u1 = (_b = o.u1) != null ? _b : 0.4, v0 = (_c = o.v0) != null ? _c : 0.1, v1 = (_d = o.v1) != null ? _d : 0.96, fl = (_e = o.flap) != null ? _e : 0.065;
        const lines = [], over = [];
        lines.push({ d: G.poly([P(u0, v0), P(u0, v1), P(u1, v1 * 0.94), P(u1, v0 + 0.05)]), fill: "light", o: 0.16 });
        lines.push({ d: G.brush([P(u0, v0 + 0.02), P(u1, v0 + 0.07)], 8e-3 * hh), fill: "light", o: 0.55 });
        lines.push({ d: G.brush([P(u1, v0 + 0.07), P(u1, v1 * 0.94)], 0.012 * hh), fill: "deep", o: 0.7 });
        lines.push({ d: G.brush([P(u1, v1 * 0.94), P(u0, v1)], 7e-3 * hh), fill: "deep", o: 0.45 });
        lines.push({ d: plane(P(u0 + fl, v1 * 0.8), P(u1 - 5e-3, v1 * 0.78), 0.016 * hh), fill: "shade", o: 0.55 });
        lines.push({ d: G.poly([P(u0, v0 - 0.03), P(u0, v1 + 0.04), P(u0 + fl, v1 + 0.03), P(u0 + fl * 1.25, (v0 + v1) / 2), P(u0 + fl, v0 - 0.02)]), fill: "light", o: 0.24 });
        lines.push({ d: G.brush([P(u0 + fl, v0 - 0.02), P(u0 + fl * 1.25, (v0 + v1) / 2), P(u0 + fl, v1 + 0.03)], [4e-3 * hh, 0.016 * hh, 4e-3 * hh]), fill: "deep", o: 0.75 });
        over.push({ d: G.circle(...P(u0 + fl * 0.8, (v0 + v1) / 2), 9e-3 * hh), fill: o.button || "deep" });
        return { lines, over };
      }
      register({
        kind: "bottom",
        name: "cargo-trousers",
        describe: "Roomy field trousers with thigh cargo pockets (flap, button, bellows) and slant pockets; tucks into combat boots. Booker and Stacey.",
        params: { color: "fabric token (cloth-olive, cloth-slate\u2026)", cut: "straight|tapered|slim", rise: "mid|high", hem: "ankle|crop", pattern: "textile name" },
        example: { outfit: { bottom: { type: "cargo-trousers", color: "cloth-olive" } } },
        draw(ctx, o) {
          const { mat, T, det } = buildTrousers(ctx, o, { kind: "canvas", color: "cloth-olive", ease: 0.075, cut: "straight", crease: false });
          const lines = [...det.lines], over = [...det.over];
          if (ctx.lodAtLeast("mid")) for (const s of ["R", "L"]) {
            const pk = patchPocket(ctx, T.legs[s], { button: "deep" });
            lines.push(...pk.lines);
            over.push(...pk.over);
          }
          return [{ id: "trousers-cargo", z: ctx.Z.bottom, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines, over, light: { form: 1 } }, ...det.extra];
        }
      });
      register({
        kind: "bottom",
        name: "jeans",
        describe: "Five-pocket denim jeans: curved front pockets with brass rivets, belt loops, top-stitching at hi LOD, optional turn-ups and fade.",
        params: { color: "denim token (cloth-denim, cloth-faded-denim)", cut: "straight|slim|bootcut|flare", cuff: "true for turn-ups", pattern: "textile name" },
        example: { outfit: { bottom: { type: "jeans", color: "cloth-denim" } } },
        draw(ctx, o) {
          const { R, G, hh } = ctx;
          const { mat, T, det } = buildTrousers(ctx, { ...o, pockets: "none", crease: false }, { kind: "denim", color: "cloth-denim", ease: 0.04, cut: "straight", hem: "ankle" });
          const lines = [...det.lines], over = [...det.over];
          const c = R.centerAt(T.top), hw = R.widthAt(T.top);
          if (ctx.lodAtLeast("mid")) {
            for (const s of ["R", "L"]) {
              const k = R.sx(s), L = T.legs[s];
              const pa = [c + k * hw * 0.42, T.top + 0.07 * hh], pm = [c + k * hw * 0.62, T.top + 0.36 * hh], pb = [k * R.w.hip * 0.97 + R.pelvisShift, T.top + 0.52 * hh];
              lines.push({ d: G.brush([pa, pm, pb], [4e-3 * hh, 0.012 * hh, 4e-3 * hh]), fill: "deep", o: 0.9 });
              lines.push({ d: G.brush([G.add(pa, [-k * 0.014 * hh, 4e-3 * hh]), G.add(pm, [-k * 0.014 * hh, 4e-3 * hh]), G.add(pb, [-k * 0.01 * hh, 8e-3 * hh])], [1e-3 * hh, 6e-3 * hh, 1e-3 * hh]), fill: "light", o: 0.5 });
              over.push({ d: G.circle(pa[0], pa[1] + 0.03 * hh, 8e-3 * hh), fill: "metal-brass" }, { d: G.circle(pb[0] - k * 0.02 * hh, pb[1] - 0.02 * hh, 8e-3 * hh), fill: "metal-brass" });
              const F = L.F;
              lines.push({ d: plane(legPt(F, L.prof, 0.14, -0.1), legPt(F, L.prof, 0.4, 0.15), 0.07 * hh), fill: "light", o: 0.2 });
              lines.push({ d: plane(legPt(F, L.prof, F.split - 0.06, 0.1), legPt(F, L.prof, F.split + 0.1, 0), 0.05 * hh), fill: "light", o: 0.2 });
            }
            over.push({ d: G.circle(c, T.top + 0.035 * hh, 0.011 * hh), fill: "metal-brass" });
            if (ctx.lodAtLeast("hi")) for (const s of ["R", "L"]) {
              const F = T.legs[s].F, L = T.legs[s];
              lines.push({ d: G.brush([legPt(F, L.prof, 0.05, 0.93), legPt(F, L.prof, L.hemTo * 0.95, 0.93)], 4e-3 * hh), fill: "light", o: 0.45 });
            }
          }
          return [{ id: "jeans", z: ctx.Z.bottom, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines, over, light: { form: 1 } }, ...det.extra];
        }
      });
      register({
        kind: "bottom",
        name: "cigarette-pants",
        describe: "Sixties slim cigarette pants, ankle-grazing, flat front, no break at the hem. Crews and the Swinger set.",
        params: { color: "fabric token", rise: "mid|high", pattern: "textile name" },
        example: { outfit: { bottom: { type: "cigarette-pants", color: "cloth-black" } } },
        draw(ctx, o) {
          const hemY = ctx.R.y.ankle - 0.17 * ctx.hh;
          const lo = { ease: 0.025, cut: "cigarette", rise: o.rise || "mid", hemY };
          const mat = ctx.mat(o.color || "cloth-black", o.kind || "wool");
          const T = lowerBody(ctx, lo);
          const det = trouserDetail(ctx, T, mat, { ...o, cut: "cigarette", loops: false });
          return [{ id: "cigarette-pants", z: ctx.Z.bottom, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines: det.lines, over: det.over, light: { form: 1 } }, ...det.extra];
        }
      });
      register({
        kind: "bottom",
        name: "slacks",
        describe: "High-waisted wide-leg slacks, forward pleats, long and flowing: the sixties fem trouser.",
        params: { color: "fabric token", hem: "floor|ankle", pattern: "textile name" },
        example: { outfit: { bottom: { type: "slacks", color: "cloth-navy" } } },
        draw(ctx, o) {
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-navy", o.kind || "wool");
          const T = lowerBody(ctx, { ease: 0.05, waistEase: 0.03, cut: "wide", rise: "high", hem: o.hem || "floor" });
          const det = trouserDetail(ctx, T, mat, { ...o, cut: "wide", pockets: "none", loops: false });
          const lines = [...det.lines];
          const c = R.centerAt(T.top), hw = R.widthAt(T.top);
          if (ctx.lodAtLeast("mid")) {
            for (const f of [-0.5, -0.24, 0.24, 0.5]) lines.push({ d: plane([c + f * hw, T.top + 0.06 * hh], [c + f * hw * 1.18, T.top + 0.95 * hh], 0.02 * hh), fill: "shade", o: f > 0 ? 0.7 : 0.4 });
            lines.push({ d: G.circle(c + hw * 0.04, T.top + 0.035 * hh, 9e-3 * hh), fill: "light", o: 0.6 });
            for (const s of ["R", "L"]) {
              const L = T.legs[s], F = L.F;
              lines.push({ d: plane(legPt(F, L.prof, F.split + 0.02, 0.2), legPt(F, L.prof, L.hemTo - 0.03, 0.45), 0.05 * hh), fill: "shade", o: s === "L" ? 0.6 : 0.35 });
            }
          }
          return [{ id: "slacks", z: ctx.Z.bottom, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines, over: det.over, light: { form: 1 } }, ...det.extra];
        }
      });
      module.exports = { patchPocket };
    }
  });

  // src/parts/hands/relaxed.js
  var require_relaxed = __commonJS({
    "src/parts/hands/relaxed.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      function handSpace(ctx, side) {
        const { R, G } = ctx;
        const A = R.arms[side];
        const len = R.limbs.hand;
        const dir = A.handDir;
        let m = [dir[1], -dir[0]];
        const toMid = [R.centerAt(A.wrist[1]) - A.wrist[0], 0];
        if (m[0] * toMid[0] + m[1] * toMid[1] < 0) m = [-m[0], -m[1]];
        const hp = (p) => [A.wrist[0] + dir[0] * p[1] * len + m[0] * p[0] * len, A.wrist[1] + dir[1] * p[1] * len + m[1] * p[0] * len];
        return { hp, hpath: (d) => G.mapPath(d, hp), len, dir, m, A };
      }
      function handKit(ctx, side, opts = {}) {
        var _a;
        const { G } = ctx;
        const H = handSpace(ctx, side);
        const L = H.len, A = H.A;
        const mat = opts.mat || ctx.skin;
        const grow = opts.grow || 0;
        const mp = (p) => {
          const q = H.hp(p);
          return p[2] === true ? [q[0], q[1], true] : q;
        };
        const infl = (pts, d) => {
          const n = pts.length;
          let area = 0;
          for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            area += a[0] * b[1] - b[0] * a[1];
          }
          const sg = area > 0 ? 1 : -1;
          return pts.map((p, i) => {
            const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
            const t = G.norm([b[0] - a[0], b[1] - a[1]]);
            const nr = [t[1] * sg, -t[0] * sg];
            return [p[0] + nr[0] * d, p[1] + nr[1] * d, ...p[2] === true ? [true] : []];
          });
        };
        const sm = (pts, t = 0.5, g = grow) => G.smooth((g ? infl(pts, g) : pts).map(mp), true, t);
        const br = (pts, ws) => G.brush(pts.map(mp), ws.map((v) => v * L));
        const idp = opts.idPrefix || "hand";
        const z0 = (_a = opts.z) != null ? _a : A.z + 0.8;
        const piece = (suffix, pts, extra = {}) => {
          var _a2, _b, _c;
          return {
            id: `${idp}-${side}${suffix ? "-" + suffix : ""}`,
            z: z0 + (extra.dz || 0),
            d: sm(pts, (_a2 = extra.t) != null ? _a2 : 0.5, (_b = extra.grow) != null ? _b : grow),
            mat,
            light: { form: (_c = extra.form) != null ? _c : 0.9 },
            ...extra.shade ? { shade: extra.shade } : {},
            ...extra.deep ? { deep: extra.deep } : {},
            ...extra.lit ? { lit: extra.lit } : {},
            lines: extra.lines || []
          };
        };
        const line = (pts, ws, fill = "deep", o = 0.6) => ({ d: br(pts, ws), fill, o });
        const blob = (cx, cy, rx, ry, rot = 0) => G.ellipse(...mp([cx, cy]), rx * L, ry * L, rot);
        const lod = (l) => ctx.lodAtLeast(l);
        return { H, L, A, mat, sm, br, mp, piece, line, blob, lod, side, k: R_k(ctx, side), grow };
      }
      var R_k = (ctx, side) => ctx.R.sx(side);
      function lobes(fs, nd = 0.05) {
        const s = fs[fs.length - 1].x >= fs[0].x ? 1 : -1, out = [];
        fs.forEach((f, i) => {
          var _a, _b;
          if (i) {
            const p = fs[i - 1];
            out.push([(p.x + f.x) / 2, Math.min(p.y, f.y) - ((_a = f.nd) != null ? _a : nd), true]);
          }
          const h = f.w / 2, sh = (_b = f.sh) != null ? _b : f.w * 0.5;
          out.push([f.x - s * h * 0.96, f.y - sh], [f.x - s * h * 0.6, f.y - sh * 0.25], [f.x, f.y], [f.x + s * h * 0.6, f.y - sh * 0.25], [f.x + s * h * 0.96, f.y - sh]);
        });
        return out;
      }
      function groove(c, x, y, len, w = 0.016, fill = "deep", o = 0.55, dx = 0) {
        return c.line([[x, y], [x + dx * 0.5, y - len * 0.5], [x + dx, y - len]], [w, w * 0.7, 2e-3], fill, o);
      }
      register({
        kind: "hands",
        name: "relaxed",
        describe: "Relaxed hanging hand seen from the thumb side: grouped fingers lightly curled, thumb hanging in front.",
        example: { pose: { arms: { R: "down", L: "down" } } },
        handSpace,
        handKit,
        draw(ctx, opts) {
          const c = handKit(ctx, opts.side || "R", opts);
          const F = [{ x: -0.104, w: 0.047, y: 0.86 }, { x: -0.056, w: 0.052, y: 0.95 }, { x: -2e-3, w: 0.054, y: 0.99 }, { x: 0.05, w: 0.052, y: 0.93 }];
          const main = [[-0.12, -0.02], [-0.134, 0.14], [-0.141, 0.32], [-0.14, 0.52], [-0.132, 0.7], ...lobes(F, 0.05), [0.08, 0.74], [0.098, 0.56], [0.108, 0.4], [0.112, 0.2], [0.108, 0]];
          const thumb = [[0.086, 0.07], [0.132, 0.13], [0.162, 0.23], [0.178, 0.34], [0.178, 0.43], [0.162, 0.485], [0.137, 0.478], [0.12, 0.42], [0.102, 0.3], [0.094, 0.18]];
          const pcs = [];
          const lines = [], shade = [];
          shade.push({ d: c.sm([[-0.01, 0.46], [0.07, 0.5], [0.075, 0.8], [0.04, 0.97], [0, 1.03], [-0.04, 0.8]], 0.4, 0), o: 0.9 });
          if (c.lod("mid")) {
            lines.push(groove(c, -0.029, 0.88, 0.2, 0.017, "deep", 0.6), groove(c, 0.024, 0.93, 0.22, 0.019, "deep", 0.6));
            if (c.lod("hi")) lines.push(groove(c, -0.08, 0.82, 0.12, 0.012, "deep", 0.5));
          }
          if (c.lod("hi")) {
            for (const [x, y] of [[-0.1, 0.47], [-0.05, 0.5], [0, 0.51], [0.05, 0.49]]) lines.push({ d: c.blob(x, y, 0.026, 0.014), fill: "light", o: 0.45 });
          }
          pcs.push(c.piece("", main, { lines, shade }));
          pcs.push(c.piece("thumb", thumb, { dz: 0.04, form: 0.8, lines: c.lod("mid") ? [c.line([[0.1, 0.12], [0.158, 0.28], [0.168, 0.44]], [2e-3, 0.02, 2e-3], "shade", 0.85)] : [] }));
          return pcs;
        }
      });
      register({
        kind: "hands",
        name: "pocket",
        describe: "Hand inside the trouser pocket (bottoms draw the pocket lip and cut the forearm). thumb: true hooks the thumb outside.",
        params: { thumb: "true = thumb hooked over the pocket edge" },
        example: { pose: { arms: { R: "pocket", L: "pocket" } } },
        draw(ctx, opts) {
          const side = opts.side || "R";
          const pt = ctx.S.pose && ctx.S.pose.thumb;
          const want = opts.thumb || pt === true || pt === side || pt && typeof pt === "object" && pt[side];
          if (!want) return [];
          const { R, G, hh } = ctx;
          const A = R.arms[side];
          const k = R.sx(side);
          const top = R.y.waist + 0.05 * hh;
          const pa = [R.centerAt(top) + k * R.widthAt(top) * 0.55, top + 0.07 * hh], pb = [k * R.w.hip * 0.98 + R.pelvisShift, R.y.hip + 0.12 * hh];
          const v = G.norm(G.sub(pb, pa));
          let n = [v[1], -v[0]];
          if (n[1] > 0) n = [-n[0], -n[1]];
          const at = (t, lift) => G.add(G.add(pa, G.mul(G.sub(pb, pa), t)), G.mul(n, lift * hh));
          const mat = opts.mat || ctx.skin;
          const pts = [at(0.7, 0), at(0.56, 0.05), at(0.38, 0.075), at(0.2, 0.07)];
          const lines = ctx.lodAtLeast("hi") ? [{ d: G.brush([at(0.3, 0.075), at(0.2, 0.07)], [3e-3 * hh, 0.02 * hh, 4e-3 * hh]), fill: "light", o: 0.6 }] : [];
          return [{ id: `pocketthumb-${side}`, z: A.z + 0.95, d: G.brush(pts, [0.07 * hh, 0.058 * hh, 0.05 * hh, 0.036 * hh]), mat, light: { form: 0.8 }, lines }];
        }
      });
      register({
        kind: "hands",
        name: "hidden",
        describe: "Hands out of sight behind the back (nothing drawn).",
        example: { pose: { arms: { R: "behind", L: "behind" } } },
        draw: () => []
      });
      module.exports = { handSpace, handKit, lobes, groove };
    }
  });

  // src/parts/hands/anchors.js
  var require_anchors = __commonJS({
    "src/parts/hands/anchors.js"(exports, module) {
      "use strict";
      var { handSpace } = require_relaxed();
      var HAND_FOR_POSE = { down: "relaxed", pocket: "pocket", hip: "hip", cross: "tucked", smoke: "cigarette", hold: "hold", behind: "hidden", carry: "grip", raise: "peace", lapel: "lapel" };
      var TABLE = {
        cigarette: { p: [-5e-3, 0.86], d: [0.03, 1], kind: "pinch", r: 0.03 },
        grip: { p: [0, 0.43], d: [0, 1], kind: "fist", r: 0.1 },
        fist: { p: [0, 0.43], d: [0, 1], kind: "fist", r: 0.1 },
        hold: { p: [-0.02, 0.6], d: [0, 1], kind: "palm", r: 0.2, up: [-1, 0] },
        peace: { p: [0, 0.5], d: [0, 1], kind: "none", r: 0 },
        hip: { p: [0, 0.5], d: [0, 1], kind: "none", r: 0 },
        lapel: { p: [0, 0.62], d: [0, 1], kind: "pinch", r: 0.05 },
        tucked: { p: [0, 0.3], d: [0, 1], kind: "none", r: 0 },
        relaxed: { p: [0, 0.45], d: [0, 1], kind: "none", r: 0 }
      };
      function handAnchor(ctx, side) {
        const { R, G } = ctx;
        const A = R.arms[side];
        const named = ctx.S.pose && ctx.S.pose.hands && ctx.S.pose.hands[side];
        const hand = named || HAND_FOR_POSE[A.pose] || "relaxed";
        const t = TABLE[hand] || { p: [0, 0.45], d: [0, 1], kind: "none", r: 0 };
        const H = handSpace(ctx, side);
        const pt = H.hp(t.p);
        const dv = G.norm([H.dir[0] * t.d[1] + H.m[0] * t.d[0], H.dir[1] * t.d[1] + H.m[1] * t.d[0]]);
        const up = t.up ? G.norm([H.dir[0] * t.up[1] + H.m[0] * t.up[0], H.dir[1] * t.up[1] + H.m[1] * t.up[0]]) : [-H.dir[1], H.dir[0]];
        return { pt, dir: dv, up, grip: { kind: t.kind, r: t.r * H.len }, hand, side, zUnder: A.z + 0.7, zOver: A.z + 0.9 };
      }
      module.exports = { handAnchor, HAND_FOR_POSE };
    }
  });

  // src/parts/props/_kit.js
  var require_kit = __commonJS({
    "src/parts/props/_kit.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var ANCH = null;
      try {
        ANCH = require_anchors();
      } catch (e) {
        ANCH = null;
      }
      var U = 25;
      var inch = (n) => n * U;
      var f = G.f;
      var add = G.add;
      var sub = G.sub;
      var mul = G.mul;
      var norm = G.norm;
      var perp = G.perp;
      function frame(origin, angle = 0, scale = 1, flip = 1, flipY = 1) {
        const c = Math.cos(angle), s = Math.sin(angle);
        const P = (p) => {
          const x = p[0] * flip * scale, y = p[1] * flipY * scale;
          const r = [origin[0] + x * c - y * s, origin[1] + x * s + y * c];
          if (p[2] === true) r.push(true);
          return r;
        };
        return { P, D: (d) => G.mapPath(d, P), origin, angle, scale, flip };
      }
      function rrect(x0, y0, x1, y1, r = 0) {
        if (r <= 0) return G.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
        r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
        return `M${f(x0 + r)} ${f(y0)} L${f(x1 - r)} ${f(y0)} Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + r)} L${f(x1)} ${f(y1 - r)} Q${f(x1)} ${f(y1)} ${f(x1 - r)} ${f(y1)} L${f(x0 + r)} ${f(y1)} Q${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)} L${f(x0)} ${f(y0 + r)} Q${f(x0)} ${f(y0)} ${f(x0 + r)} ${f(y0)} Z`;
      }
      function bar(a, b, w, w2) {
        const d = norm(sub(b, a)), n = perp(d), h = w / 2, h2 = (w2 != null ? w2 : w) / 2;
        return G.poly([add(a, mul(n, h)), add(b, mul(n, h2)), sub(b, mul(n, h2)), sub(a, mul(n, h))]);
      }
      function ribbon(pts, w, o = {}) {
        var _a;
        const dense = G.resample(pts, o.n || Math.max(10, pts.length * 8), (_a = o.tension) != null ? _a : 0.5);
        const W = typeof w === "function" ? w : Array.isArray(w) ? (t) => {
          const m = w.length - 1, s = t * m, i = Math.min(m - 1, Math.floor(s));
          return G.lerp(w[i], w[i + 1], s - i);
        } : () => w;
        const L = [], Rr = [];
        for (let i = 0; i < dense.length; i++) {
          const t = i / (dense.length - 1);
          const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
          const n = perp(norm(sub(b, a))), h = W(t) / 2;
          L.push(add(dense[i], mul(n, h)));
          Rr.push(sub(dense[i], mul(n, h)));
        }
        return G.poly([...L, ...Rr.reverse()]);
      }
      var along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      var off = (p, a, b, v) => add(p, mul(perp(norm(sub(b, a))), v));
      function handInfo(ctx, side) {
        const { R } = ctx;
        const A = R.arms[side];
        let a = null;
        if (ANCH && ANCH.handAnchor) {
          try {
            a = ANCH.handAnchor(ctx, side);
          } catch (e) {
            a = null;
          }
        }
        const dir = a && a.dir ? norm(a.dir) : A.handDir;
        const pt = a && a.pt ? a.pt : A.hand;
        let up = a && a.up ? a.up : perp(dir);
        return {
          side,
          A,
          pt,
          dir,
          up,
          k: R.sx(side),
          pose: A.pose,
          grip: a ? a.grip : { kind: "none", r: 0 },
          hand: a ? a.hand : "relaxed",
          zUnder: a ? a.zUnder : A.z + 0.7,
          zOver: a ? a.zOver : A.z + 0.9
        };
      }
      function pickArm(ctx, o, prefs, label) {
        const sides = o.side ? [o.side] : ["R", "L"];
        for (const pose of prefs) for (const s of sides) if (ctx.R.arms[s].pose === pose) return handInfo(ctx, s);
        ctx.warn(`${label}: needs an arm in pose ${prefs.map((p) => '"' + p + '"').join(" or ")}${o.side ? " on side " + o.side : ""}; set pose.arms.${o.side || "R"} accordingly`);
        return null;
      }
      function gripFist(ctx, hi, id) {
        if (!hi || hi.hand !== "relaxed") return [];
        let H;
        try {
          H = require_relaxed().handSpace(ctx, hi.side);
        } catch (e) {
          return [];
        }
        ctx.cut(`^hand-${hi.side}(-|$)`, G.poly([[-0.5, -0.06], [0.5, -0.06], [0.5, 1.3], [-0.5, 1.3]].map(H.hp)));
        return ctx.part("hands", "grip", { side: hi.side }).map((pc) => ({ ...pc, id: String(pc.id).replace(/^hand-/, `${id}-fist-`) }));
      }
      function bodyAnchor(ctx, name) {
        const { R } = ctx, hh = R.hh;
        const [part, sd] = String(name).split("-");
        const k = sd === "R" ? -1 : sd === "L" ? 1 : 0;
        let pt;
        switch (part) {
          case "shoulder":
            pt = R.torsoPt(k * R.w.shoulder * 0.55, R.y.shoulder + 0.03 * hh);
            break;
          case "chest":
            pt = R.torsoPt(k * R.w.chest * 0.5, R.y.chest - 0.22 * hh);
            break;
          case "hip":
            pt = R.torsoPt(k * R.w.hip * 0.95, R.y.hip + 0.06 * hh);
            break;
          case "waist":
            pt = R.torsoPt(k * R.w.waist * 0.8, R.y.waist);
            break;
          case "neck":
            pt = [R.centerAt(R.y.neckBase), R.y.neckBase];
            break;
          case "back":
            pt = [R.centerAt(R.y.chest), R.y.chest];
            break;
          case "knee":
            pt = R.legs[sd || "R"].knee;
            break;
          case "boot":
          case "ankle":
            pt = R.legs[sd || "R"].ankle;
            break;
          default:
            pt = R.torsoPt(k * R.w.chest * 0.5, R.y.chest);
        }
        return { pt, k, name };
      }
      function dotTrail(ctx, pts, o = {}) {
        var _a, _b, _c;
        const dense = G.resample(pts, o.n || 60, 0.5);
        const r0 = (_a = o.r0) != null ? _a : 3, r1 = (_b = o.r1) != null ? _b : 1.5, spread = (_c = o.spread) != null ? _c : 4, keep = o.keep || ((t) => 1 - t * 0.6);
        let d = "";
        for (let i = 0; i < dense.length; i++) {
          const t = i / (dense.length - 1);
          if (ctx.rng() > keep(t)) continue;
          const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
          const n = perp(norm(sub(b, a))), s = (ctx.rng() - 0.5) * 2 * spread * (o.grow ? 0.3 + t : 1);
          const c = add(dense[i], mul(n, s));
          d += G.circle(c[0], c[1], G.lerp(r0, r1, t) * (0.7 + ctx.rng() * 0.6));
        }
        return d;
      }
      var mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      module.exports = { U, inch, f, frame, rrect, bar, ribbon, along, off, handInfo, pickArm, gripFist, bodyAnchor, dotTrail, mid, add, sub, mul, norm, perp };
    }
  });

  // src/parts/companions/cat.js
  var require_cat = __commonJS({
    "src/parts/companions/cat.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      register({
        kind: "companion",
        name: "cat",
        describe: "Black cat sprawled across the shoulder (default shoulder-L): loaf body, round head with two pricked ears and glowing orange eyes, paws dangling over the chest, tail hanging down the back. Only this lying pose exists; a bad `at` warns and uses shoulder-L.",
        params: { at: "shoulder-L (default) | shoulder-R", side: "L|R (same as `at`)", color: "fur token (cloth-black)" },
        example: { companion: { type: "cat", at: "shoulder-L" } },
        draw(ctx, o) {
          const { G, Z, hh } = ctx;
          if (o.pose != null && o.pose !== "lie") ctx.warn(`cat: only the lying pose exists (pose ${JSON.stringify(o.pose)} ignored)`);
          let at = o.at || "shoulder-" + (o.side || "L");
          if (!/^shoulder-[LR]$/.test(at)) {
            ctx.warn(`cat: unknown spot ${JSON.stringify(at)}; use shoulder-L or shoulder-R (using shoulder-L)`);
            at = "shoulder-L";
          }
          const a = K.bodyAnchor(ctx, at), k = a.k || 1;
          const F = K.frame([a.pt[0] + k * K.inch(0.9), a.pt[1] - K.inch(0.3)], -k * 0.06, K.U, k);
          const P = (pts) => pts.map(F.P);
          const fur = ctx.mat(o.color || "cloth-black", "cloth");
          const z = Z.arm + 4;
          const out = [];
          out.push({ id: "cat-tail", z: z - 0.2, d: K.ribbon(P([[8.4, -1.6], [10.6, 0.4], [10.9, 3.6], [9.9, 6.4], [10.4, 8]]), [K.inch(1.1), K.inch(0.85), K.inch(0.6)]), mat: fur, light: { form: 0.9 } });
          out.push({
            id: "cat-body",
            z,
            d: G.smooth(P([[-1.4, -1.4], [-0.6, -4.4], [2.6, -5.8], [6.4, -5.2], [9.2, -3.2], [9.6, -0.6], [8.2, 0.7], [3, 1.1], [-0.6, 0.6]]), true, 0.5),
            mat: fur,
            light: { form: 1 },
            shade: [{ d: G.smooth(P([[3, 1.4], [9.8, 0.6], [9.4, -3.2], [6.4, -1.6]]), true, 0.4), o: 0.5 }]
          });
          out.push({ id: "cat-haunch", z: z + 0.05, d: G.ellipse(...F.P([7.3, -2]), K.inch(2.5), K.inch(2.4)), mat: fur, light: { form: 0.9 } });
          out.push({ id: "cat-paws", z: z + 0.1, d: [[-1.7, 1.9], [0.2, 2.3]].map(([x, y]) => G.ellipse(...F.P([x, y]), K.inch(0.62), K.inch(1.15), -k * 0.1)).join(""), mat: fur, light: { form: 0.6 } });
          const hc = [-0.9, -3.9];
          out.push({ id: "cat-ears", z: z + 0.15, d: G.poly(P([[hc[0] - 2.1, hc[1] - 0.8], [hc[0] - 1.9, hc[1] - 4], [hc[0] - 0.4, hc[1] - 1.9]])) + G.poly(P([[hc[0] + 0.5, hc[1] - 1.9], [hc[0] + 1.9, hc[1] - 4], [hc[0] + 2.2, hc[1] - 0.8]])), mat: fur, light: { form: 0.6 } });
          out.push({ id: "cat-head", z: z + 0.2, d: G.smooth(P([[hc[0] - 2.5, hc[1] + 0.2], [hc[0] - 2.2, hc[1] - 1.4], [hc[0], hc[1] - 2], [hc[0] + 2.2, hc[1] - 1.4], [hc[0] + 2.6, hc[1] + 0.2], [hc[0] + 1.6, hc[1] + 1.8], [hc[0], hc[1] + 2.1], [hc[0] - 1.6, hc[1] + 1.8]]), true, 0.5), mat: fur, light: { form: 0.9 } });
          const eyes = [-1, 1].map((s) => G.ellipse(...F.P([hc[0] + s * 1, hc[1] - 0.15]), K.inch(0.4), K.inch(0.2), s * 0.25 * -k)).join("");
          out.push({ id: "cat-eyes", z: z + 0.3, d: eyes, fill: "signal-500", light: false, spot: true });
          if (ctx.lodAtLeast("mid")) {
            out.push({ id: "cat-pupils", z: z + 0.31, d: [-1, 1].map((s) => G.ellipse(...F.P([hc[0] + s * 1, hc[1] - 0.15]), K.inch(0.07), K.inch(0.17))).join(""), fill: "ink-900", light: false });
            out.push({ id: "cat-nose", z: z + 0.3, d: G.poly(P([[hc[0] - 0.25, hc[1] + 0.75], [hc[0] + 0.25, hc[1] + 0.75], [hc[0], hc[1] + 1.05]])), fill: "cloth-salmon", light: false, o: 0.8 });
          }
          if (ctx.lodAtLeast("hi")) out.push({ id: "cat-whiskers", z: z + 0.3, d: [-1, 1].map((s) => [0, 0.35].map((dy) => K.ribbon(P([[hc[0] + s * 0.9, hc[1] + 0.95 + dy], [hc[0] + s * 3, hc[1] + 0.8 + dy * 2]]), K.inch(0.03))).join("")).join(""), fill: "ink-300", light: false, o: 0.7 });
          return out;
        }
      });
    }
  });

  // src/parts/companions/dog.js
  var require_dog = __commonJS({
    "src/parts/companions/dog.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      var BREEDS = {
        hound: { size: 26, base: "cloth-tan", dark: "cloth-tobacco", ear: "cloth-brown", light: "cloth-camel", earStyle: "long", snout: 1, tail: "sabre", body: 1 },
        terrier: { size: 15.5, base: "cloth-cream", dark: "cloth-tan", ear: "cloth-tan", light: "cloth-white", earStyle: "fold", snout: 0.68, tail: "up", body: 0.92 },
        mutt: { size: 21, base: "cloth-ash", dark: "cloth-graphite", ear: "cloth-graphite", light: "cloth-stone", earStyle: "fold", snout: 0.82, tail: "sabre", body: 0.95 },
        shepherd: { size: 25, base: "cloth-tan", dark: "cloth-charcoal", ear: "cloth-charcoal", light: "cloth-camel", earStyle: "prick", snout: 0.95, tail: "bush", body: 1 }
      };
      var tubeFn = (ws) => (t) => {
        const m = ws.length - 1, s = Math.min(m - 1e-9, t * m), i = Math.floor(s);
        return ws[i] + (ws[i + 1] - ws[i]) * (s - i);
      };
      function pose(name, br) {
        var _a;
        if (name === "sit") return {
          body: [[0.8, -8], [3, -13.5], [7.5, -19.5], [12.5, -23.6], [17.5, -25.6], [22, -27.4], [25.6, -26.3], [26, -21.8], [24.6, -17], [22.8, -12.2], [20.4, -9.4], [16, -6.8], [11, -4.4], [6, -1.6], [1.4, -1.2], [-0.2, -4.4]],
          legs: { near: [[18.6, -16], [18.8, -8], [19, -3.5], [19.6, -1.2]], far: [[21.8, -15], [22, -8], [22.2, -3.5], [22.8, -1.2]] },
          hind: null,
          haunch: { c: [8.6, -5.8], rx: 6.6, ry: 5.7, rot: -0.25 },
          hindPaw: [13.4, -0.9],
          hock: [1.8, -2.6],
          headAt: [-13.4, 0.4],
          headRot: -0.16,
          tail: [[0.5, -2.6], [-1.8, -2], [-4.2, -1.3], [-6.2, -0.8]],
          collar: [[22.4, -27.6], [23.7, -23.2], [24.8, -19.4]],
          neck0: [24, -25],
          sad: [[3, -13], [8, -19], [13, -22.6], [17.5, -24.2], [21.5, -26], [21, -20.5], [16, -16.5], [10.5, -11], [5.5, -7.5]],
          belly: [[15, -7.2], [20, -9.8], [22.6, -13.5], [21.4, -8.4], [15, -4.8]],
          chest: [[22, -24.4], [25.6, -23.6], [25.6, -18.6], [23.2, -17.6]]
        };
        return {
          body: [[0.5, -23.8], [5, -26], [12, -26.6], [20, -26.4], [27, -27.4], [33, -29], [37.5, -28.6], [39, -24.5], [37.6, -19], [34.2, -14.6], [30, -12.4], [23, -13.8], [16, -16.2], [10, -17], [4, -18], [-0.3, -20.8]],
          legs: { near: [[29.5, -19], [29.2, -10], [29.4, -4.5], [30, -1]], far: [[33, -18.5], [32.8, -10], [33, -4.5], [33.6, -1]] },
          hind: { near: [[8.8, -14.4], [3.6, -8.4], [5.4, -1.5]], far: [[12.6, -14], [7.6, -8.4], [9.4, -1.5]], thigh: [6.2, -18.2] },
          headAt: [0, 0],
          headRot: (_a = br.look) != null ? _a : 0.1,
          tail: br.tail === "up" ? [[0.6, -23], [-0.6, -27], [-0.4, -31], [0.8, -34]] : br.tail === "bush" ? [[0.4, -22.6], [-3, -19], [-5.4, -13.5], [-6.2, -8]] : [[0.6, -23], [-1.5, -27], [-2.6, -32], [-1.8, -36.5]],
          collar: [[34.5, -29.2], [34.9, -24], [35.2, -18.8]],
          neck0: [30, -26],
          sad: [[1, -22.6], [5, -25.2], [12, -25.8], [20, -25.6], [27, -26.6], [32, -28], [31.4, -22.6], [26, -19.4], [18, -18.8], [10, -19.6], [4, -18.4]],
          belly: [[10, -15.4], [22, -13.6], [29, -12.8], [27, -17.2], [15, -17]],
          chest: [[31, -25.5], [37.8, -25], [37.4, -20.2], [33, -16.5], [30, -17.5]]
        };
      }
      register({
        kind: "companion",
        name: "dog",
        aliases: ["hound"],
        describe: "Buck, Alfie's hound: Denee-style side-on dog at true scale at heel outside the leg on `side`; long ears, droopy flews, red collar. Breeds hound (default), terrier, mutt, shepherd; pose stand or sit; facing out (head away from the figure, default) or in (nose at the figure's leg). Bad values warn and fall back to the default.",
        params: { breed: "hound|terrier|mutt|shepherd (default hound; unknown warns)", side: "R|L (default R)", pose: "stand|sit (default stand)", color: "coat token (overrides the breed's base colour)", facing: "out|in (default out)" },
        example: { companion: { type: "dog", breed: "hound", side: "R", pose: "stand" } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const pick = (v, ok, def, what) => {
            if (v == null) return def;
            const m = ok.find((x) => x.toLowerCase() === String(v).toLowerCase());
            if (m) return m;
            ctx.warn(`dog: unknown ${what} ${JSON.stringify(v)}; use ${ok.join("|")} (using ${def})`);
            return def;
          };
          const breed = pick(o.breed, Object.keys(BREEDS), "hound", "breed");
          const br = { ...BREEDS[breed] };
          const side = pick(o.side, ["R", "L"], "R", "side"), k = side === "R" ? -1 : 1;
          const sit = pick(o.pose, ["stand", "sit"], "stand", "pose") === "sit";
          const Pz = pose(sit ? "sit" : "stand", br);
          const sc = br.size / 26;
          const L = R.legs[side];
          const edge = Math.max(Math.abs(L.hip[0]) + L.widths.thigh * 0.9, Math.abs(L.knee[0]) + L.widths.knee, Math.abs(L.ankle[0]) + L.widths.ankle * 1.3);
          const face = pick(o.facing, ["out", "in"], "out", "facing") === "in" ? -1 : 1;
          const gap = sit ? K.inch(0.7) : K.inch(2.4 + (br.tail === "sabre" ? 2 : 0.8) * sc);
          const nose = (43.5 + 8 * br.snout + (sit ? -13.4 : 0)) * K.U * sc, gapIn = K.inch(1.4) * sc;
          const F = K.frame([k * (edge + (face < 0 ? gapIn + nose : gap)), 0], 0, K.U * sc, k * face);
          const P = (pts) => pts.map((p) => F.P(p));
          const bodyM = ctx.mat(o.color || br.base, "cloth"), darkM = ctx.mat(br.dark, "cloth"), earM = ctx.mat(br.ear, "cloth"), lightM = ctx.mat(br.light, "cloth");
          const blk = ctx.mat("cloth-black", "satin");
          const z0 = 8;
          const out = [];
          const sm = (pts, t = 0.5) => G.smooth(P(pts), true, t);
          const tube = (pts, ws, cap = "round") => G.tube(P(pts), tubeFn(ws.map((w) => w * K.U * sc)), { capEnd: cap, samples: 22 });
          const mid = ctx.lodAtLeast("mid");
          out.push({ id: "dog-shadow", z: -0.9, d: G.ellipse(...F.P([sit ? 13 : 20, 0]), K.inch(sit ? 13 : 29) * sc, K.inch(1.6) * sc), fill: ctx.scheme.shadow || "ink-900", light: false, opacity: 0.22 });
          const tailW = br.tail === "bush" ? [2.6, 3.4, 2, 0.6] : br.tail === "up" ? [1.6, 1.2, 0.8] : [2.2, 1.5, 0.45];
          out.push({ id: "dog-tail", z: z0 + 0.15, d: tube(Pz.tail, tailW, "round"), mat: bodyM, light: { form: 0.9 } });
          out.push({ id: "dog-leg-far-f", z: z0 + 0.1, d: tube(Pz.legs.far, sit ? [2.9, 2, 1.6, 1.6] : [2.4, 1.6, 1.35, 1.35], "flat"), mat: bodyM, fill: "shade", light: { form: 0.6 } });
          out.push({ id: "dog-paw-far-f", z: z0 + 0.11, d: G.ellipse(...F.P([Pz.legs.far[3][0] + 0.7, -0.8]), K.inch(1.75) * sc, K.inch(0.85) * sc), mat: bodyM, fill: "shade", light: false });
          if (Pz.hind) {
            out.push({ id: "dog-leg-far-h", z: z0 + 0.1, d: tube(Pz.hind.far, [2.6, 1.6, 1.25], "flat"), mat: bodyM, fill: "shade", light: { form: 0.6 } });
            out.push({ id: "dog-paw-far-h", z: z0 + 0.11, d: G.ellipse(...F.P([Pz.hind.far[2][0] + 1.1, -0.8]), K.inch(1.75) * sc, K.inch(0.85) * sc), mat: bodyM, fill: "shade", light: false });
          }
          const sad = Pz.sad;
          out.push({
            id: "dog-body",
            z: z0 + 0.3,
            d: sm(Pz.body),
            mat: bodyM,
            light: { form: 1 },
            shade: [{ d: sm(Pz.belly, 0.5), o: 0.55 }],
            lit: [{ d: sm(Pz.chest, 0.5), fill: "light", o: 0.5 }]
          });
          out.push({ id: "dog-saddle", z: z0 + 0.32, d: sm(sad), mat: darkM, clip: "dog-body", light: { form: 0.6 } });
          if (sit) {
            out.push({ id: "dog-haunch", z: z0 + 0.4, d: G.ellipse(...F.P(Pz.haunch.c), K.inch(Pz.haunch.rx) * sc, K.inch(Pz.haunch.ry) * sc, Pz.haunch.rot * k * face), mat: bodyM, light: { form: 1 }, shade: [{ d: G.ellipse(...F.P([Pz.haunch.c[0] + 1.6, Pz.haunch.c[1] + 2.2]), K.inch(4.6) * sc, K.inch(2.6) * sc), o: 0.5 }] });
            out.push({ id: "dog-hindpaw", z: z0 + 0.42, d: G.ellipse(...F.P(Pz.hindPaw), K.inch(3.6) * sc, K.inch(1.05) * sc), mat: lightM, light: { form: 0.6 } });
            out.push({ id: "dog-hock", z: z0 + 0.41, d: G.ellipse(...F.P(Pz.hock), K.inch(1.6) * sc, K.inch(2) * sc), mat: bodyM, light: false });
          } else {
            out.push({ id: "dog-leg-near-h", z: z0 + 0.4, d: tube(Pz.hind.near, [2.9, 1.7, 1.3], "flat"), mat: bodyM, light: { form: 1 } });
            out.push({ id: "dog-thigh", z: z0 + 0.41, d: G.ellipse(...F.P(Pz.hind.thigh), K.inch(4.9) * sc, K.inch(8.4) * sc, 0.3 * k * face), mat: bodyM, light: { form: 1 }, shade: [{ d: G.ellipse(...F.P([Pz.hind.thigh[0] + 2.4, Pz.hind.thigh[1] + 2.6]), K.inch(4.2) * sc, K.inch(5.6) * sc, 0.32 * k * face), o: 0.45 }] });
            out.push({ id: "dog-paw-near-h", z: z0 + 0.41, d: G.ellipse(...F.P([Pz.hind.near[2][0] + 1.2, -0.8]), K.inch(1.9) * sc, K.inch(0.9) * sc), mat: lightM, light: false });
          }
          out.push({ id: "dog-leg-near-f", z: z0 + 0.2, d: tube(Pz.legs.near, sit ? [3.2, 2.2, 1.7, 1.65] : [2.7, 1.8, 1.45, 1.4], "flat"), mat: bodyM, light: { form: 1 } });
          out.push({ id: "dog-paw-near-f", z: z0 + 0.51, d: G.ellipse(...F.P([Pz.legs.near[3][0] + 0.8, -0.8]), K.inch(1.95) * sc, K.inch(0.9) * sc), mat: lightM, light: false });
          const occ = [37.4, -29];
          const HP = (p) => {
            const sx = p[0] > 43.5 ? 43.5 + (p[0] - 43.5) * br.snout : p[0];
            const dx = sx - occ[0], dy = p[1] - occ[1], a = Pz.headRot, c = Math.cos(a), s = Math.sin(a);
            return [occ[0] + dx * c - dy * s + Pz.headAt[0], occ[1] + dx * s + dy * c + Pz.headAt[1]];
          };
          const Hp = (pts) => pts.map((p) => F.P(HP(p)));
          const hsm = (pts, t = 0.5) => G.smooth(Hp(pts), true, t);
          const headZ = z0 + 0.6;
          const head = [[37, -29.8], [40.6, -31.2], [43.6, -29.8], [46.6, -28.2], [49.6, -27.6], [51.1, -26.7], [51.5, -25.3], [50.7, -23.9], [48.6, -22.3], [45.2, -22.2], [42, -22.8], [38.8, -24], [36.8, -26]];
          const mask = [[43.6, -29.6], [46.6, -28.2], [49.6, -27.6], [51.1, -26.7], [51.2, -25.8], [47, -25.8], [44.4, -26.4]];
          out.push({
            id: "dog-head",
            z: headZ,
            d: hsm(head),
            mat: bodyM,
            light: { form: 0.9 },
            shade: [{ d: hsm([[40, -24], [46, -23.2], [50.4, -24.4], [48.6, -22.2], [43, -22]], 0.5), o: 0.6 }]
          });
          out.push({ id: "dog-muzzle", z: headZ + 0.02, d: hsm(mask), mat: darkM, clip: "dog-head", light: { form: 0.4 } });
          out.push({ id: "dog-collar", z: headZ - 0.05, d: K.ribbon(P(Pz.collar), K.inch(1.45) * sc), mat: ctx.mat("cloth-oxblood", "leather"), light: { form: 0.8 }, clip: "dog-body", spot: true });
          out.push({ id: "dog-tag", z: headZ - 0.04, d: G.circle(...F.P([Pz.collar[2][0] + 0.3, Pz.collar[2][1] + 0.4]), K.inch(0.7) * sc), mat: ctx.mat("metal-brass", "metal"), light: { form: 0.5 } });
          const earPts = br.earStyle === "prick" ? [[38.4, -30.2], [39.6, -36.6], [42.3, -30.4], [40.4, -28.4]] : br.earStyle === "fold" ? [[38.2, -30.4], [41.8, -31.4], [43, -27.2], [40.4, -26], [38.4, -27.6]] : [[38.2, -30.2], [41.6, -28.8], [42.3, -24], [41.4, -19], [39.4, -16.2], [37.2, -17.2], [36, -21.5], [36.2, -26.6]];
          out.push({
            id: "dog-ear",
            z: headZ + 0.1,
            d: hsm(earPts, 0.5),
            mat: earM,
            light: { form: 0.9 },
            shade: br.earStyle === "long" ? [{ d: hsm([[39.2, -26], [41.4, -22], [40.6, -17.6], [38, -17.4], [38.4, -23]], 0.5), o: 0.55 }] : [],
            lines: br.earStyle === "long" && mid ? [{ d: G.brush(Hp([[38.4, -29], [38.6, -23], [38.2, -18]]), [K.inch(0.05) * sc, K.inch(0.3) * sc, K.inch(0.05) * sc]), fill: "light", o: 0.35 }] : []
          });
          const eyeP = F.P(HP([43.6, -27.5]));
          out.push({ id: "dog-eye-lid", z: headZ + 0.2, d: G.ellipse(eyeP[0], eyeP[1] + K.inch(0.2) * sc, K.inch(0.78) * sc, K.inch(0.42) * sc, 0.12), fill: "alarm-700", light: false, o: 0.85 });
          out.push({ id: "dog-eye", z: headZ + 0.21, d: G.ellipse(eyeP[0], eyeP[1], K.inch(0.6) * sc, K.inch(0.36) * sc, 0.1), fill: "cloth-black", light: false });
          if (ctx.lodAtLeast("hi")) out.push({ id: "dog-eye-glint", z: headZ + 0.22, d: G.circle(eyeP[0] - K.inch(0.12) * sc * face * k * -1, eyeP[1] - K.inch(0.1) * sc, K.inch(0.1) * sc), fill: "paper-000", light: false });
          const noseP = F.P(HP([50.8, -26.2]));
          out.push({ id: "dog-nose", z: headZ + 0.2, d: G.ellipse(noseP[0], noseP[1], K.inch(1.2) * sc, K.inch(1) * sc, -0.2 * k), mat: blk, light: { form: 0.7 } });
          out.push({ id: "dog-mouth", z: headZ + 0.2, d: G.brush(Hp([[50.2, -24.9], [48, -24.5], [45.6, -24.3], [44, -23.5]]), [K.inch(0.05) * sc, K.inch(0.3) * sc, K.inch(0.25) * sc, K.inch(0.05) * sc]), fill: "cloth-black", light: false, o: 0.9 });
          if (mid) {
            out.push({ id: "dog-brow", z: headZ + 0.2, d: G.brush(Hp([[42.2, -29.4], [44, -29.6], [45.6, -29]]), [K.inch(0.04) * sc, K.inch(0.3) * sc, K.inch(0.04) * sc]), fill: "cloth-black", light: false, o: 0.5 });
            if (!sit) out.push({ id: "dog-neck-fold", z: z0 + 0.45, d: G.brush(P([[31, -22.6], [33.4, -21.2], [35.6, -21.4]]), [K.inch(0.04) * sc, K.inch(0.3) * sc, K.inch(0.04) * sc]), fill: "cloth-black", light: false, o: 0.35 });
          }
          return out;
        }
      });
      module.exports = { BREEDS };
    }
  });

  // src/parts/dresses/_dress.js
  var require_dress = __commonJS({
    "src/parts/dresses/_dress.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { hemYOf, plane } = require_lower();
      var SILHOUETTES = ["trapeze", "aline", "column"];
      var UNDER_FLARE = 0.1;
      function dressBody(ctx, o = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const { R, hh } = ctx, y = R.y, w = R.w;
        const cap = ctx.underCaps ? ctx.underCaps() : null;
        const e = Math.min((_a = o.ease) != null ? _a : 0.03, cap ? cap.ease : 9) * hh;
        const t = ctx.body.torso({ ease: (_b = o.ease) != null ? _b : 0.03, neckline: o.neckline || "scoop", depth: o.depth, hem: y.hip + 0.1 * hh });
        const hemY = hemYOf(ctx, o);
        const sil = SILHOUETTES.includes(o.silhouette) ? o.silhouette : null;
        const minWaist = ctx.S.outfit && ctx.S.outfit.base && ctx.S.outfit.base.type ? w.waist + 0.024 * hh : -Infinity;
        const hipW = w.hip + e;
        let chestX = w.chest + e, waistX, hipX = hipW, hemW, below, armpitIn = 0;
        if (sil === "trapeze") {
          armpitIn = !o.sleeves || o.sleeves === "none" ? 0.07 * hh : 0;
          const apY = y.chest - 0.24 * hh, apW = w.chest * 0.98 + e - armpitIn;
          const clear = (hipW + 0.015 * hh - apW) / Math.max(1, y.hip - apY);
          const slope = Math.max(clear, o.flare != null ? o.flare * hh / Math.max(1, hemY - apY) : Math.tan(((_c = o.angle) != null ? _c : 10) * Math.PI / 180));
          const line = (Y) => apW + slope * (Y - apY);
          chestX = line(y.chest);
          waistX = Math.max(minWaist, line(y.waist));
          hipX = line(y.hip);
          hemW = line(hemY);
          below = (Y) => Math.max(hipW, line(Y));
        } else if (sil === "aline" || sil === "column") {
          const col = sil === "column";
          waistX = Math.max(minWaist, (col ? G.lerp(w.waist, w.hip, 0.3) : w.waist) + e - (o.pinch || 0) * hh);
          hemW = hipW + ((_d = o.flare) != null ? _d : col ? 0.05 : 0.34) * hh;
          below = (Y) => hipW + (hemW - hipW) * Math.pow(Math.min(1, (Y - y.hip) / Math.max(1, hemY - y.hip)), col ? 3 : 1);
        } else {
          waistX = Math.max(minWaist, (o.fit === "fitted" ? w.waist + e : o.fit === "tent" ? w.hip + e : G.lerp(w.waist, w.hip, 0.6) + e) - (o.pinch || 0) * hh);
          hemW = hipW + ((_e = o.flare) != null ? _e : 0.14) * hh;
          const pw = (_f = o.pow) != null ? _f : 1;
          below = (Y) => hipW + (hemW - hipW) * Math.pow(Math.min(1, (Y - y.hip) / Math.max(1, hemY - y.hip)), pw);
        }
        if (sil && cap) {
          chestX = Math.min(chestX, w.chest + e);
          waistX = Math.max(minWaist, Math.min(waistX, w.waist + ((cap.waist || 0) - (o.pinch || 0)) * hh));
          hipX = hipW;
          if (ctx.under && ctx.under.torso === "outer") hemW = Math.min(hemW, hipW + UNDER_FLARE * hh);
          const hem0 = hemW, designed = below;
          below = (Y) => Math.min(designed(Y), hipW + (hem0 - hipW) * Math.min(1, Math.max(0, (Y - y.hip) / Math.max(1, hemY - y.hip))));
        }
        const sleeveless = !o.sleeves || o.sleeves === "none";
        const P = (k, x, Y) => Y <= y.hip + 0.02 * hh ? R.torsoPt(k * x, Y) : [R.pelvisShift + k * x, Y];
        const side = (s) => {
          const k = R.sx(s), p = t.pts[s];
          const pts = [p.neck, p.trap, p.shTop];
          if (sleeveless) {
            const ap = armpitIn ? R.torsoPt(k * (w.chest * 0.98 + e - armpitIn), y.chest - 0.24 * hh) : p.armpit;
            pts.push([G.lerp(p.shTop[0], ap[0], 0.5) - k * 0.035 * hh, G.lerp(p.shTop[1], ap[1], 0.55)], [...ap, true]);
          } else pts.push(p.shPt, p.armpit);
          pts.push(sil === "trapeze" ? P(k, chestX, y.chest) : p.chest, P(k, waistX, y.waist), P(k, hipX, y.hip));
          for (const f of [0.35, 0.7]) {
            const Y = y.hip + (hemY - y.hip) * f;
            pts.push(P(k, below(Y), Y));
          }
          pts.push([...P(k, hemW, hemY), true]);
          return pts;
        };
        const sR = side("R"), sL = side("L");
        const hemMid = [R.pelvisShift, hemY + ((_g = o.sag) != null ? _g : 0.012) * hh];
        const d = G.smooth([...sR, hemMid, ...sL.slice().reverse(), t.neckMid], true, 0.42);
        const ctl = [[y.shoulder, w.shoulder * 0.9], [y.chest, chestX], [y.waist, waistX], [y.hip, hipX]];
        for (const f of [0.35, 0.7]) {
          const Y = y.hip + (hemY - y.hip) * f;
          ctl.push([Y, below(Y)]);
        }
        ctl.push([hemY, hemW]);
        const wAt = (Y) => {
          if (Y <= ctl[0][0]) return ctl[0][1];
          for (let i = 0; i < ctl.length - 1; i++) {
            if (Y <= ctl[i + 1][0]) return G.lerp(ctl[i][1], ctl[i + 1][1], (Y - ctl[i][0]) / (ctl[i + 1][0] - ctl[i][0]));
          }
          return hemW;
        };
        return { d, t, hemY, hemW, hipW: hipX, wAt, sR, sL, hemMid, sleeveless, topY: y.shoulder, silhouette: sil };
      }
      function dressDetail(ctx, D, o = {}) {
        const { R, hh } = ctx, y = R.y;
        const lines = [], c = R.pelvisShift;
        const t = D.t;
        if (ctx.lodAtLeast("mid")) {
          const nm = t.neckMid;
          lines.push({ d: G.brush([t.pts.R.neck, [R.centerAt(y.neckBase), nm[1] + 0.01 * hh], t.pts.L.neck], 0.028 * hh), fill: "shade", o: 0.55 });
          lines.push({ d: G.brush([t.pts.R.neck, [R.centerAt(y.neckBase), nm[1] + 0.03 * hh], t.pts.L.neck], 0.01 * hh), fill: "light", o: 0.3 });
          if (D.sleeveless) for (const [i, k] of [[0, -1], [1, 1]]) {
            const S = D[i ? "sL" : "sR"], a = S[2], m = S[3], b = S[4];
            lines.push({ d: G.brush([a, m, b], 0.014 * hh), fill: k > 0 ? "shade" : "light", o: k > 0 ? 0.6 : 0.35 });
          }
          const len = D.hemY - y.hip;
          for (const k of [-1, 1]) {
            const wb = R.w.chest;
            lines.push({ d: plane([c + k * wb * 0.5, y.chest + 0.28 * hh], [c + k * D.hemW * 0.72, D.hemY - 0.01 * hh], (0.05 + Math.min(0.03, len / (30 * hh))) * hh, k * 0.01 * hh), fill: "shade", o: k > 0 ? 0.75 : 0.35 });
            lines.push({ d: plane([c + k * D.hipW * 0.9, y.hip - 0.12 * hh], [c + k * D.hemW * 0.97, D.hemY - 0.02 * hh], 0.03 * hh), fill: "shade", o: k > 0 ? 0.7 : 0.3 });
          }
          lines.push({ d: plane([c - D.hipW * 0.45, y.hip - 0.1 * hh], [c - D.hemW * 0.55, D.hemY - 0.02 * hh], 0.05 * hh), fill: "light", o: 0.2 });
          const h = D.hemY;
          lines.push({ d: G.brush([[c - D.hemW, h - 0.03 * hh], [c, h - 0.03 * hh + 0.012 * hh], [c + D.hemW, h - 0.03 * hh]], 0.01 * hh), fill: "deep", o: 0.32 });
          lines.push({ d: G.brush([[c - D.hemW, h - 0.045 * hh], [c, h - 0.033 * hh], [c + D.hemW, h - 0.045 * hh]], 6e-3 * hh), fill: "light", o: 0.3 });
        }
        return lines;
      }
      function sleeves(ctx, mat, o = {}) {
        var _a, _b, _c;
        const { R, hh } = ctx, out = [];
        for (const s of ["R", "L"]) {
          const A = R.arms[s], to = (_a = o.to) != null ? _a : 1;
          const lb = ctx.body.limb("arm", s, { ease: (_b = o.ease) != null ? _b : 0.04, to, capStart: "round" });
          lb.pieces.forEach((pc) => {
            const fore = pc.seg === "lower", lines = [];
            if (ctx.lodAtLeast("mid") && to > 0.6) {
              const e = lb.at(lb.split), up = lb.at(lb.split - 0.08), dn = lb.at(lb.split + 0.06);
              const n = G.perp(G.norm(G.sub(dn, up))), hw = lb.hw(lb.split);
              lines.push({ d: G.brush([G.add(e, G.mul(n, -hw * 0.9)), G.add(G.lerp(e, dn, 0.5), G.mul(n, -hw * 0.1))], [4e-3 * hh, 0.022 * hh, 2e-3 * hh]), fill: "deep", o: 0.7 });
              lines.push({ d: G.brush([G.add(up, G.mul(n, hw * 0.8)), G.add(G.lerp(up, e, 0.6), G.mul(n, hw * 0.05))], [3e-3 * hh, 0.016 * hh, 2e-3 * hh]), fill: "shade", o: 0.8 });
            }
            out.push({ id: `${o.prefix || "dress"}-sleeve-${s}-${pc.seg}`, z: A.z + 0.2 + (fore ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat, lines, pattern: o.pattern, spot: o.spot, light: { form: 1 } });
          });
          if (o.cuff !== false && ctx.lodAtLeast("mid")) {
            const p = lb.at(to), q = lb.at(Math.max(0, to - 0.02)), n = G.perp(G.norm(G.sub(p, q))), hw = lb.hw(to) + ((_c = o.ease) != null ? _c : 0.04) * hh;
            out.push({ id: `${o.prefix || "dress"}-cuff-${s}`, z: A.z + 0.28, over: [{ d: G.brush([G.add(p, G.mul(n, -hw * 0.95)), G.add(p, G.mul(n, hw * 0.95))], 0.02 * hh), fill: mat.shade, o: 0.9 }] });
          }
        }
        return out;
      }
      function blockShape(ctx, D, kind) {
        const { R, hh } = ctx, y = R.y, c = R.pelvisShift;
        const top = y.shoulder - 0.2 * hh, hem = D.hemY + 0.1 * hh, H = D.hemY - y.shoulder;
        const hwB = R.w.hip * 1 + 0.1 * hh;
        if (kind === "stripe") {
          const pts = [], pts2 = [];
          for (let i = 0; i <= 8; i++) {
            const Y = top + (hem - top) * i / 8, w = D.wAt(Y);
            pts.push([c - w * 0.62, Y]);
            pts2.push([c - w * 0.2, Y]);
          }
          return G.smooth([...pts, ...pts2.reverse()], true, 0.3);
        }
        if (kind === "panel") {
          return G.poly([[c - 3 * hwB, top], [c + D.wAt(y.shoulder + 0.1 * hh) * 0.12, top], [c - D.wAt(D.hemY) * 0.3, hem], [c - 3 * hwB, hem]]);
        }
        const Wt = 2 * (R.w.chest + 0.03 * hh);
        const Ro = Math.min(Wt / 3 / 0.83, 0.34 * H);
        const left = c - 0.62 * hwB;
        const cc = [left + Ro, y.chest + 0.5 * (D.hemY - y.chest) - 0.04 * H];
        const a0 = Math.PI * (1 - 0.44), a1 = Math.PI * (1 + 0.44);
        const E = [cc[0] + Ro * Math.cos(a0), cc[1] + Ro * Math.sin(a0)];
        const dx = 0.85 * Ro, c2 = [cc[0] + dx, cc[1]], R2 = Math.hypot(E[0] - c2[0], E[1] - c2[1]);
        const b0 = Math.atan2(E[1] - c2[1], E[0] - c2[0]), b1 = 2 * Math.PI - b0;
        const outer = [], inner = [];
        for (let i = 0; i <= 14; i++) {
          const f = i / 14, a = a0 + (a1 - a0) * f, b = b0 + (b1 - b0) * f;
          outer.push([cc[0] + Ro * Math.cos(a), cc[1] + Ro * Math.sin(a) * 1.25]);
          inner.push([c2[0] + R2 * Math.cos(b), cc[1] + R2 * Math.sin(b) * 1.25]);
        }
        return G.smooth([...outer, ...inner.reverse()], true, 0.4);
      }
      function collarBand(ctx, D, mat, id, extra = {}) {
        const { R, G: G2, hh } = ctx, t = D.t;
        const nR = t.pts.R.neck, nL = t.pts.L.neck, nm = t.neckMid;
        const top = R.y.neckBase - 0.1 * hh, wN = R.w.neck * 1.08;
        const cx = (Y) => R.centerAt(Y);
        const pts = [[...nR, true], [cx(nm[1]), nm[1] + 0.015 * hh], [...nL, true], [cx(top) + wN, top + 0.01 * hh, true], [cx(top), top + 0.02 * hh], [cx(top) - wN, top + 0.01 * hh, true]];
        const d = G2.smooth(pts, true, 0.3);
        const lines = ctx.lodAtLeast("mid") ? [
          { d: G2.brush([nR, [cx(nm[1]), nm[1] + 5e-3 * hh], nL], 0.012 * hh), fill: "deep", o: 0.6 },
          { d: G2.brush([[cx(top) - wN * 0.9, top + 0.025 * hh], [cx(top), top + 0.03 * hh], [cx(top) + wN * 0.9, top + 0.025 * hh]], 8e-3 * hh), fill: "light", o: 0.4 }
        ] : [];
        return [{ id: `${id}-collar`, z: ctx.Z.top + 1.05, d, mat, pattern: extra.pattern, spot: extra.spot, lines, light: { form: 0.9 } }];
      }
      module.exports = { dressBody, dressDetail, sleeves, blockShape, collarBand, SILHOUETTES };
    }
  });

  // src/parts/dresses/boiler-suit.js
  var require_boiler_suit = __commonJS({
    "src/parts/dresses/boiler-suit.js"() {
      "use strict";
      var { register } = require_registry();
      var { lowerBody, plane } = require_lower();
      var { trouserDetail } = require_trousers();
      var { patchPocket } = require_trousers_more();
      var { sleeves } = require_dress();
      register({
        kind: "dress",
        name: "boiler-suit",
        describe: "Long-sleeved boiler suit: collar, zip placket, flap chest pockets, waist belt, thigh pockets. The Paranormalist.",
        params: { color: "fabric token (default cloth-sky)", pattern: "textile name" },
        example: { outfit: { dress: { type: "boiler-suit", color: "cloth-sky" } } },
        draw(ctx, o) {
          const { R, G, hh } = ctx, y = R.y;
          const mat = ctx.mat(o.color || "cloth-sky", o.kind || "cloth");
          const z = ctx.Z.top + 1;
          const t = ctx.body.torso({ ease: 0.075, neckline: "high", hem: y.waist + 0.1 * hh });
          const c = R.centerAt(y.chest);
          const lines = [], over = [];
          if (ctx.lodAtLeast("mid")) {
            for (const s of ["R", "L"]) {
              const k = R.sx(s), ap = t.pts[s].armpit;
              lines.push({ d: plane([ap[0] - k * 0.02 * hh, ap[1] + 0.05 * hh], [ap[0] - k * 0.3 * hh, ap[1] + 0.34 * hh], 0.026 * hh), fill: "shade", o: 0.8 });
            }
            const nm = t.neckMid, nR = t.pts.R.neck, nL = t.pts.L.neck;
            for (const [n, k] of [[nR, -1], [nL, 1]]) {
              lines.push({ d: G.poly([[n[0] - k * 0.01 * hh, n[1] - 0.02 * hh], [n[0] + k * 0.16 * hh, n[1] + 0.2 * hh], [c + k * 0.015 * hh, nm[1] + 0.34 * hh], [c, nm[1] + 0.02 * hh]]), fill: "light", o: 0.4 });
              lines.push({ d: G.brush([[n[0], n[1]], [n[0] + k * 0.16 * hh, n[1] + 0.2 * hh], [c + k * 0.015 * hh, nm[1] + 0.34 * hh]], 0.01 * hh), fill: "deep", o: 0.7 });
            }
            lines.push({ d: G.brush([[c, nm[1] + 0.3 * hh], [c, y.waist + 0.05 * hh]], 0.022 * hh), fill: "shade", o: 0.55 });
            lines.push({ d: G.brush([[c + 0.012 * hh, nm[1] + 0.3 * hh], [c + 0.012 * hh, y.waist + 0.05 * hh]], 5e-3 * hh), fill: "light", o: 0.6 });
            for (const k of [-1, 1]) {
              const x0 = c + k * 0.07 * hh, x1 = c + k * R.w.chest * 0.82, py = y.chest + 0.02 * hh, ph = 0.34 * hh;
              const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
              lines.push({ d: G.poly([[xa, py], [xb, py], [xb, py + ph], [xa, py + ph]]), fill: "light", o: 0.14 });
              lines.push({ d: G.poly([[xa, py - 0.02 * hh], [xb, py - 0.02 * hh], [xb, py + 0.12 * hh], [(xa + xb) / 2, py + 0.16 * hh], [xa, py + 0.12 * hh]]), fill: "light", o: 0.24 });
              lines.push({ d: G.brush([[xa, py + 0.12 * hh], [(xa + xb) / 2, py + 0.16 * hh], [xb, py + 0.12 * hh]], [4e-3 * hh, 0.014 * hh, 4e-3 * hh]), fill: "deep", o: 0.75 });
              over.push({ d: G.circle((xa + xb) / 2, py + 0.12 * hh, 9e-3 * hh), fill: "deep" });
            }
          }
          const out = [{ id: "boiler-suit", z, d: t.d, mat, pattern: o.pattern, spot: o.spot, lines, over, light: { form: 1 } }];
          const T = lowerBody(ctx, { ease: 0.06, waistEase: 0.06, cut: "tapered", rise: "high", hem: "ankle" });
          const det = trouserDetail(ctx, T, mat, { band: false, fly: false, pockets: "none", crease: false, loops: false, cuff: true, cut: "tapered" });
          const ll = [...det.lines];
          if (ctx.lodAtLeast("mid")) for (const s of ["R", "L"]) ll.push(...patchPocket(ctx, T.legs[s], { u0: 0.2, u1: 0.38, v0: 0.05, v1: 0.8, button: "deep" }).lines);
          out.push({ id: "boiler-suit-legs", z: z - 0.5, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines: ll, over: det.over, light: { form: 1 } }, ...det.extra);
          const nw = R.widthAt(y.waist) + 0.09 * hh, yy = y.waist + 0.02 * hh, bh = 0.09 * hh;
          const bl = R.torsoPt(-nw, yy), br = R.torsoPt(nw, yy);
          out.push({
            id: "boiler-suit-belt",
            z: z + 0.1,
            d: G.poly([[bl[0], bl[1] - bh / 2], [br[0], br[1] - bh / 2], [br[0], br[1] + bh / 2], [bl[0], bl[1] + bh / 2]]),
            mat,
            lines: ctx.lodAtLeast("mid") ? [{ d: G.brush([[bl[0], bl[1] + bh * 0.36], [br[0], br[1] + bh * 0.36]], 0.01 * hh), fill: "deep", o: 0.5 }] : [],
            over: [{ d: G.poly([[R.pelvisShift - 0.07 * hh, yy - bh * 0.6], [R.pelvisShift + 0.07 * hh, yy - bh * 0.6], [R.pelvisShift + 0.07 * hh, yy + bh * 0.6], [R.pelvisShift - 0.07 * hh, yy + bh * 0.6]]), fill: "metal-steel" }, { d: G.poly([[R.pelvisShift - 0.04 * hh, yy - bh * 0.3], [R.pelvisShift + 0.04 * hh, yy - bh * 0.3], [R.pelvisShift + 0.04 * hh, yy + bh * 0.3], [R.pelvisShift - 0.04 * hh, yy + bh * 0.3]]), fill: "deep" }],
            light: { form: 1 }
          });
          out.push(...sleeves(ctx, mat, { to: 1, prefix: "boiler", pattern: o.pattern, spot: o.spot, ease: 0.045 }));
          return out;
        }
      });
    }
  });

  // src/parts/dresses/dresses.js
  var require_dresses = __commonJS({
    "src/parts/dresses/dresses.js"() {
      "use strict";
      var { register } = require_registry();
      var { dressBody, dressDetail, sleeves, blockShape, collarBand, SILHOUETTES } = require_dress();
      var { pocketHands } = require_trousers();
      var BLOCK_SHAPES = ["arc", "stripe", "panel"];
      function dress(ctx, o, d) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const mat = ctx.mat(o.color || d.color, o.kind || d.kind || "wool");
        const sl = (_a = o.sleeves) != null ? _a : d.sleeves;
        const nl = o.neckline || d.neckline;
        const depth = (_b = o.depth) != null ? _b : o.neckline && o.neckline !== d.neckline ? void 0 : d.depth;
        let sil = (_c = o.silhouette) != null ? _c : o.fit ? null : d.silhouette;
        if (sil != null && !SILHOUETTES.includes(sil)) {
          ctx.warn(`${d.id}: silhouette "${sil}" is not ${SILHOUETTES.join("|")}; used ${d.silhouette}`);
          sil = d.silhouette;
        }
        const D = dressBody(ctx, { ease: d.ease, silhouette: sil, fit: o.fit || d.fit, hem: o.hem || d.hem, flare: (_d = o.flare) != null ? _d : d.flare, angle: (_e = o.angle) != null ? _e : d.angle, neckline: nl, depth, sleeves: sl, pow: d.pow, pinch: (_f = o.pinch) != null ? _f : d.pinch, sag: d.sag });
        const lines = dressDetail(ctx, D, o);
        const id = d.id;
        const z = ctx.Z.top + 1;
        if (d.seam && ctx.lodAtLeast("mid")) {
          const { R, hh } = ctx, Y = R.y.waist + 0.01 * hh, c = R.pelvisShift, w = D.wAt(Y);
          lines.push({ d: ctx.G.brush([[c - w, Y + 4e-3 * hh], [c, Y + 0.012 * hh], [c + w, Y + 4e-3 * hh]], 0.011 * hh), fill: "deep", o: 0.45 });
          lines.push({ d: ctx.G.brush([[c - w, Y - 8e-3 * hh], [c, Y], [c + w, Y - 8e-3 * hh]], 6e-3 * hh), fill: "light", o: 0.3 });
        }
        const out = [{ id, z, d: D.d, mat, pattern: o.pattern, spot: o.spot, lines, light: { form: 1 } }];
        if (nl === "high") out.push(...collarBand(ctx, D, mat, id, { pattern: o.pattern, spot: o.spot }));
        const blk = o.block === void 0 ? d.block : o.block;
        if (blk) {
          let b = blk === true ? {} : typeof blk === "string" ? { color: blk } : blk;
          if (typeof b !== "object" || Array.isArray(b)) {
            ctx.warn(`dress block "${String(blk)}" must be a colour token or { color, shape }; used the default block`);
            b = {};
          }
          let shape = b.shape || "arc";
          if (!BLOCK_SHAPES.includes(shape)) {
            ctx.warn(`dress block.shape "${shape}" is not ${BLOCK_SHAPES.join("|")}; used arc`);
            shape = "arc";
          }
          const bm = ctx.mat(b.color || "cloth-magenta", "cloth");
          out.push({ id: `${id}-block`, z: z + 0.05, d: blockShape(ctx, D, shape), clip: id, mat: bm, spot: (_g = b.spot) != null ? _g : true, pattern: b.pattern, light: { form: 0.7 } });
        }
        if (sl && sl !== "none") out.push(...sleeves(ctx, mat, { to: sl === "short" ? 0.32 : sl === "elbow" ? 0.55 : 1, prefix: id, pattern: o.pattern, spot: o.spot }));
        const pocketArm = ["R", "L"].some((sd) => ctx.R.arms[sd].pose === "pocket");
        if (pocketArm && o.pockets === false) ctx.warn(`${id}: pockets:false with a pocket arm pose leaves the hand lying over the dress front; drop pockets:false`);
        if ((_h = o.pockets) != null ? _h : pocketArm) out.push(...pocketHands(ctx, { top: ctx.R.y.waist + 0.05 * ctx.hh }, mat));
        return out;
      }
      var SIL_PARAM = "trapeze|aline|column: the cut (trapeze flares from the armpits in one straight line; aline is fitted to the waist and flares straight from the hip; column drops straight from the hip)";
      register({
        kind: "dress",
        name: "shift-dress",
        describe: "Sleeveless sixties mod shift above the knee, cut as a trapeze: narrow at the shoulders, one straight line from the armpit to a wide hem. block: { color, shape: arc|stripe|panel } adds the colour block (a spot accent that survives colour schemes). The Socialite/Swinger.",
        params: { color: "fabric token", block: "colour token | { color: token, shape: 'arc'|'stripe'|'panel', spot: true } (an unknown shape warns and falls back to arc)", hem: "mini|short|aline|knee", neckline: "scoop|crew|v|boat|high (high adds a stand collar band)", sleeves: "none|short|elbow|long", silhouette: `${SIL_PARAM} (default trapeze; aline gives the belted mod A-line)`, angle: "trapeze side angle from the vertical, degrees (default 10; 5 is a near-straight shift, 16 a tent)", flare: "hem half-width beyond the bust (trapeze) or the hips (aline), head-heights", pattern: "textile name" },
        example: { outfit: { dress: { type: "shift-dress", color: "cloth-chocolate", block: { color: "cloth-magenta", shape: "arc" } } } },
        draw: (ctx, o) => dress(ctx, o, { id: "shift-dress", color: "cloth-chocolate", hem: "short", silhouette: "trapeze", angle: 10, neckline: "crew", depth: 0.12, ease: 0.035 })
      });
      register({
        kind: "dress",
        name: "a-line-dress",
        describe: "A-line dress: a fitted bodice taken in at the waist, then a skirt flaring in straight lines from the hip to the knee; short sleeves optional.",
        params: { color: "fabric token", sleeves: "none|short|elbow|long", neckline: "scoop|crew|v|boat|high", hem: "short|aline|knee|midi", silhouette: `${SIL_PARAM} (default aline)`, flare: "hem half-width beyond the hips, head-heights (default 0.34)", pattern: "textile name", pinch: "0\u20130.05 head-heights: how far the waist is taken in (default 0.03)" },
        example: { outfit: { dress: { type: "a-line-dress", color: "cloth-pink" } } },
        draw: (ctx, o) => dress(ctx, o, { id: "a-line-dress", color: "cloth-pink", hem: "knee", silhouette: "aline", flare: 0.34, neckline: "scoop", depth: 0.25, ease: 0.03, sleeves: "short", pinch: 0.03, seam: true })
      });
      register({
        kind: "dress",
        name: "gown",
        describe: "Floor-length column gown: fitted through the bust, a hint of waist, then straight down from the hip to a hem barely wider; high neck, long sleeves. The medium's gown, the Shadows and Red Window silhouette.",
        params: { color: "fabric token", sleeves: "none|short|elbow|long", neckline: "high (default, with a stand collar band)|crew|v|boat", silhouette: `${SIL_PARAM} (default column)`, flare: "hem half-width beyond the hips, head-heights (default 0.05)" },
        example: { outfit: { dress: { type: "gown", color: "cloth-oxblood" } } },
        draw: (ctx, o) => dress(ctx, o, { id: "gown", color: "cloth-oxblood", kind: "satin", hem: "maxi", silhouette: "column", flare: 0.05, neckline: "high", ease: 0.025, sleeves: "long", sag: 0.02, pinch: 0.02 })
      });
    }
  });

  // src/parts/dresses/overalls.js
  var require_overalls = __commonJS({
    "src/parts/dresses/overalls.js"() {
      "use strict";
      var { register } = require_registry();
      var { lowerBody, plane } = require_lower();
      var { trouserDetail } = require_trousers();
      register({
        kind: "dress",
        name: "overalls",
        describe: "Canvas overalls: bib with chest pocket, straps with brass buckles, loose rolled-cuff legs, grime. Worn over a tee. The Garbage Loader; works with the big leg.",
        params: { color: "fabric token (default cloth-tobacco)", hem: "cuffed|crop|ankle", grime: "false to keep them clean", pattern: "textile name" },
        example: { outfit: { dress: { type: "overalls", color: "cloth-tobacco" } } },
        draw(ctx, o) {
          const { R, G, hh } = ctx, y = R.y, w = R.w;
          const mat = ctx.mat(o.color || "cloth-tobacco", o.kind || "canvas");
          const z = ctx.Z.top + 1;
          const P = (x, Y) => R.torsoPt(x, Y);
          const bibTop = y.chest - 0.2 * hh, topY = y.waist - 0.04 * hh, bibHW = w.chest * 0.5;
          const hemSpec = o.hem || "cuffed";
          const big = ctx.R.legs.R.big ? "R" : ctx.R.legs.L.big ? "L" : null;
          const lo = {
            ease: 0.04,
            waistEase: 0.05,
            // round 3: the big leg's overall leg is unmistakably the bigger one (and the other one hangs close to its leg)
            ...big ? { legK: { [big]: 1, [big === "R" ? "L" : "R"]: 0.9 }, legStraight: { [big]: true } } : {},
            cut: "straight",
            topY,
            crotchDrop: 0.12,
            upper: (T0) => {
              const side = (k, hip) => {
                const w2 = P(k * (R.widthAt(topY) + 0.05 * hh), topY);
                return big && Math.sign(hip[0] - R.pelvisShift) === k && big === "R" === k < 0 ? [G.lerp(w2[0], hip[0], 0.55), w2[1]] : [...w2, true];
              };
              return {
                L: [[...P(-bibHW, bibTop), true], [...P(-bibHW * 1.02, topY), true], side(-1, T0.hipL), T0.hipL],
                R: [T0.hipR, side(1, T0.hipR), [...P(bibHW * 1.02, topY), true], [...P(bibHW, bibTop), true]]
              };
            }
          };
          if (hemSpec === "cuffed") lo.hemY = y.knee + 0.32 * (y.ankle - y.knee);
          else lo.hem = hemSpec;
          const T = lowerBody(ctx, lo);
          const det = trouserDetail(ctx, T, mat, { band: false, fly: false, pockets: "none", crease: false, loops: false, cuff: hemSpec === "cuffed", cut: "straight" });
          const lines = [...det.lines], over = [...det.over];
          const c = R.centerAt(y.chest);
          if (ctx.lodAtLeast("mid")) {
            lines.push({ d: G.brush([P(-bibHW, bibTop + 0.03 * hh), P(0, bibTop + 0.03 * hh), P(bibHW, bibTop + 0.03 * hh)], 0.012 * hh), fill: "deep", o: 0.5 });
            lines.push({ d: G.brush([P(-bibHW * 1.04, topY + 0.01 * hh), P(0, topY + 0.015 * hh), P(bibHW * 1.04, topY + 0.01 * hh)], 0.016 * hh), fill: "deep", o: 0.55 });
            const pw = bibHW * 0.62, py = bibTop + 0.26 * hh, ph = 0.3 * hh;
            lines.push({ d: G.poly([P(-pw, py), P(pw, py), P(pw, py + ph), P(-pw, py + ph)]), fill: "light", o: 0.14 });
            lines.push({ d: G.poly([P(-pw, py - 0.02 * hh), P(pw, py - 0.02 * hh), P(pw, py + 0.08 * hh), P(0, py + 0.12 * hh), P(-pw, py + 0.08 * hh)]), fill: "light", o: 0.22 });
            lines.push({ d: G.brush([P(-pw, py + 0.08 * hh), P(0, py + 0.12 * hh), P(pw, py + 0.08 * hh)], [4e-3 * hh, 0.014 * hh, 4e-3 * hh]), fill: "deep", o: 0.75 });
            lines.push({ d: G.brush([P(pw, py + 0.1 * hh), P(pw, py + ph)], 0.012 * hh), fill: "deep", o: 0.55 });
            over.push({ d: G.circle(...P(0, py + 0.085 * hh), 9e-3 * hh), fill: "metal-brass" });
            for (const k of [-1, 1]) over.push({ d: G.circle(...P(k * (R.widthAt(topY) + 0.01 * hh), topY + 0.07 * hh), 0.011 * hh), fill: "metal-brass" });
            lines.push({ d: plane(P(bibHW * 0.8, bibTop + 0.1 * hh), P(bibHW * 0.9, topY), 0.035 * hh), fill: "shade", o: 0.6 });
            if (o.grime !== false) {
              const rg = ctx.rng();
              for (let i = 0; i < 4; i++) {
                const Y = y.waist + (0.2 + rg * 1.8) * hh, X = c + (ctx.rng() - 0.5) * R.w.hip * 1.4;
                lines.push({ d: G.ellipse(X, Y, (0.05 + ctx.rng() * 0.05) * hh, (0.04 + ctx.rng() * 0.05) * hh, ctx.rng() * 3), fill: "deep", o: 0.2 });
              }
              lines.push({ d: G.ellipse(P(bibHW * 0.3, bibTop + 0.7 * hh)[0], bibTop + 0.7 * hh, 0.06 * hh, 0.05 * hh), fill: "deep", o: 0.18 });
            }
          }
          const out = [{ id: "overalls", z, d: T.d, mat, pattern: o.pattern, spot: o.spot, lines, over, light: { form: 1 } }, ...det.extra];
          const brass = ctx.mat("metal-brass", "metal");
          for (const s of ["R", "L"]) {
            const k = R.sx(s);
            const a = P(k * bibHW * 0.8, bibTop + 0.02 * hh), b = P(k * (w.neckBase + (w.shoulder - w.neckBase) * 0.42), y.shoulder - 0.03 * hh);
            const sw = 0.1 * hh;
            out.push({ id: `overalls-strap-${s}`, z: z + 0.15, d: G.brush([a, G.lerp(a, b, 0.5), b], [sw, sw * 0.95, sw * 0.85]), mat, lines: ctx.lodAtLeast("mid") ? [{ d: G.brush([G.add(a, [k * 0.03 * hh, 0]), G.add(b, [k * 0.03 * hh, 0])], 8e-3 * hh), fill: "deep", o: 0.4 }] : [], light: { form: 1 } });
            const bw = 0.13 * hh, bh = 0.095 * hh, bc = G.add(a, [0, 0.01 * hh]);
            out.push({
              id: `overalls-buckle-${s}`,
              z: z + 0.3,
              d: G.poly([[bc[0] - bw / 2, bc[1] - bh / 2], [bc[0] + bw / 2, bc[1] - bh / 2], [bc[0] + bw / 2, bc[1] + bh / 2], [bc[0] - bw / 2, bc[1] + bh / 2]]),
              mat: brass,
              lines: [{ d: G.poly([[bc[0] - bw * 0.3, bc[1] - bh * 0.28], [bc[0] + bw * 0.3, bc[1] - bh * 0.28], [bc[0] + bw * 0.3, bc[1] + bh * 0.28], [bc[0] - bw * 0.3, bc[1] + bh * 0.28]]), fill: "deep", o: 0.85 }],
              light: { form: 0.8 }
            });
          }
          return out;
        }
      });
    }
  });

  // src/parts/eyes/_hg.js
  var require_hg = __commonJS({
    "src/parts/eyes/_hg.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var K = 1e3;
      var sc = (p) => p.length > 2 ? [p[0] * K, p[1] * K, p[2]] : [p[0] * K, p[1] * K];
      var wf = (w) => typeof w === "function" ? (t) => w(t) * K : Array.isArray(w) ? w.map((x) => x * K) : w * K;
      function hg(ctx) {
        const o = {
          brush: (pts, widths, opt) => G.brush(pts.map(sc), wf(widths), opt),
          smooth: (pts, closed = true, tension = 0.5) => G.smooth(pts.map(sc), closed, tension),
          poly: (pts, closed = true) => G.poly(pts.map(sc), closed),
          ellipse: (cx, cy, rx, ry = rx, rot = 0) => G.ellipse(cx * K, cy * K, rx * K, ry * K, rot),
          /* map a milli-head path to kit units through the head projection (opts: { depth, flat }) */
          hs: (d, opt) => d ? G.mapPath(d, (p) => ctx.hp([p[0] / K, p[1] / K], opt)) : d
        };
        o.brushD = (pts, widths, opt, hopt) => o.hs(o.brush(pts, widths, opt), hopt);
        o.smoothD = (pts, closed, tension, hopt) => o.hs(o.smooth(pts, closed, tension), hopt);
        o.ellipseD = (cx, cy, rx, ry, rot, hopt) => o.hs(o.ellipse(cx, cy, rx, ry, rot), hopt);
        o.polyD = (pts, closed, hopt) => o.hs(o.poly(pts, closed), hopt);
        o.px = (n) => ctx.px(n) / ctx.R.head.k;
        o.atLeast = (v, n) => Math.max(v, o.px(n));
        return o;
      }
      function noise(ctx, i, salt = 0) {
        let h = Math.imul((ctx.S.seed | 0) ^ salt * 2654435761, 2246822519) + Math.imul(i + 1, 3266489917) | 0;
        h ^= h >>> 15;
        h = Math.imul(h, 2246822519);
        h ^= h >>> 13;
        h = Math.imul(h, 3266489917);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
      }
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var lerp = (a, b, t) => a + (b - a) * t;
      var smoothstep = (a, b, x) => {
        const t = clamp((x - a) / (b - a), 0, 1);
        return t * t * (3 - 2 * t);
      };
      function darkSkin(ctx) {
        return clamp((0.36 - ctx.C.lum(ctx.skin.shade)) / 0.13, 0, 1);
      }
      module.exports = { hg, noise, clamp, lerp, smoothstep, darkSkin };
    }
  });

  // src/parts/expressions/_fx.js
  var require_fx = __commonJS({
    "src/parts/expressions/_fx.js"(exports, module) {
      "use strict";
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var num = (v, d = 0) => typeof v === "number" && isFinite(v) ? v : d;
      var KG = { angle: 1, raise: 1, knit: 1, lid: 1, lower: 1, bags: 1.2, curve: 1.5, smirk: 1.6, open: 1, width: 1, cue: 1 };
      function fx(ctx) {
        const E = ctx.expr || {};
        const g = num(E.gain, 1) > 0 ? num(E.gain, 1) : 1;
        const k = (n) => {
          var _a;
          return 1 + (g - 1) * ((_a = KG[n]) != null ? _a : 1);
        };
        const B = E.brow || {}, L = E.lid || {}, M = E.mouth || {}, C = E.cheek || {}, N = E.nose || {};
        const side = (o, key, tag) => o[key + tag] != null ? num(o[key + tag]) : num(o[key]);
        const brow = {
          angle: clamp(num(B.angle) * k("angle"), -1.9, 1.9),
          knit: clamp(num(B.knit) * k("knit"), 0, 1.25),
          raise: clamp(num(B.raise) * k("raise"), -0.05, 0.09),
          raiseR: clamp(num(B.raiseR) * k("raise"), -0.05, 0.07),
          raiseL: clamp(num(B.raiseL) * k("raise"), -0.05, 0.07),
          droop: clamp(num(B.droop) * k("angle"), 0, 1.6)
          // the outer ends sag (tired) without the inner ends lifting (sad)
        };
        brow.ridge = clamp(Math.max(0, -brow.angle) * 0.42 + brow.knit * 0.3 + Math.max(0, -brow.raise) * 6, 0, 1);
        const upperRaw = (tag) => num(L.upper) + num(L["upper" + tag]);
        const lidK = k("lid");
        const lid = {
          // upper-lid closure (+ closes, - wide). The gain widens eyes and closes them further, but a lid never closes past
          // max(0.62, what the preset itself asks for): no gain ever shuts an eye that the expression did not shut.
          upperR: gainLid(upperRaw("R"), lidK),
          upperL: gainLid(upperRaw("L"), lidK),
          lower: clamp(num(L.lower) * k("lower"), 0, 0.8),
          lowerR: clamp((num(L.lower) + num(L.lowerR)) * k("lower"), 0, 0.8),
          lowerL: clamp((num(L.lower) + num(L.lowerL)) * k("lower"), 0, 0.8),
          bags: clamp(num(L.bags) * k("bags"), 0, 1.4),
          crinkle: clamp(num(L.crinkle) * k("cue"), 0, 1.2),
          arc: clamp(num(L.arc) * k("cue"), 0, 1.2)
        };
        lid.upper = (lid.upperR + lid.upperL) / 2;
        const mouth = {
          curve: clamp(num(M.curve) * k("curve"), -2.2, 2.2),
          smirk: clamp(num(M.smirk) * k("smirk"), -2.1, 2.1),
          open: clamp(num(M.open) * k("open"), 0, 1.5),
          width: clamp(1 + (num(M.width, 1) - 1) * k("width"), 0.7, 1.45),
          teeth: clamp(num(M.teeth), 0, 1),
          snarl: clamp(num(M.snarl) * k("cue"), -1.3, 1.3),
          press: clamp(num(M.press) * k("cue"), 0, 1.3),
          dimple: clamp(num(M.dimple) * k("cue"), 0, 1.3),
          slack: clamp(num(M.slack), 0, 1)
          // face v2: a slack mouth drops a hard mouth's set corners (tired)
        };
        const cheek = {};
        for (const tag of ["R", "L"]) {
          cheek["apple" + tag] = clamp(side(C, "apple", tag) * k("cue"), 0, 1.3);
          cheek["wedge" + tag] = clamp(side(C, "wedge", tag) * k("cue"), 0, 1.3);
          cheek["jaw" + tag] = clamp(side(C, "jaw", tag) * k("cue"), 0, 1.3);
        }
        cheek.apple = (cheek.appleR + cheek.appleL) / 2;
        cheek.wedge = (cheek.wedgeR + cheek.wedgeL) / 2;
        cheek.jaw = (cheek.jawR + cheek.jawL) / 2;
        const nose = { wrinkle: clamp(num(N.wrinkle) * k("cue"), 0, 1.3) };
        const gz = Array.isArray(E.gaze) ? E.gaze : [0, 0];
        return { g, k, brow, lid, mouth, cheek, nose, gaze: [num(gz[0]) * Math.min(g, 1.6), num(gz[1]) * Math.min(g, 1.6)] };
      }
      function gainLid(raw, kk) {
        if (raw <= 0) return clamp(raw * kk, -0.7, 0);
        return clamp(raw * kk, 0, Math.min(0.82, raw + 0.2));
      }
      var opens = (e) => e.mouth.open > 0.05;
      function work(ctx) {
        const S = ctx.T.STYLE, hi = S.lod.hi, lo = ((S.exprGain || [])[1] || [76])[0], ph = ctx.R.hh * ctx.scale;
        return clamp((hi - ph) / (hi - lo), 0, 1);
      }
      function lerpE(a, b, t) {
        if (Array.isArray(a) || Array.isArray(b)) {
          const n = Math.max((a || []).length, (b || []).length);
          return Array.from({ length: n }, (_, i) => lerpE((a || [])[i], (b || [])[i], t));
        }
        if (a && typeof a === "object" || b && typeof b === "object") {
          const o = {};
          for (const k of /* @__PURE__ */ new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) o[k] = lerpE((a || {})[k], (b || {})[k], t);
          return o;
        }
        const x = num(a), y = num(b);
        return x + (y - x) * t;
      }
      module.exports = { fx, opens, clamp, num, KG, work, lerpE };
    }
  });

  // src/parts/expressions/_cues.js
  var require_cues = __commonJS({
    "src/parts/expressions/_cues.js"(exports, module) {
      "use strict";
      var REG = require_registry();
      var { hg, clamp, darkSkin } = require_hg();
      var { fx } = require_fx();
      var U = require_util();
      function merged(base, over) {
        const out = { ...base };
        for (const k of Object.keys(over || {})) out[k] = typeof over[k] !== "object" || Array.isArray(over[k]) ? over[k] : { ...base[k] || {}, ...over[k] };
        return out;
      }
      function covered(ctx, kind) {
        const F = ctx.S.face || {}, MK = F.mask && F.mask.type ? REG.get("mask", F.mask.type) : null;
        if (!MK) return false;
        return [].concat((typeof MK.covers === "function" ? MK.covers(F.mask, ctx.S) : MK.covers) || []).includes(kind);
      }
      function lens(cx, cy, rx, ry, rot, pts, s) {
        const c = Math.cos(rot), sn = Math.sin(rot);
        return pts.map(([u, v]) => {
          const x = u * rx, y = v * ry;
          return [cx + s * (x * c - y * sn), cy + x * sn + y * c];
        });
      }
      var LIFT = [[-1, 0.1], [-0.6, -0.6], [0, -0.76], [0.64, -0.58], [1.1, -0.02], [0.62, 0.52], [-0.04, 0.86], [-0.66, 0.64]];
      function cuePieces(ctx, preset) {
        const saved = ctx.expr;
        ctx.expr = merged(saved, preset);
        try {
          return build(ctx);
        } finally {
          ctx.expr = saved;
        }
      }
      function build(ctx) {
        const X = fx(ctx), Ck = X.cheek, N = X.nose;
        const strong = (v) => v > 0.03;
        const lowerFace = !covered(ctx, "mouth"), noseFree = !covered(ctx, "nose");
        const wantApple = lowerFace && (strong(Ck.appleR) || strong(Ck.appleL)), wantWedge = lowerFace && (strong(Ck.wedgeR) || strong(Ck.wedgeL));
        const wantWrinkle = noseFree && strong(N.wrinkle), wantJaw = lowerFace && strong(Ck.jaw);
        if (!wantApple && !wantWedge && !wantWrinkle && !wantJaw) return [];
        const { C, T, skin } = ctx, H = ctx.head, g = hg(ctx), lod = ctx.lod;
        const mb = U.mouthBox(ctx, ctx.S.face || {});
        const wid = H.widthAt || (() => H.w);
        const kLod = lod === "hi" ? 0.55 : lod === "mid" ? 1 : 1.15;
        const over = [];
        const px = (n) => g.px(n), dk = darkSkin(ctx);
        for (const s of [-1, 1]) {
          const tag = s < 0 ? "R" : "L", lit = s < 0;
          const ap = Ck["apple" + tag], wd = Ck["wedge" + tag];
          if (lowerFace && strong(ap)) {
            const e = Math.min(1.25, ap);
            const cx = s * (H.eyeX + 0.056), cy = H.eyeY + 0.12 + 4e-3 * e;
            const room = wid(cy) - Math.abs(cx) - 0.02;
            const rx = Math.min(0.056 + 0.011 * e, room), ry = Math.max(0.026 + 7e-3 * e, px(lod === "lo" ? 4.2 : lod === "mid" ? 3 : 2) / 2);
            const lo = lod === "lo" ? 1 - dk : 0;
            const fill = lit ? C.mix(skin.light, T.PAPER, 0.12 + 0.58 * lo) : C.mix(C.mix(skin.base, skin.shade, 0.2), skin.light, Math.max(0.7 * dk, 0.85 * lo));
            const fillV2 = dk > 0.1 ? C.mix(C.saturate(fill, 1 - 0.4 * dk), ctx.light.keyColor, 0.06 * dk) : fill;
            over.push({ d: g.smoothD(lens(cx, cy, rx, ry, 0.3, LIFT, s), true, 0.5), fill: fillV2, o: clamp(ap * 0.8 * kLod, 0, 0.88) });
          }
          if (lowerFace && strong(wd)) {
            const yc = s < 0 ? mb.yl : mb.yr, mw = mb.mw, nw = H.noseW, w = Math.min(1.2, wd);
            const ax = s * (nw * 0.88 + 0.016), ay = H.noseY - 8e-3;
            const bx = s * (mw + 0.018), by = yc - 0.012;
            const W = Math.max(0.042 * w, px(lod === "lo" ? 3.2 : lod === "mid" ? 3 : 1.6));
            const at = (t, k) => [ax + (bx - ax) * t + s * W * k, ay + (by - ay) * t];
            const pts = [[ax, ay], at(0.3, 0.3), at(0.62, 0.78), at(0.94, 1), [bx + s * W * 0.15, by + 0.014], [bx, by + 4e-3], [ax + (bx - ax) * 0.5, ay + (by - ay) * 0.5]];
            over.push({ d: g.smoothD(pts, true, 0.32), fill: lit ? C.mix(skin.base, skin.shade, 0.7) : C.mix(skin.shade, skin.deep, 0.75), o: clamp(wd * 0.8 * kLod * (lit && lod !== "lo" ? 0.6 : 1), 0, 0.9) });
          }
        }
        if (wantJaw) {
          for (const s of [-1, 1]) {
            const j = Math.min(1.2, s < 0 ? Ck.jawR : Ck.jawL);
            if (!strong(j)) continue;
            const y0 = H.jawY - 0.15, y1 = H.jawY + 0.015, x = s * (wid(H.jawY - 0.07) - 0.07);
            const w = Math.max(0.034 * j, px(lod === "lo" ? 2.6 : lod === "mid" ? 2.6 : 1.6));
            over.push({ d: g.brushD([[x + s * 4e-3, y0], [x + s * 2e-3, (y0 + y1) / 2], [x - s * 0.014, y1]], [2e-3, w, 2e-3]), fill: s < 0 ? C.mix(skin.shade, skin.deep, 0.3) : skin.deep, o: clamp(j * 0.6 * kLod, 0, 0.75) });
          }
        }
        if (wantWrinkle && lod !== "lo") {
          const w = Math.min(1.2, N.wrinkle), ww = Math.max(0.011 * w, px(lod === "mid" ? 1.7 : 1.1)), col = (s) => s < 0 ? C.mix(skin.shade, skin.deep, 0.4) : skin.deep, o = clamp(0.85 * w * kLod, 0, 0.92);
          for (const s of [-1, 1]) {
            over.push({ d: g.brushD([[s * 0.084, H.noseY - 0.125], [s * 0.07, H.noseY - 0.085], [s * 0.056, H.noseY - 0.042]], [2e-3, ww, 2e-3]), fill: col(s), o });
          }
          over.push({ d: g.brushD([[-0.05, H.noseY - 0.138], [0, H.noseY - 0.128], [0.05, H.noseY - 0.138]], [2e-3, ww * 0.9, 2e-3]), fill: skin.deep, o: o * 0.8 });
        }
        return over.length ? [{ id: "expression-cues", z: ctx.Z.face + 0.02, over }] : [];
      }
      module.exports = { cuePieces, merged, covered };
    }
  });

  // src/parts/expressions/basic.js
  var require_basic = __commonJS({
    "src/parts/expressions/basic.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { cuePieces, merged } = require_cues();
      var { work, lerpE } = require_fx();
      var PRESETS = {
        neutral: { d: "Calm, unreadable. The line-up default.", e: {} },
        stern: {
          d: "Hard stare: brows low and flat, lids weighted, lips pressed with the corners pulled down hard and a shade fold each side.",
          sig: "mouth corners dragged down with a shade fold each side, under low flat brows",
          e: { brow: { angle: 0.05, knit: 0.1, raise: -0.03 }, lid: { upper: 0.34, lower: 0.1 }, mouth: { curve: -0.85, width: 0.96, press: 0.4 }, cheek: { wedge: 0.9 } },
          h: { brow: { angle: -0.5, knit: 0.45, raise: -0.016 }, lid: { upper: 0.24 }, mouth: { curve: -0.4, press: 0.12 }, cheek: { wedge: 0.3 } }
        },
        smirk: {
          d: "One brow up, lids lazy, one corner of the mouth up and tucked in with the cheek lifted on that side only. Knows something.",
          sig: "everything on one side: that brow up, that corner up and tucked, that cheek lifted, the other brow down; lids lazy not squeezed",
          e: { brow: { angle: 0, raiseR: -0.028, raiseL: 0.04 }, lid: { upper: 0.3, lower: 0.05 }, mouth: { curve: -0.05, smirk: 1.5, dimple: 1 }, cheek: { appleL: 0.9, wedgeL: 1.1 }, gaze: [0.05, 0] },
          h: { brow: { raiseR: -0.01, raiseL: 0.03 }, lid: { lower: 0.1 }, mouth: { curve: 0.1, smirk: 1.4, dimple: 0.5 }, cheek: { appleL: 0.5, wedgeL: 0.9 }, gaze: [0.03, 0] },
          // face v2 (P2.1's open item: the cast's smirks read faintly): a higher, harder-tucked corner, a fuller lift on that side and the brows further apart
          v2: { e: { brow: { raiseR: -0.034, raiseL: 0.05 }, mouth: { curve: 0, smirk: 1.9, dimple: 1.3 }, cheek: { appleL: 1.15, wedgeL: 1.35 } }, h: { brow: { raiseL: 0.036 }, mouth: { smirk: 1.6, dimple: 0.7 }, cheek: { appleL: 0.65, wedgeL: 1.05 } } }
        },
        tired: {
          d: "Heavy lids with a wide gap of lid skin under the brows, dark bags under the eyes, the outer ends of the brows sagging, gaze dropped, mouth slack. Seen too much.",
          sig: "heavy lids and dark bags under brows that sag at the outer ends (not sad's lifted inner ends)",
          e: { brow: { angle: 0.1, raise: -4e-3, droop: 1.3 }, lid: { upper: 0.72, bags: 1.2 }, mouth: { curve: -0.3, width: 0.95 }, gaze: [0, 0.14] },
          h: { brow: { angle: 0.1, raise: -4e-3, droop: 0.9 }, lid: { upper: 0.5, bags: 0.95 }, mouth: { curve: -0.3 }, gaze: [0, 0.12] },
          // face v2 (the inspector's tired read grim): inner brow ends a touch up and the outer ends sagging more, a slack mouth (slightly
          // parted, corners not set), so it reads weary and not hard
          // (round 2: lifted inner ends read worried on Booker, so the brows stay level and only the outer ends sag; the lids do the work)
          v2: { e: { brow: { angle: 0.04, knit: 0, raise: 0.024, droop: 1.5 }, lid: { upper: 0.72, bags: 1.4 }, mouth: { curve: -0.1, open: 0.05, slack: 0.9 }, gaze: [0, 0.12] }, h: { brow: { angle: 0, raise: -8e-3, droop: 0.9 }, lid: { upper: 0.6, bags: 1 }, mouth: { curve: -0.12, open: 0.04, slack: 0.9 } } }
        },
        wary: {
          d: "Sidelong glance, narrowed eyes, brows tense and uneven, lips tight.",
          sig: "iris in the corner, one brow low, one lifted",
          e: { brow: { angle: -0.2, knit: 0.3, raiseR: 0.022, raiseL: -0.022 }, lid: { upper: 0.25, lower: 0.35 }, gaze: [0.5, 0], mouth: { curve: -0.1, width: 0.88, press: 0.3 } },
          h: { brow: { raiseR: 4e-3, raiseL: -8e-3 }, lid: { lower: 0.2 }, gaze: [0.4, 0], mouth: { width: 0.9, press: 0 } }
        },
        smile: {
          d: "Closed-mouth smile: a wide curve tucked at both corners, a lit cheek lens and a shade fold each side, the lower lids lifted.",
          sig: "two lit cheek lenses and folds round a wide, even curve",
          e: { brow: { angle: 0.15, raise: 0.012 }, lid: { upper: 0.04, lower: 0.45, crinkle: 0.3 }, mouth: { curve: 1, width: 1.2, dimple: 0.6 }, cheek: { apple: 1, wedge: 0.9 } },
          h: { brow: { raise: 8e-3 }, lid: { upper: 0.08, lower: 0.38, crinkle: 0.1 }, mouth: { curve: 0.9, width: 1.15, dimple: 0 }, cheek: { apple: 0.4, wedge: 0.3 } }
        },
        scowl: {
          d: "Angry: brows crushed down and in, eyes slanted and narrowed, the nose wrinkled, mouth turned down hard.",
          sig: "V brows over a dark lid shade, nose wrinkle, deep frown",
          e: { brow: { angle: -1.2, knit: 0.95, raise: -0.02 }, lid: { upper: 0.3, lower: 0.32 }, mouth: { curve: -0.95, width: 0.92 }, nose: { wrinkle: 0.6 }, cheek: { wedge: 0.7 } },
          h: { brow: { knit: 0.9 }, mouth: { curve: -0.9 }, nose: { wrinkle: 0.35 }, cheek: { wedge: 0.3 } }
        },
        surprised: {
          d: "Brows up and arched, eyes wide with white showing, mouth a little open.",
          sig: "high brows, wide eyes, a small round mouth",
          e: { brow: { raise: 0.05, angle: 0.3 }, lid: { upper: -0.55 }, mouth: { curve: 0, open: 0.7, width: 0.8 } },
          h: { brow: { raise: 0.045 }, lid: { upper: -0.5 } }
        },
        sneer: {
          d: "Contempt: the upper lip lifted on one side over a tooth, the nose wrinkled, that brow dropped and the other lifted.",
          sig: "one lifted lip with a tooth, nose wrinkle, one deep fold",
          e: { brow: { angle: -0.4, knit: 0.3, raiseR: -0.014, raiseL: 6e-3 }, lid: { upper: 0.3, lower: 0.15 }, mouth: { curve: -0.25, smirk: -0.5, snarl: -1.2 }, nose: { wrinkle: 1 }, cheek: { wedgeR: 1.2, wedgeL: 0.15 } },
          h: { brow: { raiseL: 4e-3 }, mouth: { curve: -0.2, smirk: -0.7, snarl: -0.5 }, nose: { wrinkle: 0.4 }, cheek: { wedgeR: 0.45, wedgeL: 0.05 } }
        },
        sad: {
          d: "Inner brows pulled up, lids drooping, eyes down, mouth turned down.",
          sig: "inner brows high, mouth a deep downturn",
          e: { brow: { angle: 1.2, knit: 0.25, raise: 4e-3 }, lid: { upper: 0.3 }, gaze: [0, 0.16], mouth: { curve: -0.85, width: 0.95 } }
        },
        cool: {
          d: "Lids half down, brows lifted and easy, mouth relaxed with a trace of a smirk: nonchalant 60s cool.",
          sig: "slit eyes under lifted brows, a faint one-sided tuck",
          e: { brow: { angle: 0, raise: 0.038 }, lid: { upper: 0.5 }, mouth: { curve: -0.05, smirk: 0.4, dimple: 0.7 }, gaze: [0.04, 0.05] },
          h: { brow: { angle: 0.05, raise: 6e-3 }, lid: { upper: 0.45 }, mouth: { smirk: 0.25, dimple: 0 }, gaze: [0.04, 0.04] }
        },
        determined: {
          d: "Eyes wide and fixed, brows set low and slanting in, lips pressed straight, the jaw clenched: about to do something.",
          sig: "clenched jaw and a straight pressed line under slanting brows",
          e: { brow: { angle: -1.05, knit: 0.7, raise: 4e-3 }, lid: { upper: -0.22, lower: 0.18 }, mouth: { curve: 0, width: 0.88, press: 1 }, cheek: { jaw: 1.2 } },
          h: { brow: { angle: -0.4, knit: 0.45, raise: -8e-3 }, lid: { upper: 0.08, lower: 0.16 }, mouth: { curve: -0.15, press: 0.3 }, cheek: { jaw: 0.35 } }
        },
        amused: {
          d: "Eyes squeezed into smiling arcs, one brow cocked, a closed half smile with both cheeks up and one higher: enjoying this.",
          sig: "smiling arcs for eyes under one cocked brow, a closed half smile that is higher on one side",
          e: { brow: { angle: 0.08, raiseR: 0, raiseL: 0.04 }, lid: { upper: 0.55, lower: 0.5, arc: 0.6, crinkle: 1 }, mouth: { curve: 0.7, smirk: 0.5, width: 1.2, dimple: 0.9 }, cheek: { appleR: 0.95, appleL: 1.1, wedgeR: 0.6, wedgeL: 1 }, gaze: [-0.08, 0.02] },
          h: { brow: { angle: 0.1, raiseR: 4e-3, raiseL: 0.03 }, lid: { upper: 0.2, lower: 0.36, arc: 0.2, crinkle: 0.3 }, mouth: { curve: 0.8, smirk: 0.5, width: 1.1, dimple: 0.3 }, cheek: { appleR: 0.3, appleL: 0.5, wedgeR: 0.25, wedgeL: 0.55 }, gaze: [-0.06, 0] },
          // face v2 (the socialite's amused read faintly): a bigger, more lopsided half smile and the cocked brow higher
          v2: { e: { brow: { raiseL: 0.055 }, mouth: { curve: 0.9, smirk: 0.8, dimple: 1.15 }, cheek: { appleL: 1.3, wedgeL: 1.25 } }, h: { brow: { raiseL: 0.038 }, mouth: { curve: 0.9, smirk: 0.65, dimple: 0.5 }, cheek: { appleL: 0.65, wedgeL: 0.7 } } }
        },
        grin: {
          d: "A wide open grin: a band of teeth under the upper lip, cheeks pushed up into lit lenses, the lower lids lifted.",
          sig: "open mouth with a band of teeth, two lit cheek lenses",
          e: { brow: { angle: 0.1, raise: 0.018 }, lid: { upper: 0, lower: 0.3, crinkle: 0.35 }, mouth: { curve: 0.8, width: 1.3, open: 0.45, teeth: 0.9, dimple: 0.5 }, cheek: { apple: 1.1, wedge: 1 } },
          h: { lid: { lower: 0.25, crinkle: 0.15 }, mouth: { curve: 0.7, width: 1.2, open: 0.4, dimple: 0 }, cheek: { apple: 0.4, wedge: 0.3 } }
        },
        laugh: {
          d: "Laughing: a wide open mouth full of teeth, the eyes squeezed nearly shut into arcs by the cheeks, the brows lifted.",
          sig: "eyes shut in arcs under lifted brows, a wide open mouth",
          e: { brow: { angle: 0.35, raise: 0.035 }, lid: { upper: 0.74, lower: 0.55, arc: 1, crinkle: 1 }, mouth: { curve: 0.9, width: 1.36, open: 1.05, teeth: 0.9 }, cheek: { apple: 1.2, wedge: 1.1 } },
          h: { brow: { raise: 0.02 }, lid: { upper: 0.7, arc: 0.7, crinkle: 0.5 }, mouth: { width: 1.25, open: 0.9 }, cheek: { apple: 0.45, wedge: 0.35 } }
        },
        shout: {
          d: "Shouting: the mouth open wide and tall and dark with the top teeth showing, brows down and knit, eyes wide, the nose wrinkled.",
          sig: "a tall dark open mouth under low knit brows",
          e: { brow: { angle: -0.9, knit: 0.85, raise: -0.012 }, lid: { upper: -0.25 }, mouth: { curve: -0.25, width: 1, open: 1.3, teeth: 0.6 }, cheek: { wedge: 0.8, jaw: 0.8 }, nose: { wrinkle: 0.5 } },
          h: { brow: { angle: -0.7, knit: 0.65 }, mouth: { open: 1.1 }, cheek: { wedge: 0.3, jaw: 0.3 }, nose: { wrinkle: 0.3 } }
        }
      };
      function strength(ctx, p) {
        if (p.v2) p = { ...p, e: merged(p.e, p.v2.e || {}), h: p.v2.h || p.h ? merged(p.h || {}, p.v2.h || {}) : void 0 };
        if (!p.h) return p.e;
        const w = work(ctx), hi = merged(p.e, p.h);
        return w <= 0 ? hi : w >= 1 ? p.e : lerpE(hi, p.e, w);
      }
      for (const [name, p] of Object.entries(PRESETS)) {
        register({ kind: "expression", name, describe: p.d, example: { face: { expression: name } }, draw: (ctx) => {
          const e = strength(ctx, p);
          return { expr: e, pieces: cuePieces(ctx, e) };
        } });
      }
      module.exports = { PRESETS };
    }
  });

  // src/parts/eyes/almond.js
  var require_almond = __commonJS({
    "src/parts/eyes/almond.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { hg, clamp, lerp, darkSkin } = require_hg();
      var { fx } = require_fx();
      function eyeShape(ctx, s, o = {}) {
        var _a;
        const H = ctx.head, E = fx(ctx);
        const tag = s < 0 ? "R" : "L";
        const lodK = ctx.lod === "lo" || ctx.lod === "mid" ? 1.1 : 1;
        const size = (o.size || 1) * lodK * 1.06;
        const dv = ctx.lod !== "hi" ? darkSkin(ctx) : 0;
        const w = H.eyeW * size, h = H.eyeH * size * (o.openK || 1) * (1 + 0.14 * dv);
        const cx = s * (H.eyeX + (o.spacing || 0)), cy = H.eyeY + (o.dy || 0);
        const xi = cx - s * w / 2, xo = cx + s * w / 2;
        const lidOff = (o.lids === "heavy" ? 0.3 : o.lids === "hooded" ? 0.4 : 0) + (o.lidAdd || 0);
        const u = clamp((tag === "R" ? E.lid.upperR : E.lid.upperL) + lidOff, -0.6, 0.82);
        const l = clamp((tag === "R" ? E.lid.lowerR : E.lid.lowerL) + (o.squint || 0) + 0.18 * Math.min(1, E.lid.crinkle), 0, 0.8);
        const tilt = (o.tilt || 0) - (E.brow.angle || 0) * 0.9;
        const ty = tilt * 0.02;
        const flat = clamp(o.flat || 0, 0, 1), pk = (_a = o.peak) != null ? _a : 0.4, open = 1 - u;
        const inner = (o.inner || 0) * 0.01;
        const X = (t) => xi + (xo - xi) * t;
        const bump = (t, p) => Math.sin(Math.PI / 2 * clamp(t < p ? t / p : (1 - t) / (1 - p), 0, 1));
        const arc = E.lid.arc * Math.min(1, Math.max(0, u) * 1.6);
        const base = (t) => cy + lerp(5e-3 + inner, -4e-3, t) - ty * Math.pow(t, 1.4) - arc * 0.017 * Math.sin(Math.PI * t);
        const yU = (t) => base(t) - h * 0.66 * open * Math.pow(bump(t, pk), 1 - 0.65 * flat);
        const yL = (t) => base(t) + h * 0.42 * (1 - l) * (1 - 0.5 * clamp(u, 0, 1)) * (o.lowerK || 1) * Math.pow(bump(t, 0.45), 0.8);
        const TU = [0, 0.14, 0.28, pk, 0.64, 0.8, 0.92, 1], TL = [0.86, 0.66, 0.45, 0.26, 0.1];
        const upper = TU.map((t, i) => i === 0 || i === TU.length - 1 ? [X(t), yU(t), true] : [X(t), yU(t)]);
        const lower = TL.map((t) => [X(t), yL(t)]);
        return { white: [...upper, ...lower], upper, lower, xi, xo, cx, cy, w, h, u, l, X, yU, yL, tilt, ty, pk, s, tag, TU };
      }
      function irisColour(ctx, opts) {
        const t = ctx.T.tok(opts.eyeColor);
        if (t) return t;
        const sk = ctx.S.skin;
        if (["porcelain", "fair", "pale", "flushed"].includes(sk)) return ctx.T.tok("cloth-teal");
        if (["olive", "tan"].includes(sk)) return ctx.T.tok("cloth-brown");
        return ctx.T.tok("cloth-chocolate");
      }
      function shapeOpts(cfg = {}, opts = {}) {
        var _a;
        const sh = cfg.shape || {};
        return {
          size: (sh.size || 1) * (opts.size || 1),
          spacing: (sh.spacing || 0) + (opts.spacing || 0),
          dy: (sh.dy || 0) + (opts.dy || 0),
          openK: (sh.openK || 1) * (opts.openK || 1),
          lids: (_a = opts.lids) != null ? _a : sh.lids,
          lidAdd: sh.lidAdd,
          squint: (sh.squint || 0) + (opts.squint || 0),
          tilt: (sh.tilt || 0) + (opts.tilt || 0),
          flat: sh.flat,
          peak: sh.peak,
          lowerK: sh.lowerK,
          inner: sh.inner
        };
      }
      function drawEyes(ctx, opts = {}, cfg = {}) {
        var _a, _b, _c, _d;
        const { skin, C, T } = ctx;
        const E = fx(ctx);
        const g = hg(ctx);
        const ink = T.INK, lod = ctx.lod, out = [];
        const irisC = irisColour(ctx, opts);
        const so = shapeOpts(cfg, opts), dk = darkSkin(ctx);
        for (const s of [-1, 1]) {
          const e = eyeShape(ctx, s, so);
          const shadow = s > 0, tag = e.tag, id = `eye-${tag}`;
          const closing = lod === "hi" ? 0 : clamp(E.lid["upper" + tag], 0, 0.8);
          const lw = g.atLeast(0.019 * (opts.lidWeight || 1) * (cfg.lidW || 1), lod === "lo" ? 2.6 : lod === "mid" ? 1.8 : 1.2) * (1 + 0.4 * closing) * 1.2;
          const fl = ((_a = cfg.flick) != null ? _a : 1) * 0.015;
          const prof = cfg.lidProfile || [0.35, 0.75, 1, 1.1, 1.1, 1, 0.8, 0.55, 0.1];
          const lidPts = [...e.TU.map((t) => [e.X(t), e.yU(t) - lw * 0.3]), [e.xo + s * fl, e.yU(1) - lw * 0.3 - fl * (0.35 + Math.max(0, e.tilt) * 0.25)]];
          const lid = g.brushD(lidPts, prof.map((k) => k * lw));
          const eyeD = g.smoothD(e.white, true, 0.5);
          if (lod !== "lo" && cfg.socket) {
            const k = cfg.socket, h = e.h, cy = e.cy;
            const blob = [[e.xi - s * 0.03, cy - h * 0.2], [e.X(0.25), cy - h * 1.7], [e.X(0.75), cy - h * 1.65], [e.xo + s * 0.045, cy - h * 0.5], [e.xo + s * 0.04, cy + h * 1.1], [e.X(0.5), cy + h * 1.7], [e.xi - s * 0.015, cy + h * 1.2]];
            [[1, 0.1], [0.86, 0.11], [0.73, 0.12], [0.61, 0.13], [0.5, 0.14]].forEach(([sc, o], i) => out.push({ id: `${id}-socket${i}`, z: ctx.Z.face + 0.15 + i * 3e-3, d: g.smoothD(blob.map(([x, y]) => [lerp(e.cx, x, sc), lerp(cy, y, sc)]), true, 0.6), fill: skin.deep, opacity: Math.min(1, o * k * (shadow ? 1.35 : 0.95)), light: false, clip: "head" }));
          }
          let whiteC = lod === "lo" ? C.mix(C.mix("paper-200", skin.shade, shadow ? 0.45 : 0.25), ink, shadow ? 0.25 : 0.18) : cfg.whites === "dark" ? C.mix("paper-200", skin.shade, shadow ? 0.55 : 0.4) : shadow ? C.mix("paper-200", skin.shade, 0.3 - 0.14 * dk) : C.mix("paper-100", skin.base, 0.14 - 0.08 * dk);
          if (lod === "lo") {
            const ir2 = e.h * 0.84 * (cfg.iris || 1), gz2 = E.gaze || [0, 0], icx2 = e.cx + clamp(gz2[0] * e.w - s * e.w * 0.02, -(e.w * 0.5 - ir2 * 0.5), e.w * 0.5 - ir2 * 0.5);
            out.push({ id, z: ctx.Z.face + 0.2, d: eyeD, fill: whiteC, light: false, lines: [{ d: g.ellipseD(icx2, e.cy + gz2[1] * e.h + e.h * ((_b = cfg.irisDy) != null ? _b : 0.1), ir2, ir2), fill: C.mix(irisColour(ctx, opts), ink, 0.75) }], over: [{ d: lid, fill: ink }] });
            continue;
          }
          const dv = lod !== "hi" ? dk : 0;
          if (dv) whiteC = C.mix("paper-100", skin.light, 0.12);
          const ir = e.h * (lod === "hi" ? 0.86 : 0.84) * (cfg.iris || 1) * (1 - 0.22 * dv);
          const gz = E.gaze || [0, 0];
          let icx = e.cx + gz[0] * e.w - s * e.w * 0.02, icy = e.cy + gz[1] * e.h + e.h * ((_c = cfg.irisDy) != null ? _c : 0.1);
          const reach = e.w * 0.5 - ir * 0.5;
          icx = e.cx + clamp(icx - e.cx, -reach, reach);
          const lines = [];
          if (lod === "hi") {
            lines.push({ d: g.ellipseD(icx, icy, ir, ir), fill: C.mix(irisC, ink, 0.6) });
            lines.push({ d: g.ellipseD(icx, icy, ir * 0.84, ir * 0.84), fill: C.mix(irisC, ink, shadow ? 0.38 : 0.1) });
            lines.push({ d: g.ellipseD(icx + s * ir * 0.1, icy + ir * 0.34, ir * 0.6, ir * 0.38), fill: C.mix(irisC, T.PAPER, 0.18), o: shadow ? 0.25 : 0.45 });
            lines.push({ d: g.ellipseD(icx, icy, ir * 0.44, ir * 0.44), fill: ink });
            lines.push({ d: g.ellipseD(icx - ir * 0.36, icy - ir * 0.4, ir * 0.2, ir * 0.2), fill: shadow ? "ink-300" : T.PAPER });
            lines.push({ d: g.ellipseD(e.xi, e.cy, e.w * 0.14, e.h * 0.9), fill: skin.shade, o: 0.4 });
            lines.push({ d: g.ellipseD(e.xo, e.cy, e.w * 0.12, e.h * 0.9), fill: skin.shade, o: 0.4 });
          } else {
            lines.push({ d: g.ellipseD(icx, icy, ir, ir), fill: C.mix(irisC, ink, (_d = cfg.irisDark) != null ? _d : 0.68) });
          }
          const lsPts = [0, 0.3, 0.55, 0.8, 1].map((t) => [e.X(t), e.yU(t) + e.h * 0.16]);
          lines.push({ d: g.brushD(lsPts, [e.h * 0.55, e.h * 0.8, e.h * 0.8, e.h * 0.7, e.h * 0.4]), fill: ink, o: lod === "hi" ? shadow ? 0.4 : 0.28 : shadow ? 0.22 : 0.14 });
          out.push({ id, z: ctx.Z.face + 0.2, d: eyeD, fill: whiteC, light: false, lines });
          const bagsK = opts.bags ? 1 : E.lid.bags;
          if (cfg.fold) {
            const k = cfg.fold, h = e.h, cy = e.cy;
            const top = [[e.xi - s * 0.012, cy - h * 1], [e.X(0.25), cy - h * (1.5 + 0.35 * k)], [e.X(0.62), cy - h * (1.55 + 0.25 * k)], [e.X(0.92), cy - h * 0.75], [e.xo + s * 0.016, e.yU(1) - 2e-3]];
            const back = e.TU.slice().reverse().map((t) => [e.X(t), e.yU(t) - lw * 0.2]);
            out.push({
              id: `${id}-fold`,
              z: ctx.Z.face + 0.21,
              d: g.smoothD([...top, ...back.slice(1, -1), [e.xi, e.yU(0), true]], true, 0.45),
              fill: dk > 0.3 ? C.mix(skin.base, skin.light, 0.3) : C.mix(skin.shade, skin.deep, 0.35),
              opacity: shadow ? 0.95 : 0.85,
              light: false,
              // face v2 on dark skin: the fold catches the light, so brow, lid and eye stay apart
              over: [{ d: g.brushD(top, [3e-3, 0.011, 0.012, 7e-3, 2e-3].map((w) => w * (lod === "hi" ? 1 : 1.3))), fill: skin.deep, o: shadow ? 0.9 : 0.75 }]
            });
          }
          const over = [{ d: lid, fill: ink }];
          const lowPts = [0, 0.2, 0.45, 0.7, 0.95].map((t) => [e.X(t), e.yL(t) + 2e-3]);
          if (lod === "hi") {
            if (!cfg.fold) over.push({ d: g.brushD([[e.xi + s * 0.01, e.cy - e.h * 0.95], [e.cx, e.cy - e.h * (1.3 - e.u * 0.45 + (cfg.creaseUp || 0))], [e.xo - s * 4e-3, e.cy - e.h * 0.8]], [2e-3, 7e-3, 2e-3]), fill: skin.line, o: 0.6 });
            over.push({ d: g.brushD(lowPts, [1e-3, 5e-3, 5e-3, 4e-3, 1e-3]), fill: skin.line, o: 0.65 });
            over.push({ d: g.ellipseD(e.xi + s * 4e-3, e.cy + e.h * 0.1, 6e-3, 8e-3), fill: skin.blush, o: 0.8 });
          } else {
            over.push({ d: g.brushD(lowPts, [2e-3, g.atLeast(7e-3, 1.1), g.atLeast(7e-3, 1.1), g.atLeast(5e-3, 0.9), 2e-3]), fill: skin.shade, o: 0.9 });
          }
          if (lod !== "lo" && E.lid["upper" + tag] > 0.3) {
            const k = clamp((E.lid["upper" + tag] - 0.3) / 0.4, 0, 1), small = lod !== "hi" && 1 / g.px(1) < 60;
            over.push({ d: g.brushD([0.05, 0.3, 0.6, 0.92].map((t) => [e.X(t), e.yU(t) - lw * 0.9 - 0.012 * k]), [2e-3, 0.034 * k, 0.034 * k, 2e-3]), fill: C.mix(shadow ? skin.deep : skin.shade, skin.base, 0.5 * dk), o: (lod === "hi" ? 0.35 : small ? 0.3 : 0.6) * k });
          }
          if (opts.bags || bagsK > 0.2 || cfg.bags) {
            const k = opts.bags ? 1 : Math.max(bagsK, cfg.bags || 0);
            if (lod === "hi" || bagsK <= 0.2) {
              over.push({ d: g.brushD([[e.xi + s * 0.02, e.cy + e.h * 1.2], [e.cx, e.cy + e.h * 1.65], [e.xo + s * 5e-3, e.cy + e.h * 1.1]], [2e-3, 0.012 * k + 3e-3, 2e-3]), fill: skin.shade, o: 0.75 });
              if (lod === "hi" && !opts.bags && E.lid.bags > 0.2) {
                const th = 0.026 * Math.min(1.2, bagsK), ts = [0.08, 0.28, 0.52, 0.76, 0.94];
                const top = ts.map((t) => [e.X(t), e.yL(t) + 0.012]), bot = ts.map((t) => [e.X(t), e.yL(t) + 0.012 + th * Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * t)), 0.8)]);
                over.push({ d: g.smoothD([...top, ...bot.reverse()], true, 0.4), fill: C.mix(skin.shade, skin.deep, 0.5), o: 0.32 + 0.1 * Math.min(1, bagsK) });
              }
            } else {
              const th = Math.max(0.03 * Math.min(1.2, k), g.px(lod === "mid" ? 2.5 : 2)), ts = [0.06, 0.25, 0.5, 0.75, 0.94];
              const top = ts.map((t) => [e.X(t), e.yL(t) + 8e-3]), bot = ts.map((t) => [e.X(t), e.yL(t) + 8e-3 + th * Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * t)), 0.8)]);
              over.push({ d: g.smoothD([...top, ...bot.reverse()], true, 0.4), fill: C.mix(skin.shade, skin.deep, 0.55), o: Math.min(0.9, 0.5 + 0.3 * k) });
            }
            if (lod === "hi") over.push({ d: g.brushD([[e.xi + s * 0.03, e.cy + e.h * 1.55], [e.cx, e.cy + e.h * 2], [e.xo, e.cy + e.h * 1.5]], [1e-3, 5e-3, 1e-3]), fill: skin.line, o: 0.5 });
          }
          out.push({ id: `${id}-lids`, z: ctx.Z.face + 0.25, over });
        }
        return out;
      }
      register({
        kind: "eyes",
        name: "almond",
        describe: "Almond eyes: dark iris tucked under a bold black upper lid with a small flick, cream whites, grey on the shadow side. The neutral default.",
        params: { size: "0.85\u20131.25", lids: "normal|heavy|hooded", eyeColor: "token (iris)", bags: "true for under-eye bags", lidWeight: "0.7\u20131.6 lid thickness", tilt: "-1..2 outer corner up" },
        example: { face: { eyes: "almond" } },
        eyeShape,
        shapeOpts,
        shape: (ctx, s, opts) => eyeShape(ctx, s, shapeOpts({}, opts)),
        draw: (ctx, opts) => drawEyes(ctx, opts, {})
      });
      module.exports = { eyeShape, drawEyes, shapeOpts, irisColour };
    }
  });

  // src/parts/eyes/_brow.js
  var require_brow = __commonJS({
    "src/parts/eyes/_brow.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { hg, noise, clamp, lerp, darkSkin } = require_hg();
      var { fx } = require_fx();
      function browPath(ctx, s, o = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i;
        const H = ctx.head, B = fx(ctx).brow, tag = s < 0 ? "R" : "L";
        const knit = (B.knit || 0) * 0.026;
        const k = (B.angle || 0) * ((_a = o.angK) != null ? _a : 1);
        const raise = clamp((B.raise || 0) + (B["raise" + tag] || 0), -0.05, 0.1) + (o.raise || 0);
        const xi = s * Math.max((_b = o.minInner) != null ? _b : 0.026, ((_c = o.inner) != null ? _c : 0.042) - knit), xo = s * (H.eyeX + H.eyeW * ((_d = o.len) != null ? _d : 0.66));
        const y = H.brow - raise + (o.dy || 0);
        const arch = (_e = o.arch) != null ? _e : 0.012, pT = (_f = o.peakT) != null ? _f : 0.6, slope = (o.slope || 0) - (B.droop || 0) * 0.03, drop = (_g = o.drop) != null ? _g : 0.012;
        const X = (t) => xi + (xo - xi) * t;
        const pts = [
          [xi, y + 6e-3 - k * 0.038 + (o.innerDrop || 0)],
          [X(0.3), y - arch * 0.55 - k * 0.02 - slope * 0.3],
          [X(pT), y - arch - k * 4e-3 - slope * 0.62],
          [xo, y + drop + k * 0.01 - slope]
        ];
        const yMax = H.eyeY - H.eyeH * 0.68 - 0.016, x0 = H.eyeX - H.eyeW * 0.5 - 0.012;
        for (const p of pts) if (Math.abs(p[0]) >= x0) p[1] = Math.min(p[1], yMax);
        const yMin = Math.max((_h = H.hairline) != null ? _h : -0.28, (_i = H.hatLine) != null ? _i : -0.33) + 0.05;
        for (const p of pts) p[1] = Math.max(p[1], yMin);
        return pts;
      }
      function browColour(ctx, opts, mixInk = 0.45) {
        const { C, T } = ctx;
        return C.mix(T.tok(opts.browColor) || T.tok(ctx.S.hair.color) || "cloth-chocolate", T.INK, mixInk);
      }
      function gapCut(ctx, g, pts, s, opts, sel) {
        var _a, _b, _c;
        const t = (_a = opts.gapAt) != null ? _a : 0.42, gw = ((_b = opts.gapW) != null ? _b : 0.026) / 2, sl = (_c = opts.gapSlant) != null ? _c : 0.25;
        const sp = G.resample(pts, 41), p = sp[Math.round(clamp(t, 0, 1) * 40)];
        const h = 0.07, w = Math.max(gw, g.px(1.2) / 2);
        ctx.cut(sel, g.polyD([[p[0] - w - sl * h, p[1] - h], [p[0] + w - sl * h, p[1] - h], [p[0] + w + sl * h, p[1] + h], [p[0] - w + sl * h, p[1] + h]], true));
      }
      function strands(ctx, g, pts, s, st, wgt, salt) {
        const sp = G.resample(pts, 41), n = st.strands, out = [];
        for (let i = 0; i < n; i++) {
          const t = clamp(0.04 + 0.9 * i / (n - 1) + (noise(ctx, i, salt) - 0.5) * 0.05, 0, 0.97);
          const p = sp[Math.round(t * 40)];
          const up = noise(ctx, i + 31, salt) > 0.28;
          const a = (up ? 1 : -1) * (0.7 + noise(ctx, i + 7, salt) * 0.8) * (1 - 0.5 * t);
          const L = (up ? 0.016 + noise(ctx, i + 13, salt) * 0.022 : 8e-3 + noise(ctx, i + 17, salt) * 0.01) * (st.strandK || 1);
          const dir = [s * Math.cos(a), -Math.sin(a)];
          const b = [p[0] - dir[0] * 6e-3, p[1] - dir[1] * 6e-3], tip = [p[0] + dir[0] * L, p[1] + dir[1] * L], mid = [lerp(b[0], tip[0], 0.5), lerp(b[1], tip[1], 0.5) - 2e-3];
          out.push(g.brush([b, mid, tip], [0.011 * wgt, 9e-3 * wgt, 2e-3]));
        }
        return out;
      }
      function browBone(ctx, g, pts, ws, tag) {
        const dk = darkSkin(ctx);
        if (dk < 0.1 || ctx.lod === "hi") return null;
        const { C, T, skin } = ctx;
        const up = ws.map((w) => w * 0.5 + g.px(0.6)), th = ws.map((w) => Math.max(w * 0.4, g.px(1.5)));
        const spine = pts.map(([x, y], i) => [x, y - up[i]]);
        return { id: `brow-${tag}-bone`, z: ctx.Z.face + 0.16, d: g.brushD(spine, [th[0] * 0.5, th[1], th[2], th[3] * 0.4].map((w) => w * 1.4)), fill: C.mix(skin.light, T.PAPER, 0.22), opacity: 0.88 * dk, light: false, clip: "head" };
      }
      function drawBrows(ctx, opts, st) {
        var _a, _b, _c, _d, _e;
        const { T, C } = ctx;
        const g = hg(ctx);
        const lod = ctx.lod;
        const wgt = (opts.browWeight || 1) * (lod === "lo" ? 1.35 : lod === "mid" ? 1.12 : 1) * 1.18;
        const col = browColour(ctx, opts, (_a = st.ink) != null ? _a : 0.45);
        const minW = g.px(lod === "lo" ? 2.8 : lod === "mid" ? 2.6 : 1.2);
        const inK = lod === "hi" ? 1 : 1.3;
        const W = (arr) => arr.map((w, i) => i === arr.length - 1 ? w * wgt : Math.max(w * wgt, Math.min(minW * (i === 0 ? inK : 1), w * wgt * 2.6 * (i === 0 ? inK : 1))));
        const out = [];
        const ridgeK = Math.max(st.ridge || 0, fx(ctx).brow.ridge * (lod === "hi" ? 0.4 : 0.8));
        const gapOpt = (_b = opts.gap) != null ? _b : opts.browGap;
        const gapSides = gapOpt === "both" ? ["R", "L"] : gapOpt ? [gapOpt] : [];
        const fxB = fx(ctx).brow, inW = W(st.w)[0];
        const clearIn = st.uni ? 0 : 0.014 + inW * 0.4 * Math.min(1, Math.abs(fxB.angle) / 1.1);
        const pathO = { ...st.path, raise: (((_c = st.path) == null ? void 0 : _c.raise) || 0) + (opts.raise || 0), minInner: Math.max((_e = (_d = st.path) == null ? void 0 : _d.minInner) != null ? _e : 0.026, clearIn) };
        if (st.uni) {
          const R = browPath(ctx, -1, pathO), L = browPath(ctx, 1, pathO);
          const cy = (R[0][1] + L[0][1]) / 2 + (st.centreDip || 2e-3);
          const pts = [R[3], R[2], R[1], R[0], [0, cy], L[0], L[1], L[2], L[3]];
          const w = st.w.map((x) => x * wgt * 1.22);
          const d = g.brushD(pts, [w[3], w[2], w[1], w[0], w[0] * 1.08, w[0], w[1], w[2], w[3]].map((x, i) => i === 0 || i === 8 ? x : Math.max(x, minW)));
          const over = [];
          if (lod === "hi") over.push({ d: g.brushD(pts.map(([x, y]) => [x - 2e-3, y - 0.011 * wgt]), [2e-3, 6e-3, 6e-3, 6e-3, 4e-3, 6e-3, 4e-3, 3e-3, 1e-3]), fill: C.mix(col, T.PAPER, 0.3), o: 0.3 });
          out.push({ id: "brow-uni", z: ctx.Z.face + 0.4, d, fill: col, light: false, over });
          for (const t of gapSides) gapCut(ctx, g, t === "R" ? R : L, t === "R" ? -1 : 1, opts, "^brow");
          return out;
        }
        for (const s of [-1, 1]) {
          const tag = s < 0 ? "R" : "L";
          const pts = browPath(ctx, s, pathO);
          let d = g.brush(pts, W(st.w));
          if (st.strands) d = [d, ...strands(ctx, g, pts, s, st, wgt, s < 0 ? 1 : 2)].join(" ");
          d = g.hs(d);
          const over = [];
          if (lod === "hi" && s < 0) over.push({ d: g.brushD(pts.map(([x, y]) => [x, y - st.w[1] * wgt * 0.3]), [2e-3, st.w[1] * 0.2 * wgt, st.w[2] * 0.18 * wgt, 1e-3]), fill: C.mix(col, T.PAPER, 0.3), o: 0.28 });
          if (ridgeK > 0.05 && lod !== "lo") {
            out.push({ id: `brow-${tag}-ridge`, z: ctx.Z.face + 0.14, d: g.brushD(pts.map(([x, y]) => [x, y + 0.026]), [0.01, 0.05, 0.05, 0.02].map((w) => w * ridgeK)), fill: ctx.skin.shade, opacity: s > 0 ? 0.75 : 0.5, light: false, clip: "head" });
          }
          const bone = browBone(ctx, g, pts, W(st.w), tag);
          if (bone) out.push(bone);
          out.push({ id: `brow-${tag}`, z: ctx.Z.face + 0.4, d, fill: col, light: false, over });
          if (gapSides.includes(tag)) gapCut(ctx, g, pts, s, opts, `^brow-${tag}$`);
        }
        return out;
      }
      module.exports = { browPath, drawBrows, browColour };
    }
  });

  // src/parts/eyes/brows-straight.js
  var require_brows_straight = __commonJS({
    "src/parts/eyes/brows-straight.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { browPath, drawBrows } = require_brow();
      var PARAMS = { browWeight: "0.7\u20131.6 thickness", browColor: "token; defaults to the hair colour, darkened", gap: '"R"|"L"|"both" (set on spec.face.gap, or face.browGap): a scar gap cut through that brow', gapAt: "0.2\u20130.7 where along the brow", raise: "-0.02..0.02" };
      register({
        kind: "brows",
        name: "straight",
        describe: "Strong straight brows, blunt inner end tapering to a fine tail: the default, reads at any size.",
        params: PARAMS,
        example: { face: { brows: "straight" } },
        browPath,
        draw: (ctx, opts) => drawBrows(ctx, opts, { w: [0.036, 0.04, 0.03, 0.012], path: { arch: 0.011 } })
      });
      module.exports = { browPath, PARAMS };
    }
  });

  // src/parts/eyes/brows-more.js
  var require_brows_more = __commonJS({
    "src/parts/eyes/brows-more.js"() {
      "use strict";
      var { register } = require_registry();
      var { drawBrows } = require_brow();
      var { PARAMS } = require_brows_straight();
      var V = [
        {
          name: "heavy",
          d: "Thick, low, slightly beetled brows with a ridge shadow on the lids: tired, older, immovable (Booker).",
          ex: {},
          st: { w: [0.06, 0.066, 0.054, 0.024], path: { dy: 9e-3, arch: 5e-3, len: 0.72, inner: 0.034, drop: 0.016 }, ridge: 1 }
        },
        {
          name: "unibrow",
          d: "One continuous bar across the nose, thickest in the middle (the Garbage Loader).",
          ex: {},
          st: { uni: true, w: [0.062, 0.056, 0.044, 0.018], path: { dy: 4e-3, arch: 6e-3, inner: 0.016, minInner: 0, len: 0.7, drop: 0.014 } }
        },
        {
          name: "arched",
          d: "A high pencilled 60s arch, fine and long: socialites, glamour.",
          ex: {},
          st: { w: [0.015, 0.017, 0.013, 4e-3], ink: 0.62, path: { dy: -0.012, arch: 0.034, peakT: 0.64, len: 0.78, drop: 0.016, inner: 0.05 } }
        },
        {
          name: "angled",
          d: "Severe brows rising outward from a low inner end: menace, command.",
          ex: {},
          st: { w: [0.038, 0.04, 0.03, 0.01], path: { slope: 0.032, arch: 4e-3, innerDrop: 4e-3, len: 0.72 }, ridge: 0.6 }
        },
        {
          name: "bushy",
          d: "Wild, uneven old-man brows, hairs standing out of the top edge.",
          ex: { age: 62 },
          st: { w: [0.04, 0.046, 0.04, 0.014], ink: 0.22, strands: 9, path: { dy: 2e-3, arch: 0.01, len: 0.72 }, ridge: 0.7 }
        }
      ];
      for (const v of V) {
        register({ kind: "brows", name: v.name, describe: v.d, params: PARAMS, example: { ...v.ex, face: { brows: v.name } }, draw: (ctx, opts) => drawBrows(ctx, opts, v.st) });
      }
    }
  });

  // src/parts/eyes/eyes-more.js
  var require_eyes_more = __commonJS({
    "src/parts/eyes/eyes-more.js"() {
      "use strict";
      var { register } = require_registry();
      var { eyeShape, drawEyes, shapeOpts } = require_almond();
      var PARAMS = { size: "0.85\u20131.25", eyeColor: "token (iris)", bags: "true for under-eye bags", lidWeight: "0.7\u20131.6 lid thickness", lids: "normal|heavy|hooded" };
      var FLAT = [0.7, 1, 1.1, 1.15, 1.15, 1.1, 0.95, 0.7, 0.15];
      var V = [
        {
          name: "hooded",
          d: "A heavy skin fold over the upper lid, crease dropping to the outer corner: tired, older, hard-lived (Booker).",
          cfg: { shape: { lidAdd: 0.16, size: 0.97, tilt: -0.4, flat: 0.5, peak: 0.36 }, fold: 1, lidW: 1.1, bags: 0.45, irisDy: 0.14 }
        },
        {
          name: "narrow",
          d: "A hard, flat squint: thin slit, straight lid and lower lid, small dark iris (Stacey).",
          cfg: { shape: { openK: 0.62, flat: 1, squint: 0.18, tilt: 0.5, peak: 0.45 }, lidW: 1.5, lidProfile: FLAT, flick: 0.5, iris: 0.9, irisDy: 0.02 }
        },
        {
          name: "heavy",
          d: "Lazy half-closed lids, a flat heavy lid bar cutting the iris: 60s cool, bored (Alfie).",
          cfg: { shape: { lidAdd: 0.12, flat: 0.85, peak: 0.42, squint: 0.06, tilt: -0.2 }, lidW: 1.35, lidProfile: FLAT, irisDy: 0.16, bags: 0.2 }
        },
        {
          name: "deepset",
          d: "Eyes sunk in a dark socket under a hard brow ridge, whites in shade.",
          cfg: { shape: { size: 0.93 }, socket: 1, whites: "dark", irisDark: 0.82, lidW: 1.1 }
        },
        {
          name: "round",
          d: "Wide, open, innocent: tall round eyes with white showing, a small flick.",
          cfg: { shape: { openK: 1.4, peak: 0.5, lowerK: 1.25, size: 0.98 }, iris: 0.82, irisDy: 0.02, lidW: 0.8, flick: 0.3 },
          // face v2 (P2.1's open item: the loader's stare): still round and open, but a bigger iris tucked up under a heavier lid, so the white shows
          // below it and at the sides, not all round it
          v2: { shape: { openK: 1, peak: 0.48, lowerK: 1.05, size: 1, lidAdd: 0.14, flat: 0.35 }, iris: 1, irisDy: 0.02, lidW: 1.15, flick: 0.4 }
        },
        {
          name: "upturned",
          d: "Cat-like eyes, outer corners lifted and a long flick: socialites; pairs with liner.",
          cfg: { shape: { tilt: 1.7, inner: 0.4, peak: 0.55, size: 1.05 }, flick: 2.4, lidW: 1.1 }
        },
        {
          name: "downturned",
          d: "Sad, droopy eyes, outer corners falling: puppyish or defeated.",
          cfg: { shape: { tilt: -1.5, peak: 0.28 }, flick: 0, bags: 0.5, lidW: 0.95 }
        }
      ];
      for (const v of V) {
        const cf = (ctx) => v.v2 || v.cfg;
        register({
          kind: "eyes",
          name: v.name,
          describe: v.d,
          params: PARAMS,
          example: { face: { eyes: v.name } },
          eyeShape: (ctx, s, o) => eyeShape(ctx, s, shapeOpts(cf(ctx), o)),
          shape: (ctx, s, o) => eyeShape(ctx, s, shapeOpts(cf(ctx), o)),
          draw: (ctx, opts) => drawEyes(ctx, opts, cf(ctx))
        });
      }
    }
  });

  // src/parts/eyewear/_lens.js
  var require_lens = __commonJS({
    "src/parts/eyewear/_lens.js"(exports, module) {
      "use strict";
      var REFLECTIONS = ["soft", "wide", "bands", "glint", "none"];
      var KINDS = ["clear", "dark", "colour", "gradient", "mirror"];
      var SCENES = ["sky", "city", "window"];
      function parseLens(ctx, opts, cfg) {
        const { T } = ctx;
        const darkTok = T.tok("glass-dark");
        let raw = opts.lens !== void 0 ? opts.lens : cfg.lens;
        if (typeof opts.lensOpacity === "number") {
          const lo = opts.lensOpacity;
          const name = typeof opts.lens === "string" && !["clear", "dark", "mirror"].includes(opts.lens) ? opts.lens : cfg.v2Lens || "glass-dark";
          const to = lo >= 0.6 ? T.tok(name) === darkTok ? "dark" : name : "clear";
          ctx.warn(`eyewear lensOpacity ${lo}: see-through tints were retired in v3. Drew ${lo >= 0.6 ? to === "dark" ? 'an opaque "dark"' : `an opaque "${to}" colour` : 'a "clear"'} lens; set lens: "clear" | "dark" | a colour token instead`);
          if (!(raw && typeof raw === "object")) raw = to;
        }
        if (raw == null) raw = "clear";
        let sp;
        if (typeof raw === "string") sp = KINDS.includes(raw) && raw !== "colour" && raw !== "gradient" ? { type: raw } : { type: "colour", color: raw };
        else if (raw && typeof raw === "object") sp = { ...raw };
        else sp = { type: "clear" };
        if (sp.type === "color") sp.type = "colour";
        if (!sp.type) sp.type = sp.color ? "colour" : "clear";
        if (!KINDS.includes(sp.type)) {
          ctx.warn(`eyewear lens type "${sp.type}" is not valid; choose from: ${KINDS.join(", ")}`);
          sp.type = "clear";
        }
        const tok = (v) => v == null ? null : T.tok(v) || null;
        const out = { kind: sp.type, color: tok(sp.color), color2: tok(sp.color2), scene: null, reflection: null };
        if (out.kind === "colour" && !out.color) {
          if (sp.color != null) ctx.warn(`eyewear lens colour "${sp.color}" is not a token; drew a dark lens`);
          out.kind = "dark";
        }
        if (out.kind === "colour" && out.color === darkTok) out.kind = "dark";
        if (out.kind === "gradient" && !out.color && !out.color2) {
          out.color = T.tok("cloth-mustard");
          out.color2 = T.tok("cloth-orange");
        }
        if (out.kind === "mirror") {
          out.scene = sp.scene || "sky";
          if (!SCENES.includes(out.scene)) {
            ctx.warn(`eyewear mirror scene "${out.scene}" is not valid; choose from: ${SCENES.join(", ")}`);
            out.scene = "sky";
          }
        }
        const def = { clear: "glint", dark: "soft", colour: "wide", gradient: "wide", mirror: "glint" }[out.kind];
        let refl = opts.reflection != null ? opts.reflection : cfg.reflection || def;
        if (!REFLECTIONS.includes(refl)) {
          ctx.warn(`eyewear reflection "${refl}" is not valid; choose from: ${REFLECTIONS.join(", ")}`);
          refl = def;
        }
        out.reflection = refl;
        out.opaque = out.kind !== "clear";
        return out;
      }
      function lensColours(ctx, L, lod) {
        const { C, T } = ctx;
        let tok, mat;
        if (L.kind === "dark") tok = L.color || T.tok("glass-dark");
        else if (L.kind === "colour") tok = L.color;
        else if (L.kind === "gradient") tok = L.color2 || L.color;
        else tok = L.color || C.mix(T.tok("file-300"), T.tok("file-500"), 0.45);
        mat = ctx.mat(tok, "glass");
        let base = mat.base;
        if (lod === "lo") {
          if (L.kind === "gradient") base = C.mix(mat.base, mat.shade, 0.42);
          else if (L.kind === "mirror") base = C.mix(mat.base, L.color2 || T.tok("file-900"), L.scene === "city" ? 0.6 : L.scene === "window" ? 0.5 : 0.38);
        }
        const white = T.tok("cloth-white");
        const band = L.kind === "gradient" && L.color && L.color2 ? L.color : C.mix(mat.base, white, L.kind === "dark" ? 0.3 : 0.42);
        const steps = [];
        if (L.kind === "gradient") {
          const n = lod === "hi" ? 3 : lod === "mid" ? 2 : 1;
          const top = mat.shade, mid = C.mix(mat.shade, mat.base, 0.5);
          if (n === 3) steps.push({ v0: -1.3, v1: -0.42, fill: top }, { v0: -0.42, v1: 0.1, fill: mid });
          else if (n === 2) steps.push({ v0: -1.3, v1: -0.15, fill: mid });
        }
        return { mat, base, steps, band };
      }
      function stripe(u0, v0, w, slope) {
        const hw = w / 2;
        return [[u0 - hw + slope * 1.3, v0 - 1.3], [u0 + hw + slope * 1.3, v0 - 1.3], [u0 + hw - slope * 1.3, v0 + 1.3], [u0 - hw - slope * 1.3, v0 + 1.3]];
      }
      function opaqueLayers(ctx, L, S, env) {
        const { C, T } = ctx;
        const lod = env.lod, col = lensColours(ctx, L, lod);
        const mat = col.mat;
        const shade = [], lit = [], deep = [];
        const hi = lod === "hi", mid = lod === "mid";
        const wide = S.s < 0 ? 1 : 1;
        for (const st of col.steps) shade.push({ d: S.poly([[-1.6, st.v0], [1.6, st.v0], [1.6, st.v1], [-1.6, st.v1]]), fill: st.fill });
        if (L.kind === "mirror") mirrorScene(ctx, L, S, col, shade, lit, env);
        const refl = L.reflection;
        if (lod === "lo" || refl === "none") return { mat, base: col.base, shade, lit, deep };
        if (refl === "soft") {
          const warm = C.mix(mat.base, T.tok("cloth-tobacco"), 0.5);
          const arc = [], N = 9;
          for (let i = 0; i < N; i++) {
            const a = (62 + 118 * i / (N - 1)) * Math.PI / 180;
            arc.push([0.86 * Math.cos(a), 0.84 * Math.sin(a)]);
          }
          lit.push({ d: S.brush(arc, [0.012, 0.07, 0.13, 0.17, 0.18, 0.16, 0.12, 0.06, 0.012].map((w) => w * S.hh * 2.2)), fill: warm, o: 0.9 });
          if (hi) lit.push({ d: S.brush([[-0.66, -0.52], [-0.34, -0.74]], [0.03 * S.hh, 0.09 * S.hh]), fill: C.mix(mat.base, T.tok("cloth-white"), 0.3), o: 0.4 });
        } else if (refl === "wide") {
          const c = col.band;
          lit.push({ d: S.poly(stripe(-0.1, 0.12, 0.62, 0.8)), fill: c, o: L.kind === "gradient" ? 0.96 : 0.75 });
          if (!mid || env.thick) lit.push({ d: S.poly(stripe(0.9, 0.12, 0.2, 0.8)), fill: c, o: L.kind === "gradient" ? 0.9 : 0.7 });
        } else if (refl === "bands") {
          const c = "light";
          lit.push({ d: S.poly(stripe(-0.25, 0, 0.3, 0.9)), fill: c, o: 0.55 });
          if (!mid) lit.push({ d: S.poly(stripe(0.3, 0, 0.12, 0.9)), fill: c, o: 0.4 });
        } else if (refl === "glint") {
          lit.push({ d: glintD(S), fill: L.kind === "mirror" ? C.mix(col.base, T.tok("cloth-white"), 0.7) : "light", o: 0.8 });
        }
        if (env.up) lit.push({ d: S.poly([[-1.6, -1.5], [1.6, -1.5], [1.6, -0.05], [-1.6, -0.45]]), fill: C.mix(col.base, T.tok("cloth-white"), 0.5), o: 0.5 });
        return { mat, base: col.base, shade, lit, deep };
      }
      function glintD(S) {
        return S.brush([[-0.68, -0.34], [-0.3, -0.7]], [0.05 * S.hh, 0.15 * S.hh, 0.03 * S.hh]);
      }
      function mirrorScene(ctx, L, S, col, shade, lit, env) {
        const { C, T } = ctx;
        const hi = env.lod === "hi";
        const ground = L.color2 || T.tok("file-900");
        const cloud = C.mix(col.base, T.tok("cloth-white"), 0.55);
        const hor = (u) => 0.3 + 0.2 * u * u;
        const gp = [];
        for (let i = 0; i <= 8; i++) {
          const u = -1.5 + 3 * i / 8;
          gp.push([u, hor(u)]);
        }
        const groundD = () => S.poly([...gp, [1.5, 1.6], [-1.5, 1.6]]);
        if (L.scene === "city") {
          const bld = [[-1.5, -0.95, -0.05], [-0.95, -0.6, 0.12], [-0.6, -0.25, -0.4], [-0.25, 0.1, 0.02], [0.1, 0.45, -0.25], [0.45, 0.8, 0.14], [0.8, 1.5, -0.12]];
          for (const [a, b, top] of bld) shade.push({ d: S.poly([[a, top], [b, top], [b, 1.6], [a, 1.6]]), fill: ground });
          shade.push({ d: groundD(), fill: C.mix(ground, T.tok("glass-dark"), 0.4) });
          if (hi) for (const [a, b, top] of bld) for (let k = 0; k < 3; k++) {
            const x = a + (b - a) * (0.25 + 0.3 * (k % 2)), y = top + 0.18 + 0.2 * Math.floor(k / 2) + 0.12 * k;
            if (y < hor(x) - 0.08) lit.push({ d: S.poly([[x, y], [x + 0.08, y], [x + 0.08, y + 0.09], [x, y + 0.09]]), fill: cloud, o: 0.75 });
          }
        } else if (L.scene === "window") {
          shade.push({ d: S.poly([[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]), fill: ground });
          lit.push({ d: S.poly([[-0.72, -0.72], [0.72, -0.72], [0.72, 0.5], [-0.72, 0.5]]), fill: C.mix(col.base, T.tok("cloth-white"), 0.35), o: 1 });
          shade.push({ d: S.poly([[-0.05, -0.8], [0.05, -0.8], [0.05, 0.6], [-0.05, 0.6]]), fill: ground });
          shade.push({ d: S.poly([[-0.8, -0.14], [0.8, -0.14], [0.8, -0.05], [-0.8, -0.05]]), fill: ground });
        } else {
          lit.push({ d: S.poly(blob(-0.42, -0.5, 0.52, 0.2)), fill: cloud, o: 0.85 });
          lit.push({ d: S.poly(blob(0.42, -0.12, 0.42, 0.16)), fill: cloud, o: 0.7 });
          shade.push({ d: groundD(), fill: ground });
          if (hi) {
            lit.push({ d: S.brush([[0.12, -0.9], [0.4, -0.5]], [0.02 * S.hh, 0.1 * S.hh, 0.01 * S.hh]), fill: T.tok("cloth-mustard"), o: 0.85 });
          }
        }
      }
      function blob(cu, cv, ru, rv) {
        const pts = [];
        for (let i = 0; i < 14; i++) {
          const a = i / 14 * Math.PI * 2, b = 1 + 0.18 * Math.sin(a * 3 + 0.7) * (Math.sin(a) < 0 ? 1 : 0.3);
          pts.push([cu + Math.cos(a) * ru * b, cv + Math.sin(a) * rv * b]);
        }
        return pts;
      }
      module.exports = { parseLens, lensColours, opaqueLayers, glintD, stripe, blob, REFLECTIONS, KINDS, SCENES };
    }
  });

  // src/parts/eyewear/_wear.js
  var require_wear = __commonJS({
    "src/parts/eyewear/_wear.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { handAnchor } = require_anchors();
      var DEG = Math.PI / 180;
      var rotP = (a) => {
        const c = Math.cos(a), s = Math.sin(a);
        return ([x, y]) => [x * c - y * s, x * s + y * c];
      };
      function drawCarried(ctx, opts, cfg, o, wear) {
        var _a;
        const { drawFrames } = require_frame();
        const R = ctx.R, k = R.head.k, hh = R.hh;
        if (cfg.single || cfg.band || cfg.name === "goggles") {
          ctx.warn(`eyewear "${cfg.name}" cannot be carried as wear "${wear}"; worn on`);
          return null;
        }
        const hwL = cfg.hw * o.size, hhL = cfg.hh * o.size, rimS = cfg.rim[1] * (cfg.rimIn || 1);
        const sep = hwL + rimS + 0.026;
        const outer = sep + hwL + rimS;
        const armW = Math.max((_a = cfg.arm) != null ? _a : 0.02, 0.012);
        const zc = ctx.Z.strap - 0.5;
        let P, z = zc, clipY, extras;
        if (wear === "hand") {
          const want = opts.hand === "R" || opts.hand === "L" ? opts.hand : null;
          const side = want || ["R", "L"].find((s) => R.arms[s].pose === "hold");
          if (!side || R.arms[side].pose !== "hold") {
            ctx.warn(`eyewear wear "hand" needs an arm in pose "hold"${want ? " on side " + want : ""}; set pose.arms.${want || "R"}: "hold" (worn on instead)`);
            return null;
          }
          const a = handAnchor(ctx, side);
          const rot = rotP((side === "R" ? -1 : 1) * 14 * DEG);
          const c0 = [a.pt[0] + a.up[0] * 0.2 * k, a.pt[1] + a.up[1] * 0.2 * k];
          P = (p) => {
            const q = rot(p);
            return [c0[0] + q[0] * k, c0[1] + q[1] * k];
          };
          z = a.zUnder;
          extras = (env) => {
            const w = Math.max(armW, env.min) * (env.lod === "lo" ? 1.2 : 1);
            const s = side === "R" ? -1 : 1;
            const pts = [[s * outer, -hhL * 0.5], [s * (outer + 0.16), -hhL * 0.38], [s * (outer + 0.32), -hhL * 0.1]];
            return [{ id: "eyewear-held-arm", z: env.zFront + 0.05, d: G.brush(pts.map(P), w * k), mat: env.frameMat, light: false }];
          };
        } else if (wear === "chain") {
          const nb = R.y.neckBase, c0 = R.torsoPt(0, R.y.chest - 0.2 * hh), rot = rotP(5 * DEG);
          P = (p) => {
            const q = rot(p);
            return [c0[0] + q[0] * k, c0[1] + q[1] * k];
          };
          extras = (env) => {
            const out = [], w = Math.max(armW * 0.9, env.min);
            const want = typeof opts.chain === "string" ? opts.chain : null;
            const tok = want && ctx.T.tok(want) || ctx.T.tok("metal-brass");
            if (want && !ctx.T.tok(want)) ctx.warn(`eyewear chain "${want}" is not a colour token (try metal-brass, metal-chrome, metal-steel or metal-gun); drew a brass chain`);
            const cm = ctx.mat(tok, "metal");
            for (const s of [-1, 1]) {
              const h0 = [s * outer, -hhL * 0.42], h1 = [s * (outer + 0.012), hhL * 0.2];
              out.push({ id: `eyewear-hinge-${s < 0 ? "R" : "L"}`, z: env.zFront + 0.05, d: G.brush([h0, h1].map(P), [w * k, w * k * 0.9]), mat: env.frameMat, light: false });
              const N = R.torsoPt(s * R.w.neckBase * 0.92, nb + 0.02 * hh), E = P(h0);
              const m = [(N[0] + E[0]) / 2 + s * 0.012 * hh, (N[1] + E[1]) / 2 + 0.03 * hh];
              const pts = [];
              for (let i = 0; i <= 10; i++) {
                const t = i / 10, u = 1 - t;
                pts.push([u * u * N[0] + 2 * u * t * m[0] + t * t * E[0], u * u * N[1] + 2 * u * t * m[1] + t * t * E[1]]);
              }
              const cw = Math.max(6e-3 * hh, ctx.px(env.lod === "lo" ? 1.8 : env.lod === "mid" ? 1.3 : 1.1));
              out.push({ id: `eyewear-chain-${s < 0 ? "R" : "L"}`, z: env.zFront - 0.05, d: G.brush(pts, cw), mat: cm, light: false });
            }
            return out;
          };
        } else {
          const at = opts.at === "neckline" ? "neckline" : "breast";
          if (opts.at != null && opts.at !== "breast" && opts.at !== "neckline") ctx.warn(`eyewear at "${opts.at}" is not valid; use "breast" (default) or "neckline"`);
          const side = opts.side === "R" ? "R" : "L", kk = side === "R" ? -1 : 1;
          if (at === "breast") {
            const M = R.torsoPt(kk * R.w.chest * 0.5, R.y.chest - 0.16 * hh), rot = rotP(-kk * 7 * DEG);
            clipY = hhL * 0.12;
            P = (p) => {
              const q = rot([p[0], p[1] - clipY]);
              return [M[0] + q[0] * k * 0.92, M[1] + q[1] * k * 0.92];
            };
            extras = (env) => {
              const w = Math.max(armW, env.min) * (env.lod === "lo" ? 1.2 : 1), s = -kk;
              const pts = [[s * outer, -hhL * 0.55], [s * outer * 0.55, -hhL * 0.78], [0, clipY * 0.4]];
              return [{ id: "eyewear-pocket-arm", z: env.zFront + 0.05, d: G.brush(pts.map(P), w * k), mat: env.frameMat, light: false }];
            };
          } else {
            const nb = R.y.neckBase, M = R.torsoPt(kk * R.w.neckBase * 0.3, nb + 0.17 * hh), rot = rotP(kk * 8 * DEG);
            P = (p) => {
              const q = rot(p);
              return [M[0] + q[0] * k * 0.92, M[1] + q[1] * k * 0.92];
            };
            extras = (env) => {
              const w = Math.max(armW, env.min) * (env.lod === "lo" ? 1.2 : 1), s = kk;
              const pts = [[s * outer, -hhL * 0.4], [s * (outer + 0.01), -hhL * 0.95], [s * (outer - 0.03), -hhL * 1.5]];
              return [{ id: "eyewear-hook-arm", z: env.zFront + 0.05, d: G.brush(pts.map(P), w * k), mat: env.frameMat, light: false }];
            };
          }
        }
        return drawFrames(ctx, { ...opts, wear: "on" }, cfg, { P, z, sep, clipY, extras });
      }
      module.exports = { drawCarried };
    }
  });

  // src/parts/eyewear/_frame.js
  var require_frame = __commonJS({
    "src/parts/eyewear/_frame.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { hg, clamp, lerp } = require_hg();
      var U = require_util();
      var Lens = require_lens();
      var DEG = Math.PI / 180;
      var WEARS = ["on", "low", "up", "hand", "pocket", "chain"];
      var MATERIALS = ["acetate", "metal", "wire"];
      var LO_BAR_PX = 6;
      var LO_DROP_PX = 4;
      function lensPts(s, cx, cy, hw, hh, o = {}) {
        const N = o.N || 44, pts = [];
        const n = o.n || 2.6;
        for (let i = 0; i < N; i++) {
          const a = i / N * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
          const xl = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
          const yl = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
          let X = xl * hw, Y = yl * hh;
          if (o.taper && yl > 0) X *= 1 - o.taper * yl;
          if (o.flatTop && yl < 0) Y *= 1 - o.flatTop * 0.35 * (1 - Math.abs(xl));
          if (o.top != null && yl < 0) Y *= o.top;
          if (o.sweep && xl > 0 && yl < 0.3) Y -= o.sweep * Math.pow(xl, 1.6) * hh * (1 - yl) * 0.6;
          if (o.drop && xl > 0 && yl > -0.2) Y += o.drop * Math.pow(xl, 1.3) * hh * (0.3 + yl);
          pts.push([cx + s * X, cy + Y]);
        }
        return pts;
      }
      function thickAt(nx, ny, s, rim, rimIn) {
        const side = nx * s > 0 ? rim[1] : rim[1] * rimIn;
        const vert = ny < 0 ? rim[0] : rim[2];
        const P = 2.6;
        return Math.pow(Math.pow(Math.abs(nx) * side, P) + Math.pow(Math.abs(ny) * vert, P), 1 / P);
      }
      function ringOf(inner, s, rim, rimIn, lug) {
        const n = inner.length;
        let mx = 0, my = 0;
        for (const p of inner) {
          mx += p[0];
          my += p[1];
        }
        mx /= n;
        my /= n;
        const outer = [], nrm = [], thk = [];
        for (let i = 0; i < n; i++) {
          const a = inner[(i - 1 + n) % n], b = inner[(i + 1) % n], p = inner[i];
          const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
          let nx = ty / l, ny = -tx / l;
          if (nx * (p[0] - mx) + ny * (p[1] - my) < 0) {
            nx = -nx;
            ny = -ny;
          }
          let t = thickAt(nx, ny, s, rim, rimIn);
          if (lug) {
            const w = s * nx * 0.74 - ny * 0.67;
            t += lug * rim[0] * Math.pow(Math.max(0, (w - 0.86) / 0.14), 1.4);
          }
          outer.push([p[0] + nx * t, p[1] + ny * t]);
          nrm.push([nx, ny]);
          thk.push(t);
        }
        return { inner, outer, nrm, thk };
      }
      function crescent(g, ring, ctr, phiC, half, frac, minW, W) {
        const n = ring.outer.length, idx = [];
        const dist = (i) => {
          const p = ring.outer[i];
          let d = Math.atan2((p[1] - ctr.cy) / ctr.ry, (p[0] - ctr.cx) / ctr.rx) / DEG - phiC;
          d = (d + 540) % 360 - 180;
          return Math.abs(d);
        };
        let i0 = 0, best = -1;
        for (let i = 0; i < n; i++) {
          const d = dist(i);
          if (d > best) {
            best = d;
            i0 = i;
          }
        }
        for (let k = 1; k <= n; k++) {
          const i = (i0 + k) % n;
          if (dist(i) <= half) idx.push(i);
        }
        if (idx.length < 3) return null;
        const m = idx.length, pts = [], ws = [];
        for (let k = 0; k < m; k++) {
          const i = idx[k], t = m > 1 ? k / (m - 1) : 0, tap = Math.pow(Math.sin(Math.PI * t), 0.75);
          const w = Math.max(frac * ring.thk[i], minW) * tap + 1e-5;
          const o = ring.outer[i], nn = ring.nrm[i];
          pts.push(W([o[0] - nn[0] * w * 0.5, o[1] - nn[1] * w * 0.5]));
          ws.push(w);
        }
        return g.brush(pts, ws);
      }
      function clipPoly(P, yMax) {
        const out = [];
        for (let i = 0; i < P.length; i++) {
          const a = P[i], b = P[(i + 1) % P.length], ain = a[1] <= yMax, bin = b[1] <= yMax;
          if (ain) out.push(a);
          if (ain !== bin) {
            const t = (yMax - a[1]) / (b[1] - a[1]);
            out.push([a[0] + (b[0] - a[0]) * t, yMax]);
          }
        }
        return out;
      }
      function yawSlide(ctx, x, y, depth = 0) {
        const H = ctx.R.head;
        if (!H.yaw) return 0;
        const r = H.w * Math.sqrt(Math.max(0.15, 1 - Math.pow(Math.max(0, y - 0.05) / 0.62, 2)));
        return (Math.sqrt(Math.max(0, r * r - x * x)) + depth) * Math.sin(H.yaw);
      }
      function hsArm(ctx, d, xFront, xEar, front) {
        return G.mapPath(d, (p) => {
          const x = Math.abs(p[0] / 1e3), t = clamp((x - xFront) / Math.max(1e-6, xEar - xFront), 0, 1);
          return ctx.hp([p[0] / 1e3, p[1] / 1e3], { depth: front * (1 - t) });
        });
      }
      function resolve(ctx, opts, cfg) {
        const { T } = ctx;
        const o = {};
        o.material = opts.material != null ? opts.material : cfg.material || "acetate";
        if (!MATERIALS.includes(o.material)) {
          ctx.warn(`eyewear material "${o.material}" is not valid; choose from: ${MATERIALS.join(", ")}`);
          o.material = cfg.material || "acetate";
        }
        o.frameTok = T.tok(opts.frame) || T.tok(cfg.frame) || T.tok("cloth-black");
        o.size = clamp(+opts.size || 1, 0.6, 1.6);
        o.rimWeight = clamp(+opts.rimWeight || 1, 0.4, 3.5);
        o.seatOff = +opts.seat || 0;
        let wear = opts.wear != null ? opts.wear : cfg.wear || "on";
        if (!WEARS.includes(wear)) {
          ctx.warn(`eyewear wear "${wear}" is not valid; choose from: ${WEARS.join(", ")}`);
          wear = "on";
        }
        o.wear = wear;
        let spot = opts.spot;
        if (spot != null && spot !== true && spot !== false && spot !== "lens" && spot !== "frame") {
          ctx.warn(`eyewear spot "${spot}" is not valid; use true, "lens" or "frame"`);
          spot = null;
        }
        o.spot = spot;
        o.pattern = opts.pattern != null ? opts.pattern : cfg.pattern || null;
        if (o.pattern === "none") o.pattern = null;
        if (o.pattern && o.pattern !== "tortoise") {
          ctx.warn(`eyewear pattern "${o.pattern}" is not valid; use "tortoise" (acetate frames) or "none"`);
          o.pattern = null;
        }
        if (o.pattern && o.material !== "acetate") {
          ctx.warn('eyewear pattern "tortoise" needs material "acetate"; ignored');
          o.pattern = null;
        }
        o.lens = Lens.parseLens(ctx, opts, cfg);
        return o;
      }
      function drawFrames(ctx, opts, cfg, carry) {
        var _a;
        const { T, C } = ctx;
        const g = hg(ctx);
        const H = ctx.head;
        const lod = ctx.lod;
        const o = resolve(ctx, opts, cfg);
        const flat = { flat: true };
        const D = carry ? (d) => G.mapPath(d, (p) => carry.P([p[0] / 1e3, p[1] / 1e3])) : (d) => g.hs(d, flat);
        const yaw = carry ? 0 : ctx.R.head.yaw || 0, cosY = Math.cos(yaw);
        const ys = (x, y, d) => carry ? 0 : yawSlide(ctx, x, y, d);
        const hasHat = !carry && !!(ctx.S.hair && ctx.S.hair.hat);
        let wear = carry ? "on" : o.wear;
        const wearOut = require_wear();
        if (!carry && wear === "up" && hasHat && cfg.name !== "goggles") {
          ctx.warn('eyewear wear "up" needs a bare head (the hair is the rest); with a hat the glasses were worn on');
          wear = "on";
        }
        if (!carry && (wear === "hand" || wear === "pocket" || wear === "chain")) {
          const w = wearOut.drawCarried(ctx, opts, cfg, o, wear);
          if (w) return w;
          wear = "on";
        }
        let lensT = o.lens;
        const clipDown = !!cfg.clip && !carry && (opts.flip == null || opts.flip === "down");
        if (clipDown && lod === "lo") lensT = Lens.parseLens(ctx, { lens: "dark" }, cfg);
        const opaque = lensT.opaque;
        const clearSeat = !opaque;
        const k = lod === "lo" ? 1.25 : lod === "mid" ? 1.15 : 1;
        const min = g.px(lod === "lo" ? o.material === "acetate" ? 2 : 1.5 : lod === "mid" ? 1.7 : 1.1);
        const rim = cfg.rim.map((r) => Math.max(r * k * o.rimWeight, min));
        const rimIn = cfg.rimIn || 1;
        const hw = cfg.hw * o.size, hh = cfg.hh * o.size;
        const lensPx = 2 * hw / g.px(1);
        const topF = cfg.top != null ? cfg.top : 1;
        const shapeO = { n: cfg.n, taper: cfg.taper, sweep: cfg.sweep, drop: cfg.drop, flatTop: cfg.flatTop, top: cfg.top };
        const seatMode = cfg.seat || "eye";
        let cy;
        if (carry) cy = 0;
        else if (seatMode === "brow") cy = H.brow - 0.034 + rim[0] + hh * topF;
        else if (seatMode === "under") cy = H.brow + 0.016 + rim[0] + hh * topF;
        else cy = H.eyeY + (cfg.dy || 0);
        if (!carry) cy += o.seatOff;
        const dxLens = cfg.dx || 0;
        const minCx = clearSeat ? hw + rim[1] * rimIn + 0.012 : 0;
        const yUp = cfg.name === "goggles" && hasHat ? H.hatLine - 0.07 : H.hairline - 0.06;
        let W = (p) => p;
        if (wear === "low") {
          const top = cy - hh * topF - rim[0], sh = Math.max(0.03, H.eyeY + 0.042 - top);
          W = (p) => p.length > 2 ? [p[0], p[1] + sh, p[2]] : [p[0], p[1] + sh];
        }
        if (wear === "up") {
          const kY = 0.45;
          W = (p) => p.length > 2 ? [p[0], yUp + (p[1] - cy) * kY, p[2]] : [p[0], yUp + (p[1] - cy) * kY];
        }
        const cyW = W([0, cy])[1];
        const mk = {
          poly: (pts, closed = true) => D(g.poly(pts.map(W), closed)),
          smooth: (pts, closed = true, t = 0.5) => D(g.smooth(pts.map(W), closed, t)),
          brush: (pts, w, opt) => D(g.brush(pts.map(W), w, opt))
        };
        const outlineP = carry ? null : U.outlinePoly(ctx).map(([x, y]) => [x + yawSlide(ctx, x, y, 0), y]);
        const edge = carry ? null : U.edgeAt(outlineP, cyW);
        const sideTags = cfg.single ? [opts.side === "L" ? "L" : "R"] : cfg.sides || ["R", "L"];
        const sides = sideTags.map((tag) => {
          var _a2;
          const s = tag === "R" ? -1 : 1;
          const cx = s * (carry ? carry.sep : Math.max(H.eyeX + dxLens, minCx));
          let cs = cosY, cP = cx + ys(cx, cy, 0.035);
          if (edge) {
            const prot = wear === "up" ? 0.06 : (_a2 = cfg.protrude) != null ? _a2 : 0.02;
            const lim = s > 0 ? edge.r - (yaw ? 4e-3 : -prot) : edge.l + (yaw ? 4e-3 : -prot);
            const over = s * (cP + s * (hw + rim[1]) * cs - lim);
            if (over > 0) {
              const Wd = 2 * (hw + rim[1]) * cs, W2 = Math.max(Wd - over, Wd * 0.45);
              cP -= s * (Wd - W2) / 2;
              cs *= W2 / Wd;
            }
          }
          const hwE = hw * cs;
          const rimE = [rim[0], rim[1] * cs, rim[2]];
          const inner = lensPts(s, cP, cy, hwE, hh, shapeO);
          const ring = ringOf(inner, s, rimE, rimIn, cfg.lug ? cfg.lug * (cfg.material === "acetate" || !cfg.material ? 1 : 0) : 0);
          const S = { tag, s, cP, cy, hwE, hh, rimE, ring, ctr: { cx: cP, cy, rx: hwE + rimE[1], ry: hh + (rim[0] + rim[2]) / 2 }, far: yaw !== 0 && Math.sign(yaw) === s };
          S.pt = (u, v) => [cP + u * hwE, cy + v * hh];
          S.poly = (uv) => mk.poly(uv.map(([u, v]) => S.pt(u, v)));
          S.smooth = (uv) => mk.smooth(uv.map(([u, v]) => S.pt(u, v)));
          S.brush = (uv, w) => mk.brush(uv.map(([u, v]) => S.pt(u, v)), w);
          S.hh = hh;
          S.s = s;
          return S;
        });
        const clipY = carry && carry.clipY != null ? carry.clipY : null;
        const zFront = carry ? carry.z : (cfg.overHat && hasHat && wear === "up" ? ctx.Z.hat : ctx.Z.hair) + 0.3;
        const isMetal = o.material !== "acetate";
        const frameMat = ctx.mat(o.frameTok, isMetal ? "metal" : cfg.frameKind || "satin");
        const out = [];
        const role = (r, pc) => {
          const sp = o.spot;
          pc.spot = sp === true || sp === r;
          if (!pc.spot) delete pc.spot;
          return pc;
        };
        const env = { ctx, opts, g, W, mk, D, cyW, topF, sides, rim, rimIn, cy, hw, hh, zFront, lod, frameMat, o, cfg, wear, yaw, cosY, role, out, k, min, opaque, edge, lens: lensT, hasHat, ys, carry, lensPx, tiny: lod === "lo" && lensPx < LO_BAR_PX };
        if (cfg.band) env.band = makeBand(env);
        if (lod === "lo" && !cfg.noLoBar) {
          if (opaque && lensPx < LO_BAR_PX) {
            const lo = drawLo(env);
            if (carry && carry.extras) lo.push(...carry.extras(env));
            return lo;
          }
          if (!opaque && !carry && !cfg.band && lensPx < LO_DROP_PX) return [];
        }
        for (const S of sides) {
          if (opaque) {
            const lay = Lens.opaqueLayers(ctx, lensT, S, { lod, up: wear === "up", thick: rim[0] > 0.03 });
            out.push(role("lens", { id: `eyewear-lens-${S.tag}`, z: zFront, d: clipY != null ? mk.poly(clipPoly(S.ring.outer, clipY)) : mk.smooth(S.ring.outer, true, 0.5), mat: lay.mat, fill: lay.base, light: false, shade: lay.shade, lit: lay.lit, deep: lay.deep }));
          } else if (lensT.reflection === "glint" && lod !== "lo") {
            const chip = Lens.glintD(S);
            out.push(role("lens", { id: `eyewear-glint-${S.tag}`, z: zFront + 0.05, d: chip, mat: ctx.mat("cloth-white", "flat"), fill: "base", opacity: 0.62, light: false }));
            if (lod === "hi" && clipY == null && o.material === "acetate" && rim[0] >= g.px(3.4)) {
              const c = S.ctr, w = g.px(1.3), fx = 1 - w / c.rx, fy = 1 - w / c.ry;
              const inner = S.ring.inner, shrunk = inner.map(([x, y]) => [c.cx + (x - c.cx) * fx, c.cy + (y - c.cy) * fy]).reverse();
              out.push(role("lens", { id: `eyewear-lensedge-${S.tag}`, z: zFront + 0.02, d: mk.smooth(inner, true, 0.5) + " " + mk.smooth(shrunk, true, 0.5), mat: ctx.mat("cloth-white", "flat"), fill: "base", opacity: 0.17, light: false }));
            }
          }
        }
        const pat = o.pattern ? { type: o.pattern } : null;
        const px1 = g.px(1.05);
        const frameBase = (lum) => o.material === "acetate" ? lum < 0.2 ? 0.26 : 0.8 : 0.75;
        const thickRim = rim[0] >= g.px(3.4) && o.material === "acetate";
        const band = env.band;
        if (band) {
          const br = band.ring;
          const lit = [], shade = [];
          if (lod === "hi" || lod === "mid") {
            const cL = crescent(g, br, band.ctr, -118, 70, 0.34, px1, W);
            if (cL) lit.push({ d: D(cL), o: frameBase(C.lum(frameMat.base)) });
            if (lod === "hi") {
              const cS = crescent(g, br, band.ctr, 52, 70, 0.4, px1, W);
              if (cS) shade.push({ d: D(cS), o: 0.85 });
            }
          }
          const area = (P) => P.reduce((a, p, i) => {
            const q = P[(i + 1) % P.length];
            return a + p[0] * q[1] - q[0] * p[1];
          }, 0);
          const sgn = Math.sign(area(band.pts));
          const holes = sides.map((S) => {
            const h = S.ring.inner.slice();
            if (Math.sign(area(h)) === sgn) h.reverse();
            return mk.smooth(h, true, 0.5);
          }).join(" ");
          out.push(role("frame", { id: "eyewear-frame", z: zFront + 0.1, d: mk.smooth(band.pts, true, 0.5) + " " + holes, mat: frameMat, light: false, lit, shade }));
        } else {
          for (const S of sides) {
            const lit = [], shade = [];
            if (lod === "hi" || lod === "mid" && thickRim) {
              const cL = crescent(g, S.ring, S.ctr, -135, 62, thickRim ? 0.36 : 0.5, px1, W);
              if (cL) lit.push({ d: D(cL), o: frameBase(C.lum(frameMat.base)) });
              if (thickRim && lod === "hi" && clipY == null) {
                const cS = crescent(g, S.ring, S.ctr, 38, 66, 0.4, px1, W);
                if (cS) shade.push({ d: D(cS), o: 0.85 });
              }
            }
            const ringD = clipY != null ? mk.poly(clipPoly(S.ring.outer, clipY)) + " " + mk.poly(clipPoly(S.ring.inner.slice().reverse(), clipY)) : mk.smooth(S.ring.outer, true, 0.5) + " " + mk.smooth(S.ring.inner.slice().reverse(), true, 0.5);
            out.push(role("frame", { id: `eyewear-frame-${S.tag}`, z: zFront + 0.1, d: ringD, mat: frameMat, light: false, lit, shade, ...pat ? { pattern: { type: pat.type }, patternOpacity: 0.92 } : {} }));
          }
        }
        if (!band) for (const b of bridgePieces(env)) out.push(role("frame", b));
        if (lod === "hi" && isMetal && cfg.pads !== false && sides.length === 2 && wear === "on" && !carry) {
          for (const S of sides) {
            const a = (S.s < 0 ? 28 : 152) * DEG, c = S.ctr;
            const bx = c.cx + Math.cos(a) * c.rx * 0.98, by = c.cy + Math.sin(a) * c.ry * 0.98;
            const px = bx - S.s * 0.016, py = by + 0.012;
            out.push(role("frame", { id: `eyewear-pad-${S.tag}`, z: zFront + 0.12, d: D(g.smooth(ellipsePts(px, py, 75e-4, 0.014, S.s * 0.35), true, 0.5)), mat: frameMat, fill: "light", light: false, opacity: 0.85 }));
            out.push(role("frame", { id: `eyewear-padarm-${S.tag}`, z: zFront + 0.11, d: D(g.brush([[bx, by], [lerp(bx, px, 0.55), lerp(by, py, 0.5)], [px, py]], [g.px(1), g.px(1), g.px(0.9)])), mat: frameMat, light: false }));
          }
        }
        if (!cfg.noArms && !band && wear !== "up" && !carry) {
          for (const S of sides) {
            if (S.far && Math.abs(yaw) > 8 * DEG) continue;
            const ya = cy - hh * 0.35, e = U.edgeAt(S.ring.outer, ya);
            const xf = e ? (S.s > 0 ? e.r : e.l) - S.s * S.rimE[1] * 0.3 : S.cP + S.s * (S.hwE + S.rimE[1]);
            const ye = H.earTop + 0.045, xe0 = S.s * H.earX * 0.97, xe = xe0 + yawSlide(ctx, xe0, ye, 0);
            const aw = Math.max(((_a = cfg.arm) != null ? _a : 0.02) * k * Math.max(1, o.rimWeight * 0.5 + 0.5), min);
            const a0 = W([xf, ya]), pts = [a0, [lerp(a0[0], xe, 0.5), lerp(a0[1], ye, 0.45)], [xe, ye]];
            out.push(role("frame", { id: `eyewear-arm-${S.tag}`, z: ctx.Z.eyewear - 0.1, d: D(g.brush(pts, [aw, aw * 0.9, aw * 0.8])), clip: "head", mat: frameMat, light: false }));
          }
        }
        if (carry && carry.extras) out.push(...carry.extras(env));
        if (cfg.extras && !carry) for (const pc of cfg.extras(env) || []) out.push(pc);
        return out;
      }
      function makeBand(env) {
        var _a;
        const { cfg, o, cy, edge, wear, yaw, cosY, ys } = env, bd = cfg.band, cB = ys(0, cy, 0.035);
        const pr = yaw ? -4e-3 : wear === "up" ? 0.06 : (_a = cfg.protrude) != null ? _a : 0.02;
        let left = cB - bd.hw * o.size * cosY, right = cB + bd.hw * o.size * cosY;
        if (edge) {
          left = Math.max(left, edge.l - pr);
          right = Math.min(right, edge.r + pr);
        }
        const bcx = (left + right) / 2, bcy = cy + (bd.dy || 0), bhh = bd.hh * o.size;
        const hwB = (right - left) / 2;
        const pts = lensPts(1, bcx, bcy, hwB, bhh, { n: bd.n, flatTop: bd.flatTop, taper: bd.taper, top: bd.top }).map(([x, y]) => {
          const dx = Math.abs(x - bcx) / hwB;
          if (bd.wing && y < bcy) y -= bd.wing * bhh * Math.pow(dx, 2.2) * (1 - 0.4 * (bcy - y) / bhh);
          if (bd.notch && y > bcy && dx < 0.3) y -= bd.notch * bhh * (1 - Math.pow(dx / 0.3, 2)) * 0.9;
          return [x, y];
        });
        const ring = ringOf(pts, 1, [0, 0, 0], 1, 0);
        ring.thk = ring.thk.map(() => bd.th || 0.045);
        return { pts, ring, ctr: { cx: bcx, cy: bcy, rx: (right - left) / 2, ry: bhh } };
      }
      function ellipsePts(cx, cy, rx, ry, rot) {
        const pts = [], c = Math.cos(rot), s = Math.sin(rot);
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
          pts.push([cx + x * c - y * s, cy + x * s + y * c]);
        }
        return pts;
      }
      function bridgePieces(env) {
        var _a;
        const { sides, cfg, cy, hh, g, mk, zFront, frameMat, lod, k, min, ctx } = env;
        if (sides.length < 2) return [];
        const b = cfg.bridge || { kind: "arch", y: -0.3, w: 0.016 };
        if (b.kind === "none") return [];
        const [R, L] = sides[0].s < 0 ? [sides[0], sides[1]] : [sides[1], sides[0]];
        const out = [];
        const xAt = (S, y, which) => {
          const e = U.edgeAt(S.ring[which], y);
          return e ? S.s < 0 ? e.r : e.l : S.s * 0.02;
        };
        if (b.kind === "solid") {
          const yt = cy + b.y * hh, th = Math.max(b.th * k * env.o.rimWeight, min), thE = Math.max(((_a = b.thEnd) != null ? _a : b.th * 1.35) * k * env.o.rimWeight, th);
          const ym = yt + thE * 0.5;
          const xa = (xAt(R, ym, "inner") + xAt(R, ym, "outer")) / 2, xb = (xAt(L, ym, "inner") + xAt(L, ym, "outer")) / 2;
          const xm = (xa + xb) / 2, half = Math.max((xb - xa) / 2, 0.01);
          const pts = [[xa, yt, true], [lerp(xa, xb, 0.5), yt], [xb, yt, true]];
          const N = 8;
          for (let i = N; i >= 0; i--) {
            const t = i / N, x = lerp(xa, xb, t), q = Math.abs(x - xm) / half;
            pts.push([x, yt + th + (thE - th) * q * q, i === N || i === 0]);
          }
          out.push({ id: "eyewear-bridge", z: zFront + 0.05, d: mk.smooth(pts, true, 0.4), mat: frameMat, light: false });
          return out;
        }
        const bars = b.kind === "double" ? b.bars : [b];
        bars.forEach((bb, i) => {
          var _a2;
          const y = cy + bb.y * hh, w = Math.max(bb.w * k, min * (bb.w > 0.01 ? 1 : 0.8)), a = (_a2 = bb.arc) != null ? _a2 : -8e-3;
          const xa = xAt(R, y, "outer") - 4e-3, xb = xAt(L, y, "outer") + 4e-3, xm = (xa + xb) / 2;
          out.push({ id: `eyewear-bridge-${i}`, z: zFront + 0.05, d: mk.brush([[xa, y], [lerp(xa, xm, 0.6), y + a * 0.8], [xm, y + a], [lerp(xm, xb, 0.4), y + a * 0.8], [xb, y]], [w, w, w, w, w]), mat: frameMat, light: false });
        });
        return out;
      }
      function drawLo(env) {
        const { sides, o, g, mk, zFront, frameMat, role, ctx, lens } = env;
        const out = [];
        const polys = env.band ? [env.band.pts] : sides.map((S) => S.ring.outer);
        const x0 = Math.min(...polys.map((P) => Math.min(...P.map((p) => p[0])))), x1 = Math.max(...polys.map((P) => Math.max(...P.map((p) => p[0]))));
        let yT = Math.min(...polys.map((P) => Math.min(...P.map((p) => p[1])))), yB = Math.max(...polys.map((P) => Math.max(...P.map((p) => p[1]))));
        yT -= g.px(0.9);
        yB += g.px(0.3);
        const xc = (x0 + x1) / 2, yc = (yT + yB) / 2;
        const bar = (cx, cyy, hw, hh2, n) => mk.smooth(lensPts(1, cx, cyy, hw, hh2, { n, N: 28 }), true, 0.5);
        const inset = Math.max(g.px(0.95), 4e-3);
        const lc = Lens.lensColours(ctx, lens, "lo");
        out.push(role("frame", { id: "eyewear-bar-frame", z: zFront + 0.1, d: bar(xc, yc, (x1 - x0) / 2, (yB - yT) / 2, 5), mat: frameMat, light: false }));
        if (env.band) {
          const ins = sides.map((S) => S.ring.inner);
          const lx0 = Math.min(...ins.map((P) => Math.min(...P.map((p) => p[0])))), lx1 = Math.max(...ins.map((P) => Math.max(...P.map((p) => p[0]))));
          const ly0 = Math.min(...ins.map((P) => Math.min(...P.map((p) => p[1])))), ly1 = Math.max(...ins.map((P) => Math.max(...P.map((p) => p[1]))));
          const lh = Math.max(ly1 - ly0, g.px(2.4));
          out.push(role("lens", { id: "eyewear-bar-lens", z: zFront + 0.2, d: bar((lx0 + lx1) / 2, (ly0 + ly1) / 2, (lx1 - lx0) / 2, lh / 2, 4), mat: lc.mat, fill: lc.base, light: false }));
        } else {
          out.push(role("lens", { id: "eyewear-bar-lens", z: zFront + 0.2, d: bar(xc, yc, (x1 - x0) / 2 - inset, (yB - yT) / 2 - inset, 5), mat: lc.mat, fill: lc.base, light: false }));
        }
        return out;
      }
      module.exports = { drawFrames, lensPts, ringOf, crescent, hsArm, yawSlide, resolve, thickAt, ellipsePts, WEARS, MATERIALS };
    }
  });

  // src/parts/eyewear/eyepatch.js
  var require_eyepatch = __commonJS({
    "src/parts/eyewear/eyepatch.js"() {
      "use strict";
      var { register } = require_registry();
      var { hg, lerp, clamp } = require_hg();
      var { lensPts, hsArm, crescent, ringOf } = require_frame();
      var DEG = Math.PI / 180;
      register({
        kind: "eyewear",
        name: "eyepatch",
        describe: 'A solid black eyepatch over one eye with a strap running steeply up across the forehead into the hair (strap "diagonal", the Crews plate) or straight round the head (strap "band"), and a short strap to the ear.',
        params: {
          side: '"R" (the viewer-left eye, default) | "L" (the viewer-right eye, as in the Crews plate)',
          strap: '"diagonal" (default) | "band"',
          frame: "patch and strap colour token (default leather-black)",
          size: "0.85\u20131.2",
          wear: '"on" (the only mode; others warn)'
        },
        example: { face: { eyewear: { type: "eyepatch", side: "L", strap: "diagonal" } } },
        draw(ctx, opts) {
          const { T, C } = ctx;
          const g = hg(ctx);
          const H = ctx.head;
          const lod = ctx.lod;
          if (opts.wear != null && opts.wear !== "on") ctx.warn(`eyepatch wear "${opts.wear}" is not valid (the eyepatch is only worn on); drew it on`);
          let strap = opts.strap == null ? "diagonal" : opts.strap;
          if (strap !== "diagonal" && strap !== "band") {
            ctx.warn(`eyepatch strap "${strap}" is not valid; use "diagonal" or "band"`);
            strap = "diagonal";
          }
          const tag = opts.side === "L" ? "L" : "R", s = tag === "R" ? -1 : 1;
          const col = T.tok(opts.frame) || T.tok("leather-black");
          const mat = ctx.mat(col, "leather");
          const k = clamp(+opts.size || 1, 0.6, 1.6), cx = s * H.eyeX, cy = H.eyeY + 0.01;
          const hw = 0.112 * k, hh = 0.082 * k;
          const px = (n) => g.px(n);
          const sw = Math.max(lod === "lo" ? 0.03 : 0.02 * (lod === "mid" ? 1.1 : 1), px(lod === "lo" ? 2.4 : lod === "mid" ? 1.7 : 1.3));
          const depth = 0.03;
          const tip = -s * 7 * DEG, ct = Math.cos(tip), st = Math.sin(tip);
          const base = lensPts(1, 0, 0, hw, hh, { n: 2.15, taper: 0.1, N: 36 });
          const patch = base.map(([x, y]) => [cx + (x * ct - y * st), cy + (x * st + y * ct)]);
          const out = [];
          {
            const xf = Math.abs(cx) + hw * 0.82, xe = H.earX * 0.97, ye = H.earTop + 0.05;
            const y0 = cy - hh * 0.2;
            out.push({ id: "eyewear-strap-ear", z: ctx.Z.eyewear - 0.1, d: hsArm(ctx, g.brush([[s * xf, y0], [s * lerp(xf, xe, 0.5), lerp(y0, ye, 0.5)], [s * xe, ye]], [sw, sw, sw * 0.9]), xf, xe, 0.035), mat, light: false, clip: "head" });
          }
          const a = [cx - s * hw * 0.62, cy - hh * 0.88];
          let pts;
          if (strap === "diagonal") {
            const ang = 58 * DEG, run = 0.62;
            const b = [a[0] - s * Math.cos(ang) * run * 0.5, a[1] - Math.sin(ang) * run * 0.5];
            const c = [a[0] - s * Math.cos(ang * 0.86) * run, a[1] - Math.sin(ang * 0.86) * run];
            const d = [c[0] - s * 0.1, c[1] - 0.17];
            pts = [a, b, c, d];
          } else {
            const yb = H.brow - 0.045;
            pts = [a, [a[0] - s * 0.1, lerp(a[1], yb, 0.8)], [-s * 0.17, yb - 8e-3], [-s * 0.3, yb - 4e-3], [-s * 0.4, yb + 0.01]];
          }
          const wS = strap === "band" ? sw * 1.25 : sw;
          out.push({ id: "eyewear-strap-head", z: ctx.Z.eyewear - 0.05, d: g.brushD(pts, pts.map(() => wS), void 0, { depth }), mat, light: false, clip: "head" });
          const over = [];
          if (lod === "hi") {
            const rr = ringOf(patch, s, [0.01, 0.01, 0.01], 1, 0);
            const ring = { outer: patch, nrm: rr.nrm, thk: patch.map(() => 0.03) };
            const c = { cx, cy, rx: hw, ry: hh };
            const cr = crescent(g, ring, c, -128, 52, 0.9, px(1.2), (p) => p);
            if (cr) over.push({ d: g.hs(cr, { depth }), fill: "light", o: 0.26 });
          }
          out.push({ id: "eyewear-patch", z: ctx.Z.hair + 0.3, d: g.hs(g.smooth(patch, true, 0.5), { depth }), mat, light: false, over: over.length ? over : void 0 });
          return out;
        }
      });
    }
  });

  // src/parts/eyewear/_extras.js
  var require_extras = __commonJS({
    "src/parts/eyewear/_extras.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { lerp } = require_hg();
      var U = require_util();
      var Lens = require_lens();
      var DEG = Math.PI / 180;
      function ringPt(S, phi, which = "outer") {
        const c = S.ctr;
        let best = null, bd = 1e9;
        for (const p of S.ring[which]) {
          let d = Math.atan2((p[1] - c.cy) / c.ry, (p[0] - c.cx) / c.rx) / DEG - phi;
          d = (d + 540) % 360 - 180;
          if (Math.abs(d) < bd) {
            bd = Math.abs(d);
            best = p;
          }
        }
        return best;
      }
      function cord(env, id, aHead, torso, o = {}) {
        var _a, _b, _c, _d;
        const { ctx, W, lod } = env;
        if (env.tiny && !o.always) return [];
        const A = ctx.hp(W(aHead), { flat: true }), B = ctx.tp(torso), hh = ctx.R.head.k;
        const dir = Math.sign(B[0] - A[0]) || (aHead[0] < 0 ? -1 : 1);
        const C1 = [A[0] + dir * ((_a = o.out) != null ? _a : 0.02) * hh, A[1] + ((_b = o.drop) != null ? _b : 0.5) * hh];
        const C2 = [B[0] - dir * ((_c = o.land) != null ? _c : 0) * hh, B[1] - 0.5 * hh];
        const pts = [];
        for (let i = 0; i <= 14; i++) {
          const t = i / 14, u = 1 - t;
          pts.push([u * u * u * A[0] + 3 * u * u * t * C1[0] + 3 * u * t * t * C2[0] + t * t * t * B[0], u * u * u * A[1] + 3 * u * u * t * C1[1] + 3 * u * t * t * C2[1] + t * t * t * B[1]]);
        }
        const w = Math.max(((_d = o.w) != null ? _d : 7e-3) * hh, ctx.px(lod === "mid" ? 1.5 : 1.15));
        return [{ id, z: ctx.Z.eyewear + 0.1, d: G.brush(pts, w), mat: o.mat || env.frameMat, light: false }];
      }
      function ribbon(env) {
        const { ctx, opts, sides, o } = env;
        if (!opts.ribbon) return [];
        const S = sides.find((q) => q.s < 0) || sides[0];
        const a = ringPt(S, S.s < 0 ? 150 : 30);
        return cord(env, "eyewear-ribbon", a, [S.s * 0.5, 0.1], { w: 0.016, mat: ctx.mat(ctx.T.tok("cloth-black"), "satin"), out: 0.06 });
      }
      function monocleCord(env) {
        const { ctx, opts, sides } = env;
        const where = opts.cord === void 0 ? "lapel" : opts.cord;
        if (!where) return [];
        if (where !== "lapel" && where !== "pocket") {
          ctx.warn(`eyewear monocle cord "${where}" is not valid; use "lapel", "pocket" or false`);
          return [];
        }
        const S = sides[0], a = ringPt(S, S.s < 0 ? 135 : 45);
        return cord(env, "eyewear-cord", a, where === "pocket" ? [S.s * -0.5, 0.22] : [S.s * 0.5, 0.1], { w: 75e-4, mat: ctx.mat(ctx.T.tok("cloth-black"), "satin"), out: 0.03 });
      }
      function gogglesStrap(env) {
        const { ctx, g, mk, sides, edge, lod, k, min, cy, hasHat, frameMat, role, wear } = env;
        const out = [];
        const w = Math.max(0.05 * k, min * 1.4);
        for (const S of sides) {
          const xo = S.cP + S.s * (S.hwE + S.rimE[1] * 0.6);
          const lim = edge ? S.s > 0 ? edge.r : edge.l : S.s * 0.34;
          const xe = lim + S.s * (hasHat ? 0.045 : 0.03);
          const ya = cy, yb = cy + 0.012;
          const d = mk.brush([[xo, ya], [lerp(xo, xe, 0.5), lerp(ya, yb, 0.5)], [xe, yb]], [w, w, w * 0.96]);
          out.push(role("frame", { id: `eyewear-strap-${S.tag}`, z: env.zFront - 0.12, d, mat: frameMat, light: false, ...hasHat && wear === "up" ? {} : { clip: "head" } }));
        }
        return out;
      }
      function clipOn(env) {
        const { ctx, opts, g, mk, sides, zFront, lod, cy, hh, topF, rim, min, k } = env;
        const { C, T } = ctx;
        let flip = opts.flip == null ? "down" : opts.flip;
        if (flip !== "up" && flip !== "down") {
          ctx.warn(`eyewear flip "${flip}" is not valid; use "up" or "down"`);
          flip = "down";
        }
        if (lod === "lo" && flip === "down") return [];
        const L = Lens.parseLens(ctx, { lens: "dark", reflection: flip === "up" ? "glint" : "soft" }, {});
        const metal = ctx.mat(T.tok("metal-chrome") || T.tok("metal-steel"), "metal");
        const out = [];
        const yTop = cy - hh * topF - rim[0];
        const kY = 0.5;
        const place = (S, u, v) => {
          const x = S.cP + u * S.hwE * 0.96, y = cy + v * hh * 0.94;
          return flip === "down" ? [x, y] : [x, yTop - 0.012 - (hh * 0.94 - v * hh * 0.94) * kY];
        };
        const mkS = (S) => ({ ...S, pt: (u, v) => place(S, u, v), poly: (uv) => mk.poly(uv.map(([u, v]) => place(S, u, v))), brush: (uv, w) => mk.brush(uv.map(([u, v]) => place(S, u, v)), w.map((q) => q * (flip === "up" ? kY : 1))), smooth: (uv) => mk.smooth(uv.map(([u, v]) => place(S, u, v))) });
        const shape = (S, sc) => {
          const pts = [];
          for (let i = 0; i < 32; i++) {
            const a = i / 32 * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a), e = 3.2;
            pts.push(place(S, sc * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), sc * Math.sign(s2) * Math.pow(Math.abs(s2), 2 / e)));
          }
          return pts;
        };
        const rimW = Math.max(7e-3 * k, min * 0.8);
        for (const S of sides) {
          const S2 = mkS(S);
          const lay = Lens.opaqueLayers(ctx, L, S2, { lod, up: false, thick: false });
          const lensD = mk.smooth(shape(S, 1), true, 0.5);
          out.push(env.role("lens", { id: `eyewear-clip-${S.tag}`, z: zFront + 0.2, d: lensD, mat: lay.mat, fill: lay.base, light: false, shade: lay.shade, lit: lay.lit, deep: lay.deep }));
          const outer = shape(S, 1 + rimW / (S.hwE * 0.96) * 1.1), inner = shape(S, 1).slice().reverse();
          out.push(env.role("frame", { id: `eyewear-clip-rim-${S.tag}`, z: zFront + 0.22, d: mk.smooth(outer, true, 0.5) + " " + mk.smooth(inner, true, 0.5), mat: metal, light: false }));
        }
        if (sides.length === 2) {
          const [a, b] = sides[0].s < 0 ? [sides[0], sides[1]] : [sides[1], sides[0]];
          const p0 = place(a, 1, -0.55), p1 = place(b, -1, -0.55);
          const bw = Math.max(9e-3 * k, min * 0.9);
          out.push(env.role("frame", { id: "eyewear-clip-bar", z: zFront + 0.23, d: mk.brush([p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 6e-3], p1], [bw, bw, bw]), mat: metal, light: false }));
        }
        return out;
      }
      module.exports = { ringPt, cord, ribbon, monocleCord, gogglesStrap, clipOn };
    }
  });

  // src/parts/eyewear/frames.js
  var require_frames = __commonJS({
    "src/parts/eyewear/frames.js"() {
      "use strict";
      var { register } = require_registry();
      var { drawFrames } = require_frame();
      var X = require_extras();
      var LENS_DOC = '"clear" (no fill: the eye shows unchanged) | "dark" | "mirror" | a colour token (opaque) | { type: "gradient", color: <band colour>, color2: <lens body> } | { type: "mirror", scene: "sky"|"city"|"window", color, color2 }';
      var PARAMS = {
        frame: "frame colour token",
        lens: LENS_DOC,
        reflection: '"soft" (dark) | "wide" (colour, gradient) | "bands" (the v2 look) | "glint" (clear, mirror) | "none"; default follows the lens',
        spot: 'true (frame and lens) | "lens" | "frame": keeps that colour in crews, hound, shadows and paranormal',
        wear: '"on" (default) | "low" (down the nose) | "up" (pushed into the hair; bare head only, worn on under a hat) | "hand" (folded, in a holding hand: needs pose.arms.R or .L "hold") | "pocket" (hooked in the breast pocket or on the neckline) | "chain" (readers hanging mid-chest); goggles, monocle and the shield-type band cannot be carried',
        at: '"breast" (default) | "neckline": where wear "pocket" puts the folded pair',
        side: '"L" (default) | "R": the breast pocket for wear "pocket"',
        hand: '"R" | "L": the holding hand for wear "hand" (default: the arm posed "hold")',
        chain: 'chain colour token for wear "chain" (default metal-brass)',
        material: '"acetate" | "metal" | "wire" (default set by the type)',
        pattern: `"tortoise" (acetate frames only): the mottled amber of horn-rims; "none" turns a type's default pattern off`,
        size: "0.85\u20131.2",
        rimWeight: "0.7\u20131.6",
        seat: "\u22120.03\u20260.03 head units (+ lower)",
        lensOpacity: "RETIRED (v3): \u2265 0.6 upgrades to an opaque lens, < 0.6 to clear, with a warning"
      };
      var V = [
        {
          name: "shades",
          d: "Dark wayfarer sunglasses: a heavy top rim on the brow line, opaque dark lenses with one soft low reflection (the fence, the militant).",
          ex: { type: "shades" },
          cfg: {
            hw: 0.138,
            hh: 0.074,
            n: 3,
            taper: 0.2,
            flatTop: 0.7,
            rim: [0.044, 0.03, 0.026],
            seat: "brow",
            dx: 0.02,
            material: "acetate",
            frame: "cloth-black",
            lens: "dark",
            v2Lens: "glass-dark",
            arm: 0.026,
            lug: 0.35,
            bridge: { kind: "solid", y: -0.92, th: 0.034, thEnd: 0.05 }
          }
        },
        {
          name: "mod-oval",
          d: "Big oval 60s sunglasses in thick coloured acetate with opaque dark lenses and one soft warm reflection, wider than the face: the Swinger's pink shades.",
          ex: { type: "mod-oval", frame: "cloth-magenta", lens: "dark", reflection: "soft" },
          cfg: {
            hw: 0.148,
            hh: 0.098,
            n: 2.2,
            rim: [0.052, 0.044, 0.036],
            rimIn: 1,
            seat: "brow",
            dx: 0.042,
            protrude: 0.065,
            material: "acetate",
            frame: "cloth-magenta",
            lens: "dark",
            v2Lens: "cloth-pink",
            arm: 0.022,
            bridge: { kind: "solid", y: -0.62, th: 0.05, thEnd: 0.07 }
          }
        },
        {
          name: "aviators",
          d: "Teardrop aviators in thin metal with a double bridge, nose pads and an opaque graded lens.",
          ex: { type: "aviators", frame: "metal-brass", lens: { type: "gradient", color: "cloth-mustard", color2: "cloth-brown" }, reflection: "soft" },
          cfg: {
            hw: 0.138,
            hh: 0.1,
            n: 2.5,
            taper: 0.28,
            drop: 0.12,
            dy: 0.012,
            dx: 0.015,
            reflection: "soft",
            rim: [0.01, 0.01, 0.01],
            seat: "eye",
            material: "metal",
            frame: "metal-brass",
            lens: { type: "gradient", color: "cloth-mustard", color2: "cloth-brown" },
            v2Lens: "cloth-ochre",
            arm: 0.011,
            bridge: { kind: "double", bars: [{ y: -0.78, w: 0.011, arc: -2e-3 }, { y: -0.2, w: 0.011, arc: -0.012 }] }
          }
        },
        {
          name: "browline",
          d: "60s clerk frames: a thick brow bar over a thin lens rim, clear lenses.",
          ex: { type: "browline" },
          cfg: {
            hw: 0.128,
            hh: 0.075,
            n: 3.4,
            flatTop: 0.4,
            rim: [0.046, 0.012, 6e-3],
            seat: "under",
            material: "acetate",
            frame: "cloth-black",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 0.018,
            bridge: { kind: "arch", y: -0.6, w: 0.018, arc: -0.01 }
          }
        },
        {
          name: "cat-eye",
          d: 'Swept-up cat-eye frames, outer corners lifted: 60s glamour. Clear lenses by default; lens: "dark" makes sunglasses.',
          ex: { type: "cat-eye", frame: "cloth-red" },
          cfg: {
            hw: 0.132,
            hh: 0.082,
            n: 2.5,
            sweep: 1.15,
            taper: 0.1,
            rim: [0.032, 0.024, 0.02],
            seat: "under",
            material: "acetate",
            frame: "cloth-red",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 0.018,
            lug: 0.5,
            bridge: { kind: "solid", y: -0.55, th: 0.024, thEnd: 0.034 }
          }
        },
        {
          name: "round-wire",
          d: "Thin round wire spectacles with a clear lens: scholar, hippie, clerk (the Crews man in glasses).",
          ex: { type: "round-wire", frame: "cloth-black" },
          cfg: {
            hw: 0.1,
            hh: 0.1,
            n: 2,
            dy: 4e-3,
            rim: [0.0105, 0.0105, 0.0105],
            seat: "eye",
            material: "wire",
            frame: "metal-steel",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 95e-4,
            bridge: { kind: "arch", y: -0.3, w: 95e-4, arc: -0.016 }
          }
        },
        {
          name: "square-thick",
          d: "Thick square black frames, clear lens: the nerd, the engineer.",
          ex: { type: "square-thick" },
          cfg: {
            hw: 0.122,
            hh: 0.088,
            n: 4.6,
            rim: [0.032, 0.03, 0.028],
            seat: "under",
            material: "acetate",
            frame: "cloth-black",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 0.024,
            lug: 0.3,
            bridge: { kind: "solid", y: -0.6, th: 0.026, thEnd: 0.036 }
          }
        },
        {
          name: "oversized-square",
          d: "Thick black oversized square frames, opaque graded lenses crossed by wide light bands: the Intellectual playbook, the cover officer.",
          ex: { type: "oversized-square", frame: "cloth-black", lens: { type: "gradient", color: "cloth-mustard", color2: "cloth-orange" }, reflection: "wide" },
          cfg: {
            hw: 0.145,
            hh: 0.1,
            n: 4,
            taper: 0.1,
            rim: [0.05, 0.034, 0.03],
            rimIn: 1.1,
            seat: "brow",
            dx: 0.03,
            material: "acetate",
            frame: "cloth-black",
            lens: { type: "gradient", color: "cloth-mustard", color2: "cloth-orange" },
            arm: 0.032,
            lug: 0.6,
            bridge: { kind: "solid", y: -0.92, th: 0.04, thEnd: 0.058 }
          }
        },
        {
          name: "big-round",
          d: "Big round frames covering eye to cheek: white frames with dark lenses (the park bench), or big yellow or mirror lenses (the cover).",
          ex: { type: "big-round", frame: "cloth-white", lens: "dark" },
          cfg: {
            hw: 0.125,
            hh: 0.125,
            n: 2,
            rim: [0.02, 0.02, 0.02],
            seat: "brow",
            dx: 0.015,
            material: "acetate",
            frame: "cloth-white",
            lens: "dark",
            v2Lens: "glass-dark",
            arm: 0.02,
            bridge: { kind: "arch", y: -0.35, w: 0.02, arc: -0.012 }
          }
        },
        {
          name: "shield",
          d: `Courr\xE8ges shield: one band across both eyes, its outer ends swept up, with a bigger lens opening for each (the Crews plate's walking woman: white band, red lens). With spot: "lens" the lens keeps its colour in a spot-colour scheme.`,
          ex: { type: "shield", frame: "cloth-white", lens: "cloth-red", spot: "lens" },
          cfg: {
            hw: 0.092,
            hh: 0.056,
            n: 2.1,
            rim: [0.01, 0.01, 0.01],
            seat: "eye",
            dy: 0,
            dx: 0,
            material: "acetate",
            frame: "cloth-white",
            lens: "dark",
            v2Lens: "glass-dark",
            noArms: true,
            band: { hw: 0.275, hh: 0.082, n: 3, taper: 0.1, flatTop: 0.4, th: 0.05, wing: 0.55, notch: 0.5 }
          }
        },
        {
          name: "half-moon",
          d: "Half-moon reading glasses: flat-topped lenses in thin metal. Worn low on the nose by default, so the eyes look out over the top rim.",
          ex: { type: "half-moon", frame: "metal-brass" },
          cfg: {
            hw: 0.098,
            hh: 0.078,
            n: 2.2,
            top: 0.2,
            taper: 0.08,
            rim: [0.011, 0.011, 0.011],
            seat: "under",
            wear: "low",
            material: "metal",
            frame: "metal-steel",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 0.01,
            bridge: { kind: "arch", y: -0.1, w: 0.011, arc: -0.012 }
          }
        },
        {
          name: "pince-nez",
          d: "Pince-nez: two small round lenses clipped to the nose on a thin spring, no arms. ribbon: true adds a black ribbon from the right lens to the lapel.",
          ex: { type: "pince-nez", ribbon: true },
          params: { ribbon: "true: a black ribbon from the right lens down to the lapel" },
          cfg: {
            hw: 0.078,
            hh: 0.07,
            n: 2,
            dy: 0.012,
            rim: [85e-4, 85e-4, 85e-4],
            seat: "eye",
            material: "wire",
            frame: "metal-gun",
            lens: "clear",
            v2Lens: "cloth-sky",
            noArms: true,
            bridge: { kind: "arch", y: -0.45, w: 85e-4, arc: -0.034 },
            extras: X.ribbon
          }
        },
        {
          name: "monocle",
          d: 'A single round monocle in a thin brass rim on a black cord to the lapel. side "R" (default) is the viewer-left eye.',
          ex: { type: "monocle" },
          params: { side: '"R" (viewer-left, default) | "L"', cord: '"lapel" (default) | "pocket" | false' },
          cfg: { single: true, hw: 0.094, hh: 0.094, n: 2, rim: [0.0125, 0.0125, 0.0125], seat: "eye", material: "metal", frame: "metal-brass", lens: "clear", v2Lens: "cloth-sky", noArms: true, bridge: { kind: "none" }, extras: X.monocleCord }
        },
        {
          name: "goggles",
          d: 'Driving or flying goggles: two round leather cups with a nose piece and a strap round the head. wear: "up" pushes them onto the forehead, or onto the cap when the head wears one.',
          ex: { type: "goggles", frame: "leather-brown", lens: "cloth-mustard", wear: "up" },
          cfg: {
            hw: 0.118,
            hh: 0.108,
            n: 2,
            rim: [0.032, 0.032, 0.032],
            rimIn: 0.9,
            seat: "eye",
            material: "acetate",
            frameKind: "leather",
            frame: "leather-brown",
            lens: "clear",
            v2Lens: "glass-dark",
            noArms: true,
            overHat: true,
            bridge: { kind: "solid", y: -0.2, th: 0.05, thEnd: 0.06 },
            extras: X.gogglesStrap
          }
        },
        {
          name: "horn-rim",
          d: 'Heavy horn-rims: a thick top rim, thinner below and a keyhole nose piece. The default pattern is tortoiseshell; pattern: "none" gives plain acetate.',
          ex: { type: "horn-rim", frame: "cloth-tan", pattern: "tortoise" },
          cfg: {
            hw: 0.124,
            hh: 0.08,
            n: 2.8,
            taper: 0.12,
            rim: [0.046, 0.028, 0.022],
            rimIn: 1.05,
            seat: "under",
            material: "acetate",
            frame: "cloth-tan",
            pattern: "tortoise",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 0.026,
            lug: 0.5,
            bridge: { kind: "solid", y: -0.62, th: 0.03, thEnd: 0.044 }
          }
        },
        {
          name: "clip-on",
          d: 'Clear metal specs with dark clip-on lenses. flip "down" (default) covers the lenses; flip "up" lifts them above the top rim, foreshortened.',
          ex: { type: "clip-on", frame: "metal-gun", flip: "down" },
          params: { flip: '"down" (default) | "up"' },
          cfg: {
            hw: 0.118,
            hh: 0.086,
            n: 3.2,
            rim: [0.012, 0.011, 0.011],
            seat: "eye",
            dy: -4e-3,
            material: "metal",
            frame: "metal-gun",
            lens: "clear",
            v2Lens: "cloth-sky",
            arm: 0.011,
            clip: true,
            bridge: { kind: "arch", y: -0.55, w: 0.011, arc: -0.012 },
            extras: X.clipOn
          }
        }
      ];
      for (const v of V) {
        v.cfg.name = v.name;
        register({ kind: "eyewear", name: v.name, describe: v.d, params: { ...PARAMS, ...v.params || {} }, example: { face: { eyewear: v.ex } }, draw: (ctx, opts) => drawFrames(ctx, opts, v.cfg) });
      }
    }
  });

  // src/parts/facial-hair/_hair.js
  var require_hair = __commonJS({
    "src/parts/facial-hair/_hair.js"(exports, module) {
      "use strict";
      var U = require_util();
      function zones(ctx) {
        const H = ctx.head, mb = U.mouthBox(ctx, ctx.S.face), poly = U.outlinePoly(ctx);
        const edge = (y) => U.edgeAt(poly, y) || { l: -H.w * 0.8, r: H.w * 0.8 };
        const bold = U.bold(ctx), px = (n) => U.hpx(ctx, n);
        return { H, mb, poly, edge, ny: H.noseY, bold, px, under: (x) => {
          var _a;
          return (_a = U.underAt(poly, x)) != null ? _a : 0.5;
        } };
      }
      var K = (ctx, pts) => pts.map((p) => {
        var _a;
        const q = ctx.hp([p[0], p[1]], { depth: (_a = p[3]) != null ? _a : 0.03 });
        return p[2] ? [q[0], q[1], true] : q;
      });
      var path = (ctx, pts, t = 0.45) => ctx.G.smooth(K(ctx, pts), true, t);
      var area = (pts) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          a += p[0] * q[1] - q[0] * p[1];
        }
        return a;
      };
      var ring = (ctx, outer, inner, t = 0.45) => {
        const o = K(ctx, outer);
        let i = K(ctx, inner);
        if (Math.sign(area(i)) === Math.sign(area(o))) i = i.reverse();
        return ctx.G.smooth(o, true, t) + " " + ctx.G.smooth(i, true, t);
      };
      var mirror = (right) => right.map(([x, y, s, d]) => [-x, y, s, d]);
      function moustache(ctx, z, style = "chevron", k = 1) {
        const { mb, ny } = z;
        const mw = mb.mw;
        const pencil = style === "pencil";
        const wM = mw * (pencil ? 1 : 1.12) + 0.012 * k;
        const t0 = pencil ? mb.yTop - 0.026 : ny + 0.036, yl = mb.yl, yr = mb.yr;
        const topR = (yc) => pencil ? [[0, t0 + 3e-3], [wM * 0.45, t0], [wM * 0.85, t0 + 4e-3], [wM, yc - 0.012, true]] : [[0, t0 + 4e-3], [wM * 0.4, t0 - 4e-3], [wM * 0.82, t0 + 0.016], [wM, yc + 4e-3, true]];
        const top = [...mirror(topR(yl).slice(1)).reverse(), topR(yr)[0], ...topR(yr).slice(1)];
        const bt = (yc) => pencil ? yc - 0.012 : yc + 6e-3;
        const botR = (yc) => pencil ? [[0, mb.yTop - 0.012], [wM * 0.45, mb.yTop - 0.012], [wM * 0.85, mb.yTop - 7e-3], [wM * 0.97, bt(yc) + 4e-3, true]] : [[0, mb.y - 6e-3], [0.014, mb.y - 9e-3], [mw * 0.5, mb.y - 0.012], [mw * 0.92, yc - 4e-3], [wM * 0.96, yc + 8e-3, true]];
        const bot = [...mirror(botR(yl).slice(1)).reverse(), botR(yr)[0], ...botR(yr).slice(1)];
        return { top, bot, wM };
      }
      function flecks(ctx, region, n, colour, o = {}) {
        const k = ctx.R.head.k;
        let d = "", got = 0, tries = 0;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of region) {
          x0 = Math.min(x0, p[0]);
          x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1]);
          y1 = Math.max(y1, p[1]);
        }
        const r0 = Math.max(o.r || 22e-4, U.hpx(ctx, ctx.lod === "mid" ? 0.8 : 0.5));
        while (got < n && tries++ < n * 14) {
          const x = x0 + ctx.rng() * (x1 - x0), y = y0 + ctx.rng() * (y1 - y0);
          if (!U.inside(region, x, y)) continue;
          const a = ctx.hp([x, y], { depth: 0.03 }), b = ctx.hp([x + (ctx.rng() - 0.5) * 4e-3, y + 6e-3 + ctx.rng() * 4e-3], { depth: 0.03 });
          const r = r0 * (0.8 + ctx.rng() * 0.6) * k;
          d += `M${(a[0] - r).toFixed(2)} ${a[1].toFixed(2)} L${b[0].toFixed(2)} ${b[1].toFixed(2)} L${(a[0] + r).toFixed(2)} ${a[1].toFixed(2)} Z`;
          got++;
        }
        return d;
      }
      function holed(ctx, ids, outer, inner, t = 0.45) {
        ctx.cut(`^(${ids.join("|")})$`, ctx.G.smooth(K(ctx, inner), true, t));
        return ctx.G.smooth(K(ctx, outer), true, t);
      }
      function massPiece(ctx, opts, d, o = {}) {
        var _a;
        const mat = ctx.hairMat(opts.color);
        const over = [];
        if (opts.grey && o.region) {
          const g = ctx.T.tok(opts.grey) || ctx.tok("cloth-ash");
          const regions = Array.isArray(o.region[0][0]) ? o.region : [o.region];
          const n = Math.round(((_a = o.flecks) != null ? _a : 46) * (ctx.lod === "hi" ? 1 : 0.6) / regions.length);
          const fl = regions.map((r) => flecks(ctx, r, n, g)).join("");
          if (fl) over.push({ d: fl, fill: g, o: 0.92 });
        }
        return { id: o.id || "facial-hair", z: ctx.Z.facialHair, d, mat, lit: o.lit || [], lines: o.lines || [], over, light: { form: 1, sheenO: 0.38, ...o.light || {} } };
      }
      module.exports = { U, zones, K, path, ring, holed, mirror, moustache, flecks, massPiece };
    }
  });

  // src/parts/facial-hair/beards.js
  var require_beards = __commonJS({
    "src/parts/facial-hair/beards.js"() {
      "use strict";
      var { register } = require_registry();
      var Hh = require_hair();
      var { U } = Hh;
      var params = { color: "hair colour token (defaults to the head hair)", grey: "token for grey flecks (e.g. cloth-ash)" };
      var brushLines = (ctx, list, fill = "shade", o = 0.55) => ctx.lodAtLeast("hi") ? list.map(([pts, w]) => ({ d: ctx.hs(ctx.G.brush(pts, [1e-3, w, 1e-3]), { depth: 0.03 }), fill, o })) : [];
      function window_(z, M, bot, wide = 1.04) {
        const { mb } = z;
        const mw = mb.mw;
        return [...M.bot, [mw * wide, mb.yr + 0.014], [mw * wide * 0.9, bot], [0, bot + 4e-3], [-mw * wide * 0.9, bot], [-mw * wide, mb.yl + 0.014]];
      }
      register({
        kind: "facialHair",
        name: "moustache",
        params,
        example: { face: { facialHair: { type: "moustache", color: "cloth-chocolate" } } },
        describe: "Chevron moustache: a solid wedge from under the nose to the mouth line with the ends drooping past the corners. The lips stay clear.",
        draw(ctx, opts) {
          const z = Hh.zones(ctx), M = Hh.moustache(ctx, z, "chevron");
          const outline = [...M.top, ...M.bot.slice().reverse()];
          const lines = brushLines(ctx, [[[[-0.05, z.ny + 0.03], [-0.07, z.mb.y - 0.02]], 5e-3], [[[0.04, z.ny + 0.03], [0.06, z.mb.y - 0.02]], 5e-3]]);
          return [Hh.massPiece(ctx, opts, Hh.path(ctx, outline, 0.4), { id: "facial-hair", region: outline, flecks: 32, lines, lit: [{ d: Hh.path(ctx, [[-M.wM * 0.8, z.ny + 0.04], [-M.wM * 0.2, z.ny + 0.036], [-M.wM * 0.25, z.ny + 0.05], [-M.wM * 0.7, z.mb.yl - 4e-3]], 0.5), o: 0.5 }] })];
        }
      });
      register({
        kind: "facialHair",
        name: "pencil",
        params,
        example: { face: { facialHair: { type: "pencil", color: "cloth-black" } } },
        describe: "Pencil moustache: a thin 60s strip along the top of the lip. Fence, crooner, cad.",
        draw(ctx, opts) {
          const z = Hh.zones(ctx), M = Hh.moustache(ctx, z, "pencil");
          const outline = [...M.top, ...M.bot.slice().reverse()];
          return [Hh.massPiece(ctx, opts, Hh.path(ctx, outline, 0.3), { id: "facial-hair", region: outline, flecks: 16, light: { form: 0.7 } })];
        }
      });
      register({
        kind: "facialHair",
        name: "goatee",
        params,
        example: { face: { facialHair: { type: "goatee", color: "cloth-black", grey: "cloth-ash" } } },
        describe: "Goatee: a moustache joined to a chin patch by thin strips round the mouth, with optional grey flecks. Booker.",
        draw(ctx, opts) {
          const z = Hh.zones(ctx), { mb } = z, mw = mb.mw;
          const M = Hh.moustache(ctx, z, "chevron");
          const conn = Math.max(0.015, z.px(2.1)), top = mb.yBot - 4e-3;
          const side = (s) => [[s * (mw * 1.04 + conn + 8e-3), mb.y + 0.03], [s * (mw * 0.95 + conn), top], [s * 0.085, 0.43], [s * 0.058, z.under(s * 0.058) - 8e-3, false, 0], [s * 0.025, z.under(s * 0.025) + 4e-3, false, 0]];
          const R = side(1), Lp = side(-1);
          const outer = [...M.top, ...R, [0, z.under(0) + 0.012, false, 0], ...Lp.slice().reverse()];
          const hole = window_(z, M, top, 1.04);
          const region = [[-0.07, top], [0.07, top], [0.06, 0.47], [-0.06, 0.47]];
          const lines = brushLines(ctx, [[[[-0.02, top + 0.02], [-0.03, 0.45]], 6e-3], [[[0.03, top + 0.02], [0.035, 0.45]], 6e-3], [[[0, top + 0.03], [0, 0.47]], 5e-3]]);
          return [Hh.massPiece(ctx, opts, Hh.holed(ctx, ["facial-hair"], outer, hole, 0.4), { id: "facial-hair", region, flecks: 55, lines })];
        }
      });
      function beard(ctx, opts, k) {
        const z = Hh.zones(ctx), { mb, ny, H } = z, mw = mb.mw;
        const M = Hh.moustache(ctx, z, "chevron", 1);
        const yS = k.start;
        const jaw = U.jawLine(z.poly, yS);
        const out = jaw.map((p) => {
          const dx = p[0], dy = (p[1] - 0.14) * 0.85, l = Math.hypot(dx, dy) || 1;
          const under = Math.max(0, Math.min(1, (p[1] - 0.3) / 0.2));
          const amt = k.side + k.under * under;
          return [p[0] + dx / l * amt, p[1] + dy / l * amt, false, 0];
        });
        const eR = (y) => z.edge(y).r;
        const cheekR = [[eR(yS) - 0.01, yS, false, 0.01], [eR(yS + 0.07) - k.inset, yS + 0.07], [0.215, k.cy], [0.15, k.cy + 0.034], [0.09, ny + 0.022]];
        const mid = M.top.filter((p) => Math.abs(p[0]) < 0.07);
        const outer = [...out, ...cheekR, ...mid.slice().reverse(), ...Hh.mirror(cheekR).reverse()];
        const patchTop = mb.yBot + k.gap;
        const hole = window_(z, M, patchTop, k.wide);
        const region = [[-0.09, patchTop], [0.09, patchTop], [0.08, 0.5], [-0.08, 0.5]];
        const lines = brushLines(ctx, [[[[-0.06, 0.36], [-0.09, 0.47]], 7e-3], [[[0.07, 0.36], [0.09, 0.47]], 7e-3], [[[0, 0.4], [0, 0.5]], 6e-3], [[[-0.16, 0.2], [-0.2, 0.3]], 6e-3], [[[0.17, 0.2], [0.21, 0.3]], 6e-3]]);
        const fadeR = [[eR(yS) - 0.01, yS - 0.03, false, 0.01], [eR(yS + 0.07) - k.inset - 0.01, yS + 0.04], [0.215, k.cy - 0.04], [0.15, k.cy - 0.012], [0.09, ny + 0.012]];
        const fadeOuter = [...out, ...fadeR, ...mid.slice().reverse().map(([x, y, s, d]) => [x, y - 0.01, s, d]), ...Hh.mirror(fadeR).reverse()];
        const col = ctx.C.mix(ctx.hairMat(opts.color).deep, ctx.skin.deep, 0.25);
        const fadeD = Hh.path(ctx, fadeOuter, 0.45);
        const fade = { id: "facial-hair-fade", z: ctx.Z.facialHair - 0.02, clip: "head", d: fadeD, mat: ctx.hairMat(opts.color), fill: "none", light: false, lines: [{ d: fadeD, fill: U.hexA(col, 0.4), stip: true }] };
        return [fade, Hh.massPiece(ctx, opts, Hh.holed(ctx, ["facial-hair", "facial-hair-fade"], outer, hole, 0.45), { id: "facial-hair", region, flecks: k.flecks, lines })];
      }
      register({
        kind: "facialHair",
        name: "beard-short",
        params,
        example: { face: { facialHair: { type: "beard-short", color: "cloth-brown" } } },
        describe: "Close-cropped beard: a tight band along the jaw and chin joined to a moustache, a window round the lips.",
        draw: (ctx, opts) => beard(ctx, opts, { start: 0.1, side: 6e-3, under: 0.014, inset: 0.05, cy: 0.215, gap: 0, wide: 1.1, flecks: 30 })
      });
      register({
        kind: "facialHair",
        name: "beard-full",
        params,
        example: { face: { facialHair: { type: "beard-full", color: "cloth-chocolate" } } },
        describe: "Full beard from the sideburns round the jaw and under the chin, joined to a moustache: the intellectual.",
        draw: (ctx, opts) => beard(ctx, opts, { start: 0.05, side: 0.014, under: 0.05, inset: 0.085, cy: 0.2, gap: -2e-3, wide: 1.1, flecks: 50 })
      });
      register({
        kind: "facialHair",
        name: "chops",
        params,
        example: { face: { facialHair: { type: "chops", color: "cloth-brown" } } },
        describe: "Mutton chops: heavy sideburns flaring down the cheeks to the jaw, clean chin and lip.",
        draw(ctx, opts) {
          const z = Hh.zones(ctx);
          const parts = [], regions = [];
          const ys = [-0.04, 0.05, 0.13, 0.21, 0.28, 0.33];
          for (const s of [-1, 1]) {
            const e = (y) => {
              const o = z.edge(y);
              return s < 0 ? -o.l : o.r;
            };
            const outer = ys.map((y) => [s * (e(y) + 0.012), y, false, 0]);
            const inner = [[s * (e(0.33) - 0.115), 0.34, false, 0.02], [s * (e(0.25) - 0.085), 0.25], [s * (e(0.13) - 0.062), 0.13], [s * (e(0.04) - 0.04), 0.04], [s * (e(-0.04) - 0.03), -0.04, false, 0]];
            const pts = [...outer, ...inner];
            parts.push(Hh.path(ctx, pts, 0.45));
            regions.push(pts);
          }
          return [Hh.massPiece(ctx, opts, parts.join(" "), { id: "facial-hair", region: regions, flecks: 40 })];
        }
      });
    }
  });

  // src/parts/facial-hair/stubble.js
  var require_stubble = __commonJS({
    "src/parts/facial-hair/stubble.js"() {
      "use strict";
      var { register } = require_registry();
      var Hh = require_hair();
      var { U } = Hh;
      var params = { color: "hair colour token (defaults to the head hair)" };
      var diamond = (x, y, r) => {
        const f = (n) => Math.round(n * 10) / 10;
        return `M${f(x - r)} ${f(y)}L${f(x)} ${f(y - r)}L${f(x + r)} ${f(y)}L${f(x)} ${f(y + r)}Z`;
      };
      var r1 = (d) => d.replace(/-?\d+\.\d+/g, (m) => String(Math.round(parseFloat(m) * 10) / 10));
      var smooth = (a, b, x) => {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      function stubble(ctx, opts, k) {
        const z = Hh.zones(ctx), { mb, ny } = z, { C, skin } = ctx;
        const hm = ctx.hairMat(opts.color);
        const tint = C.mix(skin.shade, hm.base, 0.5);
        const dotC = C.mix(skin.deep, hm.deep, 0.55);
        const inward = (pts, amt) => pts.map((p) => {
          const dx = p[0], dy = (p[1] - 0.14) * 0.85, l = Math.hypot(dx, dy) || 1;
          return [p[0] - dx / l * amt, p[1] - dy / l * amt, false, 0];
        });
        const eR = (y) => z.edge(y).r;
        const lipTop = mb.yTop - 4e-3, mw = mb.mw;
        const hole = [[-mw * 1.08, mb.yl - 6e-3], [-mw * 0.6, lipTop - 4e-3], [mw * 0.6, lipTop - 4e-3], [mw * 1.08, mb.yr - 6e-3], [mw * 1, mb.yBot], [0, mb.yBot + 8e-3], [-mw * 1, mb.yBot]];
        const zone = (start, cy, lip) => {
          const jaw = U.jawLine(z.poly, start);
          const cheekR = [[eR(start) - 0.02, start, false, 0.01], [eR(start + 0.07) - 0.07, start + 0.07], [0.2, cy], [0.14, cy + 0.03], [0.08, lip]];
          const outer = [...inward(jaw, -4e-3), ...cheekR, [0, lip + 2e-3], ...Hh.mirror(cheekR).reverse()];
          return { outer, d: r1(Hh.path(ctx, outer, 0.45)) };
        };
        const mid = ctx.lod === "mid" ? 1.35 : 1;
        const z1 = zone(k.start, k.cy, ny + 0.03), z2 = zone(k.start + 0.08, k.cy + 0.06, ny + 0.034), z3 = zone(k.start + 0.15, k.cy + 0.1, ny + 0.04);
        const o = k.tone * mid;
        const lines = ctx.lodAtLeast("hi") ? [{ d: z1.d, fill: tint, o: o * 0.36 }, { d: z2.d, fill: tint, o: o * 0.34 }, { d: z3.d, fill: tint, o: o * 0.3 }] : [{ d: z1.d, fill: tint, o: o * 0.5 }, { d: z3.d, fill: tint, o: o * 0.46 }];
        ctx.cut("^facial-hair$", Hh.path(ctx, hole, 0.45));
        const rnd = ctx.rng;
        const coarse = ctx.lod === "hi" ? 1.18 : ctx.lod === "mid" ? 1.5 : 1.8;
        const step = Math.max(0.0105, U.hpx(ctx, 2.1)) * coarse, kit = ctx.R.head.k;
        const rad = Math.max(U.hpx(ctx, ctx.lod === "hi" ? 0.7 : 0.95), 24e-4);
        const cap = ctx.lod === "hi" ? 640 : ctx.lod === "mid" ? 340 : 220;
        const poly = z1.outer;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of poly) {
          x0 = Math.min(x0, p[0]);
          x1 = Math.max(x1, p[0]);
          y0 = Math.min(y0, p[1]);
          y1 = Math.max(y1, p[1]);
        }
        const holePoly = hole;
        let d = "", n = 0;
        rows: for (let y = y0, row = 0; y <= y1; y += step * 0.87, row++) {
          for (let x = x0 + (row % 2 ? step / 2 : 0); x <= x1; x += step) {
            const px = x + (rnd() - 0.5) * step * 0.8, py = y + (rnd() - 0.5) * step * 0.8;
            if (!U.inside(poly, px, py) || U.inside(holePoly, px, py)) continue;
            const e = z.edge(py), side = Math.min(px - e.l, e.r - px);
            const jawDens = 1 - smooth(0, 0.16, side);
            const chinDens = smooth(0.3, 0.46, py);
            const cheekFade = smooth(k.cy - 0.02, k.cy + 0.2, py);
            const dens = k.dots * cheekFade * (0.22 + 0.6 * jawDens + 0.45 * chinDens);
            if (rnd() > dens) continue;
            const c = ctx.hp([px, py], { depth: 0.02 });
            d += diamond(c[0], c[1], rad * kit * (0.85 + rnd() * 0.3));
            if (++n >= cap) break rows;
          }
        }
        if (d) lines.push({ d, fill: dotC, o: ctx.lod === "hi" ? 0.62 : 0.7 });
        return [{ id: "facial-hair", z: ctx.Z.facialHair, d: z1.d, clip: "head", mat: hm, fill: "none", light: false, lines }];
      }
      register({
        kind: "facialHair",
        name: "stubble",
        params,
        example: { face: { facialHair: { type: "stubble", color: "cloth-graphite" } } },
        describe: "Stubble: a soft darker tint over the jaw, chin and upper lip with a fine sparse stipple that thickens along the jawline and fades toward the cheeks. A tone, not a beard (Alfie).",
        draw: (ctx, opts) => stubble(ctx, opts, { start: 0.1, cy: 0.2, tone: 0.2, dots: 0.62 })
      });
      register({
        kind: "facialHair",
        name: "five-oclock",
        params,
        example: { face: { facialHair: { type: "five-oclock", color: "cloth-brown" } } },
        describe: "Five o'clock shadow: a slightly stronger tint and denser stipple than stubble, but kept to the lower jaw and chin.",
        draw: (ctx, opts) => stubble(ctx, opts, { start: 0.17, cy: 0.23, tone: 0.27, dots: 0.85 })
      });
    }
  });

  // src/parts/feet/_shoe.js
  var require_shoe = __commonJS({
    "src/parts/feet/_shoe.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { legFrame } = require_lower();
      var TOE_H = { round: 0.085, point: 0.055, square: 0.115 };
      var ss = (t) => {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
      };
      function shoeBuild(ctx, s, spec = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
        const { R, hh } = ctx;
        const L = R.legs[s], k = L.k, big = L.big;
        const bk = big ? 1.4 : 1;
        const F = legFrame(ctx, s);
        const ax = L.ankle[0], ay = L.ankle[1];
        const X = (a) => ax + k * a;
        const toe = spec.toe || "round";
        const shaft = spec.shaft || 0;
        const ease = ((_a = spec.ease) != null ? _a : 0.13) * (big ? 1.6 : 1);
        const uTop = shaft ? 1 - shaft * (1 - F.split) : F.uAtY(ay - ((_b = spec.collar) != null ? _b : 0.05) * hh);
        const flare = (spec.flare || 0) * hh * bk;
        const hwS = (v) => {
          const u = 1 + (uTop - 1) * v;
          return F.sk(u) * (1 + ease) + 8e-3 * hh + flare * v * v;
        };
        const S = (v, x) => {
          const u = 1 + (uTop - 1) * v;
          return G.add(F.at(u), G.mul(F.nAbs(u), x * hwS(v)));
        };
        const aw = hwS(0);
        const len = Math.max(aw * 1.9, ((_c = L.reach) != null ? _c : 0.3 * hh * bk) * ((_d = spec.len) != null ? _d : 0.3) / 0.3);
        const hb = Math.max(aw + 0.05 * hh * bk, (_e = L.heelReach) != null ? _e : 0);
        const toeH = ((_f = spec.toeH) != null ? _f : TOE_H[toe]) * hh * bk;
        const y0 = -4e-3 * hh, hs = (spec.heel || 0) * hh * bk;
        const curve = (_g = spec.curve) != null ? _g : 1.7, drop = Math.abs(ay);
        const V = (t, off = 0) => [X(aw + t * (len - aw)), -(toeH + (drop - toeH) * Math.pow(1 - t, curve)) + off * hh];
        const tipOut = toe === "square" ? [[X(len + 4e-3 * hh), -toeH * 0.9], [X(len + 4e-3 * hh), -toeH * 0.35], [X(len - 0.014 * hh), y0 * 1]] : toe === "point" ? [[X(len + 6e-3 * hh), -toeH * 0.55], [X(len - 0.03 * hh), y0 * 1]] : [[X(len + 6e-3 * hh), -toeH * 0.6], [X(len - 0.03 * hh), y0 * 1]];
        const vampPts = [0.14, 0.32, 0.52, 0.72, 0.9].map((t) => V(t));
        const heelLen = Math.max(0.09 * hh * bk, 0.22 * (len + hb));
        const heelFront = -hb + heelLen;
        const ball = Math.max(heelFront + 0.05 * hh, len * 0.22);
        const archLift = ((_h = spec.archLift) != null ? _h : 0.034) * hh * bk;
        const heelBlock = hs > 0 ? 0 : ((_i = spec.heelBlock) != null ? _i : 0.05) * hh * bk;
        const bot = (a) => {
          if (hs > 0) return a >= ball ? 0 : hs * ss((ball - a) / Math.max(1e-6, ball - (-hb + heelLen * 0.55)));
          if (a >= ball || a <= heelFront) return 0;
          return archLift * Math.pow((ball - a) / (ball - heelFront), 0.7);
        };
        const Wall = (t, u) => {
          const p = V(t);
          const b = -bot(k * (p[0] - ax)) + y0;
          return [p[0], p[1] + (b - p[1]) * u];
        };
        const counter = ((_j = spec.counter) != null ? _j : 0.2) * hh * bk;
        let soleBack;
        if (hs > 0) {
          const seat = -hb + heelLen * 0.55;
          soleBack = [[X(len * 0.6), y0], [X(ball), y0], [X((ball + seat) / 2), -bot((ball + seat) / 2)], [X(seat), -hs * 0.98], [X(-hb + heelLen * 0.15), -hs], [X(-hb), -hs - 0.01 * hh, true]];
        } else {
          const am = (ball + heelFront) / 2;
          soleBack = [[X(len * 0.6), y0], [X(ball), y0], [X(am), y0 - bot(am)], [X(heelFront + 4e-3 * hh), y0 - archLift * 0.96, true], [X(heelFront - 6e-3 * hh), y0, true], [X(-hb + 0.014 * hh), y0, true]];
        }
        const back = [[X(-hb), -Math.max(hs + 0.03 * hh, counter * 0.4)], [X(-hb + 0.012 * hh), -Math.max(hs + 0.06 * hh, counter * 0.86)], [X(-hb + 0.04 * hh), -Math.max(hs + 0.08 * hh, counter)]];
        const N = 5, lt = [], rt = [];
        for (let i = 0; i <= N; i++) {
          const v = 1 - i / N;
          lt.push(S(v, 1 * k));
          rt.push(S(v, -1 * k));
        }
        const outerTop = lt[0], innerTop = rt[0];
        const backTop = back[back.length - 1][1];
        const rtUp = [rt[rt.length - 1], ...rt.slice(1, -1).reverse()].filter((p) => p[1] < backTop - 0.02 * hh);
        const pts = [[...outerTop, true], ...lt.slice(1, -1), lt[lt.length - 1], ...vampPts, ...tipOut, ...soleBack, ...back, ...rtUp, [...innerTop, true]];
        const d = G.smooth(pts, true, 0.4);
        const footD = G.smooth([[...lt[lt.length - 1], true], ...vampPts, ...tipOut, ...soleBack, ...back, [...rt[rt.length - 1], true]], true, 0.4);
        let capD = null, pegD = null;
        if (spec.cap != null) {
          const tc = spec.cap, ac = aw + tc * (len - aw), top = V(tc);
          const tl = (a) => {
            var _a2;
            return -(bot(Math.max(-hb, Math.min(len, a))) + ((_a2 = spec.topline) != null ? _a2 : 0.075) * hh * bk);
          };
          const cTop = back[back.length - 1];
          const throat = [X(ac - 0.05 * hh), (top[1] + tl(ac - 0.05 * hh)) / 2];
          capD = G.smooth([
            [...top, true],
            V(Math.min(0.9, tc + 0.3)),
            ...tipOut,
            ...soleBack,
            ...back,
            [X(k * (cTop[0] - ax) + 0.05 * hh), cTop[1] * 0.92],
            [X(heelFront + 0.02 * hh), tl(heelFront + 0.02 * hh)],
            [X((heelFront + ac) / 2), tl((heelFront + ac) / 2)],
            throat
          ], true, 0.4);
        }
        if (hs > 0) {
          const tipW = 0.028 * hh * bk, t0 = -hb + heelLen * 0.62, t1 = -hb + 0.01 * hh, tip = -hb + heelLen * 0.3;
          pegD = G.smooth([[X(t0), -hs, true], [X(G.lerp(t0, tip, 0.55)), -hs * 0.55], [X(tip), y0, true], [X(tip) - k * tipW, y0, true], [X(G.lerp(t1, tip - tipW / bk, 0.5)), -hs * 0.5], [X(t1), -hs, true]], true, 0.3);
        }
        const soleBand = (h0, h1) => {
          const A = [], B = [];
          for (let i = 0; i <= 24; i++) {
            const a = -hb - 0.06 * hh + (len + hb + 0.12 * hh) * i / 24;
            const b = bot(Math.max(-hb, Math.min(len, a)));
            A.push([X(a), y0 - b - h0]);
            B.push([X(a), y0 - b - h1]);
          }
          return G.poly([...A, ...B.reverse()]);
        };
        const soleD = soleBand(-0.05 * hh, 0.045 * hh * bk);
        const heelD = heelBlock > 0 ? G.poly([[X(-hb - 0.06 * hh), 0.05 * hh], [X(heelFront), 0.05 * hh], [X(heelFront + 2e-3 * hh), y0 - heelBlock], [X(-hb - 0.06 * hh), y0 - heelBlock]]) : null;
        const band = (yTop, yBot) => G.poly([[ax - 3 * hh, yTop], [ax + 3 * hh, yTop], [ax + 3 * hh, yBot], [ax - 3 * hh, yBot]]);
        return { d, footD, capD, pegD, soleD, heelD, soleBand, bot, V, Wall, S, X, band, hwS, len, hb, heelLen, heelFront, ball, toeH, hs, counter, y0, aw, ax, ay, k, big, F, uTop, shaft, turnout: L.turnout || 0, tip: [X(len), -toeH * 0.5] };
      }
      function shoePieces(ctx, o, spec) {
        var _a, _b, _c;
        const out = [];
        const hh = ctx.hh;
        const bare = !(ctx.S.outfit && ctx.S.outfit.legs);
        for (const s of ["R", "L"]) {
          const sh = shoeBuild(ctx, s, spec);
          const det = spec.detail ? spec.detail(sh, s) : {};
          const mine = [];
          if (spec.skin && bare) mine.push({ id: `foot-${s}`, z: ctx.Z.feet - 0.2, d: sh.footD, mat: ctx.skin, light: { form: 1 } });
          if (det.back) mine.push(...det.back);
          const lines = [];
          if (spec.sole !== false) {
            lines.push({ d: sh.soleD, fill: spec.soleFill || "deep" });
            if (sh.heelD) lines.push({ d: sh.heelD, fill: spec.soleFill || "deep" });
            if (ctx.lodAtLeast("mid")) lines.push({ d: sh.soleBand(0.045 * hh, 0.054 * hh), fill: "light", o: 0.35 });
          }
          lines.push(...det.lines || []);
          const d = spec.cap != null ? sh.capD : sh.d;
          mine.push({ id: `shoe-${s}`, z: (_a = spec.z) != null ? _a : ctx.Z.feet, d, mat: spec.mat, lines, over: det.over, spot: o.spot, pattern: spec.pattern, light: { form: (_b = spec.form) != null ? _b : 0.9 } });
          if (sh.pegD) mine.push({ id: `heel-${s}`, z: ((_c = spec.z) != null ? _c : ctx.Z.feet) + 0.01, d: sh.pegD, mat: spec.mat, lines: [], light: { form: 0.8 } });
          if (det.extra) mine.push(...det.extra);
          if (ctx.R.legs[s].free) for (const p of mine) p.z += 0.3;
          out.push(...mine);
        }
        return out;
      }
      function legsCovered(ctx) {
        const o = ctx.S.outfit || {};
        const b = o.bottom && o.bottom.type, d = o.dress && o.dress.type;
        if (b && /trousers|jeans|slacks|pants|culottes/.test(b) && !(o.bottom.hem === "crop" || o.bottom.hem === "knee")) return true;
        if (d === "boiler-suit") return true;
        return false;
      }
      function footSpecFor(ctx) {
        const f = ctx.S.outfit && ctx.S.outfit.feet || {};
        if (f.type === "heels") return { toe: "point", heel: 0.16, collar: 0 };
        if (f.type === "mary-janes") return { toe: "round", collar: 0 };
        return { toe: "round", collar: 0 };
      }
      var LOW_CUT = /* @__PURE__ */ new Set(["heels", "mary-janes"]);
      function footShows(ctx) {
        const f = ctx.S.outfit && ctx.S.outfit.feet || {};
        return !f.type || LOW_CUT.has(f.type);
      }
      module.exports = { shoeBuild, shoePieces, legsCovered, footSpecFor, footShows };
    }
  });

  // src/parts/feet/oxfords.js
  var require_oxfords = __commonJS({
    "src/parts/feet/oxfords.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { shoePieces, shoeBuild } = require_shoe();
      function shoeShape(ctx, s) {
        const sh = shoeBuild(ctx, s, { collar: 0.04 });
        return { d: sh.d, sole: null, ax: sh.ax, tx: sh.X(sh.len * 0.5), w: sh.len * 0.5, h: -sh.ay };
      }
      function heelCounter(ctx, sh, o = {}) {
        var _a, _b;
        const { G, hh } = ctx, X = sh.X, top = sh.counter * ((_a = o.top) != null ? _a : 0.86), a0 = -sh.hb - 0.03 * hh, a1 = sh.heelFront + sh.heelLen * 0.35;
        const lines = [{ d: G.smooth([[X(a0), -0.04 * hh, true], [X(a0), -top, true], [X(G.lerp(a0, a1, 0.6)), -top * 0.92], [X(a1), -0.05 * hh, true]], true, 0.4), fill: "shade", o: (_b = o.o) != null ? _b : 0.5 }];
        if (ctx.lodAtLeast("mid")) lines.push({ d: G.brush([[X(-sh.hb + 0.01 * hh), -top * 0.98], [X(G.lerp(a0, a1, 0.6)), -top * 0.9], [X(a1), -0.06 * hh]], [3e-3 * hh, 8e-3 * hh, 2e-3 * hh]), fill: "deep", o: 0.55 });
        return lines;
      }
      function lacedVamp(ctx, sh, o = {}) {
        var _a;
        const { G, hh } = ctx, lines = [];
        if (!ctx.lodAtLeast("mid")) return lines;
        const V = sh.V, W = sh.Wall;
        lines.push({ d: G.brush([V(0, 0.03), V(0.2, 0.05), V(0.42, 0.07)], [0.03 * hh, 0.04 * hh, 0.02 * hh]), fill: "deep", o: 0.5 });
        for (const t of o.laces || [0.04, 0.12, 0.2, 0.28, 0.36]) lines.push({ d: G.brush([V(t, -0.01), V(t + 0.018, 0.035), V(t + 0.03, 0.075)], 0.011 * hh), fill: o.lace || "light", o: (_a = o.laceO) != null ? _a : 0.6 });
        return lines;
      }
      register({
        kind: "footwear",
        name: "oxfords",
        describe: "Polished lace-up shoes seen toe-out: toe-cap seam, lacing, heel counter and leather sheen.",
        params: { color: "leather token (cloth-black, cloth-chocolate, leather-brown \u2026)" },
        example: { outfit: { feet: { type: "oxfords", color: "cloth-black" } } },
        shoeShape,
        lacedVamp,
        heelCounter,
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-black", "leather");
          return shoePieces(ctx, o, {
            mat,
            toe: "round",
            collar: 0.05,
            detail(sh) {
              const lines = lacedVamp(ctx, sh);
              if (ctx.lodAtLeast("mid")) {
                lines.push({ d: G.brush([sh.Wall(0.72, 0), sh.Wall(0.66, 0.5), sh.Wall(0.72, 1)], [2e-3 * hh, 9e-3 * hh, 2e-3 * hh]), fill: "deep", o: 0.85 });
                lines.push({ d: G.brush([sh.Wall(0.08, 0.7), sh.Wall(0.5, 0.78), sh.Wall(0.92, 0.72)], [2e-3 * hh, 0.034 * hh, 3e-3 * hh]), fill: "shade", o: 0.6 });
                lines.push(...heelCounter(ctx, sh));
              }
              return { lines };
            }
          });
        }
      });
      module.exports = { shoeShape, lacedVamp, heelCounter };
    }
  });

  // src/parts/feet/boots.js
  var require_boots = __commonJS({
    "src/parts/feet/boots.js"() {
      "use strict";
      var { register } = require_registry();
      var { shoePieces, legsCovered } = require_shoe();
      var { TUCK_FRAC } = require_lower();
      var { lacedVamp } = require_oxfords();
      register({
        kind: "footwear",
        name: "combat-boots",
        aliases: ["work-boots", "boots"],
        describe: "Tall laced combat boots with a lug sole. tucked: true tucks the trousers in and draws the boot over them.",
        params: { color: "leather token (cloth-black, cloth-chocolate)", tucked: "true to blouse trousers into the boots" },
        example: { outfit: { feet: { type: "combat-boots", color: "cloth-black", tucked: true } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const tucked = !!o.tucked;
          const mat = ctx.mat(o.color || "cloth-black", "leather");
          const shaft = tucked ? TUCK_FRAC : legsCovered(ctx) ? 0.08 : TUCK_FRAC;
          return shoePieces(ctx, o, {
            mat,
            shaft,
            ease: 0.26,
            toe: "round",
            toeH: 0.1,
            collar: 0.05,
            counter: 0.26,
            heelBlock: 0.06,
            archLift: 0.026,
            z: tucked ? ctx.Z.feetOver : ctx.Z.feet,
            soleFill: "ink-900",
            detail(sh) {
              const lines = [], over = [], S = sh.S;
              lines.push({ d: sh.soleBand(0.045 * hh, 0.08 * hh), fill: "line", o: 0.9 });
              if (ctx.lodAtLeast("mid")) {
                lines.push(...lacedVamp(ctx, sh, { laces: [0.02, 0.09, 0.16, 0.23] }));
                lines.push({ d: G.brush([sh.Wall(0.7, 0), sh.Wall(0.64, 0.5), sh.Wall(0.7, 1)], [2e-3 * hh, 0.01 * hh, 2e-3 * hh]), fill: "deep", o: 0.8 });
                lines.push({ d: G.brush([sh.Wall(0.1, 0.7), sh.Wall(0.5, 0.78), sh.Wall(0.92, 0.72)], [2e-3 * hh, 0.034 * hh, 3e-3 * hh]), fill: "shade", o: 0.6 });
                if (sh.shaft) {
                  lines.push({ d: G.brush([S(0, 0), S(1, 0)], [0.05 * hh, 0.04 * hh]), fill: "deep", o: 0.6 });
                  const n = Math.max(4, Math.round(sh.shaft * 14));
                  for (let i = 0; i < n; i++) {
                    const v = 0.06 + 0.86 * i / (n - 1), a = S(v, -0.5), b = S(v + 0.012, 0.5);
                    lines.push({ d: G.brush([a, G.lerp(a, b, 0.5), b], 0.012 * hh), fill: "light", o: 0.55 });
                    if (ctx.lodAtLeast("hi")) over.push({ d: G.circle(a[0], a[1], 7e-3 * hh), fill: "metal-steel" }, { d: G.circle(b[0], b[1], 7e-3 * hh), fill: "metal-steel" });
                  }
                  lines.push({ d: G.brush([S(0.93, -1.1), S(0.93, 1.1)], 0.034 * hh), fill: "shade", o: 0.8 });
                  lines.push({ d: G.brush([S(0.9, 1), S(0.5, 0.95), S(0.05, 0.9)], [2e-3 * hh, 0.035 * hh, 4e-3 * hh]), fill: "shade", o: 0.65 });
                }
              }
              return { lines, over };
            }
          });
        }
      });
      register({
        kind: "footwear",
        name: "cowboy-boots",
        describe: "Western boots: pointed toe, stitched shaft with a scalloped top and pull loops, underslung heel. The Garbage Loader's footwear.",
        params: { color: "leather token (cloth-tan, cloth-brown, cloth-tobacco, cloth-rust)", shaftColor: "optional second tone for the shaft (drawn only where a tall shaft shows: mid/hi LOD, legs not hidden by long trousers or a long skirt)", stitch: "light|none: shaft stitching (same condition as shaftColor: only on a visible tall shaft at mid/hi LOD)" },
        example: { outfit: { feet: { type: "cowboy-boots", color: "cloth-tobacco" } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-tobacco", "leather");
          const shaft = legsCovered(ctx) ? 0.09 : 0.56;
          return shoePieces(ctx, o, {
            mat,
            shaft,
            ease: 0.1,
            flare: 0.015,
            toe: "point",
            len: 0.34,
            collar: 0.05,
            counter: 0.3,
            heelBlock: 0.1,
            archLift: 0.07,
            soleFill: "ink-900",
            detail(sh) {
              const lines = [], over = [], S = sh.S;
              lines.push({ d: G.poly([[sh.X(sh.heelFront + 5e-3 * hh), -0.1 * hh], [sh.X(sh.heelFront - 0.03 * hh), -0.012 * hh], [sh.X(sh.heelFront - 0.05 * hh), -0.012 * hh], [sh.X(sh.heelFront - 0.02 * hh), -0.1 * hh]]), fill: "line", o: 0.5 });
              if (ctx.lodAtLeast("mid")) {
                lines.push({ d: G.brush([sh.Wall(0.1, 0.7), sh.Wall(0.5, 0.78), sh.Wall(0.92, 0.7)], [2e-3 * hh, 0.034 * hh, 3e-3 * hh]), fill: "shade", o: 0.6 });
                lines.push({ d: G.brush([sh.Wall(0.12, 0), sh.Wall(0.5, 0.05), sh.Wall(0.85, 0.2)], [4e-3 * hh, 7e-3 * hh, 3e-3 * hh]), fill: "light", o: 0.4 });
                if (sh.shaft > 0.3) {
                  if (o.shaftColor) lines.push({ d: G.poly([S(0.06, -1.3), S(0.06, 1.3), S(1.05, 1.3), S(1.05, -1.3)]), fill: o.shaftColor });
                  lines.push({ d: G.brush([S(0, -1.05), S(0.1, 0), S(0, 1.05)], [2e-3 * hh, 0.012 * hh, 2e-3 * hh]), fill: "deep", o: 0.8 });
                  lines.push({ d: G.brush([S(0.95, 1), S(0.5, 0.92), S(0.06, 0.85)], [2e-3 * hh, 0.04 * hh, 4e-3 * hh]), fill: "shade", o: 0.7 });
                  lines.push({ d: G.poly([S(1.04, -0.38), S(1.04, 0.38), S(0.84, 0)]), fill: "deep", o: 0.75 });
                  lines.push({ d: G.brush([S(1, -1.1), S(1, 1.1)], 0.015 * hh), fill: "deep", o: 0.5 });
                  if (o.stitch !== "none") for (const m of [-1, 1]) lines.push({ d: G.brush([S(0.18, m * 0.55), S(0.45, m * 0.1), S(0.72, m * 0.5)], [2e-3 * hh, 7e-3 * hh, 2e-3 * hh]), fill: "light", o: 0.5 });
                  for (const m of [-1, 1]) over.push({ d: G.brush([S(0.96, m * 0.95), S(0.78, m * 1.02)], 0.012 * hh), fill: "deep", o: 0.85 });
                }
              }
              return { lines, over };
            }
          });
        }
      });
      register({
        kind: "footwear",
        name: "go-go-boots",
        describe: "White knee-high go-go boots: glossy, blunt toe, a flared top. The Socialite's boots.",
        params: { color: "token (default cloth-white; try cloth-cream, cloth-black, cloth-red)", height: "0.6\u20130.9 of the lower leg" },
        example: { outfit: { feet: { type: "go-go-boots", color: "cloth-white" } } },
        draw(ctx, o) {
          var _a;
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-white", "satin");
          return shoePieces(ctx, o, {
            mat,
            shaft: (_a = o.height) != null ? _a : 0.84,
            ease: 0.07,
            flare: 0.03,
            toe: "square",
            len: 0.3,
            heel: 0.07,
            collar: 0.05,
            soleFill: "shade",
            form: 1,
            detail(sh) {
              const lines = [], S = sh.S;
              if (ctx.lodAtLeast("mid")) {
                lines.push({ d: G.brush([S(0.1, -0.95), S(0.14, 0), S(0.08, 0.95)], [2e-3 * hh, 0.014 * hh, 2e-3 * hh]), fill: "shade", o: 0.75 });
                lines.push({ d: G.brush([S(0.2, -0.9), S(0.25, -0.1)], [2e-3 * hh, 0.01 * hh]), fill: "shade", o: 0.5 });
                lines.push({ d: G.brush([S(0.97, 0.9), S(0.55, 0.84), S(0.12, 0.8)], [2e-3 * hh, 0.04 * hh, 4e-3 * hh]), fill: "shade", o: 0.55 });
                lines.push({ d: G.brush([S(0.95, -0.55), S(0.5, -0.5), S(0.15, -0.45)], [3e-3 * hh, 0.016 * hh, 3e-3 * hh]), fill: "light", o: 0.65 });
                lines.push({ d: G.brush([S(0.985, -1.1), S(0.985, 1.1)], 0.012 * hh), fill: "shade", o: 0.5 });
                lines.push({ d: G.brush([sh.Wall(0.1, 0.7), sh.Wall(0.5, 0.78), sh.Wall(0.92, 0.7)], [2e-3 * hh, 0.03 * hh, 3e-3 * hh]), fill: "shade", o: 0.5 });
              }
              return { lines };
            }
          });
        }
      });
      register({
        kind: "footwear",
        name: "chelsea-boots",
        describe: "Sleek ankle boots with elastic side gores and a pointed toe.",
        params: { color: "leather token" },
        example: { outfit: { feet: { type: "chelsea-boots", color: "cloth-chocolate" } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-chocolate", "leather");
          return shoePieces(ctx, o, {
            mat,
            shaft: 0.17,
            ease: 0.1,
            toe: "point",
            len: 0.32,
            collar: 0.05,
            counter: 0.24,
            heelBlock: 0.055,
            soleFill: "ink-900",
            detail(sh) {
              const lines = [], S = sh.S;
              if (ctx.lodAtLeast("mid")) {
                for (const m of [-1, 1]) lines.push({ d: G.brush([S(0.95, m * 0.97), S(0.5, m * 0.9), S(0.05, m * 0.95)], [0.012 * hh, 0.03 * hh, 0.02 * hh]), fill: "deep", o: 0.85 });
                lines.push({ d: G.brush([S(1, -1.1), S(1, 1.1)], 0.012 * hh), fill: "deep", o: 0.5 });
                lines.push({ d: G.brush([sh.Wall(0.1, 0.7), sh.Wall(0.5, 0.78), sh.Wall(0.92, 0.7)], [2e-3 * hh, 0.03 * hh, 3e-3 * hh]), fill: "shade", o: 0.6 });
              }
              return { lines };
            }
          });
        }
      });
    }
  });

  // src/parts/feet/shoes.js
  var require_shoes = __commonJS({
    "src/parts/feet/shoes.js"() {
      "use strict";
      var { register } = require_registry();
      var { shoePieces } = require_shoe();
      var { lacedVamp } = require_oxfords();
      register({
        kind: "footwear",
        name: "heels",
        describe: "Court pumps: pointed toe cap, low-cut vamp showing the instep, a slim heel peg under the arch.",
        params: { color: "leather token (cloth-black, cloth-red, cloth-white, cloth-pink)" },
        example: { outfit: { feet: { type: "heels", color: "cloth-black" } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-black", "leather");
          return shoePieces(ctx, o, {
            mat,
            toe: "point",
            cap: 0.38,
            heel: 0.16,
            counter: 0.26,
            topline: 0.06,
            collar: 0,
            skin: true,
            soleFill: "deep",
            detail(sh) {
              const lines = [], X = sh.X;
              if (ctx.lodAtLeast("mid")) {
                lines.push({ d: G.brush([sh.Wall(0.9, 0.1), sh.Wall(0.78, 0.5), sh.Wall(0.9, 0.9)], [2e-3 * hh, 7e-3 * hh, 2e-3 * hh]), fill: "deep", o: 0.45 });
                lines.push({ d: G.brush([[X(-sh.hb + 0.02 * hh), -sh.counter * 0.8], [X(sh.heelFront), -sh.hs - 0.05 * hh], [X(sh.ball * 0.5), -sh.bot(sh.ball * 0.5) - 0.05 * hh]], [3e-3 * hh, 0.02 * hh, 3e-3 * hh]), fill: "shade", o: 0.6 });
              }
              return { lines };
            }
          });
        }
      });
      register({
        kind: "footwear",
        name: "loafers",
        describe: "Slip-on penny loafers: apron-toe stitching, a strap with a slot, soft round toe.",
        params: { color: "leather token (cloth-chocolate, cloth-black, cloth-tan)" },
        example: { outfit: { feet: { type: "loafers", color: "cloth-brown" } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-brown", "leather");
          return shoePieces(ctx, o, {
            mat,
            toe: "round",
            collar: 0,
            detail(sh) {
              const lines = [], V = sh.V, W = sh.Wall;
              if (ctx.lodAtLeast("mid")) {
                lines.push({ d: G.brush([V(0, 0.03), V(0.14, 0.05)], [0.04 * hh, 0.04 * hh]), fill: "deep", o: 0.6 });
                lines.push({ d: G.poly([V(0.2, -0.03), V(0.34, -0.03), W(0.34, 0.5), W(0.2, 0.5)]), fill: "shade", o: 0.3 });
                lines.push({ d: G.brush([W(0.34, 0), W(0.34, 0.5)], [0.012 * hh, 8e-3 * hh]), fill: "deep", o: 0.75 });
                lines.push({ d: G.brush([W(0.2, 0), W(0.2, 0.5)], 7e-3 * hh), fill: "light", o: 0.45 });
                lines.push({ d: G.poly([W(0.25, 0.12), W(0.29, 0.12), W(0.29, 0.3), W(0.25, 0.3)]), fill: "deep", o: 0.85 });
                lines.push({ d: G.brush([W(0.68, 0), W(0.62, 0.5), W(0.68, 1)], [2e-3 * hh, 6e-3 * hh, 2e-3 * hh]), fill: "shade", o: 0.8 });
                lines.push({ d: G.brush([W(0.1, 0.7), W(0.5, 0.78), W(0.92, 0.7)], [2e-3 * hh, 0.032 * hh, 3e-3 * hh]), fill: "shade", o: 0.55 });
              }
              return { lines };
            }
          });
        }
      });
      register({
        kind: "footwear",
        name: "mary-janes",
        describe: "Mary Janes: round toe cap and a buckled instep strap, worn with knee socks or tights.",
        params: { color: "leather token (cloth-black, cloth-chocolate, cloth-red)" },
        example: { outfit: { feet: { type: "mary-janes", color: "cloth-chocolate" } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-chocolate", "leather");
          return shoePieces(ctx, o, {
            mat,
            toe: "round",
            toeH: 0.09,
            cap: 0.42,
            counter: 0.18,
            topline: 0.07,
            collar: 0,
            skin: true,
            detail(sh, s) {
              const V = sh.V, W = sh.Wall, lines = [], cn = (p) => [p[0], p[1], true];
              const strap = G.smooth([cn(V(0.25, -0.045)), cn(V(0.4, -0.045)), W(0.425, 0.3), cn(W(0.4, 0.66)), cn(W(0.27, 0.66)), W(0.275, 0.3)], true, 0.35);
              const bk = W(0.33, 0.28);
              const extra = [{ id: `mj-strap-${s}`, z: ctx.Z.feet + 0.05, d: strap, mat, light: { form: 0.9 }, lines: ctx.lodAtLeast("mid") ? [{ d: G.brush([W(0.395, 0.04), W(0.415, 0.3), W(0.39, 0.66)], [3e-3 * hh, 8e-3 * hh, 3e-3 * hh]), fill: "deep", o: 0.5 }] : [], over: [{ d: G.circle(bk[0], bk[1], 0.014 * hh), fill: "metal-steel" }] }];
              if (ctx.lodAtLeast("mid")) lines.push({ d: G.brush([W(0.8, 0.05), W(0.74, 0.5), W(0.8, 0.95)], [2e-3 * hh, 6e-3 * hh, 2e-3 * hh]), fill: "shade", o: 0.6 });
              return { lines, extra };
            }
          });
        }
      });
      register({
        kind: "footwear",
        name: "sneakers",
        describe: "Sixties canvas plimsolls: white rubber toe cap and sole, laced canvas upper.",
        params: { color: "canvas token (cloth-navy, cloth-white, cloth-red)" },
        example: { outfit: { feet: { type: "sneakers", color: "cloth-navy" } } },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-navy", "canvas");
          return shoePieces(ctx, o, {
            mat,
            toe: "round",
            toeH: 0.09,
            collar: 0.07,
            counter: 0.22,
            heelBlock: 0,
            archLift: 0.012,
            soleFill: "cloth-white",
            detail(sh) {
              const lines = [], V = sh.V;
              const x0 = V(0.78)[0], x1 = sh.X(sh.len + 0.1 * hh);
              lines.push({ d: G.poly([[x0, -0.4 * hh], [x1, -0.4 * hh], [x1, 0.05 * hh], [x0, 0.05 * hh]]), fill: "cloth-white" });
              lines.push({ d: sh.soleBand(0.045 * hh, 0.075 * hh), fill: "cloth-white" });
              lines.push(...lacedVamp(ctx, sh, { lace: "cloth-white", laceO: 0.9, laces: [0.04, 0.12, 0.2, 0.28] }));
              if (ctx.lodAtLeast("mid")) lines.push({ d: G.brush([sh.Wall(0.1, 0.65), sh.Wall(0.45, 0.72), sh.Wall(0.75, 0.62)], [2e-3 * hh, 0.03 * hh, 3e-3 * hh]), fill: "shade", o: 0.5 });
              return { lines };
            }
          });
        }
      });
    }
  });

  // src/parts/gloves/gloves.js
  var require_gloves = __commonJS({
    "src/parts/gloves/gloves.js"() {
      "use strict";
      var { register } = require_registry();
      var { HAND_FOR_POSE } = require_anchors();
      var { handSpace } = require_relaxed();
      var KNUCKLE_Y = { relaxed: 0.5, hip: 0.5, peace: 0.5, cigarette: 0.5, lapel: 0.45, fist: 0.36, grip: 0.36, tucked: 0.3 };
      function sleeveTube(ctx, s, mat, o) {
        var _a;
        const { R, G, hh } = ctx;
        const A = R.arms[s];
        const sst = (x) => {
          const t = Math.max(0, Math.min(1, (x - 0.8) / 0.2));
          return t * t * (3 - 2 * t);
        };
        const lb = ctx.body.limb("arm", s, { ease: (_a = o.ease) != null ? _a : 0.018, from: o.from, to: 1, capStart: "flat", capEnd: "flat", hw: (u, b) => b * (R.fem ? 0.95 : 1) * (1 - 0.1 * sst(u)) });
        const out = [];
        const lastSeg = lb.pieces.some((pc) => pc.seg === "lower") ? "lower" : "whole";
        lb.pieces.forEach((pc) => {
          var _a2;
          const lines = [];
          const topU = pc.seg === "lower" && lb.split > o.from ? lb.split : o.from;
          if (ctx.lodAtLeast("mid") && pc.seg !== "lower") {
            const p = lb.at(o.from + 5e-3), q = lb.at(o.from + 0.04);
            const n = G.perp(G.norm(G.sub(q, p)));
            const hw = lb.hw(o.from);
            lines.push({ d: G.brush([G.add(p, G.mul(n, -hw)), G.add(p, G.mul(n, hw))], [0.012 * hh, 0.022 * hh, 0.012 * hh]), fill: "shade", o: 0.85 });
          }
          if (ctx.lodAtLeast("mid") && o.wrinkles && (pc.seg === "lower" || pc.seg === "whole")) {
            for (const u of [0.9, 0.935, 0.965]) {
              const p = lb.at(u), q = lb.at(u + 0.02);
              const n = G.perp(G.norm(G.sub(q, p)));
              const hw = lb.hw(u);
              lines.push({ d: G.brush([G.add(p, G.mul(n, -hw * 0.95)), G.add(G.add(p, G.mul(G.norm(G.sub(q, p)), 0.02 * hh)), G.mul(n, 0)), G.add(p, G.mul(n, hw * 0.95))], [2e-3 * hh, 0.014 * hh, 2e-3 * hh]), fill: u === 0.935 ? "light" : "shade", o: 0.55 });
            }
          }
          if (o.snap && !o.hideSnap && ctx.lodAtLeast("mid") && pc.seg === lastSeg) {
            const p = lb.at(1 - (1 - o.from) * 0.4), q = lb.at(1 - (1 - o.from) * 0.4 - 0.02);
            const n = G.perp(G.norm(G.sub(p, q)));
            const hw = lb.hw(0.95);
            lines.push({ d: G.ellipse(p[0] + n[0] * hw * 0.15, p[1] + n[1] * hw * 0.15, 0.022 * hh), fill: "metal-brass" });
          }
          out.push({ id: `${o.pieceId || "cuff"}-${s}-glove${pc.seg === "whole" ? "" : "-" + pc.seg}`, z: A.z + ((_a2 = o.z) != null ? _a2 : 0.35) + (pc.seg === "lower" ? 0.01 : 0), d: pc.d, mat, lines, light: { form: 1 } });
        });
        return out;
      }
      function gloveHands(ctx, s, mat, o) {
        const A = ctx.R.arms[s];
        const named = ctx.S.pose && ctx.S.pose.hands && ctx.S.pose.hands[s];
        const name = named || HAND_FOR_POSE[A.pose] || "relaxed";
        if (name === "pocket" || name === "hidden") return [];
        const pcs = ctx.part("hands", name, { side: s, mat, grow: 0.016, idPrefix: "glove-hand", z: A.z + 0.85 });
        if (o.holes && KNUCKLE_Y[name] != null && pcs.length) {
          const H = handSpace(ctx, s), y = KNUCKLE_Y[name], G = ctx.G;
          const rot = Math.atan2(H.m[1], H.m[0]);
          const main = pcs.find((p) => p.id === `glove-hand-${s}`) || pcs[0];
          main.lines = (main.lines || []).concat([-0.1, 0, 0.1].map((x) => {
            const q = H.hp([x, y]);
            return { d: G.ellipse(q[0], q[1], 0.032 * H.len, 0.022 * H.len, rot), fill: ctx.skin.base };
          }));
        }
        return pcs;
      }
      function draw(ctx, o, style) {
        var _a;
        const out = [];
        const mat = ctx.mat(o.color || style.color, style.kind);
        for (const s of ["R", "L"]) {
          const A = ctx.R.arms[s], named = ctx.S.pose && ctx.S.pose.hands && ctx.S.pose.hands[s], hn = named || HAND_FOR_POSE[A.pose] || "relaxed";
          out.push(...sleeveTube(ctx, s, mat, { from: style.from, wrinkles: style.wrinkles, snap: (_a = o.snap) != null ? _a : style.snap, hideSnap: hn === "pocket" || hn === "hidden", ease: style.ease, z: style.z }));
          out.push(...gloveHands(ctx, s, mat, { holes: style.holes }));
        }
        return out;
      }
      register({
        kind: "gloves",
        name: "leather",
        describe: "Smooth leather gloves with a short wrist cuff and a lighter knuckle line (fixers, watch officers, the Hound).",
        params: { color: "leather token (default leather-black)" },
        example: { outfit: { hands: { type: "leather", color: "leather-black" } }, pose: { arms: { R: "down", L: "hip" } } },
        draw: (ctx, o) => draw(ctx, o, { color: "leather-black", kind: "leather", from: 0.9, snap: false })
      });
      register({
        kind: "gloves",
        name: "driving",
        describe: "Racer's driving gloves: tan leather, snap-fastened wrist cuff, perforated knuckle holes showing skin.",
        params: { color: "leather token (default leather-brown)" },
        example: { outfit: { hands: { type: "driving", color: "leather-brown" } }, pose: { arms: { R: "down", L: "hip" } } },
        draw: (ctx, o) => draw(ctx, o, { color: "leather-brown", kind: "leather", from: 0.92, snap: true, holes: true })
      });
      register({
        kind: "gloves",
        name: "opera",
        describe: "Long satin opera gloves to above the elbow, ruched at the wrist (the Socialite).",
        params: { color: "fabric token (default cloth-white)" },
        example: { outfit: { hands: { type: "opera", color: "cloth-white" } }, pose: { arms: { R: "down", L: "hip" } } },
        draw: (ctx, o) => draw(ctx, o, { color: "cloth-white", kind: "satin", from: 0.33, wrinkles: true, z: 0.1, ease: 8e-3 })
      });
      register({
        kind: "gloves",
        name: "work",
        describe: "Heavy work gloves: canvas with a long gauntlet cuff (dock heavies, the Garbage Loader).",
        params: { color: "fabric token (default cloth-tan)" },
        example: { outfit: { hands: { type: "work", color: "cloth-tan" } }, pose: { arms: { R: "down", L: "hip" } } },
        draw: (ctx, o) => draw(ctx, o, { color: "cloth-tan", kind: "canvas", from: 0.84, ease: 0.03 })
      });
    }
  });

  // src/parts/hair/_lib.js
  var require_lib = __commonJS({
    "src/parts/hair/_lib.js"(exports, module) {
      "use strict";
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var HAT_Y = -0.33;
      var SKULL = [[-0.5, 0], [-0.488, 0.12], [-0.468, 0.205], [-0.43, 0.275], [-0.38, 0.312], [-0.33, 0.331], [-0.25, 0.337], [-0.16, 0.338], [-0.05, 0.345], [0.05, 0.353], [0.15, 0.356], [0.25, 0.3]];
      function skullX(y) {
        if (y <= -0.5) return 0;
        if (y < -0.25) {
          const u = Math.abs((y + 0.25) / 0.25);
          return 0.337 * Math.pow(1 - Math.pow(u, 2.4), 1 / 2.4);
        }
        for (let i = 0; i < SKULL.length - 1; i++) {
          const [y0, x0] = SKULL[i], [y1, x1] = SKULL[i + 1];
          if (y <= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0);
        }
        return SKULL[SKULL.length - 1][1];
      }
      function inPoly(p, poly) {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j];
          if (a[1] > p[1] !== b[1] > p[1] && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
      }
      function lib(ctx, opts = {}) {
        var _a;
        const { G, C } = ctx;
        const H = ctx.head;
        const k = (H.w || 0.36) / 0.36;
        const sk = H.widthAt ? (y) => H.widthAt(y) : (y) => skullX(y) * k;
        const ratio = (y) => {
          const cy = clamp(y, -0.45, 0.15), d = skullX(cy);
          return d > 0.05 ? clamp(sk(cy) / d, 0.75, 1.25) : k;
        };
        const fx = (p) => p[2] ? [p[0] * ratio(p[1]), p[1], true] : [p[0] * ratio(p[1]), p[1]];
        const hat = !!(ctx.S.hair && ctx.S.hair.hat);
        const hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
        const vol = clamp(+opts.volume || 1, 0.8, 1.4);
        const mat = ctx.hairMat(opts.color);
        const dark = C.lum(mat.base) < 0.2;
        const sheenC = dark ? C.mix(mat.light, ctx.tok("slate-500"), 0.55) : C.mix(mat.light, ctx.tok("cloth-cream"), 0.3);
        const hl = ((_a = H.hairline) != null ? _a : -0.28) + 0.28;
        const L = {
          ctx,
          G,
          C,
          H,
          k,
          hat,
          hi,
          mid,
          vol,
          mat,
          dark,
          sheenC,
          hl,
          sk,
          ratio,
          fx,
          X: (v, y = 0) => v * ratio(y),
          // head-space path → kit path; with a hat, everything above the hat line is flattened onto it
          hs: (d, o) => ctx.hs(hat ? G.mapPath(d, (p) => [p[0], Math.max(p[1], HAT_Y)]) : d, o),
          smooth: (pts, tension = 0.45, closed = true) => G.smooth(pts.map(fx), closed, tension),
          brush: (pts, widths) => G.brush(pts.map(fx), widths),
          /* part side: "L" → +x (viewer right), "R" → −x (viewer left), "none" → 0. def: the style's natural side. */
          partX(def = "R", amt = 0.11) {
            const p = opts.part === void 0 ? def : opts.part;
            return p === "none" ? 0 : (p === "L" ? 1 : -1) * amt;
          },
          /* grey colour from opts.grey (token, or true for a default silver) */
          greyC() {
            if (!opts.grey) return null;
            return ctx.tok(typeof opts.grey === "string" ? opts.grey : "cloth-stone");
          },
          /* the standard main piece */
          mass(d, extra = {}) {
            return { id: "hair", z: ctx.Z.hair, d, mat, light: { form: 1.1, sheenO: 0.4 }, ...extra };
          },
          /* a plane of light along a path (a brush stroke), cool on dark hair */
          sheen(pts, widths, o = 0.85) {
            if (hat) return null;
            return { d: L.hs(L.brush(pts, widths)), fill: sheenC, o };
          },
          /* a thin strand mark: only at hi LOD */
          strand(pts, widths, o = 0.6, fill = "shade") {
            if (!hi || hat) return null;
            return { d: L.hs(L.brush(pts, widths)), fill, o };
          },
          /* Cast shadow on the forehead under a hairline / fringe edge (array of head-space points left→right). */
          forehead(edge, depth = 0.035, o = {}) {
            var _a2, _b;
            if (hat) return [];
            const dx = (_a2 = o.dx) != null ? _a2 : 0.012;
            const n = edge.length, xs = edge.map((p) => Math.abs(p[0]));
            const xm = Math.max(...xs, 0.3);
            const low = edge.map(([x, y], i) => {
              const t = 1 - Math.pow(Math.abs(x) / (xm * 1.05), 2);
              const dd = depth * (0.25 + 0.75 * t) * (1 + 0.35 * clamp(x / xm, -1, 1));
              return [x + dx, y + dd];
            }).reverse();
            const pts = [...edge.map(([x, y]) => [x, y - 0.01]), ...low];
            const out = [{ id: "hair-shadow", z: ctx.Z.face - 0.5, d: ctx.hs(G.smooth(pts.map(fx), true, 0.5)), fill: ctx.skin.shade, light: false, clip: "head", opacity: (_b = o.opacity) != null ? _b : 0.92 }];
            if (hi && !o.single) {
              const low2 = edge.map(([x, y]) => [x + dx * 0.4, y + depth * 0.32 * (1 - Math.pow(Math.abs(x) / (xm * 1.05), 2) * 0.8)]).reverse();
              out.push({ id: "hair-shadow-deep", z: ctx.Z.face - 0.45, d: ctx.hs(G.smooth([...edge.map(([x, y]) => fx([x, y - 0.01])), ...low2.map(fx)], true, 0.5)), fill: ctx.skin.deep, light: false, clip: "head", opacity: 0.45 });
            }
            return out;
          },
          /* Grey: temples (default), a streak, or frost. Returns pieces clipped to the hair mass. */
          grey(o = {}) {
            var _a2, _b, _c, _d;
            const g = L.greyC();
            if (!g || hat) return [];
            const mode = opts.greyAt || o.mode || "temples";
            const gs = C.mix(g, mat.shade, 0.4);
            const out = [];
            if (mode === "temples") {
              const ty = (_a2 = o.y) != null ? _a2 : [-0.3, -0.04], x0 = (_b = o.x) != null ? _b : 0.3, x1 = (_c = o.x1) != null ? _c : 0.375;
              for (const s of [-1, 1]) {
                const yM = (ty[0] + ty[1]) / 2;
                const d = L.hs(G.smooth([[s * x0, ty[0]], [s * (x1 + 0.03), ty[0] + 0.06], [s * (x1 + 0.03), ty[1]], [s * (x0 + 0.01), ty[1] - 5e-3], [s * (x0 - 0.012), yM + 0.03]].map(fx), true, 0.4));
                out.push({ id: `hair-grey-${s < 0 ? "R" : "L"}`, z: ctx.Z.hair + 0.1, d, fill: s < 0 ? g : gs, light: false, clip: (o.clip && typeof o.clip === "object" ? o.clip[s < 0 ? "R" : "L"] : o.clip) || "hair", opacity: (_d = o.opacity) != null ? _d : 0.95 });
              }
            } else if (mode === "streak") {
              const sx = (opts.part === "L" ? 1 : -1) * 0.09;
              out.push({ id: "hair-grey-streak", z: ctx.Z.hair + 0.1, d: L.hs(L.brush([[sx, -0.3], [sx + 0.03, -0.42], [sx + 0.07, -0.56]], [0.012, 0.075, 0.02])), fill: g, light: false, clip: "hair", opacity: 0.95 });
            }
            return out;
          },
          /* A scatter of tiny flecks (rng, deterministic) inside a head-space polygon. Returns a kit path or null. */
          flecks(poly, n, size, o = {}) {
            if (!hi) return null;
            let d = "";
            const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            let tries = 0, got = 0;
            while (got < n && tries++ < n * 12) {
              const p = [x0 + ctx.rng() * (x1 - x0), y0 + ctx.rng() * (y1 - y0)];
              if (!inPoly(p, poly)) continue;
              const c = ctx.hp(fx(p));
              const r = size * ctx.R.head.k * (0.6 + ctx.rng() * 0.8), a = ctx.rng() * Math.PI;
              const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
              d += `M${G.f(c[0] - dx)} ${G.f(c[1] - dy)} L${G.f(c[0] - dy * 0.5)} ${G.f(c[1] + dx * 0.5)} L${G.f(c[0] + dx)} ${G.f(c[1] + dy)} L${G.f(c[0] + dy * 0.5)} ${G.f(c[1] - dx * 0.5)} Z`;
              got++;
            }
            return d || null;
          },
          /* Halftone dots inside a head-space polygon on a staggered grid, as one kit-space path.
             o.spacing (head units), o.r(x, y) → dot radius in head units (≤ 0 skips the dot), o.jitter. */
          dots(poly, o = {}) {
            var _a2, _b, _c, _d;
            const px = ctx.px(1) / ctx.R.head.k;
            const sp = Math.max((_a2 = o.spacing) != null ? _a2 : 0.028, px * ((_b = o.minSpacingPx) != null ? _b : 3.4));
            const rf = o.r || (() => sp * 0.3);
            const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            let d = "", row = 0;
            for (let y = y0; y <= y1; y += sp * 0.866, row++) {
              for (let x = x0 + (row % 2 ? sp / 2 : 0); x <= x1; x += sp) {
                const jx = (ctx.rng() - 0.5) * sp * ((_c = o.jitter) != null ? _c : 0.18), jy = (ctx.rng() - 0.5) * sp * ((_d = o.jitter) != null ? _d : 0.18);
                const p = [x + jx, y + jy];
                if (!inPoly(p, poly)) continue;
                const r = rf(p[0], p[1]);
                if (!(r > px * 0.55)) continue;
                const c = ctx.hp(fx(p)), R = r * ctx.R.head.k;
                if (o.quad) {
                  const a = R * 1.1, f1 = (v) => Math.round(v * 10) / 10;
                  d += `M${f1(c[0] + a)} ${f1(c[1])}L${f1(c[0])} ${f1(c[1] + a)}L${f1(c[0] - a)} ${f1(c[1])}L${f1(c[0])} ${f1(c[1] - a)}Z`;
                  continue;
                }
                const q = [[1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87]];
                d += "M" + q.map(([a, b]) => G.f(c[0] + a * R) + " " + G.f(c[1] + b * R)).join(" L") + " Z";
              }
            }
            return d || null;
          },
          /* Closed outline that hugs the skull, in default-skull coordinates (L.smooth fits them to this head).
             yb: bottom of the sideburns; t: thickness (number or (y, side) → number); topT: thickness at the crown;
             lift(x, y): extra rise on the dome (volume swoops). Returns points from the left bottom, over the top, to the right bottom. */
          shell(yb, t, topT, lift) {
            const ys = [yb, ...[-0.04, -0.12, -0.2, -0.28, -0.35, -0.405, -0.435, -0.457, -0.474, -0.486, -0.495].filter((y) => y < yb - 0.02)];
            const tf = (y, s) => typeof t === "function" ? t(y, s) : t;
            const side = (s) => ys.map((y) => {
              const x = s * (skullX(y) + tf(y, s));
              return [x, y - (lift && y < -0.3 ? lift(x, y) : 0)];
            });
            const left = side(-1), right = side(1).reverse();
            const top = [0, -0.5 - (topT != null ? topT : tf(-0.5, 0)) - (lift ? lift(0, -0.5) : 0)];
            left[0] = [...left[0], true];
            right[right.length - 1] = [...right[right.length - 1], true];
            return [...left, top, ...right];
          },
          /* A close-cropped patch where the scalp shows through: a lighter base (hair blended with skin) under a field of
             halftone dots in the hair colour, like the user's Alfie. d: kit path; poly: default-coords polygon for the dots. */
          buzzPiece(d, poly, o = {}) {
            var _a2, _b, _c, _d, _e;
            const base = C.mix(mat.base, ctx.skin.base, (_a2 = o.scalp) != null ? _a2 : 0.4);
            const m = ctx.mat(base, "hair");
            const lines = [];
            if (mid && !hat) {
              const rb = (_b = o.rBase) != null ? _b : 95e-4;
              const fields = o.fields || [{ r: o.r || ((x, y) => rb * (0.62 + 0.9 * clamp((x + 0.22) / 0.5, 0, 1)) * (y < -0.42 ? 1.25 : 1) * (o.fade ? o.fade(x, y) : 1)), fill: mat.deep, o: 0.95 }];
              for (const f of fields) {
                const dd = L.dots(poly, { spacing: (_c = o.spacing) != null ? _c : 0.026, r: f.r, jitter: o.jitter });
                if (dd) lines.push({ d: dd, fill: f.fill || mat.deep, o: (_d = f.o) != null ? _d : 0.95 });
              }
            }
            return { id: o.id || "hair", z: (_e = o.z) != null ? _e : ctx.Z.hair, d, mat: m, light: { form: 1 }, lines, ...o.extra || {} };
          },
          mirror: (pts) => pts.slice().reverse().map(([x, y, s]) => [-x, y, s])
        };
        return L;
      }
      module.exports = { lib, skullX, inPoly, clamp, HAT_Y };
    }
  });

  // src/parts/hair/bobs.js
  var require_bobs = __commonJS({
    "src/parts/hair/bobs.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { lib, clamp } = require_lib();
      var cmp = (a) => a.filter(Boolean);
      var S = true;
      function cheekShade(L, x, y0, y1, side) {
        const { ctx } = L;
        const wdt = side > 0 ? 0.04 : 0.022;
        return { id: `hair-cheek-${side < 0 ? "R" : "L"}`, z: ctx.Z.face - 0.4, d: L.hs(L.brush([[x, y0], [x - side * wdt * 0.5, (y0 + y1) / 2], [x - side * wdt * 0.2, y1]], [4e-3, wdt, 4e-3])), fill: ctx.skin.shade, light: false, clip: "head", opacity: side > 0 ? 0.75 : 0.5 };
      }
      register({
        kind: "hair",
        name: "bowl-bob",
        aliases: ["kelly-bob", "bowl"],
        describe: "Blunt straight fringe, heavy chin-length straight sides covering the ears, black and glossy. The Garbage Loader's Kelly bob.",
        params: { color: "hair colour token", length: "0.7\u20131.3 (drop of the sides)", volume: "0.8\u20131.4" },
        example: { hair: { style: "bowl-bob", color: "cloth-black" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, len = clamp(+opts.length || 1, 0.7, 1.3);
          const yb = 0.34 + (len - 1) * 0.25, fy = -0.135 + L.hl * 0.5, iw = 0.305, ow = 0.415 + 0.03 * v;
          const left = [[-iw, yb, S], [-ow + 0.025, yb + 4e-3], [-ow, yb - 0.035], [-ow - 4e-3, 0.15], [-ow, -0.05], [-ow + 0.01, -0.22], [-0.41, -0.38], [-0.33, -0.5], [-0.2, -0.552 - 0.02 * v], [0, -0.575 - 0.03 * v]];
          const right = left.slice(0, -1).reverse().map(([x, y, s]) => [-x, y, s]);
          const edge = [[-iw, fy, S], [-0.15, fy + 0.012], [0, fy + 0.018], [0.15, fy + 0.012], [iw, fy, S]];
          const pts = [...left, ...right, [iw, 0.15], [iw, -0.05], ...edge.slice().reverse(), [-iw, -0.05], [-iw, 0.15]];
          const d = L.hs(L.smooth(pts, 0.3));
          const lit = cmp([
            L.sheen([[-ow + 0.07, -0.12], [-ow + 0.062, 0.1], [-ow + 0.07, yb - 0.05]], [0.01, 0.032, 8e-3], 0.85),
            L.sheen([[-0.36, -0.3], [-0.3, -0.45], [-0.15, -0.52], [0, -0.545]], [0.01, 0.045, 0.04, 0.01], 0.85)
          ]);
          const lines = [];
          if (L.hi) {
            for (let i = 0; i < 9; i++) {
              const x0 = -0.26 + i * 0.065;
              lines.push(L.strand([[x0, -0.34], [x0 + 4e-3, -0.24], [x0, fy - 0.01]], [2e-3, 6e-3, 1e-3], 0.65));
            }
            for (const s of [-1, 1]) lines.push(L.strand([[s * (ow - 0.045), -0.08], [s * (ow - 0.045), 0.1], [s * (ow - 0.05), yb - 0.03]], [2e-3, 7e-3, 1e-3], 0.6));
          }
          return [
            L.mass(d, { lit, lines: lines.filter(Boolean) }),
            ...L.forehead(edge.map(([x, y]) => [x * 0.92, y]), 0.05),
            ...L.hat ? [] : [cheekShade(L, -iw, fy, yb - 0.02, -1), cheekShade(L, iw, fy, yb - 0.02, 1)]
          ].filter((p) => p && p.d);
        }
      });
      function bobShape(L, opts, flip) {
        const v = L.vol, len = clamp(+opts.length || 1, 0.7, 1.3), hy = L.hl * 0.5;
        const s = opts.part === "L" ? -1 : 1;
        const yb = 0.4 + (len - 1) * 0.25, iw = 0.31;
        let left;
        if (flip) {
          left = [[-iw, yb - 0.01, S], [-0.38, yb + 0.06], [-0.49, yb + 0.04], [-0.585, yb - 0.075, S], [-0.52, yb - 0.13], [-0.49, 0.08], [-0.47, -0.08], [-0.45, -0.24], [-0.4, -0.4], [-0.3, -0.51], [-0.15, -0.572 - 0.02 * v], [0, -0.6 - 0.035 * v]];
        } else {
          left = [[-iw, yb - 0.03, S], [-0.35, yb + 0.03], [-0.42, yb + 0], [-0.462, 0.22], [-0.475, 0], [-0.462, -0.2], [-0.4, -0.4], [-0.3, -0.51], [-0.15, -0.565 - 0.02 * v], [0, -0.59 - 0.03 * v]];
        }
        const right = left.slice(0, -1).reverse().map(([x, y, f]) => [-x, y, f]);
        const fr = [[-iw + 0.01, -0.15 + hy, S], [-0.2, -0.185 + hy], [-0.05, -0.19 + hy], [0.09, -0.165 + hy], [0.21, -0.13 + hy], [iw - 0.01, -0.085 + hy, S]];
        const edge = s > 0 ? fr : fr.slice().reverse().map(([x, y, f]) => [-x, y, f]);
        const pts = [...left, ...right, [iw, 0.2], [iw, 0], ...edge.slice().reverse(), [-iw, 0], [-iw, 0.2]];
        const d = L.hs(L.smooth(pts, 0.32));
        const lit = cmp([
          L.sheen([[-0.42, -0.2], [-0.4, 0.05], [-0.38, yb - 0.08]], [0.01, 0.034, 8e-3], 0.85),
          L.sheen([[-0.37, -0.31], [-0.29, -0.46], [-0.12, -0.54], [0.04, -0.55]], [0.01, 0.05, 0.045, 0.01], 0.85)
        ]);
        const lines = [];
        if (L.hi) {
          lines.push({ d: L.hs(L.brush([[-0.09 * s, -0.19 + hy], [-0.1 * s, -0.37], [-0.11 * s, -0.54]], [4e-3, 0.01, 2e-3])), fill: "deep", o: 0.5 });
          for (let i = 0; i < 6; i++) lines.push(L.strand([[-0.1 * s + s * i * 0.04, -0.52 + i * 0.01], [s * (0 + i * 0.05), -0.36], [s * (0.05 + i * 0.05), -0.2 + hy + i * 0.01]], [2e-3, 6e-3, 1e-3], 0.6));
          for (const q of [-1, 1]) lines.push(L.strand([[q * 0.43, -0.1], [q * 0.44, 0.1], [q * 0.4, yb - 0.04]], [2e-3, 7e-3, 1e-3], 0.55));
        }
        const tuck = L.sheen([[-0.37, yb - 0.01], [-0.33, yb + 0.02], [-0.27, yb - 0.02]], [8e-3, 0.024, 6e-3], 0.7);
        if (tuck && !flip) lit.push(tuck);
        const sh = L.forehead(edge.slice(1, -1).map(([x, y]) => [x * 0.95, y]), 0.045);
        return [L.mass(d, { lit, lines: lines.filter(Boolean) }), ...sh, ...L.hat ? [] : [cheekShade(L, -iw, 0, yb - 0.04, -1), cheekShade(L, iw, 0, yb - 0.04, 1)]];
      }
      register({
        kind: "hair",
        name: "bob",
        aliases: ["sixties-bob", "chin-bob"],
        describe: "Sixties bob: a side-swept fringe, a smooth domed crown and chin-length sides that tuck under at the jaw. Socialites, swingers, dealers.",
        params: { color: "hair colour token", part: "L|R (side the fringe sweeps from)", length: "0.7\u20131.3", volume: "0.8\u20131.4" },
        example: { hair: { style: "bob", color: "cloth-chocolate" } },
        draw(ctx, opts) {
          return bobShape(lib(ctx, opts), opts, false);
        }
      });
      register({
        kind: "hair",
        name: "flip",
        aliases: ["flipped-bob", "flick"],
        describe: "Sixties flip: a bouffant crown and a side-swept fringe, with shoulder-brushing ends flicked out and up.",
        params: { color: "hair colour token", part: "L|R", length: "0.7\u20131.3", volume: "0.8\u20131.4" },
        example: { hair: { style: "flip", color: "cloth-tobacco" } },
        draw(ctx, opts) {
          return bobShape(lib(ctx, opts), opts, true);
        }
      });
      register({
        kind: "hair",
        name: "mod-mop",
        aliases: ["beatles", "mop-top"],
        describe: "Beatles mop: thick brushed-forward fringe over the brows, full sides over the ears, ends cut at the lobe.",
        params: { color: "hair colour token", grey: "grey token", part: "L|R|none", volume: "0.8\u20131.4" },
        example: { hair: { style: "mod-mop", color: "cloth-brown" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.5;
          const s = opts.part === "L" ? -1 : 1, iw = 0.335, yb = 0.15;
          const left = [[-iw + 5e-3, yb - 0.02, S], [-0.4, yb + 0.02], [-0.44, yb - 0.03, S], [-0.46, 0], [-0.46, -0.16], [-0.43, -0.34], [-0.35, -0.48], [-0.2, -0.56 - 0.02 * v], [0, -0.595 - 0.035 * v]];
          const right = left.slice(0, -1).reverse().map(([x, y, f]) => [-x, y, f]);
          const fr = [[-iw, -0.1 + hy, S], [-0.22, -0.145 + hy], [-0.08, -0.165 + hy], [0.07, -0.15 + hy], [0.22, -0.125 + hy], [iw, -0.09 + hy, S]];
          const edge = s > 0 ? fr : fr.slice().reverse().map(([x, y, f]) => [-x, y, f]);
          const pts = [...left, ...right, [iw - 5e-3, 0.05], ...edge.slice().reverse(), [-iw + 5e-3, 0.05]];
          const d = L.hs(L.smooth(pts, 0.34));
          const lit = cmp([L.sheen([[-0.36, -0.3], [-0.28, -0.46], [-0.1, -0.54], [0.06, -0.55]], [0.01, 0.05, 0.045, 0.01], 0.8)]);
          const lines = [];
          if (L.hi) for (let i = 0; i < 9; i++) {
            const x0 = -0.27 + i * 0.07;
            lines.push(L.strand([[x0 * 0.4, -0.55], [x0 * 0.8, -0.4], [x0, -0.2 + hy + i % 2 * 0.02]], [2e-3, 7e-3, 1e-3], 0.65));
          }
          const ear = L.sheen([[-0.43, -0.05], [-0.42, 0.04], [-0.4, 0.11]], [8e-3, 0.03, 6e-3], 0.7);
          if (ear) lit.push(ear);
          return [L.mass(d, { lit, lines: lines.filter(Boolean) }), ...L.grey(), ...L.forehead(edge.slice(1, -1), 0.045)];
        }
      });
      register({
        kind: "hair",
        name: "pixie",
        aliases: ["crop", "gamine"],
        describe: "Cropped pixie: close at the sides, a lifted top and a spiky wisp fringe; ears left bare. Gamine, mod, sharp.",
        params: { color: "hair colour token", part: "L|R", volume: "0.8\u20131.4" },
        example: { hair: { style: "pixie", color: "cloth-rust" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.6;
          const s = opts.part === "L" ? -1 : 1;
          const outer = L.shell(0.02, (y) => 0.018 + 0.034 * clamp((-0.05 - y) / 0.35, 0, 1) * v, 0.064 * v, (x) => 0.03 * v * Math.exp(-Math.pow((x - s * 0.08) / 0.3, 2)));
          const fr = [[-0.336, 0.03, S], [-0.331, -0.08], [-0.3, -0.18 + hy], [-0.24, -0.215 + hy], [-0.17, -0.18 + hy, S], [-0.1, -0.27 + hy], [-0.02, -0.255 + hy], [0.06, -0.15 + hy, S], [0.13, -0.235 + hy], [0.21, -0.165 + hy], [0.27, -0.1 + hy, S], [0.31, -0.15 + hy], [0.331, -0.08], [0.336, 0.03, S]];
          const edge = s > 0 ? fr : fr.slice().reverse().map(([x, y, f]) => [-x, y, f]);
          const d = L.hs(L.smooth([...outer, ...edge.slice().reverse()], 0.3));
          const lit = cmp([L.sheen([[-0.3, -0.27], [-0.25, -0.4], [-0.12, -0.5], [0.04, -0.54]], [0.01, 0.045, 0.04, 0.01], 0.85)]);
          const lines = [];
          if (L.hi) for (let i = 0; i < 7; i++) {
            const x0 = -0.2 + i * 0.065;
            lines.push(L.strand([[s * x0 * 0.5, -0.55], [s * x0, -0.4], [s * (x0 + 0.03), -0.24]], [2e-3, 7e-3, 1e-3], 0.65));
          }
          return [L.mass(d, { lit, lines: lines.filter(Boolean) }), ...L.forehead(edge.slice(1, -1).filter(([, , f]) => !f).map(([x, y]) => [x, y - 0.02]), 0.04)];
        }
      });
      module.exports = { cheekShade };
    }
  });

  // src/parts/hair/slick.js
  var require_slick = __commonJS({
    "src/parts/hair/slick.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { lib, clamp } = require_lib();
      var cmp = (a) => a.filter(Boolean);
      var S = true;
      function capMass(L, edge, o = {}) {
        var _a, _b;
        const v = L.vol;
        const outer = L.shell((_a = o.yb) != null ? _a : -0.015, (y) => {
          var _a2, _b2;
          return ((_a2 = o.side) != null ? _a2 : 0.016) + ((_b2 = o.rise) != null ? _b2 : 0.026) * clamp((-0.08 - y) / 0.3, 0, 1) * v;
        }, ((_b = o.top) != null ? _b : 0.046) * v, o.lift);
        return L.hs(L.smooth([...outer, ...edge.slice().reverse()], 0.4));
      }
      register({
        kind: "hair",
        name: "slick-back",
        aliases: ["slicked", "greaser", "wet-look"],
        describe: "Hair oiled straight back off a high widow's-peak hairline: long glossy comb planes, tight to the skull. Fences, hoods, gamblers.",
        params: { color: "hair colour token", grey: "grey token", volume: "0.8\u20131.4" },
        example: { hair: { style: "slick-back", color: "cloth-black", grey: "cloth-ash" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), hy = L.hl * 0.8;
          const edge = [[-0.337, 0.03, S], [-0.333, -0.1], [-0.31, -0.225], [-0.27, -0.3 + hy], [-0.2, -0.335 + hy], [-0.12, -0.332 + hy], [-0.05, -0.31 + hy], [0, -0.285 + hy], [0.05, -0.31 + hy], [0.12, -0.332 + hy], [0.2, -0.335 + hy], [0.27, -0.3 + hy], [0.31, -0.225], [0.333, -0.1], [0.337, 0.03, S]];
          const d = capMass(L, edge, { yb: 0.03, side: 0.013, rise: 0.022, top: 0.04, lift: (x) => 0.018 * L.vol * Math.exp(-Math.pow(x / 0.3, 2)) });
          const lit = cmp([
            L.sheen([[-0.22, -0.33], [-0.2, -0.43], [-0.13, -0.51], [-0.02, -0.54]], [0.012, 0.05, 0.045, 0.012], 0.9),
            L.sheen([[-0.08, -0.3], [-0.06, -0.4], [-0.01, -0.5]], [8e-3, 0.026, 8e-3], 0.55),
            L.sheen([[-0.33, -0.2], [-0.32, -0.3], [-0.28, -0.4]], [8e-3, 0.026, 0.01], 0.6)
          ]);
          const lines = [];
          if (L.hi) for (let i = 0; i < 9; i++) {
            const x0 = -0.26 + i * 0.065;
            lines.push(L.strand([[x0, -0.32 + hy], [x0 * 0.8, -0.42], [x0 * 0.4, -0.52]], [2e-3, 7e-3, 1e-3], 0.6, i % 3 === 0 ? L.sheenC : "shade"));
          }
          return [L.mass(d, { lit, lines: lines.filter(Boolean) }), ...L.grey({ y: [-0.28, 0.02] }), ...L.forehead(edge.slice(1, -1), 0.028)];
        }
      });
      register({
        kind: "hair",
        name: "pompadour",
        aliases: ["rockabilly", "quiff"],
        describe: "60s pompadour/quiff: sides slicked close, a rounded wave lifting about 0.17 head at the front and swept forward and over to one side, with an S-curve sheen. Racers, rockers, smooth operators.",
        params: { color: "hair colour token", grey: "grey token", part: "L|R (side the wave sweeps toward; default R = viewer-right)", volume: "0.8\u20131.4 (height of the wave)" },
        example: { hair: { style: "pompadour", color: "cloth-black" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.8;
          const s = opts.part === "L" ? -1 : 1;
          const P = ([x, y, f]) => [x * s, y, f];
          const up = (y) => y < -0.45 ? -0.45 + (y + 0.45) * (0.45 + 0.55 * v) : y;
          const outer = [
            [-0.338, 0.03, S],
            [-0.352, -0.06],
            [-0.356, -0.2],
            [-0.352, -0.32],
            [-0.34, -0.43],
            [-0.31, up(-0.53)],
            [-0.25, up(-0.6)],
            [-0.15, up(-0.65)],
            [-0.02, up(-0.672)],
            [0.11, up(-0.67)],
            [0.24, up(-0.64)],
            [0.345, up(-0.58)],
            [0.415, up(-0.5)],
            [0.44, -0.42],
            [0.425, -0.37, S],
            [0.385, -0.35],
            [0.362, -0.3],
            [0.357, -0.2],
            [0.352, -0.06],
            [0.338, 0.03, S]
          ];
          const edge = [[0.333, -0.1], [0.31, -0.225], [0.25, -0.3 + hy], [0.15, -0.336 + hy], [0, -0.35 + hy], [-0.15, -0.336 + hy], [-0.26, -0.3 + hy], [-0.315, -0.225], [-0.333, -0.1]];
          const d = L.hs(L.smooth([...outer, ...edge].map(P), 0.38));
          const sw = (a, b) => [a * s, b];
          const lit = [
            // the S-curve: up the left of the wave, over the crest, then flicking down into the curl
            L.sheen([sw(-0.32, -0.4), sw(-0.28, up(-0.51)), sw(-0.17, up(-0.6)), sw(-0.03, up(-0.612)), sw(0.08, up(-0.57)), sw(0.15, up(-0.51)), sw(0.27, up(-0.5)), sw(0.37, -0.45)], [0.012, 0.05, 0.07, 0.065, 0.05, 0.04, 0.035, 0.01], 0.9),
            L.sheen([sw(-0.12, -0.4), sw(-0.04, up(-0.5)), sw(0.08, up(-0.54))], [8e-3, 0.026, 8e-3], 0.5),
            L.sheen([sw(-0.345, -0.28), sw(-0.35, -0.16), sw(-0.34, -0.04)], [8e-3, 0.022, 8e-3], 0.5)
          ].filter(Boolean);
          const shade = [{ d: L.hs(L.brush([sw(-0.3, -0.34), sw(-0.15, -0.395), sw(0.02, -0.42), sw(0.18, -0.4), sw(0.33, -0.36)].map(([x, y]) => [x, y + hy * 0.6], 0), [0.01, 0.06, 0.075, 0.06, 0.01])), o: 0.5 }];
          const lines = [];
          if (L.hi) {
            for (let i = 0; i < 7; i++) {
              const x0 = -0.27 + i * 0.075;
              lines.push(L.strand([sw(x0, -0.35), sw(x0 + 0.03, up(-0.5) + 0.02 * i / 3), sw(x0 + 0.12, up(-0.56) + 0.03 * i / 3)], [2e-3, 8e-3, 1e-3], 0.6, i % 2 ? "shade" : L.sheenC));
            }
            for (const q of [-1, 1]) lines.push(L.strand([[q * 0.35, -0.28], [q * 0.356, -0.14], [q * 0.345, 0]], [2e-3, 7e-3, 1e-3], 0.6));
          }
          return [L.mass(d, { lit, shade, lines: lines.filter(Boolean) }), ...L.grey({ y: [-0.3, 0.03] }), ...L.forehead([[-0.28, -0.3 + hy], [-0.15, -0.336 + hy], [0, -0.35 + hy], [0.15, -0.336 + hy], [0.28, -0.3 + hy]], 0.04)];
        }
      });
      module.exports = { capMass };
    }
  });

  // src/parts/hair/long.js
  var require_long = __commonJS({
    "src/parts/hair/long.js"() {
      "use strict";
      var { register } = require_registry();
      var { lib, clamp } = require_lib();
      var { capMass } = require_slick();
      var cmp = (a) => a.filter(Boolean);
      var S = true;
      var tieEdge = (hy) => [[-0.337, 0, S], [-0.332, -0.11], [-0.304, -0.22], [-0.235, -0.292 + hy], [-0.12, -0.327 + hy], [0, -0.335 + hy], [0.12, -0.327 + hy], [0.235, -0.292 + hy], [0.304, -0.22], [0.332, -0.11], [0.337, 0, S]];
      register({
        kind: "hair",
        name: "long-straight",
        aliases: ["long", "long-hair"],
        describe: "Long straight hair centre-parted, falling in front of the shoulders to the chest, with a darker back mass behind. Singers, mystics, flower children.",
        params: { color: "hair colour token", part: "L|R|none (default none)", length: "0.7\u20131.3", volume: "0.8\u20131.4" },
        example: { hair: { style: "long-straight", color: "cloth-brown" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, len = clamp(+opts.length || 1, 0.7, 1.3), hy = L.hl * 0.8;
          const yb = 0.55 + 0.6 * len;
          const pX = opts.part === "L" ? 0.1 : opts.part === "R" ? -0.1 : 0;
          const outerL = [[0, -0.6 - 0.03 * v], [-0.15, -0.575 - 0.02 * v], [-0.3, -0.525], [-0.4, -0.42], [-0.455, -0.25], [-0.478, -0.05], [-0.5, 0.2], [-0.515, 0.5], [-0.52, yb - 0.3], [-0.51, yb - 0.04], [-0.485, yb, S]];
          const innerL = [[-0.27, yb - 0.02, S], [-0.252, yb - 0.3], [-0.248, 0.6], [-0.275, 0.4], [-0.32, 0.2], [-0.338, 0.02], [-0.335, -0.1], [-0.31, -0.195], [-0.24, -0.275 + hy], [-0.13, -0.32 + hy], [-0.06, -0.337 + hy]];
          const R = (a) => a.slice().reverse().map(([x, y, f]) => [-x, y, f]);
          const outerR = R(outerL.slice(1)), innerR = R(innerL);
          const loop = [...outerL, ...innerL, [pX, -0.343 + hy], ...innerR, ...outerR];
          const d = L.hs(L.smooth(loop, 0.34));
          const lit = cmp([
            L.sheen([[-0.44, -0.15], [-0.46, 0.2], [-0.475, 0.6], [-0.48, yb - 0.12]], [0.01, 0.045, 0.04, 0.01], 0.85),
            L.sheen([[-0.37, -0.31], [-0.29, -0.46], [-0.12, -0.54], [0.04, -0.55]], [0.01, 0.05, 0.045, 0.01], 0.85),
            L.sheen([[-0.34, 0.1], [-0.33, 0.4], [-0.31, 0.75]], [8e-3, 0.024, 8e-3], 0.45)
          ]);
          const lines = [];
          if (L.hi) {
            lines.push({ d: L.hs(L.brush([[pX, -0.34 + hy], [pX, -0.44], [pX, -0.55]], [4e-3, 9e-3, 2e-3])), fill: "deep", o: 0.6 });
            for (const s of [-1, 1]) for (let i = 0; i < 4; i++) lines.push(L.strand([[s * (0.32 + i * 0.05), 0 + i * 0.04], [s * (0.34 + i * 0.045), 0.4 + i * 0.1], [s * (0.35 + i * 0.045), yb - 0.1 - i * 0.04]], [2e-3, 7e-3, 1e-3], 0.55));
          }
          const out = [L.mass(d, { lit, lines: lines.filter(Boolean) })];
          const bl = [[-0.42, -0.3], [-0.47, 0], [-0.51, 0.5], [-0.525, yb - 0.25], [-0.5, yb + 0], [-0.26, yb + 0.03], [0, yb + 0.04]];
          out.push({ id: "hair-back", z: ctx.Z.backHair, d: L.hs(L.smooth([...bl, ...bl.slice(0, -1).reverse().map(([x, y]) => [-x, y])], 0.35)), mat: L.mat, fill: L.mat.shade, light: { form: 0.6, sheenO: 0.2 } });
          return [...out, ...L.forehead([[-0.28, -0.22 + hy], [-0.2, -0.275 + hy], [-0.1, -0.318 + hy], [pX, -0.34 + hy], [0.1, -0.318 + hy], [0.2, -0.275 + hy], [0.28, -0.22 + hy]], 0.03)];
        }
      });
      register({
        kind: "hair",
        name: "ponytail",
        aliases: ["pony", "high-ponytail"],
        describe: "Hair scraped back from a high hairline into a swinging high ponytail that rises behind the crown and falls past the shoulder. Athletes, pilots, go-go dancers.",
        params: { color: "hair colour token", part: "L|R (side the tail swings to; default L = viewer right)", length: "0.7\u20131.3", volume: "0.8\u20131.4" },
        example: { hair: { style: "ponytail", color: "cloth-black" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), hy = L.hl * 0.8, len = clamp(+opts.length || 1, 0.7, 1.3);
          const s = opts.part === "R" ? -1 : 1;
          const d = capMass(L, tieEdge(hy), { yb: 0, side: 0.012, rise: 0.02, top: 0.036 });
          const lit = cmp([L.sheen([[-0.25, -0.31], [-0.22, -0.42], [-0.12, -0.5], [0.03, -0.53]], [0.01, 0.045, 0.04, 0.01], 0.85), L.sheen([[-0.33, -0.18], [-0.325, -0.28], [-0.29, -0.38]], [8e-3, 0.024, 8e-3], 0.55)]);
          const lines = [];
          if (L.hi) for (let i = 0; i < 8; i++) {
            const x0 = -0.26 + i * 0.075;
            lines.push(L.strand([[x0, -0.31 + hy], [x0 * 0.7, -0.42], [x0 * 0.3, -0.52]], [2e-3, 7e-3, 1e-3], 0.6));
          }
          const out = [L.mass(d, { lit, lines: lines.filter(Boolean) })];
          const tail0 = [[0.02, -0.46], [0.1, -0.56], [0.26, -0.6], [0.42, -0.5], [0.5, -0.3], [0.52, -0.02], [0.5, 0.22], [0.48, 0.15 + 0.3 * len], [0.46, 0.2 + 0.38 * len]];
          const tail = (L.hat ? [[0.3, -0.3], [0.38, -0.2], [0.46, -0.08], [0.5, 0.1], [0.5, 0.22], [0.48, 0.15 + 0.3 * len], [0.46, 0.2 + 0.38 * len]] : tail0).map(([x, y]) => [x * s, y]);
          const tl = lib(ctx, opts);
          out.push({
            id: "hair-back",
            z: ctx.Z.backHair,
            d: tl.hs(tl.brush(tail, L.hat ? [0.1, 0.15, 0.17, 0.17, 0.14, 0.08, 0.012] : [0.1, 0.14, 0.18, 0.2, 0.19, 0.17, 0.13, 0.075, 0.012])),
            mat: L.mat,
            light: { form: 1, sheenO: 0.4 },
            lit: cmp([tl.sheen(tail.map(([x, y]) => [x - s * 0.04, y]).slice(2, 7), [0.012, 0.04, 0.045, 0.04, 0.012].slice(0, tail.slice(2, 7).length), 0.75)])
          });
          return [...out, ...L.forehead(tieEdge(hy).slice(1, -1), 0.03, { single: true })];
        }
      });
      register({
        kind: "hair",
        name: "bun",
        aliases: ["topknot", "ballerina-bun"],
        describe: "Centre-parted and smoothed back into a high round bun on the crown. Dancers, secretaries, severe librarians.",
        params: { color: "hair colour token", volume: "0.8\u20131.4 (size of the bun)" },
        example: { hair: { style: "bun", color: "cloth-chocolate" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), { G } = L, hy = L.hl * 0.8, v = L.vol;
          const d = capMass(L, tieEdge(hy), { yb: 0, side: 0.012, rise: 0.018, top: 0.034, lift: () => 0 });
          const lit = cmp([L.sheen([[-0.25, -0.31], [-0.22, -0.42], [-0.12, -0.5], [0, -0.52]], [0.01, 0.04, 0.036, 0.01], 0.85)]);
          const lines = [];
          if (L.hi) {
            lines.push({ d: L.hs(L.brush([[0, -0.335 + hy], [0, -0.43], [0, -0.52]], [4e-3, 9e-3, 2e-3])), fill: "deep", o: 0.6 });
            for (let i = 0; i < 6; i++) {
              const x0 = -0.24 + i * 0.08;
              lines.push(L.strand([[x0, -0.32 + hy], [x0 * 0.7, -0.42], [x0 * 0.3, -0.52]], [2e-3, 7e-3, 1e-3], 0.55));
            }
          }
          const r = 0.165 * Math.sqrt(v), cy = -0.5 - r * 0.8;
          const bun = L.hs(G.ellipse(0, cy, r * 1.08, r));
          const blit = cmp([L.sheen([[-r * 0.8, cy + r * 0.2], [-r * 0.6, cy - r * 0.55], [-r * 0.1, cy - r * 0.85]], [8e-3, 0.032, 8e-3], 0.85)]);
          const blines = [];
          if (L.hi) blines.push({ d: L.hs(L.brush([[-r * 0.5, cy + r * 0.5], [r * 0.2, cy + r * 0.45], [r * 0.7, cy - r * 0.1], [r * 0.2, cy - r * 0.6]], [2e-3, 0.012, 0.01, 2e-3])), fill: "shade", o: 0.55 });
          return [
            L.mass(d, { lit, lines: lines.filter(Boolean) }),
            { id: "hair-bun", z: ctx.Z.hair + 0.2, d: bun, mat: L.mat, light: { form: 1.2, sheenO: 0.4 }, lit: blit, lines: blines },
            ...L.forehead(tieEdge(hy).slice(1, -1), 0.03, { single: true })
          ];
        }
      });
    }
  });

  // src/parts/hair/short.js
  var require_short = __commonJS({
    "src/parts/hair/short.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { lib, clamp } = require_lib();
      function forehead(ctx, edge, depth = 0.035) {
        return lib(ctx, {}).forehead(edge, depth, { single: true })[0];
      }
      var cmp = (arr) => arr.filter(Boolean);
      var S = true;
      function massD(L, outer, edge, tension = 0.42) {
        const e = edge.slice().reverse();
        return L.hs(L.smooth([...outer, ...e], tension));
      }
      register({
        kind: "hair",
        name: "short",
        describe: "Short, tidy cut with a soft side part and a little lift. The everyman default; takes grey temples.",
        params: { color: "hair colour token", grey: "temple grey colour token", part: "L|R|none", volume: "0.8\u20131.4" },
        example: { hair: { style: "short", color: "cloth-chocolate" } },
        forehead,
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.8;
          const pX = L.partX("R");
          const edge = [[-0.336, -0.015, true], [-0.332, -0.11], [-0.303, -0.215 + hy], [-0.238, -0.262 + hy], [-0.13, -0.282 + hy], [pX, -0.292 + hy], [0.13, -0.283 + hy], [0.238, -0.262 + hy], [0.303, -0.215 + hy], [0.332, -0.11], [0.336, -0.015, true]];
          const outer = L.shell(-0.015, (y) => 0.014 + 0.032 * clamp((-0.08 - y) / 0.3, 0, 1) * v, 0.056 * v, (x) => 0.03 * v * Math.exp(-Math.pow((x + pX * 1.4) / 0.2, 2)));
          const d = massD(L, outer, edge);
          const lit = cmp([L.sheen([[-0.33, -0.27], [-0.29, -0.4], [-0.18, -0.49], [-0.02, -0.535 - 0.03 * v]], [0.012, 0.05, 0.045, 0.01], 0.8)]);
          const lines = [];
          if (L.hi) {
            lines.push({ d: L.hs(L.brush([[pX, -0.285], [pX + 0.01, -0.4], [pX + 0.03, -0.51]], [4e-3, 9e-3, 2e-3])), fill: "deep", o: 0.6 });
            for (let i = 0; i < 6; i++) {
              const sgn = i % 2 ? 1 : -1, x0 = pX + sgn * (0.04 + Math.floor(i / 2) * 0.07);
              lines.push({ d: L.hs(L.brush([[x0, -0.5], [x0 + sgn * 0.045, -0.42], [x0 + sgn * 0.07, -0.33]], [2e-3, 7e-3, 1e-3])), fill: "shade", o: 0.65 });
            }
          }
          return [L.mass(d, { lit, lines }), ...L.grey(), ...L.forehead(edge, 0.034)];
        }
      });
      register({
        kind: "hair",
        name: "side-part",
        aliases: ["slick-part", "mad-men"],
        describe: "Short dark cut with a visible side part, a full crown, a forelock that sweeps across and dips over the forehead, flicked ends over the ear, sideburns and nape tufts. Stacey on a woman; lower `volume` for the slick Mad Men part on a man.",
        params: { color: "hair colour token", grey: "temple grey colour token", part: "L|R|none (default R = part on viewer-left, sweep to viewer-right)", volume: "0.8\u20131.4 (crown fullness)" },
        example: { hair: { style: "side-part", color: "cloth-black", part: "R" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.8, { skin } = ctx;
          const s = opts.part === "L" ? -1 : 1;
          const P = ([x, y, f]) => [x * s, y, f];
          const up = (y) => y < -0.45 ? -0.45 + (y + 0.45) * (0.55 + 0.45 * v) : y;
          const outer = [
            [-0.338, 0.05, S],
            [-0.372, -0.03],
            [-0.384, -0.16],
            [-0.388, -0.3],
            [-0.41, -0.37, S],
            [-0.372, -0.4],
            [-0.33, -0.5],
            [-0.24, up(-0.58)],
            [-0.1, up(-0.635)],
            [0.06, up(-0.66)],
            [0.2, up(-0.64)],
            [0.31, up(-0.57)],
            [0.385, up(-0.46)],
            [0.415, -0.33],
            [0.42, -0.2],
            [0.435, -0.09],
            [0.462, -5e-3, S],
            [0.405, -0.01],
            [0.375, 0.035, S],
            [0.345, 0.07, S]
          ].map(([x, y, f]) => [x, y, f]);
          const lock = [[0.33, -0.06], [0.325, -0.1], [0.31, -0.115, S], [0.275, -0.14], [0.22, -0.185], [0.15, -0.225], [0.06, -0.26], [-0.03, -0.28 + hy], [-0.13, -0.297 + hy]];
          const back = [[-0.21, -0.285 + hy], [-0.285, -0.235], [-0.322, -0.17], [-0.333, -0.09], [-0.33, -0.02]];
          const d = L.hs(L.smooth([...outer, ...lock, ...back].map(P), 0.38));
          const sw = (a, b) => [a * s, b];
          const lit = [
            L.sheen([sw(-0.32, -0.46), sw(-0.2, up(-0.58)), sw(-0.02, up(-0.63)), sw(0.16, up(-0.6)), sw(0.3, up(-0.5))], [0.012, 0.075, 0.08, 0.07, 0.012], 0.88),
            L.sheen([sw(0, -0.36), sw(0.12, -0.31), sw(0.23, -0.25), sw(0.3, -0.18)], [6e-3, 0.03, 0.03, 6e-3], 0.6),
            L.sheen([sw(-0.37, -0.28), sw(-0.375, -0.16), sw(-0.36, -0.06)], [8e-3, 0.024, 8e-3], 0.45)
          ].filter(Boolean);
          const lines = [];
          const pa = [[-0.13, -0.297 + hy], [-0.12, -0.4], [-0.09, up(-0.5)], [-0.05, up(-0.585)], [-0.02, up(-0.64)]];
          lines.push({ d: L.hs(L.brush(pa.map(P), [6e-3, 0.014, 0.012, 7e-3, 2e-3])), fill: skin.shade, o: 0.9 });
          lines.push({ d: L.hs(L.brush(pa.map(([x, y]) => P([x + 0.012, y + 4e-3])), [4e-3, 9e-3, 8e-3, 5e-3, 1e-3])), fill: L.mat.deep, o: 0.8 });
          if (L.hi) {
            for (let i = 0; i < 6; i++) lines.push(L.strand([sw(-0.07 - i * 0.04, up(-0.55) + i * 0.012), sw(0.07 + i * 0.03, up(-0.5) + i * 0.025), sw(0.2 + i * 0.015, -0.33 + i * 0.02)], [2e-3, 7e-3, 1e-3], 0.6));
            lines.push(L.strand([sw(0.1, -0.31), sw(0.2, -0.24), sw(0.29, -0.15)], [2e-3, 6e-3, 1e-3], 0.7, L.sheenC));
          }
          const out = [L.mass(d, { lit, lines: lines.filter(Boolean), light: { form: 1.15, sheenO: 0.35 } })];
          if (!L.hat) for (const q of [-1, 1]) {
            const T = [[0.352, 0.06], [0.385, 0.18], [0.345, 0.33], [0.28, 0.41, S], [0.285, 0.27], [0.31, 0.12]].map(([x, y, f]) => [q * x, y, f]);
            out.push({ id: `hair-nape-${q < 0 ? "R" : "L"}`, z: ctx.Z.backHair, d: L.hs(L.smooth(T, 0.4)), mat: L.mat, light: { form: 0.8, sheenO: 0.2 } });
          }
          return [...out, ...L.grey(), ...L.forehead([...lock.slice(3), ...[[-0, -0.275 + hy]]].reverse().map(P), 0.05, { dx: 0.014 })];
        }
      });
      register({
        kind: "hair",
        name: "crew",
        aliases: ["crew-cut", "ivy"],
        describe: "Crew cut: short solid top with a crisp square hairline, sides faded close to the scalp. Soldiers, cops, clean-cut types.",
        params: { color: "hair colour token", grey: "temple grey colour token", volume: "0.8\u20131.4" },
        example: { hair: { style: "crew", color: "cloth-brown" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.8;
          const edge = [[-0.336, -0.015, true], [-0.332, -0.12], [-0.31, -0.235 + hy], [-0.24, -0.272 + hy], [-0.12, -0.287 + hy], [0, -0.29 + hy], [0.12, -0.287 + hy], [0.24, -0.272 + hy], [0.31, -0.235 + hy], [0.332, -0.12], [0.336, -0.015, true]];
          const sidesOuter = L.shell(-0.015, 0.012, 0.02);
          const dSides = massD(L, sidesOuter, edge, 0.4);
          const topOuter = L.shell(-0.3, (y) => 0.02 + 0.02 * clamp((-0.3 - y) / 0.15, 0, 1), 0.05 * v, (x) => 0.018 * v * Math.exp(-Math.pow(x / 0.22, 2)));
          const topEdge = [[-0.325, -0.3, true], [-0.29, -0.275 + hy], [-0.2, -0.285 + hy], [0, -0.292 + hy], [0.2, -0.285 + hy], [0.29, -0.275 + hy], [0.325, -0.3, true]];
          const dTop = massD(L, topOuter, topEdge, 0.4);
          const poly = [...L.shell(-0.015, 0.02, 0.03), ...edge.slice().reverse()].map(([x, y]) => [x, y]);
          const side = L.buzzPiece(dSides, poly, { id: "hair-fade", z: ctx.Z.hair - 0.2, scalp: 0.3, spacing: 0.028, rBase: 0.011, fade: (x, y) => y > -0.3 ? clamp(1 - (y + 0.3) * 2.2, 0.35, 1) : 1 });
          const lit = cmp([L.sheen([[-0.27, -0.33], [-0.22, -0.43], [-0.1, -0.5], [0.03, -0.53]], [0.012, 0.04, 0.035, 0.01], 0.8)]);
          const lines = [];
          if (L.hi) for (let i = 0; i < 7; i++) {
            const x0 = -0.2 + i * 0.065;
            lines.push(L.strand([[x0, -0.49], [x0 + 0.015, -0.42], [x0 + 0.02, -0.34]], [2e-3, 6e-3, 1e-3], 0.55));
          }
          return [side, L.mass(dTop, { lit, lines: lines.filter(Boolean) }), ...L.grey({ clip: "hair-fade" }), ...L.forehead(edge.slice(1, -1), 0.03)];
        }
      });
      register({
        kind: "hair",
        name: "buzz",
        aliases: ["buzzcut", "shaved"],
        describe: "Very short buzz cut: the scalp shows through a field of halftone stubble, with a crisp hairline. Alfie.",
        params: { color: "hair colour token", grey: "temple grey colour token", volume: "0.8\u20131.4 (thickness of the stubble)" },
        example: { hair: { style: "buzz", color: "cloth-chocolate" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), hy = L.hl * 0.8;
          const edge = [[-0.34, -0.015, true], [-0.334, -0.12], [-0.31, -0.215 + hy], [-0.245, -0.262 + hy], [-0.13, -0.28 + hy], [0, -0.285 + hy], [0.13, -0.28 + hy], [0.245, -0.262 + hy], [0.31, -0.215 + hy], [0.334, -0.12], [0.34, -0.015, true]];
          const t = 0.012 * L.vol;
          const outer = L.shell(-0.015, t, 0.02 * L.vol);
          const d = massD(L, outer, edge, 0.4);
          const poly = [...outer, ...edge.slice().reverse()];
          const hairlineBand = L.hi ? [{ d: L.hs(L.smooth([...edge.slice(1, -1).map(([x, y]) => [x, y - 0.016]), ...edge.slice(1, -1).slice().reverse().map(([x, y]) => [x, y + 2e-3])], 0.4)), fill: L.mat.base, o: 0.85 }] : [];
          const piece = L.buzzPiece(d, poly, { scalp: 0.06, fields: [] });
          piece.lines.push(...hairlineBand);
          piece.lit = cmp([L.sheen([[-0.3, -0.25], [-0.26, -0.38], [-0.15, -0.47], [-0.02, -0.505]], [0.01, 0.03, 0.03, 8e-3], 0.5)]);
          piece.lit.push(...cmp([L.sheen([[-0.335, -0.1], [-0.33, -0.26], [-0.25, -0.43], [-0.1, -0.5]], [4e-3, 0.022, 0.024, 6e-3], 0.75)]));
          return [piece, ...L.grey({ clip: "hair" }), ...L.forehead(edge.slice(1, -1), 0.022, { single: true })];
        }
      });
      register({
        kind: "hair",
        name: "flattop",
        aliases: ["flat-top", "high-top"],
        describe: "60s flat-top: sides clipped close in a tight fade that follows the skull (grey temples show as fade), and a level brush on top that rises about 0.14 head. Booker.",
        params: { color: "hair colour token", grey: "grey colour token (fades in at the temples)", volume: "0.8\u20131.4 (height of the brush, 0.11\u20130.2 head)" },
        example: { hair: { style: "flattop", color: "cloth-black", grey: "cloth-ash" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.8, C = L.C, rb = 98e-4;
          const hairY = -0.335 + hy, topY = -0.5 - 0.14 * v, hw = 0.328;
          const g = L.greyC();
          const fEdge = [[-0.338, -0.015, S], [-0.334, -0.12], [-0.318, -0.23], [-0.29, hairY + 0.01], [0, hairY + 0.016], [0.29, hairY + 0.01], [0.318, -0.23], [0.334, -0.12], [0.338, -0.015, S]];
          const fOuter = L.shell(-0.015, 0.011, 0.015);
          const smo = (a, b, y) => clamp((y - a) / (b - a), 0, 1);
          const sh = (x) => 0.75 + 0.45 * clamp((x + 0.25) / 0.5, 0, 1);
          const fields = [{ r: (x, y) => rb * sh(x) * (1 - smo(-0.3, -0.08, y)) * 1.15, fill: L.mat.deep, o: 0.95 }];
          if (g) fields.push({ r: (x, y) => rb * 1.1 * sh(x) * smo(-0.3, -0.2, y) * (1 - 0.8 * smo(-0.15, 0, y)), fill: g, o: 0.95 });
          else fields.push({ r: (x, y) => rb * sh(x) * smo(-0.42, -0.3, y) * (1 - 0.85 * smo(-0.2, 0, y)), fill: L.mat.deep, o: 0.9 });
          const fade = L.buzzPiece(massD(L, fOuter, fEdge, 0.4), [...fOuter, ...fEdge.slice().reverse()], { id: "hair-fade", z: ctx.Z.hair - 0.2, scalp: g ? 0.45 : 0.3, spacing: 0.024, fields, jitter: 0.2 });
          const left = [[-0.336, -0.25, S], [-hw - 4e-3, -0.4], [-hw - 0.01, topY + 0.085], [-hw - 3e-3, topY + 0.045], [-hw + 0.022, topY + 0.012], [-hw + 0.07, topY - 2e-3], [-0.15, topY - 6e-3], [-0.05, topY - 8e-3]];
          const right = left.slice(1).reverse().map(([x, y, f]) => [-x, y, f]);
          const top = [0, topY - 9e-3];
          const front = [[0.336, -0.25, S], [0.318, -0.3], [0.29, hairY + 6e-3], [0.15, hairY + 5e-3], [0, hairY + 0.013], [-0.15, hairY + 5e-3], [-0.29, hairY + 6e-3], [-0.318, -0.3]];
          const d = L.hs(L.smooth([...left, top, ...right.slice(1), ...front], 0.3));
          const lit = [], lines = [];
          lit.push(L.sheen([[-hw + 0.06, topY + 0.014], [0, topY + 0.011], [hw - 0.06, topY + 0.014]], [0.014, 0.034, 0.014], 0.8));
          lit.push(L.sheen([[-hw + 0.08, topY + 0.045], [0, topY + 0.042], [hw - 0.08, topY + 0.045]], [0.01, 0.022, 0.01], 0.32));
          lit.push(L.sheen([[-hw + 0.03, topY + 0.09], [-hw + 0.025, -0.44], [-hw + 0.04, hairY - 0.03]], [8e-3, 0.026, 8e-3], 0.4));
          const fl = L.flecks([[-0.26, topY + 0.05], [0.26, topY + 0.05], [0.26, hairY - 0.035], [-0.26, hairY - 0.035]], 38, 75e-4);
          if (fl && !L.hat) lines.push({ d: fl, fill: L.sheenC, o: 0.85 });
          if (L.hi) for (let i = 0; i < 6; i++) {
            const x0 = -0.22 + i * 0.088;
            lines.push(L.strand([[x0, topY + 0.06], [x0 + 4e-3, (topY + hairY) / 2], [x0 + 0.01, hairY - 0.04]], [2e-3, 5e-3, 1e-3], 0.5));
          }
          const out = [fade, L.mass(d, { lit: lit.filter(Boolean), lines: lines.filter(Boolean), light: { form: 0.9, sheenO: 0.3 } })];
          if (g && L.mid && !L.hi) {
            out.push(...L.grey({ clip: "hair-fade", y: [-0.31, -0.03], x: 0.25, x1: 0.37, opacity: 0.95 }));
            out.push(...L.grey({ clip: "hair", y: [topY + 0.07, -0.24], x: 0.215, x1: 0.37, opacity: 0.95 }).map((p) => ({ ...p, id: p.id + "-brush", fill: g })));
          }
          if (L.mid && !L.hat) {
            const dr = (poly, r) => L.dots(poly, { spacing: 0.02, r, jitter: 0.3 });
            const under = dr([[-0.3, hairY + 0.01], [0.3, hairY + 0.01], [0.3, hairY + 0.05], [-0.3, hairY + 0.05]], (x, y) => 72e-4 * clamp(1 - (y - hairY - 0.01) / 0.036, 0, 1) * (1 - Math.abs(x) / 0.45));
            if (under) out.push({ id: "hair-fray", z: ctx.Z.hair - 0.1, d: under, fill: L.mat.base, light: false, clip: "head", opacity: 0.9 });
            const over = dr([[-0.3, topY - 0.04], [0.3, topY - 0.04], [0.3, topY + 5e-3], [-0.3, topY + 5e-3]], (x, y) => 58e-4 * clamp((y - (topY - 0.04)) / 0.035, 0, 1) * (1 - Math.abs(x) / 0.5));
            if (over) out.push({ id: "hair-fuzz", z: ctx.Z.hair - 0.1, d: over, fill: L.mat.base, light: false, opacity: 0.9 });
          }
          return [...out, ...L.forehead([[-0.29, hairY + 0.012], [0, hairY + 0.018], [0.29, hairY + 0.012]], 0.03)];
        }
      });
      register({
        kind: "hair",
        name: "receding",
        aliases: ["widows-peak"],
        describe: "Short hair with a hairline in retreat: a deep M with a widow's peak, thin tidy top. Older men, gone-to-seed schemers.",
        params: { color: "hair colour token", grey: "grey colour token", volume: "0.8\u20131.4" },
        example: { hair: { style: "receding", color: "cloth-brown", grey: "cloth-ash" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol;
          const edge = [[-0.34, -0.045, true], [-0.333, -0.16], [-0.3, -0.28], [-0.235, -0.372], [-0.15, -0.388], [-0.075, -0.352], [0, -0.318], [0.075, -0.352], [0.15, -0.388], [0.235, -0.372], [0.3, -0.28], [0.333, -0.16], [0.34, -0.045, true]];
          const outer = L.shell(-0.015, (y) => 0.02 + 0.016 * clamp((-0.2 - y) / 0.3, 0, 1) * v, 0.045 * v, (x) => 0.02 * v * Math.exp(-Math.pow(x / 0.25, 2)));
          const d = massD(L, outer, edge, 0.4);
          const lit = cmp([L.sheen([[-0.3, -0.34], [-0.26, -0.43], [-0.15, -0.49], [-0.02, -0.52]], [0.01, 0.04, 0.035, 0.01], 0.75)]);
          const lines = [];
          if (L.hi) for (let i = 0; i < 6; i++) {
            const x0 = -0.17 + i * 0.07;
            lines.push(L.strand([[x0, -0.5], [x0 + 0.01, -0.44], [x0 + 0.015, -0.39]], [2e-3, 6e-3, 1e-3], 0.6));
          }
          return [L.mass(d, { lit, lines: lines.filter(Boolean) }), ...L.grey({ y: [-0.34, -0.04] }), ...L.forehead(edge.slice(1, -1), 0.03)];
        }
      });
      function scalpSheen(L) {
        const { ctx, G } = L;
        const out = [];
        if (L.hat) return out;
        const light = ctx.skin.light;
        out.push({ id: "scalp-sheen", z: ctx.Z.hair - 0.3, d: ctx.hs(G.smooth([[-0.27, -0.3], [-0.22, -0.41], [-0.1, -0.475], [0.03, -0.49], [-0.03, -0.44], [-0.14, -0.4], [-0.21, -0.32]].map(L.fx), true, 0.5)), fill: light, light: false, clip: "head", opacity: 0.8 });
        if (L.hi) out.push({ id: "scalp-spec", z: ctx.Z.hair - 0.29, d: ctx.hs(G.ellipse(-0.11 * L.ratio(-0.45), -0.455, 0.045, 0.014, -0.5)), fill: ctx.skin.light, light: false, clip: "head", opacity: 0.95 });
        return out;
      }
      register({
        kind: "hair",
        name: "balding",
        aliases: ["horseshoe", "bald-top"],
        describe: "Horseshoe baldness: a thin band of hair round the sides over the ears, the dome bare and shiny.",
        params: { color: "hair colour token", grey: "grey colour token" },
        example: { hair: { style: "balding", color: "cloth-brown", grey: "cloth-ash" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts);
          const out = [];
          for (const s of [-1, 1]) {
            const pts = [[s * 0.352, -0.02, true], [s * 0.366, -0.13], [s * 0.35, -0.25], [s * 0.325, -0.34], [s * 0.302, -0.375, true], [s * 0.287, -0.3], [s * 0.297, -0.19], [s * 0.305, -0.1], [s * 0.32, -0.03, true]];
            out.push({ id: `hair-${s < 0 ? "R" : "L"}`, z: ctx.Z.hair, d: L.hs(L.smooth(pts, 0.4)), mat: L.mat, light: { form: 1 }, lines: L.hi ? [{ d: L.hs(L.brush([[s * 0.34, -0.3], [s * 0.325, -0.2], [s * 0.335, -0.08]].map(([x, y]) => [x, y]), [2e-3, 7e-3, 1e-3])), fill: "shade", o: 0.6 }] : [] });
          }
          return [...out, ...L.grey({ y: [-0.3, -0.015], x: 0.28, x1: 0.36, opacity: 0.8, clip: { R: "hair-R", L: "hair-L" } }), ...scalpSheen(L)];
        }
      });
      register({
        kind: "hair",
        name: "bald",
        aliases: ["shaved-head"],
        describe: "No hair: just the highlight on a bare scalp.",
        params: {},
        example: { hair: { style: "bald" } },
        draw(ctx, opts) {
          return scalpSheen(lib(ctx, opts));
        }
      });
      module.exports = { forehead, massD };
    }
  });

  // src/parts/hair/volume.js
  var require_volume = __commonJS({
    "src/parts/hair/volume.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { lib, clamp } = require_lib();
      var cmp = (a) => a.filter(Boolean);
      var S = true;
      register({
        kind: "hair",
        name: "afro",
        aliases: ["natural", "fro"],
        describe: "Big round afro with a soft, fuzzy edge and halftone texture: light stipple on the lit side, dense dark grain in shadow. The Veteran.",
        params: { color: "hair colour token", volume: "0.8\u20131.4 (size of the halo)", grey: "grey token (frost)" },
        example: { hair: { style: "afro", color: "cloth-chocolate" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), { G } = L;
          const sv = Math.pow(L.vol, 0.6), C0 = [0, -0.3];
          const wk = L.hat ? 0.74 : 1;
          const E = (x, y, f) => [(C0[0] + (x - C0[0]) * sv) * wk, C0[1] + (y - C0[1]) * sv, f];
          const lobe = () => 1 + (ctx.rng() - 0.5) * (L.mid ? 0.05 : 0.03);
          const outerL = [[0, -0.9], [-0.2, -0.87], [-0.37, -0.77], [-0.5, -0.63], [-0.585, -0.46], [-0.625, -0.28], [-0.61, -0.1], [-0.55, 0.05], [-0.47, 0.14]].map(([x, y]) => {
            const k = lobe();
            return E(C0[0] + (x - C0[0]) * k, C0[1] + (y - C0[1]) * k);
          });
          const inner = [[-0.395, 0.1, S], [-0.345, 0.04], [-0.337, -0.09], [-0.315, -0.165], [-0.26, -0.215], [-0.14, -0.245], [0, -0.255]];
          const left = [...outerL, ...inner];
          const right = left.slice(1, -1).reverse().map(([x, y, f]) => [-x, y, f]);
          const mass = L.hs(L.smooth([...left, ...right], 0.45));
          const poly = [...outerL, ...outerL.slice().reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x, y]);
          const lines = [], lit = [];
          const rb = 0.0136;
          const dl = L.dots(poly, { spacing: 0.039, quad: true, r: (x, y) => rb * clamp((-x * 0.85 + (-0.32 - y) * 0.95) / 0.5, 0, 1), jitter: 0.3 });
          if (dl && L.mid && !L.hat) lit.push({ d: dl, fill: L.sheenC, o: 0.7 });
          const dd = L.dots(poly, { spacing: 0.038, quad: true, r: (x, y) => rb * 1.1 * clamp((x * 0.85 + (y + 0.3) * 0.8 - 0.05) / 0.5, 0, 1), jitter: 0.3 });
          if (dd && L.mid && !L.hat) lines.push({ d: dd, fill: L.mat.deep, o: 0.9 });
          const gc = L.greyC();
          if (gc && L.mid && !L.hat) {
            const gs = L.C.mix(gc, L.mat.shade, 0.4);
            for (const s of [-1, 1]) {
              const gp = [[0.33, -0.4], [0.46, -0.42], [0.58, -0.28], [0.6, -0.05], [0.5, 0.13], [0.34, 0.1]].map(([x, y]) => [s * x, y]);
              const dg = L.dots(gp, { spacing: 0.034, quad: true, jitter: 0.3, r: (x, y) => 0.0158 * clamp((0.58 - Math.abs(x)) / 0.2, 0, 1) * clamp((y + 0.4) / 0.14, 0, 1) });
              if (dg) lines.push({ d: dg, fill: s < 0 ? gc : gs, o: 0.92 });
            }
          } else if (gc && !L.hat) {
            for (const s of [-1, 1]) lines.push({ d: L.hs(L.brush([[s * 0.4, -0.3], [s * 0.43, -0.14], [s * 0.4, 0.03]], [0.03, 0.1, 0.04])), fill: gc, o: 0.5 });
          }
          const rx = 0.64 * sv, ry = 0.62 * sv;
          const ring = [[-rx * 1.1, -0.3], [-rx * 0.95, -0.3 - ry * 0.65], [0, -0.3 - ry * 1.1], [rx * 0.95, -0.3 - ry * 0.65], [rx * 1.1, -0.3], [rx * 0.85, 0.12], [-rx * 0.85, 0.12]];
          const fz = L.mid && !L.hat ? L.dots(ring, { spacing: 0.04, quad: true, r: (x, y) => {
            const rho = Math.sqrt((x / rx) ** 2 + ((y + 0.3) / ry) ** 2);
            return rho < 0.96 ? 0 : 0.0125 * clamp((1.08 - rho) / 0.08, 0, 1);
          }, jitter: 0.35 }) : null;
          const out = [];
          if (fz) out.push({ id: "hair-fuzz", z: ctx.Z.hair - 0.1, d: fz, fill: L.mat.base, light: false, opacity: 0.95 });
          if (!L.hat) lit.push(L.sheen([[-0.46, -0.45], [-0.38, -0.66], [-0.2, -0.8], [0, -0.85]], [0.02, 0.07, 0.06, 0.012], 0.45));
          out.push(L.mass(mass, { lit: lit.filter(Boolean), lines, light: { form: 1.15, sheenO: 0.3 } }));
          const bl = [[-0.5, -0.2], [-0.54, 0.05], [-0.5, 0.25], [-0.38, 0.36], [-0.18, 0.4], [0, 0.41]].map(([x, y]) => E(x, y));
          const bpts = [...bl, ...bl.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
          out.push({ id: "hair-back", z: ctx.Z.backHair, d: ctx.hs(L.smooth(bpts, 0.45)), mat: L.mat, light: { form: 0.7, sheenO: 0.2 } });
          const edge = [[-0.3, -0.2], [-0.2, -0.235], [0, -0.255], [0.2, -0.235], [0.3, -0.2]];
          return [...out, ...L.forehead(edge, 0.07)];
        }
      });
      register({
        kind: "hair",
        name: "beehive",
        aliases: ["bouffant", "bouffant-high"],
        describe: "Teased beehive piled high above a smooth hairline, with swirling sheen planes and little flicked ends at the ears. Socialites and swingers.",
        params: { color: "hair colour token", volume: "0.8\u20131.4 (height of the pile)", grey: "grey token" },
        example: { hair: { style: "beehive", color: "cloth-tobacco" } },
        draw(ctx, opts) {
          const L = lib(ctx, opts), v = L.vol, hy = L.hl * 0.6;
          const H1 = 0.5 * v;
          const top = -0.5 - H1;
          const mx = (f) => top + (-0.5 - top) * f;
          const left = [[0, top], [-0.1, top + 0.012], [-0.2, mx(0.1)], [-0.29, mx(0.26)], [-0.36, mx(0.46)], [-0.405, mx(0.68)], [-0.42, -0.42], [-0.4, -0.3], [-0.372, -0.17], [-0.376, -0.04], [-0.395, 0.03], [-0.42, 0.095, S], [-0.368, 0.09], [-0.338, 0.025, S], [-0.332, -0.1], [-0.3, -0.205 + hy], [-0.2, -0.292 + hy], [-0.1, -0.335 + hy]];
          const centre = [0, -0.348 + hy];
          const right = left.slice(1).reverse().map(([x, y, f]) => [-x, y, f]);
          const d = L.hs(L.smooth([...left, centre, ...right], 0.4));
          const lit = cmp([
            L.sheen([[-0.36, -0.42], [-0.34, mx(0.62)], [-0.24, mx(0.36)], [-0.08, mx(0.14)]], [0.015, 0.07, 0.065, 0.015], 0.9),
            L.sheen([[-0.2, mx(0.8)], [-0.08, mx(0.58)], [0.06, mx(0.4)]], [0.01, 0.04, 0.01], 0.6)
          ]);
          const shade = [{ d: L.hs(L.brush([[-0.37, -0.38], [-0.2, -0.43], [0, -0.45], [0.2, -0.43], [0.37, -0.38]], [0.01, 0.045, 0.05, 0.045, 0.01])), o: 0.5 }];
          const lines = [];
          if (L.hi) {
            for (let i = 0; i < 4; i++) lines.push(L.strand([[-0.3 + i * 0.1, -0.4 - i * 0.02], [-0.18 + i * 0.1, mx(0.55) + i * 0.02], [-0.02 + i * 0.1, mx(0.3)]], [2e-3, 7e-3, 1e-3], 0.6));
            lines.push(L.strand([[-0.1, -0.34 + hy], [-0.12, -0.42], [-0.1, -0.5]], [2e-3, 7e-3, 1e-3], 0.5, "deep"));
          }
          const e = [[-0.3, -0.205 + hy], [-0.2, -0.292 + hy], [-0.1, -0.335 + hy], [0, -0.348 + hy], [0.1, -0.335 + hy], [0.2, -0.292 + hy], [0.3, -0.205 + hy]];
          return [L.mass(d, { lit, shade, lines: lines.filter(Boolean) }), ...L.grey({ y: [-0.28, 0] }), ...L.forehead(e, 0.036)];
        }
      });
      module.exports = {};
    }
  });

  // src/parts/hands/poses.js
  var require_poses = __commonJS({
    "src/parts/hands/poses.js"() {
      "use strict";
      var { register } = require_registry();
      var { handKit, lobes, groove } = require_relaxed();
      var reg = (name, describe, example, build) => register({
        kind: "hands",
        name,
        describe,
        example: { pose: { arms: example, ...name === "fist" ? { hands: { R: "fist", L: "fist" } } : {} } },
        draw(ctx, opts) {
          return build(handKit(ctx, opts.side || "R", opts), ctx, opts);
        }
      });
      var ln = (c, pts, w, fill, o) => c.line(pts, w, fill, o);
      reg(
        "peace",
        "Raised hand, palm out: short palm, two long wide fingers in a clear V, ring and little fingers folded into the palm as knuckle lobes under the thumb (peace sign).",
        { R: "raise", L: "raise" },
        (c) => {
          const main = [
            [-0.096, 0],
            [-0.13, 0.15],
            [-0.148, 0.3],
            [-0.152, 0.42],
            [-0.14, 0.5],
            [-0.158, 0.62],
            [-0.172, 0.78],
            [-0.18, 0.92],
            [-0.172, 1],
            [-0.148, 1.035],
            [-0.12, 1.012],
            [-0.108, 0.93],
            [-0.072, 0.8],
            [-0.03, 0.7],
            [2e-3, 0.63, true],
            [0.04, 0.73],
            [0.08, 0.85],
            [0.108, 0.95],
            [0.126, 1.02],
            [0.154, 1.04],
            [0.178, 1],
            [0.18, 0.92],
            [0.16, 0.8],
            [0.148, 0.66],
            [0.158, 0.57],
            [0.178, 0.5],
            [0.186, 0.43, true],
            [0.18, 0.37],
            [0.186, 0.3],
            [0.15, 0.15],
            [0.098, 0]
          ];
          const lines = [], shade = [];
          if (c.lod("mid")) {
            shade.push({ d: c.sm([[0.04, 0], [0.14, 0.05], [0.17, 0.3], [0.13, 0.5], [0.07, 0.42], [0.03, 0.2]], 0.4, 0), o: 0.55 });
            lines.push(ln(c, [[-0.15, 0.5], [-0.1, 0.545], [-0.05, 0.53]], [2e-3, 0.018, 2e-3], "deep", 0.65));
            lines.push(groove(c, 2e-3, 0.64, 0.12, 0.02, "deep", 0.75));
            lines.push(groove(c, 0.186, 0.43, 0.1, 0.012, "deep", 0.55, -0.03));
          }
          if (c.lod("hi")) {
            lines.push(ln(c, [[-0.138, 0.84], [-0.12, 0.85]], [2e-3, 0.012, 2e-3], "shade", 0.6), ln(c, [[0.122, 0.84], [0.14, 0.85]], [2e-3, 0.012, 2e-3], "shade", 0.6));
            lines.push(ln(c, [[-0.15, 0.99], [-0.138, 1.02]], [0.014, 0.018, 4e-3], "light", 0.6), ln(c, [[0.138, 1], [0.15, 1.025]], [0.014, 0.018, 4e-3], "light", 0.6));
          }
          return [
            c.piece("", main, { lines, shade }),
            c.piece("thumb", [[0.16, 0.18], [0.16, 0.3], [0.1, 0.4], [0.02, 0.47], [-0.07, 0.495], [-0.09, 0.45], [-0.03, 0.39], [0.05, 0.3], [0.085, 0.16]], { dz: 0.04, form: 0.8, lines: c.lod("mid") ? [ln(c, [[0.15, 0.22], [0.09, 0.36], [-0.02, 0.44]], [2e-3, 0.014, 2e-3], "shade", 0.8)] : [] })
          ];
        }
      );
      reg(
        "cigarette",
        "Hand at the mouth: short palm, index and middle fingers in a shallow V (as wide as the finger lobes) holding the cigarette, ring and pinky curled as knuckle lobes, thumb tucked under.",
        { R: "smoke", L: "smoke" },
        (c) => {
          const main = [
            [-0.115, 0],
            [-0.155, 0.16],
            [-0.178, 0.32],
            [-0.183, 0.44],
            [-0.165, 0.53],
            [-0.14, 0.58],
            [-0.138, 0.7],
            [-0.142, 0.82],
            [-0.136, 0.94],
            [-0.108, 0.995],
            [-0.066, 0.96],
            [-0.046, 0.86],
            [-0.012, 0.79, true],
            [0.026, 0.86],
            [0.066, 0.955],
            [0.106, 0.98],
            [0.14, 0.93],
            [0.136, 0.82],
            [0.128, 0.7],
            [0.14, 0.62],
            [0.17, 0.55],
            [0.186, 0.49],
            [0.186, 0.43, true],
            [0.18, 0.38],
            [0.185, 0.3],
            [0.17, 0.2],
            [0.115, 0]
          ];
          const lines = [], shade = [];
          if (c.lod("mid")) {
            shade.push({ d: c.sm([[0.02, 0], [0.13, 0.05], [0.19, 0.3], [0.18, 0.55], [0.1, 0.6], [0.02, 0.3]], 0.4, 0), o: 0.5 });
            lines.push(ln(c, [[-0.17, 0.56], [-0.13, 0.6], [-0.09, 0.585]], [2e-3, 0.018, 2e-3], "deep", 0.6));
            lines.push(groove(c, -0.012, 0.79, 0.2, 0.02, "deep", 0.7));
            lines.push(groove(c, 0.186, 0.43, 0.09, 0.012, "deep", 0.55, -0.025));
            lines.push(ln(c, [[-0.14, 0.78], [-0.09, 0.8]], [2e-3, 0.012, 2e-3], "shade", 0.6));
          }
          if (c.lod("hi")) lines.push(ln(c, [[-0.17, 0.4], [-0.1, 0.38], [0, 0.4], [0.1, 0.42]], [2e-3, 0.018, 2e-3], "light", 0.5));
          return [
            c.piece("", main, { lines, shade }),
            c.piece("thumb", [[0.19, 0.26], [0.195, 0.38], [0.165, 0.5], [0.1, 0.56], [0.06, 0.52], [0.12, 0.4], [0.13, 0.26]], { dz: 0.04, form: 0.8 })
          ];
        }
      );
      function fistShape(top) {
        const L = [{ x: -0.142, w: 0.074, y: 0.7 }, { x: -0.069, w: 0.074, y: 0.74 }, { x: 4e-3, w: 0.074, y: 0.745 }, { x: 0.077, w: 0.074, y: 0.71 }];
        const pts = [[-0.115, 0], [-0.152, 0.12], [-0.176, 0.32], [-0.18, 0.5], [-0.172, 0.62], ...lobes(L, 0.04), [0.145, 0.65], [0.188, 0.55], [0.196, 0.38], [0.158, 0.2], [0.108, 0]];
        return { pts, L };
      }
      function fistDetail(c, L, rows) {
        const lines = [], shade = [];
        if (c.lod("mid")) {
          shade.push({ d: c.sm([[0.05, 0.05], [0.18, 0.15], [0.2, 0.6], [0.1, 0.78], [0, 0.5]], 0.4, 0), o: 0.55 });
          for (let i = 1; i < L.length; i++) lines.push(groove(c, (L[i - 1].x + L[i].x) / 2, Math.min(L[i - 1].y, L[i].y) - 0.04, 0.12, 0.014, "deep", 0.6));
          for (const y of rows) lines.push(ln(c, [[-0.165, y], [-0.05, y + 0.02], [0.08, y], [0.17, y - 0.02]], [2e-3, 0.015, 2e-3], "deep", 0.5));
        }
        if (c.lod("hi")) lines.push(ln(c, [[-0.16, 0.34], [-0.05, 0.31], [0.09, 0.33]], [2e-3, 0.02, 2e-3], "light", 0.5));
        return { lines, shade };
      }
      reg(
        "grip",
        "Fist closed on a handle (briefcase, bag, pistol grip): short palm block, four curled finger lobes, a crease row, thumb wrapped over.",
        { R: "carry", L: "carry" },
        (c) => {
          const f = fistShape(), d = fistDetail(c, f.L, [0.5]);
          return [
            c.piece("", f.pts, d),
            c.piece("thumb", [[0.1, 0.1], [0.2, 0.2], [0.235, 0.36], [0.215, 0.5], [0.15, 0.55], [0.06, 0.47], [0.06, 0.3]], { dz: 0.04, form: 0.8, lines: c.lod("mid") ? [ln(c, [[0.11, 0.16], [0.19, 0.3], [0.17, 0.46]], [2e-3, 0.016, 2e-3], "shade", 0.8)] : [] })
          ];
        }
      );
      reg(
        "fist",
        "Clenched fist, back of the hand to the viewer: knuckle row of four lobes on top, finger creases, thumb across.",
        { R: "raise", L: "raise" },
        (c) => {
          const f = fistShape(), d = fistDetail(c, f.L, [0.5, 0.6]);
          return [
            c.piece("", f.pts, d),
            c.piece("thumb", [[0.12, 0.42], [0.2, 0.5], [0.19, 0.62], [0.1, 0.7], [0, 0.7], [-0.05, 0.64], [0.03, 0.55]], { dz: 0.04, form: 0.8 })
          ];
        }
      );
      reg(
        "hip",
        "Hand on the hip (akimbo): the back of the hand and knuckles rest on the hip bone, four short finger lobes turning away behind the contour, thumb hidden.",
        { R: "hip", L: "hip" },
        (c) => {
          const F = [{ x: -0.1, w: 0.052, y: 0.53 }, { x: -0.048, w: 0.054, y: 0.605 }, { x: 6e-3, w: 0.056, y: 0.635 }, { x: 0.06, w: 0.054, y: 0.6 }];
          const main = [[-0.125, 0], [-0.168, 0.14], [-0.182, 0.3], [-0.17, 0.43], [-0.14, 0.495], ...lobes(F, 0.045), [0.12, 0.53], [0.16, 0.46], [0.19, 0.38], [0.196, 0.28], [0.182, 0.16], [0.125, 0]];
          const lines = [], shade = [];
          if (c.lod("mid")) {
            shade.push({ d: c.sm([[-0.02, 0.38], [0.14, 0.4], [0.13, 0.62], [0, 0.68], [-0.1, 0.55]], 0.4, 0), o: 0.8 });
            lines.push(groove(c, -0.074, 0.505, 0.14, 0.015, "deep", 0.6), groove(c, -0.021, 0.57, 0.15, 0.017, "deep", 0.6), groove(c, 0.033, 0.575, 0.14, 0.015, "deep", 0.55));
          }
          if (c.lod("hi")) for (const [x, y] of [[-0.12, 0.4], [-0.05, 0.43], [0.02, 0.44], [0.09, 0.42]]) lines.push({ d: c.blob(x, y, 0.034, 0.02), fill: "light", o: 0.5 });
          return [c.piece("", main, { lines, shade })];
        }
      );
      reg(
        "tucked",
        "Hand folded under the opposite arm: only a stub of four knuckled finger lobes shows past the forearm.",
        { R: "cross", L: "cross" },
        (c, ctx) => {
          const F = [{ x: -0.118, w: 0.068, y: 0.45 }, { x: -0.05, w: 0.07, y: 0.48 }, { x: 0.02, w: 0.07, y: 0.475 }, { x: 0.09, w: 0.066, y: 0.44 }];
          const main = [[-0.125, 0], [-0.17, 0.12], [-0.186, 0.28], [-0.16, 0.4], ...lobes(F, 0.03), [0.15, 0.4], [0.18, 0.26], [0.125, 0]];
          const lines = c.lod("mid") ? [groove(c, -0.084, 0.43, 0.14, 0.014, "deep", 0.6), groove(c, -0.015, 0.45, 0.14, 0.015, "deep", 0.55), groove(c, 0.055, 0.43, 0.14, 0.014, "deep", 0.55)] : [];
          return [c.piece("", main, { lines, dz: (c.A.side === "R" ? 54.9 : 54.8) - (c.A.z + 0.8) })];
        }
      );
      reg(
        "hold",
        "Cupped hand, palm up: heel of the palm, four fingers curling up in staggered lobes around a glass, cup or book, and a separate opposable thumb standing on the near side with a clear web.",
        { R: "hold", L: "hold" },
        (c) => {
          const F = [{ x: 0.152, w: 0.058, y: 0.78 }, { x: 0.094, w: 0.062, y: 0.885 }, { x: 0.03, w: 0.064, y: 0.945 }, { x: -0.036, w: 0.062, y: 0.925 }];
          const main = [[0.125, 0], [0.175, 0.2], [0.2, 0.4], [0.204, 0.58], [0.19, 0.68], ...lobes(F, 0.04), [-0.095, 0.84], [-0.085, 0.76], [-0.06, 0.68], [-0.05, 0.5], [-0.09, 0.34], [-0.14, 0.2], [-0.12, 0]];
          const lines = [], shade = [];
          if (c.lod("mid")) {
            shade.push({ d: c.sm([[0, 0.1], [0.19, 0.3], [0.18, 0.6], [0.06, 0.85], [-0.02, 0.6], [-0.02, 0.3]], 0.4, 0), o: 0.5 });
            lines.push(groove(c, 0.062, 0.855, 0.3, 0.017, "deep", 0.6, -0.04), groove(c, 0.122, 0.775, 0.3, 0.017, "deep", 0.55, -0.02));
            lines.push(groove(c, -3e-3, 0.9, 0.25, 0.015, "deep", 0.5, -0.03));
          }
          if (c.lod("hi")) lines.push(ln(c, [[0, 0.3], [0.08, 0.36], [0.17, 0.4]], [2e-3, 0.02, 2e-3], "light", 0.45));
          const thumb = [[-0.085, 0.1], [-0.15, 0.1], [-0.215, 0.17], [-0.262, 0.27], [-0.285, 0.37], [-0.28, 0.47], [-0.252, 0.515], [-0.222, 0.49], [-0.205, 0.41], [-0.17, 0.33], [-0.115, 0.27], [-0.07, 0.24]];
          return [
            c.piece("", main, { lines, shade }),
            c.piece("thumb", thumb, {
              dz: 0.04,
              form: 0.8,
              lines: c.lod("mid") ? [ln(c, [[-0.17, 0.14], [-0.235, 0.26], [-0.255, 0.4]], [2e-3, 0.018, 2e-3], "shade", 0.8)] : [],
              ...c.lod("hi") ? { lit: [{ d: c.blob(-0.256, 0.47, 0.016, 0.022, 0.4), fill: "light", o: 0.6 }] } : {}
            })
          ];
        }
      );
      reg(
        "lapel",
        "Hand gripping a lapel: back of the hand to the viewer, four folded finger lobes hooked over the edge, thumb lying along the near side.",
        { R: "lapel", L: "lapel" },
        (c) => {
          const F = [{ x: -0.135, w: 0.076, y: 0.735 }, { x: -0.061, w: 0.078, y: 0.795 }, { x: 0.015, w: 0.078, y: 0.805 }, { x: 0.089, w: 0.074, y: 0.765 }];
          const main = [[-0.12, 0], [-0.17, 0.15], [-0.19, 0.36], [-0.186, 0.55], [-0.17, 0.64], ...lobes(F, 0.045), [0.15, 0.7], [0.196, 0.6], [0.205, 0.44], [0.185, 0.34], [0.125, 0.14], [0.12, 0]];
          const lines = [], shade = [];
          if (c.lod("mid")) {
            shade.push({ d: c.sm([[0, 0.05], [0.13, 0.1], [0.2, 0.4], [0.14, 0.7], [0.03, 0.62], [0, 0.3]], 0.4, 0), o: 0.5 });
            lines.push(groove(c, -0.098, 0.7, 0.13, 0.016, "deep", 0.6), groove(c, -0.023, 0.76, 0.15, 0.018, "deep", 0.6), groove(c, 0.052, 0.74, 0.13, 0.016, "deep", 0.55));
          }
          if (c.lod("hi")) {
            lines.push(ln(c, [[-0.17, 0.48], [-0.05, 0.46], [0.1, 0.48]], [2e-3, 0.02, 2e-3], "light", 0.5));
            for (const [x, y] of [[-0.135, 0.62], [-0.061, 0.67], [0.015, 0.68], [0.089, 0.65]]) lines.push({ d: c.blob(x, y, 0.03, 0.017), fill: "light", o: 0.45 });
          }
          const thumb = [[0.115, 0.12], [0.185, 0.2], [0.232, 0.33], [0.252, 0.47], [0.242, 0.59], [0.212, 0.63], [0.186, 0.56], [0.168, 0.44], [0.138, 0.32]];
          return [
            c.piece("", main, { lines, shade }),
            c.piece("thumb", thumb, { dz: 0.04, form: 0.8, lines: c.lod("mid") ? [ln(c, [[0.15, 0.2], [0.205, 0.34], [0.216, 0.5]], [2e-3, 0.016, 2e-3], "shade", 0.8)] : [] })
          ];
        }
      );
    }
  });

  // src/core/tokens.js
  var require_tokens = __commonJS({
    "src/core/tokens.js"(exports, module) {
      "use strict";
      var BRAND = {
        "ink-150": "#c9c3b8",
        "ink-300": "#8e8880",
        "ink-500": "#55504a",
        "ink-700": "#2a2521",
        "ink-900": "#14110e",
        "paper-000": "#fbf8f1",
        "paper-100": "#f2ede1",
        "paper-200": "#e8e2d4",
        "paper-300": "#dcd4c2",
        "signal-500": "#e0691e",
        "signal-700": "#b8481a",
        "signal-900": "#6b2a10",
        "caution-500": "#e8c33c",
        "caution-700": "#c39b18",
        "caution-900": "#6e5408",
        "file-300": "#8fa3dd",
        "file-500": "#3f62c4",
        "file-700": "#26418f",
        "file-900": "#12224f",
        "covert-500": "#6e8f6a",
        "covert-700": "#41633e",
        "covert-900": "#13513b",
        "alarm-500": "#e03a20",
        "alarm-700": "#a8210f",
        "alarm-900": "#5c1208",
        "swing-500": "#c9348c",
        "swing-700": "#98206a",
        "swing-900": "#4e0f36",
        "slate-500": "#6e8a8c",
        "slate-700": "#3e5356",
        "slate-900": "#1a1a1c"
      };
      var CLOTH = {
        "cloth-black": "#1f1b18",
        "cloth-charcoal": "#33302d",
        "cloth-graphite": "#4a4744",
        "cloth-ash": "#8c8177",
        "cloth-stone": "#b9ae9c",
        "cloth-cream": "#efe4cc",
        "cloth-white": "#f4efe4",
        "cloth-navy": "#22283f",
        "cloth-ink-blue": "#2a334b",
        "cloth-cobalt": "#4862a6",
        "cloth-sky": "#829fbf",
        "cloth-teal": "#586766",
        "cloth-sea": "#697c7b",
        "cloth-petrol": "#28474a",
        "cloth-forest": "#2e3d2a",
        "cloth-sage": "#8fa37c",
        "cloth-olive": "#5b5a2c",
        "cloth-avocado": "#6f7230",
        "cloth-khaki": "#8a7d5a",
        "cloth-mustard": "#d9b13b",
        "cloth-ochre": "#c39231",
        "cloth-camel": "#c09a6b",
        "cloth-tan": "#a8784a",
        "cloth-tobacco": "#7e5634",
        "cloth-brown": "#5c3a22",
        "cloth-chocolate": "#371706",
        "cloth-rust": "#a84427",
        "cloth-orange": "#c56b30",
        "cloth-brick": "#8d3a24",
        "cloth-oxblood": "#5c1a14",
        "cloth-red": "#b83a2a",
        "cloth-salmon": "#c37270",
        "cloth-pink": "#d68a9a",
        "cloth-magenta": "#c44d8d",
        "cloth-plum": "#4e1f3e",
        "cloth-aubergine": "#280921",
        "cloth-lilac": "#9a86b0",
        "cloth-denim": "#3a4f6e",
        "cloth-faded-denim": "#6f86a3",
        "cloth-warm-grey": "#64564c"
      };
      var MATTER = {
        "metal-steel": "#8e9496",
        "metal-gun": "#3a3c3e",
        "metal-brass": "#c39b18",
        "metal-chrome": "#c9ccc8",
        "wood-dark": "#4a2c18",
        "wood-light": "#9a6a3a",
        "leather-brown": "#6b3f22",
        "leather-black": "#221d1a",
        "glass-dark": "#1d2226",
        "paper-news": "#e8e2d4",
        "smoke": "#e8e2d4",
        "flame": "#e8c33c"
      };
      var SKIN = {
        porcelain: { light: "#f1d6c2", base: "#e6c0a8", shade: "#b48682", deep: "#653c40", line: "#8a5a52", blush: "#dc9a8e", lip: "#c06e68" },
        fair: { light: "#eccdb0", base: "#dfb08c", shade: "#a87870", deep: "#58343a", line: "#86584a", blush: "#d08e78", lip: "#b06656" },
        olive: { light: "#e0b384", base: "#c99460", shade: "#8e5e44", deep: "#46281e", line: "#704830", blush: "#bd7c5c", lip: "#94563e" },
        tan: { light: "#d39a66", base: "#b97c4c", shade: "#7a4a2e", deep: "#3a2014", line: "#5e3820", blush: "#ac6444", lip: "#80442e" },
        brown: { light: "#b8743e", base: "#935226", shade: "#552a16", deep: "#26100a", line: "#3e1e0e", blush: "#984a2a", lip: "#5e2816" },
        deep: { light: "#b8662c", base: "#85401c", shade: "#3a170c", deep: "#180805", line: "#2a1008", blush: "#86381a", lip: "#45180c" },
        ebony: { light: "#8a4e2a", base: "#5c2e16", shade: "#2c1209", deep: "#100604", line: "#200c06", blush: "#6a2c16", lip: "#30120a" },
        flushed: { light: "#e8a690", base: "#d48270", shade: "#9a5052", deep: "#4e2428", line: "#7a3a36", blush: "#c45a50", lip: "#a0423c" },
        pale: { light: "#f0dccb", base: "#e3c8b4", shade: "#ac9090", deep: "#62484c", line: "#8c706a", blush: "#dca69c", lip: "#bc7e7a" }
      };
      var SCHEMES = {
        natural: { rim: null, key: "#fff4e0", shadow: "#2a1f1d", map: null },
        "natural-rim": { rim: "#c37270", key: "#fff4e0", shadow: "#2a1f1d", map: null },
        hound: { rim: "#c37270", key: "#e9efe8", shadow: "#191713", map: ["#191713", "#2f2925", "#586766", "#697c7b", "#b9bab5", "#f6f5ed"], spotKeep: true },
        crews: { rim: "#7e98c3", key: "#efeef3", shadow: "#1f1e1e", map: ["#1a1d2a", "#2c3a6e", "#4862a6", "#7e98c3", "#c8c8d0", "#f4f4f7"], spotKeep: true },
        shadows: { rim: "#b5c3a5", key: "#c0cbb1", shadow: "#20251c", map: ["#161a12", "#2c3626", "#455239", "#768666", "#a0b38d", "#d4dcc8"], spotKeep: true },
        veteran: { rim: "#e4c83c", key: "#e4c83c", shadow: "#2a1e1a", map: ["#1e1612", "#2a1e1a", "#4b372b", "#8c8177", "#e4c83c", "#fbf3c8"], spotKeep: false },
        intellectual: { rim: "#c56b30", key: "#f4ead0", shadow: "#17120b", map: ["#17120b", "#301504", "#5d3517", "#8e491a", "#cda472", "#f4ead0"], spotKeep: false },
        characters: { rim: "#d9b13b", key: "#f0decd", shadow: "#3a1708", map: ["#2a1006", "#5c2510", "#a84427", "#c56b30", "#d9b13b", "#f0decd"], spotKeep: false },
        swinger: { rim: "#ca5e98", key: "#f6f5ec", shadow: "#371706", map: null },
        militants: { rim: "#edd23c", key: "#fcfaf1", shadow: "#221815", map: ["#160f0c", "#221815", "#402e26", "#7e7570", "#e7c639", "#fcfaf1"], spotKeep: false },
        paranormal: { rim: "#c65d4b", key: "#e3ecf9", shadow: "#1f2650", map: ["#141a3a", "#3a4683", "#5870b0", "#749ed3", "#ccdff4", "#fcfbfa"], spotKeep: true },
        balcony: { rim: "#ddbd5d", key: "#eddbcb", shadow: "#280921", map: null },
        ink: { rim: null, key: "#ffffff", shadow: "#14110e", map: ["#14110e", "#14110e"], spotKeep: false }
        // silhouette
      };
      var STYLE = {
        formShadow: 0.3,
        // crescent offset as a fraction of piece width
        formShadowMaxHH: 0.34,
        // cap, in head-heights
        formDy: 0.35,
        // vertical component of the shadow offset (light slightly above)
        bands: [0.1, 0.06],
        // stipple terminator bands as fractions of piece width (outer, inner)
        bandAlpha: [0.28, 0.55],
        lit: 0.04,
        // key-light sheen on the lit edge
        stipplePx: 0.75,
        // stipple noise frequency in cycles per output px
        grainPx: 1.1,
        // grain frequency per output px
        grainAlpha: 0.16,
        lod: { hi: 110, mid: 34 },
        // px per head thresholds (mid was 42: a 300 px figure is 35-44 px per head and a line-up under about 360 px high is 29-44, and they drew at lo)
        // expression gain (P2.1) by px per head, piecewise linear between these [pxPerHead, gain] points: face parts multiply their
        // expression geometry by ctx.expr.gain so faces still read small. 1 at portrait size (no caricature drift at hi LOD).
        exprGain: [[110, 1], [76, 1.4], [40, 1.8], [16, 2.5]],
        minLinePx: 0.6
      };
      var Z = {
        backProp: 2,
        backHair: 6,
        cape: 8,
        legs: 10,
        tights: 11,
        feet: 12,
        torso: 20,
        tucked: 25,
        bottom: 26,
        feetOver: 27,
        neck: 28,
        top: 30,
        tie: 31.5,
        mid: 33,
        outer: 36,
        collar: 38,
        belt: 40,
        strap: 42,
        arm: 45,
        armCross: 55,
        head: 60,
        ears: 61,
        earring: 61.5,
        face: 62,
        facialHair: 64,
        eyewear: 66,
        mask: 67,
        maskOver: 69.5,
        hair: 70,
        maskVeil: 70.6,
        hat: 72,
        necklace: 31.7,
        frontProp: 80,
        fx: 90
      };
      function tok(name) {
        if (name == null) return null;
        if (typeof name !== "string") return name;
        if (name[0] === "#") return name;
        return BRAND[name] || CLOTH[name] || MATTER[name] || null;
      }
      module.exports = { BRAND, CLOTH, MATTER, SKIN, SCHEMES, STYLE, Z, tok, INK: BRAND["ink-900"], PAPER: BRAND["paper-000"] };
    }
  });

  // src/core/color.js
  var require_color = __commonJS({
    "src/core/color.js"(exports, module) {
      "use strict";
      var T = require_tokens();
      function rgb(hex2) {
        hex2 = T.tok(hex2) || hex2;
        if (!/^#[0-9a-f]{6}$/i.test(hex2)) throw new Error(`Unknown colour "${hex2}". Use a token name (e.g. "cloth-olive", "file-500") or #rrggbb.`);
        const n = parseInt(hex2.slice(1), 16);
        return [n >> 16 & 255, n >> 8 & 255, n & 255];
      }
      var clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));
      function hex(c) {
        return "#" + c.map((v) => clamp(Math.round(v)).toString(16).padStart(2, "0")).join("");
      }
      function mix(a, b, t) {
        const A = rgb(a), B = rgb(b);
        return hex(A.map((v, i) => v + (B[i] - v) * t));
      }
      function multiply(a, b) {
        const A = rgb(a), B = rgb(b);
        return hex(A.map((v, i) => v * B[i] / 255));
      }
      function screen(a, b) {
        const A = rgb(a), B = rgb(b);
        return hex(A.map((v, i) => 255 - (255 - v) * (255 - B[i]) / 255));
      }
      function lum(a) {
        const [r, g, b] = rgb(a).map((v) => v / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      function toHsl(c) {
        let [r, g, b] = rgb(c).map((v) => v / 255);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (mx + mn) / 2;
        if (mx !== mn) {
          const d = mx - mn;
          s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
          h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
          h /= 6;
        }
        return [h, s, l];
      }
      function fromHsl([h, s, l]) {
        const f = (p2, q2, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
          if (t < 1 / 2) return q2;
          if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
          return p2;
        };
        if (s === 0) return hex([l * 255, l * 255, l * 255]);
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
        return hex([f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]);
      }
      function saturate(c, k) {
        const h = toHsl(c);
        h[1] = Math.max(0, Math.min(1, h[1] * k));
        return fromHsl(h);
      }
      function shadeOf(c, t, shadow = "#2a1f1d") {
        const tint = mix("#ffffff", shadow, t);
        return saturate(multiply(c, tint), 1.12);
      }
      var KIND = {
        cloth: { s: 0.5, d: 0.78, l: 0.14, line: 0.62, form: 1, bands: true, rim: true, gloss: 0 },
        wool: { s: 0.52, d: 0.8, l: 0.1, line: 0.62, form: 1, bands: true, rim: true, gloss: 0 },
        knit: { s: 0.5, d: 0.78, l: 0.1, line: 0.6, form: 1, bands: true, rim: true, gloss: 0 },
        denim: { s: 0.5, d: 0.78, l: 0.16, line: 0.66, form: 1, bands: true, rim: true, gloss: 0 },
        canvas: { s: 0.48, d: 0.76, l: 0.14, line: 0.6, form: 1, bands: true, rim: true, gloss: 0 },
        leather: { s: 0.6, d: 0.85, l: 0.38, line: 0.7, form: 1, bands: false, rim: true, gloss: 1 },
        satin: { s: 0.45, d: 0.75, l: 0.42, line: 0.6, form: 1, bands: true, rim: true, gloss: 1 },
        metal: { s: 0.62, d: 0.86, l: 0.6, line: 0.75, form: 0.8, bands: false, rim: true, gloss: 1 },
        hair: { s: 0.55, d: 0.8, l: 0.22, line: 0.7, form: 0.9, bands: true, rim: true, gloss: 0.5 },
        glass: { s: 0.4, d: 0.7, l: 0.5, line: 0.7, form: 0.6, bands: false, rim: false, gloss: 1 },
        paper: { s: 0.3, d: 0.6, l: 0.08, line: 0.5, form: 0.6, bands: true, rim: false, gloss: 0 },
        wood: { s: 0.5, d: 0.8, l: 0.18, line: 0.7, form: 0.9, bands: true, rim: true, gloss: 0 },
        flat: { s: 0.5, d: 0.78, l: 0.14, line: 0.62, form: 0, bands: false, rim: false, gloss: 0 }
      };
      function material(colour, kind = "cloth", scheme = T.SCHEMES.natural, opts = {}) {
        if (colour && typeof colour === "object" && colour.base) return colour;
        if (kind === "skin") {
          const sk = T.SKIN[colour] || T.SKIN.fair;
          return { kind: "skin", ...sk, rim: scheme.rim || sk.light, form: 1, bands: true, rimOn: !!scheme.rim, gloss: 0 };
        }
        const k = KIND[kind] || KIND.cloth;
        let base = T.tok(colour), bad = null;
        if (!base) {
          bad = colour;
          base = T.tok("cloth-graphite");
        }
        const sh = scheme.shadow || "#2a1f1d";
        const L = lum(base);
        const s = k.s * (L > 0.75 ? 0.75 : 1), d = k.d;
        const out = {
          kind,
          base,
          light: mix(base, scheme.key || "#fff4e0", k.l + (L < 0.12 ? 0.12 : 0)),
          shade: L < 0.1 ? mix(base, "#000000", 0.35) : shadeOf(base, s, sh),
          deep: L < 0.1 ? mix(base, "#000000", 0.6) : shadeOf(base, d, sh),
          line: L < 0.1 ? mix(base, "#ffffff", 0.12) : shadeOf(base, k.line, sh),
          rim: scheme.rim || null,
          form: opts.form != null ? opts.form : k.form,
          bands: k.bands,
          rimOn: k.rim,
          gloss: k.gloss
        };
        if (bad) out._bad = bad;
        return out;
      }
      function mapLum(a) {
        const [r, g, b] = rgb(a).map((v) => v / 255);
        return 0.3 * r + 0.58 * g + 0.12 * b;
      }
      function mapThrough(a, stops) {
        if (!stops || !stops.length) return hex(rgb(a));
        const L = Math.max(0, Math.min(1, mapLum(a))), n = stops.length - 1, t = L * n, i = Math.min(n - 1, Math.floor(t)), f = t - i;
        if (n === 0) return hex(rgb(stops[0]));
        const A = rgb(stops[i]), B = rgb(stops[i + 1]);
        return hex(A.map((v, k) => v + (B[k] - v) * f));
      }
      function contrast(a, b) {
        const la = lum(a) + 0.05, lb = lum(b) + 0.05;
        return la > lb ? la / lb : lb / la;
      }
      module.exports = { rgb, hex, mix, multiply, screen, lum, saturate, shadeOf, material, toHsl, fromHsl, KIND, mapLum, mapThrough, contrast };
    }
  });

  // src/core/light.js
  var require_light = __commonJS({
    "src/core/light.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var C = require_color();
      var T = require_tokens();
      var PRESETS = {
        bluetime: {
          time: "bluetime",
          key: { az: 135, el: 40 },
          keyColor: "#f3f1ea",
          ambient: "#3a4256",
          shadow: { color: "#1c2130", opacity: 0.4 },
          rim: null,
          under: null,
          wrap: 0.48,
          castShadow: true,
          depth: 0.74
        },
        night: {
          time: "night",
          key: { az: 115, el: 22 },
          keyColor: "#f0b25a",
          ambient: "#1d2438",
          shadow: { color: "#0d1220", opacity: 0.55 },
          rim: { color: "#6f86b8", strength: 0.75 },
          under: null,
          wrap: 0.5,
          castShadow: false,
          depth: 0.8,
          exposure: 0.88
        }
      };
      var NIGHT_POOL = { key: { az: 205, el: 30 }, wrap: 0.42 };
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var deg = Math.PI / 180;
      function resolve(opt, warn = () => {
      }) {
        var _a, _b, _c;
        if (opt === "v1" || opt === false) {
          warn(`light ${opt === false ? "false" : '"v1"'}: light v1 retired in 3.0.0; drew bluetime`);
          opt = null;
        }
        if (opt == null || opt === true || opt === "v2") opt = "bluetime";
        if (typeof opt === "string") {
          if (!PRESETS[opt]) warn(`light "${opt}" not found, drew bluetime (available: ${Object.keys(PRESETS).join(", ")}, or a light object)`);
          opt = { time: PRESETS[opt] ? opt : "bluetime" };
        }
        if (typeof opt !== "object") {
          warn("light: expected a preset name or a light object, drew bluetime");
          opt = { time: "bluetime" };
        }
        const base = PRESETS[opt.time === "night" ? "night" : "bluetime"];
        const pool = opt.time === "night" && opt.under && opt.pool !== false ? NIGHT_POOL : {};
        const L = { ...base, ...pool, ...opt, key: { ...base.key, ...pool.key || {}, ...opt.key || {} } };
        if (opt.elevation != null) L.key.el = opt.elevation;
        if (typeof opt.key === "number") L.key = { ...base.key, az: opt.key };
        L.shadow = { ...base.shadow, ...opt.shadow || {} };
        if (opt.shadowUnify != null) L.shadow.opacity = opt.shadowUnify;
        if (opt.rim === true) L.rim = { color: null, strength: 1 };
        if (opt.under === true) L.under = { color: base.keyColor, strength: 0.8 };
        if (L.under) {
          L.under = { color: L.keyColor, strength: 0.8, at: 0, reach: 0.55, ...L.under };
          const low = L.under.at <= 0.1;
          L.under.el = (_a = L.under.el) != null ? _a : low ? 30 : 10;
          L.under.wrap = (_b = L.under.wrap) != null ? _b : low ? 0.18 : 0.24;
          L.under.az = (_c = L.under.az) != null ? _c : low ? 255 : 265;
        }
        for (const k of ["keyColor", "ambient"]) L[k] = T.tok(L[k]) || L[k];
        const az = clamp(+L.key.az || 0, -360, 360) * deg, el = clamp(+L.key.el, 0, 89) * deg;
        L.dir = [Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), Math.max(0.06, Math.sin(el))];
        L.side = L.dir[0] <= 0 ? 1 : -1;
        L.v2 = true;
        return L;
      }
      var HEAD_KINDS = /* @__PURE__ */ new Set(["head", "ears", "eyes", "brows", "nose", "mouth", "expression", "age", "mark", "facialHair", "makeup", "eyewear", "mask", "hair", "hat"]);
      var LOCAL_KINDS = /* @__PURE__ */ new Set(["prop", "jewellery"]);
      function volumeOf(p) {
        const id = p.id || "", k = p._kind || "";
        if (p.light && p.light.local) return "local";
        if (p.light && p.light.volume) return p.light.volume;
        if (LOCAL_KINDS.has(k)) return "local";
        if (k === "companion") return "companion";
        if (k === "footwear") {
          const sd = /(?:^|-)(R|L)(?:$|-)/.exec(id);
          return sd ? `leg-${sd[1]}` : "legs";
        }
        if (HEAD_KINDS.has(k)) return "head";
        const arm = /(?:^|-)(?:arm|sleeve|cuff|hand|glove)-(R|L)(?:$|[-\d])/.exec(id) || /^(?:hand|glove)-(R|L)/.exec(id);
        if (arm) return `arm-${arm[1]}`;
        const leg = /(?:^|-)leg-(R|L)(?:$|-)/.exec(id);
        if (leg) return `leg-${leg[1]}`;
        if (k === "legwear") return "legs";
        if (k === "bottom") return /skirt|kilt/.test(`${p._name || ""} ${id}`) ? "torso" : "legs";
        if (id === "neck" || /^neck(-|$)/.test(id)) return "neck";
        return "torso";
      }
      function chord(m, lz, q, wrap) {
        const A = m * m + lz * lz;
        if (q <= 1e-6 || A * q * q <= wrap * wrap) return { a: q, b: q, full: true };
        const r = lz * Math.sqrt(A * q * q - wrap * wrap);
        let a = (wrap * m - r) / A, b = (wrap * m + r) / A;
        a = clamp(a, -q, q);
        if (!(b < q) || wrap - b * m < -1e-9) b = q;
        return { a, b, full: false };
      }
      function cylSection(L, t, hw) {
        let n = [-t[1], t[0]];
        let m = n[0] * L.dir[0] + n[1] * L.dir[1];
        if (m < 0) {
          n = [-n[0], -n[1]];
          m = -m;
        }
        const s = chord(m, L.dir[2], 1, L.wrap);
        return { n, a: s.a * hw, b: s.b * hw, full: s.full };
      }
      function chainRegion(samples, far, band) {
        const T1 = [], F = [], B1 = [];
        for (const s of samples) {
          const { P, n, a, hw } = s;
          T1.push(G.add(P, G.mul(n, a)));
          F.push(G.add(P, G.mul(n, -(hw + far))));
          B1.push(G.add(P, G.mul(n, Math.min(a + band, hw * 1.05))));
        }
        const shadow = G.poly([...T1, ...F.slice().reverse()]);
        const bandD = G.poly([...B1, ...T1.slice().reverse()]);
        return { shadow, band: bandD };
      }
      function regions(L, R, pieces, scale, prefix) {
        const hh = R.hh, y = R.y, wrap = L.wrap;
        const BIG = 6 * hh;
        const bandW = (hw) => Math.max(2.5 / scale, Math.min(0.15 * hw, 0.06 * hh));
        const vol = {};
        const add = (name, key, d) => {
          if (!d) return;
          (vol[name] = vol[name] || { sh: [], band: [], under: [], edge: [] })[key].push(d);
        };
        const U = L.under ? { ...L, dir: underDir(L), wrap: L.under.wrap } : null;
        function cylinder(name, pts, hws, far, ext = 0) {
          const doLight = (LL, keyS) => {
            const samples = [];
            for (let i = 0; i < pts.length; i++) {
              const t = G.norm(G.sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
              const s = cylSection(LL, t, hws[i]);
              let P = pts[i];
              if (ext && (i === 0 || i === pts.length - 1)) P = G.add(P, G.mul(t, i === 0 ? -ext : ext));
              samples.push({ P, n: s.n, a: s.a, b: s.b, hw: hws[i] });
            }
            if (keyS === "under") {
              const s2 = samples.map((s) => ({ ...s, n: G.mul(s.n, -1), a: -s.b }));
              const T1 = samples.map((s) => G.add(s.P, G.mul(s.n, s.a))), N1 = samples.map((s) => G.add(s.P, G.mul(s.n, s.a >= s.hw * 0.98 ? s.a : s.b >= s.hw * 0.98 ? s.hw + far : s.b)));
              if (samples.some((s) => s.a < s.hw * 0.98)) add(name, "under", G.poly([...T1, ...N1.reverse()]));
              return void s2;
            }
            const r = chainRegion(samples, far, bandW(Math.max(...hws)));
            add(name, keyS, r.shadow);
            if (keyS === "sh") {
              add(name, "band", r.band);
              const ew = (hw) => Math.max(1.6 / scale, Math.min(0.16 * hw, 0.05 * hh));
              const lit = samples.filter((s) => s.b >= s.hw * 0.98);
              if (lit.length === samples.length) {
                const A = samples.map((s) => G.add(s.P, G.mul(s.n, s.hw - ew(s.hw)))), Bp = samples.map((s) => G.add(s.P, G.mul(s.n, s.hw + Math.min(far, 0.3 * hh))));
                add(name, "edge", G.poly([...A, ...Bp.reverse()]));
              }
            }
            if (samples.some((s) => s.b < s.hw * 0.98)) {
              const s2 = samples.map((s) => ({ ...s, n: G.mul(s.n, -1), a: -s.b }));
              add(name, keyS, chainRegion(s2, far, 0).shadow);
            }
          };
          doLight(L, "sh");
          if (U) doLight(U, "under");
        }
        {
          const ys = [];
          for (let Y = y.neckBase - 0.1 * hh; Y <= 1e-3; Y += 0.2 * hh) ys.push(Y);
          const pts = ys.map((Y) => R.torsoPt(0, Y)), hws = ys.map((Y) => R.widthAt(Y) * 1.05);
          cylinder("torso", pts, hws, BIG);
          const ps = ys.filter((Y) => Y >= y.waist - 0.2 * hh && Y <= y.crotch + 0.3 * hh);
          cylinder("legs", ps.map((Y) => R.torsoPt(0, Y)), ps.map((Y) => R.widthAt(Y) * 1.05), 0.25 * hh);
        }
        cylinder("neck", [[R.head.cx, y.chin - 0.1 * hh], [R.centerAt(y.neckBase), y.neckBase + 0.25 * hh]], [R.w.neck * 1.05, R.w.neckBase * 1.1], 0.6 * hh, 0.1 * hh);
        for (const s of ["R", "L"]) {
          const A = R.arms[s], w = A.widths;
          const hand = G.add(A.wrist, G.mul(A.handDir, R.limbs.hand));
          cylinder(`arm-${s}`, [A.shoulder, A.elbow], [w.top * 1.25, w.elbow * 1.25], 0.35 * hh, 0.18 * hh);
          cylinder(`arm-${s}`, [A.elbow, A.wrist], [w.elbow * 1.25, w.wrist * 1.3], 0.35 * hh, 0.12 * hh);
          cylinder(`arm-${s}`, [A.wrist, hand], [w.wrist * 1.4, w.wrist * 1.3], 0.2 * hh, 0.08 * hh);
          const Lg = R.legs[s], lw = Lg.widths;
          const legPts = [Lg.hip, Lg.knee, Lg.ankle], legW = [lw.thigh * 1.15, lw.knee * 1.25, lw.ankle * 1.6];
          for (const nm of [`leg-${s}`, "legs"]) {
            cylinder(nm, [legPts[0], legPts[1]], [legW[0], legW[1]], 0.3 * hh, 0.15 * hh);
            cylinder(nm, [legPts[1], legPts[2]], [legW[1], legW[2]], 0.3 * hh, 0.25 * hh);
          }
        }
        {
          const cp = pieces.filter((p) => p._kind === "companion" && p.d);
          if (cp.length) {
            let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
            for (const p of cp) {
              const b = G.bbox(p.d);
              x0 = Math.min(x0, b.x);
              x1 = Math.max(x1, b.x1);
              y0 = Math.min(y0, b.y);
              y1 = Math.max(y1, b.y1);
            }
            const hw = (x1 - x0) / 2, cx = (x0 + x1) / 2;
            cylinder("companion", [[cx, y0 - 0.2 * hh], [cx, y1 + 0.2 * hh]], [hw, hw], 0.5 * hh);
          }
        }
        const headRegion = (LL) => {
          const H = R.head, rx = H.w * H.k * 1.02, ry = 0.5 * H.k * 1, c = [H.cx, H.cy - 0.02 * H.k];
          const lxy = [LL.dir[0], LL.dir[1]], m = Math.hypot(lxy[0], lxy[1]);
          const eu = m > 1e-6 ? [lxy[0] / m, lxy[1] / m] : [-1, 0], ev = [-eu[1], eu[0]];
          const toKit = (u, v) => {
            const x = u * eu[0] + v * ev[0], yy = u * eu[1] + v * ev[1];
            const p = [c[0] + x * rx, c[1] + yy * ry];
            return H.tilt ? G.rot(p, H.tilt, H.pivot) : p;
          };
          const term = [], far = [], band = [], near = [];
          const N = 28;
          for (let i = -3; i <= N + 3; i++) {
            const v = -1.25 + 2.5 * i / N, vv = clamp(v, -1, 1), q = Math.sqrt(Math.max(0, 1 - vv * vv));
            const s = chord(m, LL.dir[2], q, LL.wrap);
            const a = Math.abs(v) > 1 ? 0 : s.a;
            term.push(toKit(a, v));
            far.push(toKit(-3, v));
            near.push(toKit(3, v));
            band.push(toKit(Math.min(q, a + 0.16), v));
          }
          return { shadow: G.poly([...term, ...far.reverse()]), lit: G.poly([...term, ...near.reverse()]), band: G.poly([...band, ...term.slice().reverse()]) };
        };
        {
          const r = headRegion({ ...L, wrap: wrap * 0.9 });
          add("head", "sh", r.shadow);
          add("head", "band", r.band);
        }
        if (U) add("head", "under", headRegion({ ...U, wrap: U.wrap }).lit);
        const away = G.norm([-L.dir[0], -L.dir[1] + 0.35]);
        const kz = 1 - L.dir[2] * 0.6;
        const idOf = (p) => p._id;
        const CAST = [
          { name: "head-neck", casters: (p) => {
            var _a;
            return p._vol === "head" && /^(head|hair|hat-brim|hat-crown|facial-hair)/.test(p.id || "") && ((_a = p.z) != null ? _a : 50) >= 59;
          }, to: (p) => {
            var _a;
            return p._vol === "neck" || p._vol === "torso" && ((_a = p.z) != null ? _a : 50) < 59;
          }, d: 0.2 * hh },
          { name: "brim-face", casters: (p) => p._kind === "hat" && /brim|peak|visor/.test(p.id || ""), to: (p) => {
            var _a;
            return p._vol === "head" && p._kind !== "hat" && ((_a = p.z) != null ? _a : 50) < 72;
          }, d: 0.13 * hh },
          { name: "fringe", casters: (p) => {
            var _a;
            return p._kind === "hair" && ((_a = p.z) != null ? _a : 50) >= 65;
          }, to: (p) => p.id === "head", d: 0.045 * hh },
          { name: "arm-torso", casters: (p) => {
            var _a;
            return /^arm-/.test(p._vol) && ((_a = p.z) != null ? _a : 50) >= 54;
          }, to: (p) => {
            var _a;
            return p._vol === "torso" && ((_a = p.z) != null ? _a : 50) < 54;
          }, d: 0.12 * hh },
          { name: "hem-legs", casters: (p) => (p._kind === "outer" || p._kind === "dress") && p._vol === "torso" && !/collar|lapel|pocket|belt|button/.test(p.id || ""), to: (p) => p._vol === "legs" || /^leg-/.test(p._vol) || p._kind === "footwear", d: 0.16 * hh }
        ];
        for (const p of pieces) p._vol = volumeOf(p);
        const castUse = {};
        for (const r of CAST) {
          const cs = pieces.filter((p) => p.d && p._id && p.light !== false && r.casters(p));
          if (!cs.length) continue;
          const dx = away[0] * r.d * kz, dy = away[1] * r.d * kz;
          castUse[r.name] = cs.map((p) => `<use href="#${idOf(p)}-s" transform="translate(${G.f(dx)} ${G.f(dy)})"/>`).join("");
        }
        const defs = [], made = {};
        const clip = (key, inner) => {
          if (!made[key]) {
            made[key] = `${prefix}-lv-${key}`;
            defs.push(`<clipPath id="${made[key]}">${inner}</clipPath>`);
          }
          return made[key];
        };
        const paths = (ds) => ds.map((d) => `<path d="${d}"/>`).join("");
        function of(p) {
          const v = p._vol;
          if (v === "local" || !vol[v]) return null;
          const rules = CAST.filter((r) => castUse[r.name] && r.to(p) && !r.casters(p)).map((r) => r.name);
          const face = !!(p.light && p.light.face);
          const key = [face ? "face" : v, ...rules].join("_");
          const sh = face && !rules.length ? null : clip(`${key}-sh`, (face ? "" : paths(vol[v].sh)) + rules.map((r) => castUse[r]).join(""));
          const band = !face && vol[v].band.length ? clip(`${v}-bd`, paths(vol[v].band)) : null;
          const under = U && vol[v].under.length ? clip(`${v}-un`, paths(vol[v].under)) : null;
          const edge = !face && vol[v].edge.length ? clip(`${v}-ed`, paths(vol[v].edge)) : null;
          return { sh, band, under, edge };
        }
        return { defs, of, vol };
      }
      function facePattern(L, face) {
        const want = face && face.light || L.face;
        if (["loop", "rembrandt", "split", "rim"].includes(want)) return want;
        const el = Math.asin(clamp(L.dir[2], 0, 1)) / deg;
        if (L.time === "night" && !L.under) return "rim";
        return el < 16 ? "split" : el < 30 ? "rembrandt" : "loop";
      }
      function underDir(L) {
        var _a, _b;
        const az = ((_a = L.under.az) != null ? _a : 255) * deg, el = ((_b = L.under.el) != null ? _b : 35) * deg;
        return [Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), Math.sin(el)];
      }
      function relight(mat, L, scheme) {
        if (!mat || !mat.base) return mat;
        const cache = relight._c = relight._c || /* @__PURE__ */ new Map();
        const key = `${mat.base}|${mat.shade}|${mat.kind}|${L.keyColor}|${L.ambient}|${L.shadow.color}|${L.shadow.opacity}|${L.depth}|${scheme && scheme.shadow}|${L.exposure || 1}`;
        if (cache.has(key)) return { ...mat, ...cache.get(key) };
        const mapped = !!(scheme && scheme.map);
        const amb = mapped ? scheme.shadow || L.ambient : L.ambient;
        const keyMul = C.mix("#ffffff", L.keyColor, mapped ? 0.15 : L.time === "night" ? 0.55 : 0.12);
        const ex = L.exposure || 1;
        const lit = (c) => {
          const m = C.multiply(c, keyMul);
          return ex === 1 ? m : C.mix("#000000", m, ex);
        };
        const lumB = C.lum(mat.base);
        const depth = L.depth * (lumB > 0.75 ? 0.92 : 1);
        let shade = C.shadeOf(mat.base, depth, amb);
        if (mat.kind === "skin" && !mapped) shade = C.mix(mat.shade, amb, 0.12);
        if (lumB < 0.08) shade = C.mix(mat.base, C.mix(amb, "#000000", 0.55), 0.45);
        const cloth = mat.kind !== "skin" && lumB >= 0.22;
        shade = C.mix(shade, L.shadow.color, clamp(L.shadow.opacity, 0, 1) * (lumB < 0.08 ? 0.3 : mat.kind === "skin" ? 0.3 : cloth && !mapped ? 0.45 : 1));
        if (cloth && !mapped) {
          const floor = C.saturate(C.multiply(mat.base, "#8a8a8a"), 1.12);
          if (C.lum(shade) < C.lum(floor)) shade = floor;
        }
        if (ex !== 1) shade = C.mix("#000000", shade, Math.min(1, ex + 0.08));
        const darkLift = lumB < 0.06 ? 0.1 : lumB < 0.13 ? 0.08 : 0;
        const litBase = darkLift ? C.mix(mat.base, C.mix(L.keyColor, L.ambient, 0.45), darkLift) : mat.base;
        if (darkLift) shade = C.mix(shade, "#000000", 0.5);
        else if (lumB < 0.22) shade = C.mix(shade, "#000000", 0.3);
        const edgeC = lit(C.mix(litBase, L.keyColor, lumB < 0.22 ? 0.3 : 0.22));
        const out = { edgeC, edgeO: lumB < 0.22 ? 0.75 : 0.5, base: lit(litBase), light: mat.light ? lit(mat.light) : mat.light, shade, deep: C.mix(shade, "#000000", 0.32), line: mat.line ? lit(mat.line) : mat.line, v2Shade: shade };
        if (mat.blush) out.blush = lit(mat.blush);
        if (mat.lip) out.lip = lit(mat.lip);
        cache.set(key, out);
        return { ...mat, ...out };
      }
      function underColour(mat, L) {
        const c = L.under.color || L.keyColor;
        return C.mix(C.screen(C.multiply(mat.base, C.mix("#ffffff", c, 0.6)), C.mix("#000000", c, 0.35)), c, 0.18);
      }
      function edgeFilter(prefix, L, o) {
        var _a;
        const { scale, hh, scheme } = o;
        const away = G.norm([-L.dir[0], -L.dir[1]]);
        const w = Math.max(1.3 / scale, Math.min(0.045 * hh, 3.2 / scale));
        const parts = [];
        const rimC = L.rim ? L.rim.color || scheme && scheme.rim || "#c37270" : scheme && scheme.rim;
        const rimS = L.rim ? (_a = L.rim.strength) != null ? _a : 1 : 1;
        if (rimC) {
          parts.push(`<feOffset in="SourceAlpha" dx="${G.f(-away[0] * w * 1.15)}" dy="${G.f(-away[1] * w * 1.15)}" result="rmo"/><feComposite in="SourceAlpha" in2="rmo" operator="out" result="rme"/><feFlood flood-color="${T.tok(rimC) || rimC}" flood-opacity="${clamp(rimS, 0, 1)}"/><feComposite in2="rme" operator="in" result="rim"/>`);
        }
        const litO = L.time === "night" ? 0.24 : 0.3;
        const lw = Math.max(1 / scale, w * 0.55);
        parts.push(`<feOffset in="SourceAlpha" dx="${G.f(away[0] * lw)}" dy="${G.f(away[1] * lw)}" result="lto"/><feComposite in="SourceAlpha" in2="lto" operator="out" result="lte"/><feFlood flood-color="${L.keyColor}" flood-opacity="${litO}"/><feComposite in2="lte" operator="in" result="lit"/>`);
        return { prims: parts.join(""), nodes: [rimC ? "rim" : null, "lit"].filter(Boolean) };
      }
      module.exports = { PRESETS, NIGHT_POOL, facePattern, resolve, volumeOf, regions, relight, underColour, edgeFilter, chord };
    }
  });

  // src/parts/head/_planes.js
  var require_planes = __commonJS({
    "src/parts/head/_planes.js"(exports, module) {
      "use strict";
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var hexA = (hex, a) => hex + Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, "0");
      function outlineLeft(P) {
        var _a;
        const { crownW, templeW, cheekW, cheekY, midW, jawW, jawY, chinW, chinY, chin, bulge, sharp } = P;
        const L = [
          [0, -0.5],
          [-crownW * 0.62, -0.465],
          [-crownW * 0.95, -0.33],
          [-templeW, -0.16],
          [-cheekW, cheekY],
          [-midW, (_a = P.midY) != null ? _a : 0.14],
          [-jawW, jawY, !!sharp]
        ];
        const mx = (jawW + chinW) / 2 + bulge, my = (jawY + chinY) / 2 + 0.012;
        if (chin === "square") {
          L.push([-mx, my], [-chinW, chinY - 0.022, true], [-chinW * 0.42, chinY]);
        } else if (chin === "pointed") {
          L.push([-mx, my], [-chinW * 0.62, chinY - 0.032], [-0.018, chinY + 4e-3]);
        } else if (chin === "cleft") {
          L.push([-mx, my], [-chinW, chinY - 0.03], [-chinW * 0.4, chinY], [-0.012, chinY - 8e-3]);
        } else {
          L.push([-mx, my], [-chinW, chinY - 0.03], [-chinW * 0.35, chinY]);
        }
        return L;
      }
      function buildOutline(G, P) {
        const L = outlineLeft(P);
        const R = L.slice(1).reverse().map(([x, y, s]) => [-x, y, s]);
        const pts = P.chin === "cleft" ? [...L.slice(0, -1), ...R.slice(1)] : [...L, ...R];
        const d = G.smooth(pts, true, 0.5);
        const dense = G.resample(L.map((p) => [p[0], p[1]]), 160, 0.5);
        const widthAt = (y) => {
          let best = 0;
          for (let i = 0; i < dense.length - 1; i++) {
            const [x0, y0] = dense[i], [x1, y1] = dense[i + 1];
            if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
              const t = (y - y0) / (y1 - y0);
              best = Math.max(best, -(x0 + (x1 - x0) * t));
            }
          }
          if (!best) best = y < -0.5 ? 0 : -dense[dense.length - 1][0];
          return best;
        };
        return { d, pts, widthAt };
      }
      function resolveShape(ctx, o, d) {
        var _a, _b, _c, _d;
        const H0 = ctx.head, fem = !!ctx.R.fem;
        const w = H0.w * (d.wK || 1);
        const jk = clamp(o.jaw || 1, 0.7, 1.4);
        const fj = fem ? 0.93 : 1, fc = fem ? 0.85 : 1;
        const P = {
          crownW: w * d.crown,
          templeW: w * d.temple,
          cheekW: w * d.cheek,
          cheekY: (_a = d.cheekY) != null ? _a : 0.03,
          midW: w * d.mid * (1 + (jk - 1) * 0.5) * (fem ? 0.975 : 1),
          jawW: w * d.jaw * jk * fj,
          jawY: ((_b = d.jawY) != null ? _b : 0.3) - (fem ? 0.012 : 0),
          chinW: ((_c = d.chinW) != null ? _c : 0.11) * Math.sqrt(jk) * fc,
          chinY: (_d = d.chinY) != null ? _d : 0.5,
          chin: o.chin || d.chin || "round",
          bulge: (d.bulge || 0) * (fem ? 0.8 : 1),
          sharp: !!d.sharp && !fem,
          midY: d.midY
        };
        P.jawW = Math.min(P.jawW, P.cheekW * (d.jaw > 1 ? 1.1 : 1));
        if (o.chin === "square" && !d.chin) P.chinW *= 1.35;
        if (o.chin === "pointed") P.chinW *= 0.7;
        if (P.chin === "square" && fem) P.chinW *= 0.92;
        return { P, w, fem, jk };
      }
      function facePlanesV2(ctx, H, kIn = {}) {
        var _a, _b, _c, _d, _e;
        const { G, skin } = ctx;
        const LV = require_light();
        const out = { shade: [], deep: [], lit: [], lines: [] };
        const named = ctx.S.face && ctx.S.face.light || ctx.light.face;
        let pat = LV.facePattern(ctx.light, ctx.S.face || {});
        if (!named && pat === "rembrandt" && ctx.C.lum(skin.shade) < 0.28) pat = "loop";
        const sd = ctx.light.side || 1;
        const hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
        const fem = !!ctx.R.fem;
        const k = { socket: 1, jaw: 1, chin: 1, jowl: 0, ...kIn };
        const dk = Math.max(0, Math.min(1, (0.36 - ctx.C.lum(skin.shade)) / 0.13));
        k.socket *= 1 - 0.85 * dk;
        const X = (pts) => pts.map(([x, y, c]) => c ? [sd * x, y, c] : [sd * x, y]);
        const S = (pts, t = 0.5) => ctx.hs(G.smooth(X(pts), true, t));
        const B = (pts, ws) => ctx.hs(G.brush(X(pts), ws));
        const wid = H.widthAt || (() => H.w);
        const ex = H.eyeX, br = H.brow, hl = H.hairline, ny = (_a = H.noseY) != null ? _a : 0.205, my = (_b = H.mouthY) != null ? _b : 0.31, cy = (_c = H.chinY) != null ? _c : 0.5;
        const FAR = 0.9;
        const far = [[FAR, cy + 0.2], [FAR, -0.62], [0, -0.62]];
        let main;
        if (pat === "loop") {
          const t = (y, f) => [wid(y) * f, y];
          main = [[wid(-0.42) * 0.5, -0.62], t(-0.42, 0.56), t(-0.22, 0.56), t(br, 0.64), t(0.02, 0.68), t(0.1, 0.6), t(0.2, 0.5), t(my, 0.47), t(0.42, 0.36), [H.chinW * 0.4, cy + 0.02], [H.chinW * 0.4, cy + 0.2], ...far.slice(0, 2)];
        } else if (pat === "rim") {
          main = [[-FAR, -0.62], [-FAR, cy + 0.2], [FAR, cy + 0.2], [FAR, -0.62]];
        } else {
          const nb = (_d = H.noseW) != null ? _d : 0.075;
          main = [[0.03, -0.62], [0.025, hl], [0.03, br - 0.02], [0.034, -0.02], [0.04, 0.08], [nb * 0.75, ny - 0.03], [nb * 0.9, ny + 5e-3], [0.02, ny + 0.02], [6e-3, my - 0.03], [0, my + 0.02], [-4e-3, 0.42], [0, cy + 0.04], [0, cy + 0.2], ...far.slice(0, 2)];
        }
        out.shade.push({ d: S(main, 0.35), o: 1 });
        if (pat === "rembrandt")
          out.lit.push({ d: S([[0.06, 0.06], [ex + 0.07, 0.055], [0.08, 0.19]], 0.15), fill: "base", o: 1 });
        if (pat === "rim") {
          const e = [-0.34, -0.2, -0.05, 0.1, 0.25, 0.38].map((y) => [-(wid(y) - 4e-3), y]);
          out.lit.push({ d: B(e, [4e-3, 0.03, 0.036, 0.034, 0.026, 6e-3]), fill: "base", o: 1 });
        }
        if (!mid) return out;
        if (dk > 0.5 && pat !== "rim") {
          out.lit.push({ d: B([[-wid(0.06) * 0.86, 0.05], [-wid(0.06) * 0.55, 0.115], [-wid(0.06) * 0.22, 0.16]], [8e-3, 0.055, 0.01]), fill: "light", o: 0.7 * dk });
          out.lit.push({ d: B([[-ex - 0.1, br - 0.035], [-ex, br - 0.05], [-ex + 0.09, br - 0.035]], [6e-3, 0.026, 6e-3]), fill: "light", o: 0.6 * dk });
        }
        out.deep.push({ d: S([[0.04, br + 0.03], [ex, br + 8e-3], [ex + 0.11, br + 0.03], [ex + 0.1, 0.03], [ex, 0.05], [0.06, 0.035]]), o: (pat === "rim" ? 0.2 : 0.32) * k.socket * (fem ? 0.8 : 1) });
        if (pat !== "rim") out.shade.push({ d: S([[-ex - 0.09, br + 0.03], [-ex, br + 0.012], [-ex + 0.09, br + 0.034], [-ex + 0.07, 0.03], [-ex - 0.07, 0.03]]), o: 0.18 * k.socket * (fem ? 0.8 : 1) });
        if (pat === "loop") out.shade.push({ d: S([[0.012, ny - 4e-3], [0.07, ny + 6e-3], [0.1, ny + 0.045], [0.07, ny + 0.06], [0.02, ny + 0.03]], 0.45), o: 0.95 });
        out.deep.push({ d: S([[-0.05, ny + 0.012], [0, ny + 6e-3], [0.06, ny + 0.014], [0.04, ny + 0.034], [-0.03, ny + 0.03]], 0.45), o: 0.4 });
        for (const s of [-1, 1]) {
          const ys = [H.jawY - 0.06, H.jawY + 0.03, (H.jawY + cy) / 2 + 0.015, cy - 0.03];
          const pts = ys.map((y) => [s * (wid(y) - 0.01), y]);
          const ws = [0.01, 0.06, 0.06, 0.03].map((v) => v * k.jaw * (1 + (k.jowl || 0) * 0.6));
          (s < 0 ? out.shade : out.deep).push({ d: B(pts, ws), o: s < 0 ? 0.75 : 0.55 });
        }
        out.deep.push({ d: B([[-H.chinW * 1.05, cy - 0.04], [0, cy - 0.022], [H.chinW * 1.05, cy - 0.044]], [0.01, 0.034 * k.chin, 0.012]), o: 0.4 * k.chin });
        if (hi) {
          out.lit.push({ d: B([[-wid(0.03) * 0.82, 0.03], [-wid(0.03) * 0.5, 0.1], [-wid(0.03) * 0.22, 0.15]], [6e-3, 0.05, 8e-3]), o: 0.45 });
          out.lit.push({ d: S([[-H.w * 0.7, hl + 0.02], [-0.03, hl - 5e-3], [-0.04, br - 0.05], [-H.w * 0.64, br - 0.03]]), o: 0.32 });
          if (k.jowl) for (const s of [-1, 1]) out[s < 0 ? "shade" : "deep"].push({ d: B([[s * ((_e = H.mouthW) != null ? _e : 0.135) * 0.55, my + 0.05], [s * (H.jawW * 0.62), my + 0.1], [s * (H.jawW * 0.8), H.jawY + 0.06]], [4e-3, 0.022 * k.jowl, 6e-3]), o: s < 0 ? 0.3 : 0.4 });
        }
        return out;
      }
      function facePlanes(ctx, H, kIn = {}) {
        return facePlanesV2(ctx, H, kIn);
      }
      function makeHead(ctx, o, def) {
        var _a, _b, _c, _d;
        const { G } = ctx;
        const { P, w, fem } = resolveShape(ctx, o, def);
        const out = buildOutline(G, P);
        const wid = out.widthAt;
        const eyeX = (_a = def.eyeX) != null ? _a : ctx.head.eyeX;
        const earX = wid(0.07) * 0.985;
        const head = {
          outline: out.d,
          w,
          jawW: P.jawW,
          jawY: P.jawY,
          chinW: P.chinW,
          chinY: P.chinY,
          cheekW: P.cheekW,
          cheekY: P.cheekY,
          templeW: wid(-0.16),
          skullW: wid(-0.22),
          earX,
          earTop: (_b = def.earTop) != null ? _b : -0.05,
          earBot: (_c = def.earBot) != null ? _c : 0.19,
          widthAt: wid,
          eyeX,
          ...def.noseY != null ? { noseY: def.noseY, noseTipY: def.noseY - 0.035 } : {},
          ...def.mouthY != null ? { mouthY: def.mouthY } : {},
          ...def.brow != null ? { brow: def.brow } : {},
          ...def.mouthW != null ? { mouthW: def.mouthW } : {}
        };
        const Hn = { ...ctx.head, ...head };
        const mod = facePlanes(ctx, Hn, def.planes || {});
        return {
          head,
          pieces: [{ id: "head", z: ctx.Z.head, d: ctx.hs(out.d), mat: ctx.skin, shade: mod.shade, deep: mod.deep, lit: mod.lit, lines: mod.lines, light: { form: (_d = def.form) != null ? _d : 1, face: true } }]
        };
      }
      var PARAMS = { jaw: "0.8\u20131.3 jaw width multiplier (spec.head.jaw)", chin: "round|square|pointed|cleft (spec.head.chin)", width: "0.85\u20131.15 (spec.head.width)" };
      module.exports = { clamp, hexA, buildOutline, resolveShape, facePlanes, makeHead, PARAMS };
    }
  });

  // src/parts/hats/_hat.js
  var require_hat = __commonJS({
    "src/parts/hats/_hat.js"(exports, module) {
      "use strict";
      var { hexA } = require_planes();
      function frame(ctx) {
        const H = ctx.head;
        const wid = H.widthAt || (() => H.w);
        const w = H.skullW || H.w;
        return { H, wid, w, cw: w + 0.03 };
      }
      var sym = (L) => [...L, ...L.slice(1, -1).reverse().map(([x, y, s]) => [-x, y, s])];
      var rotPts = (pts, a, c = [0, -0.3]) => pts.map(([x, y, s]) => {
        const dx = x - c[0], dy = y - c[1], co = Math.cos(a), si = Math.sin(a);
        return [c[0] + dx * co - dy * si, c[1] + dx * si + dy * co, s];
      });
      function castShadow(ctx, edge, depth, o = {}) {
        var _a, _b, _c, _d;
        const { G, skin } = ctx;
        if (!ctx.lodAtLeast("mid")) return [];
        const sh = (_a = o.shift) != null ? _a : 0.02, hw = (_b = o.hw) != null ? _b : 0.4;
        const low = (k) => edge.slice().reverse().map(([x, y]) => [x + sh * k, y + depth * k * (1 - 0.45 * Math.min(1, Math.abs(x) / hw))]);
        const lines = [{ d: ctx.hs(G.smooth([...low(1), ...low(1.5).slice().reverse()], true, 0.5)), fill: hexA(skin.shade, 0.5), stip: true }];
        const mk = (id, k, fill, op, ln) => ({ id, z: ctx.Z.face + 1.2, d: ctx.hs(G.smooth([...edge, ...low(k)], true, 0.5)), fill, light: false, clip: "head", opacity: op, lines: ln });
        return [mk("hat-shadow", 1, skin.shade, (_c = o.o) != null ? _c : 0.92, lines), mk("hat-shadow-core", 0.55, skin.deep, (_d = o.core) != null ? _d : 0.6)];
      }
      module.exports = { frame, sym, rotPts, castShadow, hexA };
    }
  });

  // src/parts/hats/hats-main.js
  var require_hats_main = __commonJS({
    "src/parts/hats/hats-main.js"() {
      "use strict";
      var { register } = require_registry();
      var { frame, sym, rotPts, castShadow, hexA } = require_hat();
      var tokOr = (ctx, t, d) => ctx.T.tok(t) ? t : d;
      register({
        kind: "hat",
        name: "trilby",
        aliases: ["fedora"],
        describe: "Trilby / fedora: pinched crown, ribbon band, short snap brim that throws the eyes into shadow (the Shadows plate).",
        params: { color: "felt colour token", band: "ribbon colour token", pin: "optional feather/pin accent token (spot colour)", tilt: "-0.2..0.2 radians" },
        example: { hair: { hat: { type: "trilby", color: "cloth-charcoal", band: "cloth-black", pin: "alarm-500" } } },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const { cw, w } = frame(ctx);
          const T = (_a = o.tilt) != null ? _a : -0.05, c = [0, -0.2];
          const R = (pts) => rotPts(pts, T, c);
          const felt = ctx.mat(tokOr(ctx, o.color, "cloth-charcoal"), "wool");
          const bandM = ctx.mat(tokOr(ctx, o.band, "cloth-black"), "wool");
          const bw = cw + 0.17;
          const brimPts = R(sym([[0, -0.285], [-bw * 0.55, -0.272], [-bw, -0.205, true], [-bw * 0.64, -0.128], [0, -0.1]]));
          const crownPts = R(sym([[0, -0.678], [-cw * 0.42, -0.7], [-cw * 0.8, -0.665], [-cw * 0.93, -0.54], [-cw * 1, -0.36], [-cw * 1.02, -0.215, true], [-cw * 0.55, -0.188], [0, -0.178]]));
          const bandPts = R(sym([[0, -0.29], [-cw * 0.55, -0.292], [-cw * 1.01, -0.3], [-cw * 1.02, -0.215, true], [-cw * 0.55, -0.188], [0, -0.178]]));
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const crease = ctx.lodAtLeast("mid") ? [
            { d: ctx.hs(G.brush(R([[-cw * 0.7, -0.66], [-cw * 0.3, -0.64], [0, -0.628], [cw * 0.3, -0.64], [cw * 0.7, -0.66]]), [6e-3, 0.03, 0.04, 0.03, 6e-3])), fill: "deep", o: 0.6 },
            { d: ctx.hs(G.brush(R([[-cw * 0.85, -0.6], [-cw * 0.62, -0.5], [-cw * 0.55, -0.36]]), [4e-3, 0.026, 4e-3])), fill: "shade", o: 0.55 }
          ] : [];
          const pieces = [
            {
              id: "hat-brim",
              z: ctx.Z.hat,
              d: sm(brimPts),
              mat: felt,
              lit: [{ d: ctx.hs(G.brush(R([[-bw * 0.9, -0.2], [-bw * 0.55, -0.15], [-bw * 0.2, -0.128]]), [4e-3, 0.026, 6e-3])), o: 0.5 }],
              lines: ctx.lodAtLeast("mid") ? [{ d: ctx.hs(G.brush(R([[-bw * 0.97, -0.205], [-bw * 0.6, -0.133], [0, -0.105], [bw * 0.6, -0.133], [bw * 0.97, -0.205]]), [2e-3, 0.012, 0.014, 0.012, 2e-3])), fill: "deep", o: 0.45 }] : [],
              light: { form: 0.8 }
            },
            { id: "hat-crown", z: ctx.Z.hat + 0.1, d: sm(crownPts), mat: felt, shade: crease, lit: [{ d: ctx.hs(G.brush(R([[-cw * 0.78, -0.62], [-cw * 0.9, -0.5], [-cw * 0.95, -0.36]]), [4e-3, 0.04, 6e-3])), o: 0.55 }], light: { form: 1.15 } },
            { id: "hat-band", z: ctx.Z.hat + 0.15, d: sm(bandPts, 0.45), mat: bandM, light: { form: 0.9 } }
          ];
          if (o.pin) pieces.push({ id: "hat-pin", z: ctx.Z.hat + 0.2, spot: true, d: sm(R([[-cw * 0.62, -0.268], [-cw * 0.4, -0.285], [-cw * 0.27, -0.248], [-cw * 0.48, -0.212], [-cw * 0.66, -0.228]])), mat: ctx.mat(o.pin, "flat"), light: false });
          const edge = [[-0.37, -0.178], [-0.22, -0.142], [0, -0.1], [0.22, -0.142], [0.37, -0.178]];
          pieces.push(...castShadow(ctx, rotPts(edge, T * 0.6, [0, -0.2]), 0.11, { shift: 0.03 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "peaked-cap",
        aliases: ["officer-cap"],
        describe: "City Watch peaked cap: flared crown, band, brass badge plate, glossy peak with a hard shadow over the eyes.",
        params: { color: "cloth token", band: "band token", badge: "badge metal token (default metal-brass)" },
        example: { hair: { hat: { type: "peaked-cap", color: "cloth-ink-blue", band: "cloth-black" } } },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const { cw } = frame(ctx);
          const T = (_a = o.tilt) != null ? _a : 0;
          const R = (pts) => rotPts(pts, T, [0, -0.25]);
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const cloth = ctx.mat(tokOr(ctx, o.color, "cloth-ink-blue"), "wool");
          const bandM = ctx.mat(tokOr(ctx, o.band, "cloth-black"), "wool");
          const peakM = ctx.mat(tokOr(ctx, o.peak, "leather-black"), "leather");
          const crownPts = R(sym([[0, -0.595], [-cw * 0.62, -0.58], [-cw * 1.1, -0.51, true], [-cw * 1.12, -0.44], [-cw * 1.04, -0.33], [-cw * 1, -0.26, true], [-cw * 0.55, -0.235], [0, -0.228]]));
          const bandPts = R(sym([[0, -0.3], [-cw * 0.6, -0.3], [-cw * 1, -0.285, true], [-cw * 1.02, -0.21], [-cw * 0.55, -0.185], [0, -0.178]]));
          const peakPts = R(sym([[0, -0.21], [-cw * 0.5, -0.215], [-cw * 0.86, -0.185, true], [-cw * 0.62, -0.125], [-cw * 0.3, -0.098], [0, -0.092]]));
          const pieces = [
            { id: "hat-peak", z: ctx.Z.hat, d: sm(peakPts), mat: peakM, light: { form: 0.7 } },
            {
              id: "hat-crown",
              z: ctx.Z.hat + 0.1,
              d: sm(crownPts, 0.4),
              mat: cloth,
              lit: [{ d: ctx.hs(G.brush(R([[-cw * 1, -0.5], [-cw * 0.6, -0.57], [-cw * 0.2, -0.585]]), [4e-3, 0.03, 4e-3])), o: 0.55 }],
              lines: ctx.lodAtLeast("mid") ? [{ d: ctx.hs(G.brush(R([[-cw * 1.1, -0.505], [-cw * 0.5, -0.5], [0, -0.498], [cw * 0.5, -0.5], [cw * 1.1, -0.505]]), [3e-3, 0.012, 0.014, 0.012, 3e-3])), fill: "deep", o: 0.55 }] : [],
              light: { form: 1.1 }
            },
            { id: "hat-band", z: ctx.Z.hat + 0.15, d: sm(bandPts, 0.4), mat: bandM, light: { form: 0.9 } },
            {
              id: "hat-badge",
              z: ctx.Z.hat + 0.2,
              d: sm(R([[0, -0.345], [-0.05, -0.335], [-0.048, -0.285], [0, -0.255], [0.048, -0.285], [0.05, -0.335]]), 0.4),
              mat: ctx.mat(tokOr(ctx, o.badge, "metal-brass"), "metal"),
              lines: ctx.lodAtLeast("mid") ? [{ d: sm(R([[0, -0.322], [-0.022, -0.318], [-0.02, -0.292], [0, -0.28], [0.02, -0.292], [0.022, -0.318]]), 0.4), fill: "deep", o: 0.65 }] : [],
              light: { form: 0.6 }
            }
          ];
          const edge = [[-0.36, -0.16], [-0.2, -0.114], [0, -0.092], [0.2, -0.114], [0.36, -0.16]];
          pieces.push(...castShadow(ctx, rotPts(edge, T, [0, -0.25]), 0.085, { shift: 0.025, o: 0.95 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "flat-cap",
        aliases: ["newsboy", "baker-boy"],
        describe: "Flat cap: soft puffed dome overhanging the skull, short stiff peak. The dock heavy and the urchin.",
        params: { color: "wool token", pattern: "optional textile name or {type,color2}", puff: "0.8\u20131.3", tilt: "-0.2..0.2" },
        example: { hair: { hat: { type: "flat-cap", color: "cloth-warm-grey" } } },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const { cw } = frame(ctx);
          const T = (_a = o.tilt) != null ? _a : 0.06, pf = o.puff || 1;
          const R = (pts) => rotPts(pts, T, [0, -0.2]);
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const wool = ctx.mat(tokOr(ctx, o.color, "cloth-warm-grey"), "wool");
          const bodyPts = R([[0, -0.58 * pf + 0], [-cw * 0.55, -0.565], [-cw * 1, -0.5], [-cw * 1.16 * Math.min(1.1, pf), -0.38], [-cw * 1.08, -0.255, true], [-cw * 0.6, -0.205], [0, -0.19], [cw * 0.6, -0.205], [cw * 1.1, -0.25, true], [cw * 1.2 * Math.min(1.1, pf), -0.37], [cw * 1.02, -0.5], [cw * 0.55, -0.565]]);
          const peakPts = R(sym([[0, -0.22], [-cw * 0.5, -0.215], [-cw * 0.82, -0.2, true], [-cw * 0.6, -0.14], [-cw * 0.3, -0.112], [0, -0.108]]));
          const pat = o.pattern ? { pattern: o.pattern } : {};
          const seam = ctx.lodAtLeast("mid") ? [
            { d: ctx.hs(G.brush(R([[0, -0.575], [-cw * 0.35, -0.45], [-cw * 0.62, -0.3], [-cw * 0.66, -0.215]]), [4e-3, 0.012, 0.012, 4e-3])), fill: "shade", o: 0.7 },
            { d: ctx.hs(G.brush(R([[0, -0.575], [cw * 0.3, -0.46], [cw * 0.55, -0.31], [cw * 0.6, -0.22]]), [4e-3, 0.012, 0.012, 4e-3])), fill: "shade", o: 0.6 },
            { d: ctx.hs(G.brush(R([[-cw * 1.05, -0.27], [-cw * 0.5, -0.215], [0, -0.2], [cw * 0.5, -0.215], [cw * 1.05, -0.27]]), [4e-3, 0.018, 0.02, 0.018, 4e-3])), fill: "deep", o: 0.45 }
          ] : [];
          const pieces = [
            { id: "hat-peak", z: ctx.Z.hat, d: sm(peakPts), mat: wool, shade: [{ d: sm(R(sym([[0, -0.17], [-cw * 0.7, -0.16], [-cw * 0.5, -0.125], [0, -0.112]]))), o: 0.5 }], light: { form: 0.8 } },
            { id: "hat-body", z: ctx.Z.hat + 0.1, d: sm(bodyPts, 0.45), mat: wool, ...pat, lit: [{ d: ctx.hs(G.brush(R([[-cw * 1, -0.42], [-cw * 0.75, -0.52], [-cw * 0.3, -0.56]]), [4e-3, 0.045, 4e-3])), o: 0.5 }], lines: seam, light: { form: 1.15 } },
            { id: "hat-button", z: ctx.Z.hat + 0.2, d: sm(R([[-0.022, -0.575], [0, -0.592], [0.022, -0.575], [0, -0.56]])), mat: wool, light: { form: 0.6 } }
          ];
          const edge = [[-0.36, -0.185], [-0.2, -0.135], [0, -0.108], [0.2, -0.135], [0.36, -0.185]];
          pieces.push(...castShadow(ctx, rotPts(edge, T * 0.8, [0, -0.2]), 0.075, { shift: 0.025 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "beret",
        aliases: [],
        describe: "Slanted beret pulled down over one side, stalk on top, a pin badge: the militant.",
        params: { color: "wool token", badge: "badge colour token (spot colour)", tilt: "0.1\u20130.45 radians; + drops the viewer-right side", dir: "-1 or 1 to mirror" },
        example: { hair: { hat: { type: "beret", color: "cloth-brown", badge: "caution-500" } } },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const { cw } = frame(ctx);
          const dir = o.dir === -1 ? -1 : 1;
          const T = ((_a = o.tilt) != null ? _a : 0.3) * dir, cen = [0, -0.28];
          const wool = ctx.mat(tokOr(ctx, o.color, "cloth-brown"), "wool");
          const rx = cw + 0.075, ry = 0.17;
          const P = (u, v) => [u * rx, -0.37 + v * ry];
          const R = (pts) => rotPts(pts, T, cen);
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const bodyL = [P(-1, 0.35), P(-0.92, -0.35), P(-0.6, -0.85), P(-0.1, -1.05), P(0.45, -1), P(0.9, -0.62), P(1, 0.1), P(0.82, 0.6), P(0.4, 0.92), P(-0.2, 0.95), P(-0.7, 0.8)];
          const body = R(bodyL);
          const rim = R([P(-0.74, 0.8), P(-0.2, 0.97), P(0.4, 0.94), P(0.82, 0.62), P(0.7, 0.5), P(0.38, 0.78), P(-0.2, 0.82), P(-0.62, 0.68)]);
          const stalk = R([P(-0.04, -1), P(0, -1.14), P(0.07, -1.12), P(0.1, -1)]);
          const folds = ctx.lodAtLeast("mid") ? [
            { d: ctx.hs(G.brush(R([P(0.05, -1), P(0.12, -0.5), P(0.3, 0), P(0.42, 0.45)]), [3e-3, 0.02, 0.026, 4e-3])), fill: "shade", o: 0.7 },
            { d: ctx.hs(G.brush(R([P(0, -1), P(-0.35, -0.6), P(-0.6, -0.1)]), [3e-3, 0.016, 3e-3])), fill: "shade", o: 0.5 }
          ] : [];
          const pieces = [
            { id: "hat-body", z: ctx.Z.hat + 0.1, d: sm(body, 0.45), mat: wool, lines: folds, lit: [{ d: ctx.hs(G.brush(R([P(-0.85, -0.2), P(-0.62, -0.7), P(-0.15, -0.95)]), [4e-3, 0.06, 4e-3])), o: 0.5 }], light: { form: 1.2 } },
            { id: "hat-rim", z: ctx.Z.hat + 0.15, d: sm(rim, 0.45), mat: ctx.mat(tokOr(ctx, o.rim, "leather-black"), "wool"), light: { form: 0.7 } },
            { id: "hat-stalk", z: ctx.Z.hat + 0.12, d: sm(stalk), mat: wool, light: { form: 0.5 } }
          ];
          if (o.badge) {
            const bp = R([P(-0.62 * dir, 0.18)])[0];
            pieces.push({
              id: "hat-badge",
              z: ctx.Z.hat + 0.2,
              spot: true,
              d: ctx.hs(G.ellipse(bp[0], bp[1], 0.036, 0.034, T)),
              mat: ctx.mat(o.badge, "metal"),
              light: { form: 0.5 },
              over: ctx.lodAtLeast("mid") ? [{ d: ctx.hs(G.ellipse(bp[0] + 4e-3, bp[1] + 3e-3, 0.016, 0.015, T)), fill: ctx.T.tok("ink-900"), o: 0.8 }] : []
            });
          }
          const e = R([P(-0.7, 0.8), P(-0.3, 0.9), P(0.2, 0.93), P(0.6, 0.82), P(0.82, 0.62)]).filter((p) => Math.abs(p[0]) < 0.4);
          pieces.push(...castShadow(ctx, e, 0.075, { shift: 0.02 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "headscarf",
        aliases: ["scarf", "babushka"],
        describe: "60s silk headscarf knotted under the chin, polka dots optional: the mystic, the starlet in shades.",
        params: { color: "silk token", band: "dot colour token, or 'none' for plain", dots: "false for plain" },
        example: { hair: { hat: { type: "headscarf", color: "cloth-cream", band: "cloth-black" } } },
        draw(ctx, o) {
          const { G } = ctx;
          const { wid, w } = frame(ctx);
          const silk = ctx.mat(tokOr(ctx, o.color, "cloth-cream"), "satin");
          const sm = (pts, t = 0.5) => G.smooth(pts, true, t);
          const ys = [-0.22, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
          const L = [[0, -0.6], [-w * 0.6, -0.57], [-w * 0.98, -0.45], [-(wid(-0.3) + 0.055), -0.3], ...ys.slice(1).map((y) => [-(wid(y) + 0.05), y]), [-0.14, 0.545], [0, 0.57]];
          const outer = sm([...L.map(([x, y]) => [x, y]), ...L.slice(1, -1).reverse().map(([x, y]) => [-x, y])]);
          const I = [[0, -0.27], [-0.16, -0.262], [-(wid(-0.2) - 0.035), -0.21], ...ys.slice(1).map((y) => [-(wid(y) - 0.03), y]), [-0.12, 0.5], [0, 0.515]];
          const inner = sm([...I, ...I.slice(1, -1).reverse().map(([x, y]) => [-x, y])]);
          const hole = G.mapPath(inner, (p) => p);
          const rev = (d) => {
            const pts = G.parse(d);
            return d;
          };
          const outerPts = [...L, ...L.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
          const innerPts = [...I, ...I.slice(1, -1).reverse().map(([x, y]) => [-x, y])].reverse();
          const ring = ctx.hs(sm(outerPts)) + " " + ctx.hs(sm(innerPts));
          const dotC = o.band === "none" || o.dots === false ? null : tokOr(ctx, o.band, "cloth-black");
          const lines = [];
          if (dotC && ctx.lodAtLeast("mid")) {
            const sp = 0.115, r = ctx.lodAtLeast("hi") ? 0.02 : 0.024;
            for (let j = 0, y = -0.62; y < 0.7; y += sp * 0.87, j++) for (let x = -0.62 + j % 2 * sp / 2; x < 0.62; x += sp) lines.push({ d: ctx.hs(G.circle(x, y, r)), fill: ctx.T.tok(dotC) });
          }
          if (ctx.lodAtLeast("mid")) {
            lines.push({ d: ctx.hs(G.brush([[-w * 0.2, -0.57], [-w * 0.55, -0.4], [-w * 0.8, -0.28]], [3e-3, 0.016, 3e-3])), fill: "shade", o: 0.5 });
            lines.push({ d: ctx.hs(G.brush([[wid(0.1) + 0.04, 0], [wid(0.2) + 0.03, 0.2], [0.18, 0.46]], [0.01, 0.03, 0.01])), fill: "shade", o: 0.55 });
          }
          const knot = [[-0.06, 0.5], [0, 0.48], [0.06, 0.5], [0.07, 0.56], [0, 0.6], [-0.07, 0.56]];
          const tails = [[[-0.04, 0.58], [-0.12, 0.7], [-0.07, 0.82], [0, 0.66]], [[0.04, 0.58], [0, 0.66], [0.07, 0.8], [0.13, 0.7]]];
          const pieces = [
            { id: "hat-scarf", z: ctx.Z.hat, d: ring, mat: silk, lines, lit: [{ d: ctx.hs(G.brush([[-w * 0.85, -0.42], [-w * 0.5, -0.54], [-w * 0.15, -0.58]], [4e-3, 0.05, 4e-3])), o: 0.6 }], light: { form: 1 } },
            ...tails.map((t, i) => ({ id: `hat-scarf-tail${i}`, z: ctx.Z.hat - 0.1, d: ctx.hs(sm(t, 0.5)), mat: silk, light: { form: 0.7 } })),
            { id: "hat-scarf-knot", z: ctx.Z.hat + 0.1, d: ctx.hs(sm(knot, 0.5)), mat: silk, shade: [{ d: ctx.hs(sm([[0, 0.5], [0.06, 0.52], [0.065, 0.56], [0, 0.595], [5e-3, 0.54]])), o: 0.7 }], light: { form: 0.8 } }
          ];
          const edge = [[-0.32, -0.22], [-0.16, -0.262], [0, -0.27], [0.16, -0.262], [0.32, -0.22]];
          pieces.push(...castShadow(ctx, edge, 0.045, { shift: 0.015, o: 0.8, core: 0.4 }));
          return pieces;
        }
      });
    }
  });

  // src/parts/hats/hats-more.js
  var require_hats_more = __commonJS({
    "src/parts/hats/hats-more.js"() {
      "use strict";
      var { register } = require_registry();
      var { frame, sym, castShadow } = require_hat();
      var tokOr = (ctx, t, d) => ctx.T.tok(t) ? t : d;
      register({
        kind: "hat",
        name: "beanie",
        aliases: ["watch-cap"],
        describe: "Knit watch cap with a turned-up ribbed cuff: dockhands, burglars, cold mornings.",
        params: { color: "knit token" },
        example: { hair: { hat: { type: "beanie", color: "cloth-navy" } } },
        draw(ctx, o) {
          const { G } = ctx;
          const { cw } = frame(ctx);
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const knit = ctx.mat(tokOr(ctx, o.color, "cloth-navy"), "knit");
          const cuffMat = ctx.mat(ctx.C.mix(ctx.C.mix(knit.base, knit.light, 0.75), ctx.tok("cloth-cream"), 0.1), "knit");
          const lean = 0.075;
          const slouch = ([x, y, s]) => {
            const t = Math.max(0, Math.min(1, (-0.3 - y) / 0.33));
            return [x * (x > 0 ? 1 + 0.06 * t : 1 - 0.01 * t) + lean * t * t, y - 0.03 * t * t, s];
          };
          const dome = sym([[0, -0.615], [-cw * 0.6, -0.6], [-cw * 1.03, -0.5], [-cw * 1.1, -0.36], [-cw * 1.1, -0.26, true], [-cw * 0.55, -0.22], [0, -0.215]]).map(slouch);
          const cuff = sym([[0, -0.292], [-cw * 0.6, -0.292], [-cw * 1.1, -0.302, true], [-cw * 1.13, -0.09, true], [-cw * 0.62, -0.13], [0, -0.148]]);
          const mid = ctx.lodAtLeast("mid"), hi = ctx.lodAtLeast("hi");
          const ribs = [];
          if (mid) for (let i = -6; i <= 6; i++) {
            const x = i * cw * 0.16, yb = -0.15 + Math.abs(x) * 0.16;
            ribs.push({ d: ctx.hs(G.brush([[x * 1.02, -0.285], [x, -0.22], [x * 0.98, yb]], [5e-3, 0.013, 5e-3])), fill: "shade", o: 0.6 });
            if (hi && i < 6) {
              const xm = x + cw * 0.08;
              ribs.push({ d: ctx.hs(G.brush([[xm * 1.02, -0.283], [xm, -0.22], [xm * 0.98, yb - 4e-3]], [3e-3, 7e-3, 3e-3])), fill: "light", o: 0.45 });
            }
          }
          const seam = G.brush([[-cw * 1.04, -0.318], [-cw * 0.6, -0.31], [0, -0.309], [cw * 0.6, -0.31], [cw * 1.04, -0.318]], [4e-3, 0.018, 0.022, 0.018, 4e-3]);
          const domeLines = [{ d: ctx.hs(seam), fill: "deep", o: 0.6 }];
          if (hi) {
            for (const i of [-4, -2, 0, 2, 4]) domeLines.push({ d: ctx.hs(G.brush([[i * cw * 0.05 + lean * 0.5, -0.6], [i * cw * 0.14 + lean * 0.35, -0.45], [i * cw * 0.2, -0.32]], [2e-3, 8e-3, 3e-3])), fill: "shade", o: 0.35 });
            domeLines.push({ d: ctx.hs(G.brush([[lean * 0.9 + 0.02, -0.62], [lean * 0.7 + cw * 0.5, -0.52], [cw * 0.95 + 0.02, -0.4]], [2e-3, 0.012, 4e-3])), fill: "deep", o: 0.4 });
          }
          const cuffLit = [{ d: ctx.hs(G.brush([[-cw * 1, -0.28], [-cw * 0.5, -0.275], [0, -0.272]], [4e-3, 0.016, 6e-3])), o: 0.55 }];
          const pieces = [
            { id: "hat-body", z: ctx.Z.hat, d: sm(dome, 0.45), mat: knit, lines: domeLines, lit: [{ d: ctx.hs(G.brush([[-cw * 0.95, -0.4], [-cw * 0.7, -0.53], [-cw * 0.25, -0.59]], [4e-3, 0.05, 4e-3])), o: 0.45 }], light: { form: 1.15 } },
            { id: "hat-cuff", z: ctx.Z.hat + 0.1, d: sm(cuff, 0.4), mat: cuffMat, lines: ribs, lit: cuffLit, light: { form: 1 } }
          ];
          pieces.push(...castShadow(ctx, [[-0.37, -0.1], [-0.2, -0.138], [0, -0.148], [0.2, -0.138], [0.37, -0.1]], 0.055, { shift: 0.02 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "bowler",
        aliases: ["derby"],
        describe: "Bowler: hard round crown, narrow curled brim, grosgrain band. Bank clerks, villains, undertakers.",
        params: { color: "felt token", band: "band token" },
        example: { hair: { hat: { type: "bowler", color: "cloth-charcoal", band: "cloth-black" } } },
        draw(ctx, o) {
          const { G } = ctx;
          const { cw } = frame(ctx);
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const felt = ctx.mat(tokOr(ctx, o.color, "cloth-charcoal"), "wool");
          const bw = cw + 0.08;
          const brim = sym([[0, -0.25], [-bw * 0.6, -0.242], [-bw, -0.238, true], [-bw * 0.65, -0.145], [0, -0.125]]);
          const crown = sym([[0, -0.66], [-cw * 0.55, -0.645], [-cw * 0.95, -0.53], [-cw * 1.03, -0.36], [-cw * 1.04, -0.225, true], [-cw * 0.55, -0.19], [0, -0.18]]);
          const band = sym([[0, -0.285], [-cw * 0.55, -0.28], [-cw * 1.03, -0.29], [-cw * 1.04, -0.225, true], [-cw * 0.55, -0.19], [0, -0.18]]);
          const pieces = [
            { id: "hat-brim", z: ctx.Z.hat, d: sm(brim), mat: felt, lit: [{ d: ctx.hs(G.brush([[-bw * 0.95, -0.235], [-bw * 0.6, -0.15], [-bw * 0.2, -0.13]], [4e-3, 0.022, 6e-3])), o: 0.5 }], light: { form: 0.8 } },
            { id: "hat-crown", z: ctx.Z.hat + 0.1, d: sm(crown, 0.45), mat: felt, lit: [{ d: ctx.hs(G.brush([[-cw * 0.9, -0.46], [-cw * 0.72, -0.57], [-cw * 0.3, -0.63]], [4e-3, 0.05, 4e-3])), o: 0.55 }], light: { form: 1.25 } },
            { id: "hat-band", z: ctx.Z.hat + 0.15, d: sm(band, 0.4), mat: ctx.mat(tokOr(ctx, o.band, "cloth-black"), "wool"), light: { form: 0.9 } }
          ];
          pieces.push(...castShadow(ctx, [[-0.37, -0.172], [-0.2, -0.14], [0, -0.125], [0.2, -0.14], [0.37, -0.172]], 0.09, { shift: 0.025 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "pillbox",
        aliases: [],
        describe: "60s pillbox: a small tall drum with a flat top, perched high on the head. Jackie-O and the swinger set.",
        params: { color: "cloth token" },
        example: { hair: { hat: { type: "pillbox", color: "cloth-pink" } } },
        draw(ctx, o) {
          const { G } = ctx;
          const { cw } = frame(ctx);
          const sm = (pts, t = 0.5) => ctx.hs(G.smooth(pts, true, t));
          const cl = ctx.mat(tokOr(ctx, o.color, "cloth-pink"), "wool");
          const side = sym([[0, -0.64], [-cw * 0.9, -0.64, true], [-cw * 0.93, -0.45], [-cw * 0.98, -0.285, true], [-cw * 0.5, -0.255], [0, -0.25]]);
          const top = sym([[0, -0.685], [-cw * 0.46, -0.675], [-cw * 0.9, -0.645, true], [-cw * 0.45, -0.605], [0, -0.597]]);
          const pieces = [
            { id: "hat-body", z: ctx.Z.hat, d: sm(side, 0.4), mat: cl, lit: [{ d: ctx.hs(G.brush([[-cw * 0.8, -0.34], [-cw * 0.8, -0.5], [-cw * 0.7, -0.6]], [4e-3, 0.04, 4e-3])), o: 0.5 }], light: { form: 1.1 } },
            { id: "hat-top", z: ctx.Z.hat + 0.1, d: sm(top, 0.4), mat: cl, fill: "light", light: { form: 0.5 } }
          ];
          pieces.push(...castShadow(ctx, [[-0.3, -0.265], [-0.15, -0.252], [0, -0.25], [0.15, -0.252], [0.3, -0.265]], 0.04, { shift: 0.015, o: 0.8, core: 0.4 }));
          return pieces;
        }
      });
      register({
        kind: "hat",
        name: "helmet",
        aliases: ["motorcycle-helmet", "crash-helmet"],
        describe: "Open-face motorcycle helmet: glossy shell over the ears, short peak, chin strap, optional stripe. The racer.",
        params: { color: "shell token", band: "stripe token (optional)" },
        example: { hair: { hat: { type: "helmet", color: "cloth-white", band: "signal-500" } } },
        draw(ctx, o) {
          const { G } = ctx;
          const { cw, wid } = frame(ctx);
          const sm = (pts2, t = 0.5) => ctx.hs(G.smooth(pts2, true, t));
          const shell = ctx.mat(tokOr(ctx, o.color, "cloth-white"), "satin");
          const outerL = [[0, -0.655], [-cw * 0.72, -0.63], [-cw * 1.12, -0.5], [-(wid(-0.3) + 0.08), -0.3], [-(wid(-0.1) + 0.075), -0.1], [-(wid(0.1) + 0.07), 0.1], [-(wid(0.17) + 0.06), 0.22, true]];
          const innerL = [[-(wid(0.17) - 0.015), 0.22, true], [-(wid(0.1) - 0.03), 0.07], [-(wid(-0.1) - 0.035), -0.1], [-(wid(-0.18) - 0.06), -0.19], [-0.18, -0.222], [0, -0.228]];
          const mir = (L) => L.map(([x, y, s]) => [-x, y, s]);
          const pts = [...outerL, ...innerL, ...mir(innerL).reverse().slice(1), ...mir(outerL).reverse()];
          const lines = [];
          if (o.band && ctx.T.tok(o.band)) lines.push({ d: ctx.hs(G.brush([[0, -0.23], [0, -0.45], [0, -0.66]], [0.09, 0.075, 0.06])), fill: ctx.T.tok(o.band) });
          if (ctx.lodAtLeast("mid")) lines.push({ d: ctx.hs(G.brush([[-(wid(0.1) + 0.04), 0.2], [-(wid(-0.1) + 0.045), -0.1], [-(wid(-0.3) + 0.05), -0.3]], [0.012, 0.02, 0.012])), fill: "shade", o: 0.5 });
          const strapM = ctx.mat("leather-black", "leather");
          const peak = sym([[0, -0.23], [-0.34, -0.215, true], [-0.31, -0.168], [-0.16, -0.14], [0, -0.135]]);
          const pieces = [
            { id: "hat-shell", z: ctx.Z.hat, d: sm(pts, 0.45), mat: shell, lines, lit: [{ d: ctx.hs(G.brush([[-cw * 1.02, -0.4], [-cw * 0.75, -0.57], [-cw * 0.3, -0.63]], [4e-3, 0.055, 4e-3])), o: 0.7 }], light: { form: 1.1 } },
            { id: "hat-peak", z: ctx.Z.hat + 0.1, d: sm(peak, 0.4), mat: strapM, light: { form: 0.6 } }
          ];
          for (const s of [-1, 1]) {
            const sp = [[s * (wid(0.2) - 5e-3), 0.2], [s * (wid(0.33) - 0.03), 0.36], [s * 0.08, 0.5]];
            pieces.push({ id: `hat-strap-${s < 0 ? "R" : "L"}`, z: ctx.Z.hat + 0.05, d: ctx.hs(G.brush(sp, [0.026, 0.022, 0.02])), mat: strapM, light: { form: 0.4 } });
          }
          pieces.push({ id: "hat-chincup", z: ctx.Z.hat + 0.06, d: sm([[-0.09, 0.5], [0, 0.47], [0.09, 0.5], [0.05, 0.545], [-0.05, 0.545]]), mat: strapM, light: { form: 0.4 } });
          pieces.push(...castShadow(ctx, [[-0.3, -0.175], [-0.16, -0.14], [0, -0.135], [0.16, -0.14], [0.3, -0.175]], 0.07, { shift: 0.02 }));
          return pieces;
        }
      });
    }
  });

  // src/parts/masks/_mask.js
  var require_mask = __commonJS({
    "src/parts/masks/_mask.js"(exports, module) {
      "use strict";
      var U = require_util();
      var { hexA } = require_planes();
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var lerp = (a, b, t) => a + (b - a) * t;
      var tokOr = (ctx, t, d) => typeof t === "string" && ctx.T.tok(t) ? t : d;
      function K(ctx, pts, d0 = 0.03) {
        return pts.map((p) => {
          var _a;
          const q = ctx.hp([p[0], p[1]], { depth: (_a = p[3]) != null ? _a : d0 });
          return p[2] ? [q[0], q[1], true] : q;
        });
      }
      var path = (ctx, pts, t = 0.45, d0) => ctx.G.smooth(K(ctx, pts, d0), true, t);
      var stroke = (ctx, pts, widths, d0 = 0.03) => ctx.G.brush(K(ctx, pts, d0), widths.map((w) => w * ctx.R.head.k));
      var area = (pts) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          a += p[0] * q[1] - q[0] * p[1];
        }
        return a;
      };
      function holed(ctx, outer, holes, t = 0.45, d0 = 0.03) {
        const o = K(ctx, outer, d0);
        let d = ctx.G.smooth(o, true, t);
        for (const h of holes) {
          let hp = K(ctx, h, d0);
          if (Math.sign(area(hp)) === Math.sign(area(o))) hp = hp.reverse();
          d += " " + ctx.G.smooth(hp, true, t);
        }
        return d;
      }
      function samplePath(G, d, per = 5) {
        const pts = [];
        let cur = null;
        for (const s of G.parse(d)) {
          if (s.c === "M" || s.c === "L") {
            cur = s.p[0];
            pts.push(cur);
          } else if (s.c === "C" && cur) {
            const [a, b, p] = s.p;
            for (let i = 1; i <= per; i++) {
              const t = i / per, u = 1 - t;
              pts.push([u * u * u * cur[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p[0], u * u * u * cur[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p[1]]);
            }
            cur = p;
          }
        }
        return pts;
      }
      function skull(ctx) {
        const H = ctx.head, poly = U.outlinePoly(ctx, 5);
        const wid = H.widthAt || (() => H.w);
        let kit = null;
        try {
          if (H.outline) kit = samplePath(ctx.G, ctx.hs(H.outline), 5);
        } catch (e) {
          kit = null;
        }
        if (!kit || kit.length !== poly.length) kit = poly.map((p) => ctx.hp(p, { depth: 0 }));
        return { H, poly, kit, wid, edge: (y) => U.edgeAt(poly, y) || { l: -wid(y), r: wid(y) } };
      }
      function grow(poly, amt) {
        const n = poly.length, sgn = area(poly) > 0 ? 1 : -1, out = [];
        for (let i = 0; i < n; i++) {
          const a = poly[(i - 2 + n) % n], b = poly[(i + 2) % n], p = poly[i];
          let tx = b[0] - a[0], ty = b[1] - a[1];
          const l = Math.hypot(tx, ty) || 1;
          tx /= l;
          ty /= l;
          const k = typeof amt === "function" ? amt(p, i) : amt;
          out.push([p[0] + sgn * ty * k, p[1] - sgn * tx * k]);
        }
        return out;
      }
      function relax(pts, passes = 2) {
        let cur = pts;
        for (let k = 0; k < passes; k++) {
          const n = cur.length;
          cur = cur.map((p, i) => {
            const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
            return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
          });
        }
        return cur;
      }
      var thin = (pts, k = 2) => pts.filter((_, i) => i % k === 0);
      function superellipse(cx, cy, hw, hh, o = {}) {
        const N = o.N || 28, n = o.n || 2.4, out = [];
        for (let i = 0; i < N; i++) {
          const a = i / N * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          const xl = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), yl = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
          let x = xl * hw, y = yl * hh;
          if (o.taper && yl > 0) x *= 1 - o.taper * yl;
          if (o.lift) y -= o.lift * hh * Math.max(0, xl * (o.side || 1)) * (1 - yl) * 0.5;
          if (o.rot) {
            const co = Math.cos(o.rot), si = Math.sin(o.rot);
            [x, y] = [x * co - y * si, x * si + y * co];
          }
          out.push([cx + x, cy + y]);
        }
        return out;
      }
      function shell(ctx, sk, amt, yTop, top) {
        const k = ctx.R.head.k, n = sk.poly.length;
        const full = grow(sk.kit, (p, i) => amt(sk.poly[i][1], sk.poly[i][0]) * k);
        if (yTop == null || !top) return relax(full, 2);
        let iL = -1, iR = -1;
        for (let i = 0; i < n; i++) if (sk.poly[i][1] >= yTop) {
          if (iL < 0) iL = i;
          iR = i;
        }
        if (iL < 0) return relax(full, 2);
        const side = relax(full, 2).slice(iL, iR + 1).map((p) => [p[0], p[1]]);
        side[0] = [...side[0], true];
        side[side.length - 1] = [...side[side.length - 1], true];
        const closing = K(ctx, top, 0.01).reverse().map((p, i, a) => i === 0 || i === a.length - 1 ? [p[0], p[1], true] : p);
        return [...side, ...closing];
      }
      function sides(ctx, sk, amt, y0, y1) {
        const k = ctx.R.head.k, n = sk.poly.length;
        const full = relax(grow(sk.kit, (p, i) => amt(sk.poly[i][1], sk.poly[i][0]) * k), 2);
        const L = [], R = [];
        for (let i = 0; i < n; i++) {
          const [x, y] = sk.poly[i];
          if (y >= y0 && y <= y1) (x < 0 ? L : R).push([y, full[i]]);
        }
        L.sort((a, b) => a[0] - b[0]);
        R.sort((a, b) => b[0] - a[0]);
        return { L: L.map((q) => q[1]), R: R.map((q) => q[1]) };
      }
      function slide(ctx, x, y, depth = 0) {
        const H = ctx.R.head;
        if (!H.yaw) return 0;
        const r = H.w * Math.sqrt(Math.max(0.15, 1 - Math.pow(Math.max(0, y - 0.05) / 0.62, 2)));
        return (Math.sqrt(Math.max(0, r * r - x * x)) + depth) * Math.sin(H.yaw);
      }
      function plate(ctx, cx, cy, depth = 0.03, o = {}) {
        var _a;
        const yaw = ctx.R.head.yaw || 0, cosY = Math.cos(yaw), side = Math.sign(yaw);
        const cs = cx + slide(ctx, cx, cy, depth);
        let u0 = 0, us = 1;
        const P = (u, v) => ctx.hp([cs + (u0 + u * us) * cosY, cy + v], { flat: true });
        if (o.w && o.outline && side) {
          const m = (_a = o.margin) != null ? _a : 0.012 * ctx.R.head.k;
          for (let i = 0; i < 24; i++) {
            const q = P(side * o.w, 0);
            if (U.inside(o.outline, q[0] + side * m, q[1])) break;
            us *= 0.94;
            u0 = -side * o.w * (1 - us);
          }
        }
        P.scale = us * cosY;
        P.centre = () => P(0, 0);
        return P;
      }
      var mapD = (d, P) => ctxless(d, P);
      function ctxless(d, P) {
        const G = require_geom();
        return G.mapPath(d, (p) => P(p[0], p[1]));
      }
      var mirror = (pts) => pts.map(([x, y, s, d]) => [-x, y, s, d]);
      var sym = (L) => [...L, ...mirror(L.slice(1, -1)).reverse()];
      function fitInside(ctx, pts, outline, margin, d0 = 0.012) {
        const yaw = ctx.R.head.yaw || 0;
        if (!yaw || !outline || outline.length < 4) return pts;
        const side = Math.sign(yaw);
        const cx0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
        let cur = pts;
        for (let it = 0; it < 18; it++) {
          const kp = K(ctx, cur, d0);
          const bad = kp.some((q, i) => (cur[i][0] - cx0) * side > 0 && !U.inside(outline, q[0] + side * margin, q[1]));
          if (!bad) break;
          cur = cur.map((p) => (p[0] - cx0) * side > 0 ? [cx0 + (p[0] - cx0) * 0.94, ...p.slice(1)] : p);
        }
        return cur;
      }
      function tuck(ctx, pts, outline, margin, d0 = 0.03) {
        if (!outline || outline.length < 4) return pts;
        return pts.map((p) => {
          var _a;
          let q = p;
          for (let it = 0; it < 70; it++) {
            const m = ctx.hp([q[0], q[1]], { depth: (_a = q[3]) != null ? _a : d0 });
            if (U.inside(outline, m[0] + margin, m[1]) && U.inside(outline, m[0] - margin, m[1]) && U.inside(outline, m[0], m[1] + margin) && U.inside(outline, m[0], m[1] - margin)) break;
            q = [q[0] * 0.97, -0.05 + (q[1] + 0.05) * 0.99, ...q.slice(2)];
          }
          return q;
        });
      }
      function holeRim(ctx, ring, t = 0.013, d0 = 0.012) {
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const big = ring.map(([x, y]) => {
          const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
          return [x + dx / l * t, y + dy / l * t, false, d0];
        });
        return holed(ctx, big, [ring], 0.5, d0);
      }
      function shadowBand(ctx, id, edge, depth, o = {}) {
        var _a, _b, _c, _d, _e;
        const { G, skin } = ctx;
        if (!ctx.lodAtLeast("mid")) return [];
        const sh = (_a = o.shift) != null ? _a : 0.015, hw = (_b = o.hw) != null ? _b : 0.4, dir = (_c = o.dir) != null ? _c : 1;
        const low = (k) => edge.slice().reverse().map(([x, y]) => [x + sh * k, y + dir * depth * k * (1 - 0.45 * Math.min(1, Math.abs(x) / hw))]);
        const lines = o.stip === false ? [] : [{ d: ctx.hs(G.smooth([...low(1), ...low(1.5).slice().reverse()], true, 0.5)), fill: hexA(skin.shade, 0.5), stip: true }];
        const mk = (suffix, k, fill, op, ln) => ({ id: `${id}${suffix}`, z: ctx.Z.face + 1.2, d: ctx.hs(G.smooth([...edge, ...low(k)], true, 0.5)), fill, light: false, clip: "head", opacity: op, lines: ln });
        return [mk("", 1, skin.shade, (_d = o.o) != null ? _d : 0.9, lines), mk("-core", 0.55, skin.deep, (_e = o.core) != null ? _e : 0.55)];
      }
      function tone(ctx, o = {}) {
        const { G } = ctx, H = ctx.head, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
        const out = { shade: [], deep: [], lit: [] };
        if (!mid) return out;
        const k = { nose: 1, cheek: 1, mouth: 1, jaw: 1, brow: 1, ...o };
        const dN = 0.05;
        const S = (pts, t = 0.5, d = 0.03) => G.smooth(K(ctx, pts, d), true, t);
        const B = (pts, ws, d = 0.03) => stroke(ctx, pts, ws, d);
        const ny = H.noseY, nty = H.noseTipY, nw = H.noseW;
        if (k.nose) {
          out.shade.push({ d: B([[0.026, 0.035, false, 0.04], [0.05, (ny + 0.035) / 2, false, 0.05], [nw * 0.95, ny - 0.012, false, dN]], [4e-3, 0.034 * k.nose, 0.05 * k.nose]), o: 0.62 });
          out.deep.push({ d: B([[nw * 0.45, ny - 2e-3, false, dN], [nw * 0.75, ny + 8e-3, false, dN], [nw * 1.1, ny - 0.012, false, dN]], [0.012, 0.022 * k.nose, 6e-3]), o: 0.5 });
          out.lit.push({ d: B([[-0.012, 0.03, false, 0.04], [-0.028, (nty + 0.04) / 2, false, 0.05], [-nw * 0.55, nty - 0.012, false, dN]], [4e-3, 0.026 * k.nose, 0.034 * k.nose]), o: 0.5 });
          if (hi) out.lit.push({ d: ctx.hs(G.ellipse(-6e-3, nty - 3e-3, 0.02, 0.012), { depth: dN }), o: 0.4 });
        }
        if (k.cheek) for (const s of [-1, 1]) {
          const cw = H.cheekW || H.w;
          const hollow = [[s * cw * 0.9, 0.17], [s * cw * 0.7, 0.2], [s * cw * 0.5, 0.27], [s * cw * 0.45, 0.33], [s * cw * 0.66, 0.31], [s * cw * 0.88, 0.25]];
          (s < 0 ? out.shade : out.deep).push({ d: S(hollow), o: (s < 0 ? 0.28 : 0.4) * k.cheek });
          if (s < 0) out.lit.push({ d: B([[-cw * 0.85, 0.1], [-cw * 0.55, 0.14], [-cw * 0.28, 0.2]], [4e-3, 0.04, 6e-3]), o: 0.34 * k.cheek });
        }
        if (k.mouth) {
          const my = H.mouthY;
          out.shade.push({ d: B([[-H.mouthW * 0.55, my + 0.035], [0, my + 0.05], [H.mouthW * 0.55, my + 0.035]], [4e-3, 0.022 * k.mouth, 4e-3]), o: 0.4 });
          if (hi) out.lit.push({ d: B([[-H.mouthW * 0.4, my - 0.04], [0, my - 0.05], [H.mouthW * 0.4, my - 0.04]], [4e-3, 0.016, 4e-3]), o: 0.3 });
        }
        return out;
      }
      function knitRibs(ctx, o = {}) {
        var _a, _b, _c, _d, _e, _f, _g;
        const sk = skull(ctx), H = sk.H, out = [];
        const sp = (_a = o.sp) != null ? _a : 0.034, y0 = (_b = o.y0) != null ? _b : -0.52, y1 = (_c = o.y1) != null ? _c : H.chinY, ref = (_d = o.ref) != null ? _d : 0.06;
        const wref = sk.wid(ref) || H.w, xmax = ((_e = o.xMax) != null ? _e : 0.94) * wref, w = (_f = o.w) != null ? _f : 0.011, N = Math.round(xmax / sp);
        const ys = [];
        for (let i = 0; i <= 10; i++) ys.push(lerp(y0, y1, i / 10));
        for (let i = -N; i <= N; i++) {
          if (o.skipCentre && i === 0) continue;
          const u = i * sp / wref;
          const pts = ys.map((y) => {
            var _a2;
            return [u * Math.max(0, sk.wid(Math.max(-0.5, y)) - ((_a2 = o.inset) != null ? _a2 : 4e-3)), y];
          });
          const fade = 1 - 0.55 * Math.pow(Math.abs(i) / (N || 1), 2);
          out.push({ d: stroke(ctx, pts, [w * 0.35, w * fade, w * fade, w * fade * 0.9, w * 0.3], 0), fill: o.fill || "shade", o: ((_g = o.op) != null ? _g : 0.5) * (0.6 + 0.4 * fade) });
        }
        return out;
      }
      module.exports = { sides, holeRim, samplePath, relax, shell, slide, plate, mapD, K, path, stroke, holed, skull, grow, thin, superellipse, mirror, sym, area, fitInside, tuck, shadowBand, tone, knitRibs, tokOr, hexA, clamp, lerp, U };
    }
  });

  // src/parts/hats/riot.js
  var require_riot = __commonJS({
    "src/parts/hats/riot.js"() {
      "use strict";
      var { register } = require_registry();
      var { frame, sym, castShadow } = require_hat();
      var M = require_mask();
      var tokOr = (ctx, t, d) => ctx.T.tok(t) ? t : d;
      register({
        kind: "hat",
        name: "riot-helmet",
        aliases: ["riot", "visor-helmet", "riot-cop"],
        describe: "Riot helmet: a round hard dome with ear flaps and a dark trim band, a chin strap and a pale plastic face shield that flips down over the face (a pale flat plate with a brighter lower band and one reflection streak, as on the cover) or up onto the dome (a pale crescent over its front). The cops on the cover, the stewards at the demo.",
        params: { visor: '"down" (default: the shield over the face) | "up" (flipped up onto the dome)', color: "shell token (default cloth-stone)", band: "trim band token (default cloth-charcoal)", strap: "chin strap token (default leather-black)" },
        example: { hair: { hat: { type: "riot-helmet", color: "cloth-stone", visor: "down" } } },
        draw(ctx, o) {
          const { G, C } = ctx, { cw, wid } = frame(ctx), k = ctx.R.head.k;
          const mid = ctx.lodAtLeast("mid"), hi = ctx.lodAtLeast("hi"), lo = !mid;
          const sm = (pts2, t = 0.5) => ctx.hs(G.smooth(pts2, true, t));
          const B = (pts2, ws) => ctx.hs(G.brush(pts2, ws));
          const shell = ctx.mat(tokOr(ctx, o.color, "cloth-stone"), "satin");
          const bandTok = tokOr(ctx, o.band, "cloth-charcoal");
          const strapM = ctx.mat(tokOr(ctx, o.strap, "leather-black"), "leather");
          const up = o.visor === "up";
          const mir = (L) => L.map(([x, y, s]) => [-x, y, s]);
          const trim = C.mix(shell.base, ctx.tok(bandTok), 0.9);
          const top = -0.69;
          const outerL = [[0, top], [-cw * 0.55, top + 0.022], [-cw * 1, -0.575], [-cw * 1.13, -0.43], [-cw * 1.16, -0.3], [-(wid(-0.08) + 0.1), -0.12], [-(wid(0.1) + 0.09), 0.07], [-(wid(0.17) + 0.075), 0.215, true]];
          const innerL = [[-(wid(0.17) - 0.01), 0.215, true], [-(wid(0.1) - 0.03), 0.08], [-(wid(-0.1) - 0.04), -0.09], [-(wid(-0.18) - 0.07), -0.17], [-0.2, -0.2], [0, -0.206]];
          const pts = [...outerL, ...innerL, ...mir(innerL).reverse().slice(1), ...mir(outerL).reverse().slice(0, -1)];
          const edgeL = innerL.map(([x, y]) => [x, y]);
          const edge = [...edgeL, ...mir(edgeL).reverse().slice(1)];
          const lines = [{ d: B(edge, edge.map((_, i) => 0.082 * (0.8 + 0.4 * Math.sin(i / (edge.length - 1) * Math.PI)))), fill: trim }];
          if (mid) {
            lines.push({ d: B([[0, -0.215], [0, -0.45], [0, top + 0.02]], [0.05, 0.042, 0.028]), fill: "light", o: 0.3 });
            lines.push({ d: B([[0.036, -0.23], [0.04, -0.45], [0.026, top + 0.03]], [6e-3, 0.014, 4e-3]), fill: "shade", o: 0.5 });
            for (const s of [-1, 1]) lines.push({ d: B([[s * (cw * 1.1), -0.3], [s * (wid(-0.06) + 0.085), -0.08], [s * (wid(0.06) + 0.06), 0.06]], [4e-3, 0.01, 4e-3]), fill: "shade", o: 0.5 });
          }
          if (hi) {
            for (const s of [-1, 1]) lines.push({ d: ctx.hs(G.ellipse(s * (wid(0) + 0.065), -0.02, 0.014, 0.014)), fill: "deep", o: 0.7 });
            lines.push({ d: B([[-cw * 1.02, -0.265], [-cw * 0.5, -0.285], [0, -0.29], [cw * 0.5, -0.285], [cw * 1.02, -0.265]], [4e-3, 0.011, 0.012, 0.011, 4e-3]), fill: "light", o: 0.4 });
          }
          const lit = [{ d: B([[-cw * 1, -0.4], [-cw * 0.76, -0.58], [-cw * 0.3, -0.665]], [4e-3, 0.06, 4e-3]), o: 0.7 }];
          const pieces = [{ id: "hat-shell", z: ctx.Z.hat, d: sm(pts, 0.45), mat: shell, lines, lit, light: { form: 1.1, sheenO: 0.75 } }];
          for (const s of [-1, 1]) {
            const sp = [[s * (wid(0.2) - 0.01), 0.2], [s * (wid(0.33) - 0.03), 0.36], [s * 0.08, 0.5]];
            pieces.push({ id: `hat-strap-${s < 0 ? "R" : "L"}`, z: ctx.Z.hat + 0.05, d: ctx.hs(G.brush(sp, [0.026, 0.022, 0.02])), mat: strapM, light: { form: 0.4 } });
          }
          pieces.push({ id: "hat-chincup", z: ctx.Z.hat + 0.06, d: sm([[-0.09, 0.5], [0, 0.47], [0.09, 0.5], [0.05, 0.545], [-0.05, 0.545]]), mat: strapM, light: { form: 0.4 } });
          if (!up) pieces.push(...castShadow(ctx, [[-(wid(-0.1) - 0.04), -0.09], [-0.34, -0.14], [-0.2, -0.2], [0, -0.206], [0.2, -0.2], [0.34, -0.14], [wid(-0.1) - 0.04, -0.09]], 0.055, { shift: 0.02 }));
          else pieces.push(...castShadow(ctx, [[-0.37, -0.12], [-0.2, -0.19], [0, -0.206], [0.2, -0.19], [0.37, -0.12]], 0.05, { shift: 0.02 }));
          const paper = ctx.tok("paper-100"), cool = ctx.tok("slate-500");
          const duo = !!(ctx.scheme && ctx.scheme.map && !ctx.scheme.spotKeep);
          const vlines = [];
          if (!up) {
            const W0 = wid(0.05) + 0.078;
            const v = (f, y, s = false, d = 0.08) => [-W0 * f, y, s, d];
            const VL = [[0, -0.245, false, 0.15], [-W0 * 0.5, -0.248, false, 0.14], v(0.93, -0.215, true, 0.07), v(0.99, -0.1, false, 0.06), v(1, 0.1, false, 0.05), v(0.95, 0.3, false, 0.06), v(0.82, 0.45, false, 0.08), v(0.5, 0.545, false, 0.12), [0, 0.57, false, 0.14]];
            const vd0 = M.path(ctx, M.sym(VL), 0.4);
            const base = M.thin(M.samplePath(G, vd0, 4), 2);
            vlines.push({ d: vd0, fill: paper, o: lo ? 0.3 : 0.2 });
            const q0 = ctx.hp([0, 0.43], { flat: true }), q1 = ctx.hp([0, 1.43], { flat: true }), nl = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1, nn = [(q1[0] - q0[0]) / nl, (q1[1] - q0[1]) / nl];
            const fq = (p) => (p[0] - q0[0]) * nn[0] + (p[1] - q0[1]) * nn[1], band = [];
            for (let i = 0; i < base.length; i++) {
              const a = base[i], b = base[(i + 1) % base.length], fa = fq(a), fb = fq(b);
              if (fa >= 0) band.push(a);
              if (fa >= 0 !== fb >= 0) {
                const t = fa / (fa - fb);
                band.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
              }
            }
            if (band.length > 2) vlines.push({ d: G.poly(band), fill: paper, o: 0.2 });
            const ringW = lo ? 0.036 : hi ? 0.028 : 0.035, bev = lo ? 0.014 : 9e-3;
            const rim = M.relax(M.grow(base, bev * k), 1);
            const inner = M.relax(M.grow(base, -ringW * k), 1);
            const ringOf = (out, inn) => G.smooth(out, true, 0.5) + " " + G.smooth(M.area(out) * M.area(inn) > 0 ? inn.slice().reverse() : inn, true, 0.5);
            vlines.push({ d: ringOf(rim, base), fill: cool, o: lo ? 0.5 : 0.4 });
            vlines.push({ d: ringOf(base, inner), fill: duo ? ctx.accent("paper-100", 0.5) : paper, o: duo ? 0.3 : lo ? 0.5 : 0.35 });
            if (mid) {
              const bp = [[-0.3, -0.17], [-0.22, 0], [-0.12, 0.22], [-0.03, 0.43], [0.03, 0.57]].map(([x, y]) => [x, y, false, 0.1]);
              const bw = [8e-3, 0.085, 0.105, 0.075, 8e-3];
              vlines.push({ d: M.stroke(ctx, bp, bw.map((w) => w * 1.7), 0.1), fill: paper, o: 0.1 });
              vlines.push({ d: M.stroke(ctx, bp, bw.map((w) => w * 1.2), 0.1), fill: paper, o: 0.16 });
              vlines.push({ d: M.stroke(ctx, bp, bw.map((w) => w * 0.7), 0.1), fill: paper, o: 0.26 });
            }
          } else {
            const UL = [[0, -0.62, false, 0.03], [-cw * 0.45, -0.605, false, 0.03], [-cw * 0.82, -0.52, false, 0.03], [-cw * 1.05, -0.4, false, 0.03], [-cw * 1.14, -0.28, true, 0.03], [-cw * 0.6, -0.262, false, 0.03], [0, -0.25, false, 0.03]];
            vlines.push({ d: M.path(ctx, M.sym(UL), 0.4), fill: paper, o: 0.3 });
            if (mid) {
              const bp = [[-cw * 0.9, -0.33], [-cw * 0.6, -0.46], [-cw * 0.25, -0.56]].map(([x, y]) => [x, y, false, 0.03]);
              const bw = [6e-3, 0.07, 6e-3];
              vlines.push({ d: M.stroke(ctx, bp, bw.map((w) => w * 1.7), 0.03), fill: paper, o: 0.12 });
              vlines.push({ d: M.stroke(ctx, bp, bw.map((w) => w * 1.2), 0.03), fill: paper, o: 0.2 });
              vlines.push({ d: M.stroke(ctx, bp, bw.map((w) => w * 0.7), 0.03), fill: paper, o: 0.34 });
            }
          }
          pieces.push({ id: "hat-visor", z: ctx.Z.hat + 0.3, over: vlines });
          const W1 = wid(0.05) + 0.078;
          if (hi) for (const s of [-1, 1]) {
            const c = up ? [s * cw * 1.14, -0.25] : [s * W1 * 0.93, -0.215];
            pieces.push({ id: `hat-hinge-${s < 0 ? "R" : "L"}`, z: ctx.Z.hat + 0.35, d: M.mapD(G.ellipse(0, 0, 0.026, 0.026), (u, w) => ctx.hp([c[0] + u, c[1] + w], { depth: up ? 0.02 : 0.07 })), mat: ctx.mat("metal-gun", "metal"), light: { form: 0.6 } });
          }
          return pieces;
        }
      });
    }
  });

  // src/parts/head/ears-normal.js
  var require_ears_normal = __commonJS({
    "src/parts/head/ears-normal.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var { hexA } = require_planes();
      function ear(ctx, s, st = {}) {
        var _a;
        if (typeof st === "number") st = { size: st };
        const { G } = ctx;
        const H = ctx.head;
        const size = st.size || 1, stick = st.stick || 0, wK = st.wK || 1, lump = st.lump || 0, lobe = (_a = st.lobe) != null ? _a : 1;
        const x = s * (H.earX - 0.014), t = H.earTop, hgt = (H.earBot - H.earTop) * size * (lump ? 0.88 : 1);
        const o = (0.058 * size * wK + stick) * (lump ? 1.18 : 1);
        const P = (u, v) => [x + s * o * u, t + hgt * v];
        let pts;
        if (lump) {
          pts = [P(0, 0.1), P(0.55, -0.04), P(1, 0.1), P(1.12, 0.3), P(0.98, 0.5), P(1.08, 0.7), P(0.82, 0.9), P(0.4, 1), P(-0.1, 0.92)];
        } else {
          pts = [P(0, 0.1), P(0.7, -0.05), P(1, 0.3), P(0.85, 0.72), P(0.35 * (0.6 + 0.4 * lobe), 1), P(-0.18, 0.93)];
        }
        const d = ctx.hs(G.smooth(pts, true, 0.5));
        const ib = lump ? [P(0.3, 0.3), P(0.62, 0.4), P(0.56, 0.62), P(0.28, 0.72)] : [P(0.28, 0.25), P(0.62, 0.38), P(0.55, 0.7), P(0.26, 0.8)];
        const inner = ctx.hs(G.brush(ib, lump ? [6e-3, 0.026, 0.02, 6e-3] : [4e-3, 0.016, 0.012, 4e-3]));
        const concha = ctx.hs(G.ellipse(...P(0.42, 0.5), o * 0.2, hgt * 0.16));
        const lumps = lump ? [P(0.95, 0.2), P(1, 0.55), P(0.7, 0.88)].map((p) => ctx.hs(G.ellipse(p[0], p[1], o * 0.22, hgt * 0.11))) : [];
        const rim = ctx.hs(G.brush([P(0.2, 0), P(0.8, 0.12), P(0.92, 0.45)], [2e-3, 8e-3, 2e-3]));
        return { d, inner, concha, lumps, rim };
      }
      function drawEars(ctx, opts, st) {
        const out = [];
        for (const s of [-1, 1]) {
          const e = ear(ctx, s, { ...st, size: (st.size || 1) * (opts.earSize || 1) });
          const sh = s > 0;
          const lines = [];
          const over = [];
          if (ctx.lodAtLeast("mid")) {
            lines.push({ d: e.inner, fill: sh ? "deep" : "shade" });
            if (!sh) lines.push({ d: e.rim, fill: "light", o: 0.6 });
          }
          if (ctx.lodAtLeast("hi")) lines.push({ d: e.concha, fill: sh ? "deep" : "shade", o: 0.55 });
          if (st.lump && ctx.lodAtLeast("mid")) for (const l of e.lumps) lines.push({ d: l, fill: ctx.skin.blush, o: sh ? 0.25 : 0.45 });
          out.push({ id: `ear-${s < 0 ? "R" : "L"}`, z: ctx.Z.head - 0.5, d: e.d, mat: ctx.skin, fill: sh ? "shade" : void 0, lines, over, light: { form: 0.8 } });
        }
        return out;
      }
      register({
        kind: "ears",
        name: "normal",
        describe: "Standard ears tucked against the head; the shadow-side ear sits in shade, the lit one catches a rim of light.",
        params: { earSize: "0.8\u20131.3 (spec.head.earSize)" },
        example: { head: { ears: "normal" } },
        ear,
        draw: (ctx, opts) => drawEars(ctx, opts, {})
      });
      module.exports = { ear, drawEars };
    }
  });

  // src/parts/head/ears-more.js
  var require_ears_more = __commonJS({
    "src/parts/head/ears-more.js"() {
      "use strict";
      var { register } = require_registry();
      var { drawEars } = require_ears_normal();
      var V = {
        big: { d: "Big jug ears that stick out: comic, boyish, or a bruiser who never had them pinned.", st: { size: 1.28, stick: 0.03, wK: 1.1 } },
        small: { d: "Small neat ears set close to the skull.", st: { size: 0.76, stick: -6e-3, wK: 0.9 } },
        cauliflower: { d: "A boxer's cauliflower ear: swollen, lumpy, reddened.", st: { size: 1, wK: 1, lump: 1, lobe: 0.5 } }
      };
      for (const [name, v] of Object.entries(V)) {
        register({ kind: "ears", name, describe: v.d, params: { earSize: "0.8\u20131.3" }, example: { head: { ears: name } }, draw: (ctx, opts) => drawEars(ctx, opts, v.st) });
      }
    }
  });

  // src/parts/head/oval.js
  var require_oval = __commonJS({
    "src/parts/head/oval.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var P = require_planes();
      function headOutline(G, o) {
        const { cheek, jaw, jawY, chinW, crownW = cheek * 0.97, chin = "round", temple = cheek * 0.94 } = o;
        return P.buildOutline(G, { crownW, templeW: temple, cheekW: cheek, cheekY: 0.02, midW: cheek * 0.97, jawW: jaw, jawY, chinW, chinY: 0.5, chin, bulge: 0.02, sharp: chin === "square" }).d;
      }
      function faceModelling(ctx, H) {
        const m = P.facePlanes(ctx, { ...ctx.head, ...H });
        return { shade: m.shade, deep: m.deep, lit: m.lit, lines: m.lines };
      }
      var DEF = { crown: 0.97, temple: 0.94, cheek: 1, cheekY: 0.03, mid: 0.93, jaw: 0.8, jawY: 0.3, chinW: 0.11, bulge: 0.02, form: 1 };
      register({
        kind: "head",
        name: "oval",
        describe: "Balanced oval head with a rounded chin and designed face planes (temple, sockets, cheek hollow, jaw underside). The neutral default.",
        params: P.PARAMS,
        example: { head: { shape: "oval" } },
        headOutline,
        faceModelling,
        facePlanes: P.facePlanes,
        draw: (ctx, opts) => P.makeHead(ctx, opts, DEF)
      });
      module.exports = { headOutline, faceModelling, facePlanes: P.facePlanes, DEF };
    }
  });

  // src/parts/head/shapes.js
  var require_shapes = __commonJS({
    "src/parts/head/shapes.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var P = require_planes();
      var SHAPES = {
        square: {
          describe: "Wide flat jaw, square chin, tall flat forehead: Booker, soldiers, bruisers.",
          def: { crown: 0.98, temple: 0.97, cheek: 1, cheekY: 0.05, mid: 0.97, jaw: 0.95, jawY: 0.335, chinW: 0.19, chin: "square", bulge: 0, sharp: true, form: 1, planes: { brow: 1.2, socket: 1.1, jaw: 1.15 } }
        },
        wedge: {
          describe: "Heavy broad jaw under a narrower skull: the brute. Low jaw angle, thick chin, deep brow.",
          def: { crown: 0.9, temple: 0.92, cheek: 1, cheekY: 0.06, mid: 1, jaw: 1.04, jawY: 0.36, chinW: 0.21, chin: "square", bulge: 0.01, sharp: true, wK: 1.04, earTop: -0.03, earBot: 0.21, brow: -0.078, form: 1, planes: { brow: 1.5, socket: 1.3, jaw: 1.35, hollow: 1.1 } }
        },
        diamond: {
          describe: "High cheekbones, narrow forehead and pointed chin: Stacey, gaunt and dangerous.",
          def: { crown: 0.9, temple: 0.86, cheek: 1.08, cheekY: -5e-3, mid: 0.9, midY: 0.12, wK: 0.96, jaw: 0.68, jawY: 0.3, chinW: 0.125, chin: "pointed", bulge: 0, earTop: -0.08, earBot: 0.16, form: 1, planes: { hollow: 1.45, socket: 1, jaw: 0.9, lit: 1.2 } }
        },
        pear: {
          describe: "Jowly, heavy lower face on a narrow brow, soft double chin: the Loader.",
          def: { crown: 0.92, temple: 0.88, cheek: 0.98, cheekY: 0.04, mid: 0.98, jaw: 1, jawY: 0.325, chinW: 0.15, chin: "round", bulge: 0.065, midY: 0.17, mouthY: 0.315, form: 1, planes: { jowl: 1, jaw: 1.3, hollow: 0.7 } }
        },
        round: {
          describe: "Full, round face with a short soft chin: jolly, young or comfortable.",
          def: { crown: 1.02, temple: 1, cheek: 1.05, cheekY: 0.05, mid: 1, jaw: 0.9, jawY: 0.27, chinW: 0.15, chin: "round", bulge: 0.05, wK: 1.04, form: 1, planes: { hollow: 0.6, socket: 0.9, jaw: 0.9 } }
        },
        long: {
          describe: "Narrow, long face with a drawn chin: lanky clerks and scholars.",
          def: { crown: 0.88, temple: 0.86, cheek: 0.88, cheekY: 0.03, mid: 0.85, jaw: 0.72, jawY: 0.35, chinW: 0.12, chinY: 0.525, chin: "round", bulge: 0, wK: 0.92, eyeX: 0.145, noseY: 0.22, mouthY: 0.335, earBot: 0.21, form: 1, planes: { hollow: 1.2, jaw: 1 } }
        },
        heart: {
          describe: "Wide cheeks and brow tapering to a small pointed chin: soft, fem, fashion-plate.",
          def: { crown: 0.97, temple: 0.97, cheek: 0.99, cheekY: 0.02, mid: 0.9, midY: 0.12, jaw: 0.66, jawY: 0.3, chinW: 0.115, chin: "pointed", bulge: 0, form: 1, planes: { hollow: 0.9, socket: 0.85, jaw: 0.8 } }
        }
      };
      for (const [name, s] of Object.entries(SHAPES)) {
        register({ kind: "head", name, describe: s.describe, params: P.PARAMS, example: { head: { shape: name } }, draw: (ctx, opts) => P.makeHead(ctx, opts, s.def) });
      }
      module.exports = { SHAPES };
    }
  });

  // src/core/spaces.js
  var require_spaces = __commonJS({
    "src/core/spaces.js"(exports, module) {
      "use strict";
      var G = require_geom();
      function headSpace(R) {
        const H = R.head;
        function hp(p, opts = {}) {
          let [x, y] = p;
          if (H.yaw && !opts.flat) {
            const r = H.w * Math.sqrt(Math.max(0.15, 1 - Math.pow(Math.max(0, y - 0.05) / 0.62, 2)));
            const z = Math.sqrt(Math.max(0, r * r - x * x));
            x = x + (z + (opts.depth || 0)) * Math.sin(H.yaw);
          }
          const q = [H.cx + x * H.k, H.cy + y * H.k];
          return H.tilt ? G.rot(q, H.tilt, H.pivot) : q;
        }
        const hs = (d, opts) => G.mapPath(d, (p) => hp(p, opts));
        return { hp, hs };
      }
      function torsoSpace(R) {
        const yAt = (t) => R.y.shoulder + (R.y.crotch - R.y.shoulder) * t;
        function tp(p) {
          const Y = yAt(p[1]);
          return R.torsoPt(p[0] * R.widthAt(Y), Y);
        }
        const ts = (d) => G.mapPath(d, tp);
        return { tp, ts, yAt };
      }
      function limbProfile(R, limb, side, seg) {
        if (limb === "arm") {
          const w2 = R.arms[side].widths;
          if (seg === "upper") return (u) => G.lerp(w2.top, w2.elbow, u) + Math.sin(Math.PI * Math.min(1, u * 1.3)) * (w2.bicep - (w2.top + w2.elbow) / 2) * 0.8;
          return (u) => G.lerp(w2.elbow, w2.wrist, u) + Math.sin(Math.PI * Math.min(1, u * 1.6)) * (w2.forearm - (w2.elbow + w2.wrist) / 2) * 0.9;
        }
        const w = R.legs[side].widths;
        if (seg === "upper") return (u) => G.lerp(w.thigh, w.knee, Math.pow(u, 0.85));
        return (u) => G.lerp(w.knee, w.ankle, u) + Math.sin(Math.PI * Math.min(1, u * 1.5)) * (w.calf - (w.knee + w.ankle) / 2);
      }
      function boneSpace(R) {
        function joints(limb, side, seg) {
          const L = limb === "arm" ? R.arms[side] : R.legs[side];
          const a = limb === "arm" ? L.shoulder : L.hip, b = limb === "arm" ? L.elbow : L.knee, c = limb === "arm" ? L.wrist : L.ankle;
          return seg === "upper" ? [a, b] : seg === "lower" ? [b, c] : [a, b, c];
        }
        function bone(limb, side, seg = "upper") {
          const J = joints(limb, side, seg);
          if (seg === "whole") {
            const up = bone(limb, side, "upper"), lo = bone(limb, side, "lower");
            const l1 = G.dist(J[0], J[1]), l2 = G.dist(J[1], J[2]), split = l1 / (l1 + l2);
            const bp2 = (p) => p[0] <= split ? up.bp([p[0] / split, p[1]]) : lo.bp([(p[0] - split) / (1 - split), p[1]]);
            return { bp: bp2, bs: (d) => G.mapPath(d, bp2), hw: (u) => u <= split ? up.hw(u / split) : lo.hw((u - split) / (1 - split)), a: J[0], b: J[2], split };
          }
          const [a, b] = J;
          const dir = G.norm(G.sub(b, a));
          const n = [dir[1], -dir[0]];
          const hw = limbProfile(R, limb, side, seg);
          const bp = (p) => G.add(G.lerp(a, b, p[0]), G.mul(n, p[1] * hw(Math.max(0, Math.min(1, p[0])))));
          return { bp, bs: (d) => G.mapPath(d, bp), hw, a, b, dir, n, len: G.dist(a, b) };
        }
        return { bone, limbProfile: (limb, side, seg) => limbProfile(R, limb, side, seg) };
      }
      module.exports = { headSpace, torsoSpace, boneSpace, limbProfile };
    }
  });

  // src/core/body.js
  var require_body = __commonJS({
    "src/core/body.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var { limbProfile } = require_spaces();
      function torso(R, opts = {}) {
        var _a, _b, _c;
        const hh = R.hh, w = R.w, y = R.y;
        const e = ((_a = opts.ease) != null ? _a : 0.03) * hh;
        const hem = (_b = opts.hem) != null ? _b : y.hip + 0.15 * hh;
        const flare = (opts.flare || 0) * hh;
        const drop = (opts.shoulderDrop || 0) * hh;
        const nl = opts.neckline || "high";
        const sides = {};
        for (const s of ["R", "L"]) {
          const k = R.sx(s);
          const P = (x, Y) => R.torsoPt(k * x, Y);
          const pts = {
            neck: P(w.neckBase + e * 0.4 + (nl === "boat" ? 0.22 * hh : nl === "scoop" ? 0.1 * hh : 0), y.neckBase - 0.03 * hh - (nl === "turtle" ? 0.3 * hh : 0)),
            trap: P(w.neckBase + (w.shoulder - w.neckBase) * 0.5 + e * 0.7, y.neckBase + 0.075 * hh - e * 0.25 + drop * 0.5),
            shTop: P(w.shoulder - 0.13 * hh + e, y.shoulder + 0.02 * hh - e * 0.3 + drop),
            shPt: P(w.shoulder + e, y.shoulder + 0.24 * hh + drop),
            armpit: P(w.chest * 0.98 + e, y.chest - 0.24 * hh),
            chest: P(w.chest + e, y.chest),
            waist: P(w.waist + e, y.waist),
            hip: P(w.hip + e, y.hip)
          };
          if (hem > y.hip + 0.05 * hh) pts.hipLow = P(R.widthAt(Math.min(hem, y.crotch)) + e + flare * Math.min(1, (Math.min(hem, y.crotch) - y.hip) / Math.max(1, hem - y.hip)), Math.min(hem, y.crotch) - (hem > y.crotch ? 0 : 0.02 * hh));
          pts.hem = [...P(R.widthAt(Math.min(hem, y.crotch + 3 * hh)) + e + flare, hem), true];
          if (hem < y.waist + 0.05 * hh) {
            delete pts.hip;
            delete pts.hipLow;
            pts.hem = [...P(R.widthAt(hem) + e + flare, hem), true];
          }
          if (hem < y.chest + 0.05 * hh) {
            delete pts.waist;
          }
          sides[s] = pts;
        }
        const order = ["neck", "trap", "shTop", "shPt", "armpit", "chest", "waist", "hip", "hipLow", "hem"];
        const Lpts = order.filter((n) => sides.R[n]).map((n) => sides.R[n]);
        const Rpts = order.filter((n) => sides.L[n]).map((n) => sides.L[n]).reverse();
        const c = R.centerAt(hem);
        const hemMid = [c, hem + (opts.hemCurve || 0) * hh];
        const nc = R.centerAt(y.neckBase);
        const neckPts = [];
        const depth = ((_c = opts.depth) != null ? _c : nl === "v" ? 0.7 : nl === "scoop" ? 0.35 : nl === "crew" ? 0.1 : nl === "boat" ? 0.05 : 0) * hh;
        if (nl === "v") neckPts.push([nc, y.neckBase + depth, true]);
        else if (depth > 0) neckPts.push([nc, y.neckBase - 0.03 * hh + depth]);
        else if (nl === "turtle") neckPts.push([nc, y.neckBase - 0.36 * hh]);
        else neckPts.push([nc, y.neckBase - 0.05 * hh]);
        const all = [...Lpts, hemMid, ...Rpts, ...neckPts];
        if (nl === "v") {
          all[0] = [...all[0].slice(0, 2), true];
          all[all.length - 2] = [...all[all.length - 2].slice(0, 2), true];
        }
        return { d: G.smooth(all, true, 0.45), pts: sides, L: sides.L, R: sides.R, hem, hemMid, neckMid: neckPts[0] };
      }
      function limb(R, limbName, side, opts = {}) {
        var _a, _b;
        const L = limbName === "arm" ? R.arms[side] : R.legs[side];
        const a = limbName === "arm" ? L.shoulder : L.hip, b = limbName === "arm" ? L.elbow : L.knee, c = limbName === "arm" ? L.wrist : L.ankle;
        const e = (opts.ease || 0) * R.hh;
        const ws = opts.widthScale || 1;
        const l1 = G.dist(a, b), l2 = G.dist(b, c), split = l1 / (l1 + l2);
        const up = limbProfile(R, limbName, side, "upper"), lo = limbProfile(R, limbName, side, "lower");
        const base = (u) => u <= split ? up(u / split) : lo((u - split) / (1 - split));
        const hw = (u) => (opts.hw ? opts.hw(u, base(u)) : base(u) * ws) + e;
        const u0 = (_a = opts.from) != null ? _a : 0, u1 = (_b = opts.to) != null ? _b : 1;
        const at = (u) => u <= split ? G.lerp(a, b, u / split) : G.lerp(b, c, (u - split) / (1 - split));
        const d1 = G.norm(G.sub(b, a)), d2 = G.norm(G.sub(c, b));
        const bend = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
        const capStart = opts.capStart || (limbName === "arm" && u0 === 0 ? "round" : "flat");
        const capEnd = opts.capEnd || "flat";
        const N = 10;
        const mk = (s0, s1, cs, ce) => {
          const pts = [];
          for (let i = 0; i <= N; i++) pts.push(at(G.lerp(s0, s1, i / N)));
          const prof = (t) => hw(G.lerp(s0, s1, t));
          return G.tube(pts, prof, { capStart: cs, capEnd: ce, samples: 22, tension: 0.5 });
        };
        if (bend < 0.45 || u1 <= split + 0.02 || u0 >= split - 0.02) {
          const span = Math.max(0.05, u1 - u0), M = Math.max(4, Math.ceil(16 * span));
          const pts = [];
          for (let i = 0; i <= M; i++) pts.push(at(G.lerp(u0, u1, i / M)));
          const d = G.tube(pts, (t) => hw(G.lerp(u0, u1, t)), { capStart, capEnd, samples: Math.min(28, Math.max(10, Math.ceil(28 * span) + 6)), tension: 0.5 });
          return { d, pieces: [{ d, seg: "whole" }], merged: true, split, hw, at };
        }
        const dUp = mk(u0, split + 0.015, capStart, "round");
        const dLo = mk(split - 0.015, u1, "round", capEnd);
        return { d: null, pieces: [{ d: dUp, seg: "upper" }, { d: dLo, seg: "lower" }], merged: false, split, hw, at };
      }
      function trousers(R, opts = {}) {
        var _a, _b;
        const hh = R.hh, y = R.y;
        const e = ((_a = opts.ease) != null ? _a : 0.04) * hh;
        const top = opts.rise === "high" ? y.waist - 0.12 * hh : opts.rise === "low" ? y.hip - 0.12 * hh : y.waist + 0.05 * hh;
        const cut = opts.cut || "straight";
        const hemU = (_b = { ankle: 1, floor: 1.04, crop: 0.9, knee: 0.52, shorts: 0.28 }[opts.hem || "ankle"]) != null ? _b : 1;
        const legs = {};
        for (const s of ["R", "L"]) {
          const Lg = R.legs[s];
          const lw = Lg.widths;
          const k = R.sx(s);
          const kneeW = lw.knee + e * 0.8, thighW = lw.thigh + e;
          const prof = (u) => {
            const knU = 0.5;
            if (cut === "wide") return Math.max(thighW, G.lerp(thighW, thighW * 1.08, u));
            if (u < knU) return G.lerp(thighW, kneeW * (cut === "skinny" ? 0.95 : 1.05), Math.pow(u / knU, 0.9));
            const t = (u - knU) / (1 - knU);
            if (cut === "flare") return G.lerp(kneeW * 1.05, kneeW * 1.75, Math.pow(t, 1.4));
            if (cut === "slim" || cut === "skinny") return G.lerp(kneeW * (cut === "skinny" ? 0.95 : 1.05), (lw.ankle + e) * (cut === "skinny" ? 1.05 : 1.3), t);
            return G.lerp(kneeW * 1.05, kneeW * 1.02, t);
          };
          const pts2 = [];
          const M = 18;
          const hemTo = Math.min(1.04, hemU);
          const cl = [Lg.hip, Lg.knee, [Lg.ankle[0], Lg.ankle[1] + (opts.hem === "floor" ? 0.22 * hh : 0.06 * hh)]];
          const dense = G.resample(cl, 40, 0.5);
          const atU = (u) => {
            const f = Math.max(0, Math.min(1, u)) * (dense.length - 1);
            const i = Math.min(dense.length - 2, Math.floor(f));
            return G.lerp(dense[i], dense[i + 1], f - i);
          };
          const outer = [], inner = [];
          for (let i = 0; i <= M; i++) {
            const u = i / M * hemTo;
            const p = atU(u), p2 = atU(Math.min(1, u + 0.02)), p1 = atU(Math.max(0, u - 0.02));
            const dir = G.norm(G.sub(p2, p1));
            let n = [dir[1], -dir[0]];
            if (n[0] * k < 0) n = [-n[0], -n[1]];
            const w = prof(u);
            outer.push(G.add(p, G.mul(n, w)));
            inner.push(G.sub(p, G.mul(n, w)));
          }
          legs[s] = { outer, inner, prof, atU, hemTo };
        }
        const topL = R.torsoPt(-(R.widthAt(top) + e), top), topR = R.torsoPt(R.widthAt(top) + e, top);
        const hipL = R.torsoPt(-(R.w.hip + e), y.hip), hipR = R.torsoPt(R.w.hip + e, y.hip);
        const crotch = [R.pelvisShift + 0, y.crotch + 0.06 * hh, true];
        const Ls = legs.R, Rs = legs.L;
        const mark = (p) => [p[0], p[1], true];
        const pts = [
          mark(topL),
          hipL,
          ...Ls.outer.slice(1, -1),
          mark(Ls.outer[Ls.outer.length - 1]),
          mark(Ls.inner[Ls.inner.length - 1]),
          ...Ls.inner.slice(2, -1).reverse(),
          crotch,
          ...Rs.inner.slice(2, -1),
          mark(Rs.inner[Rs.inner.length - 1]),
          mark(Rs.outer[Rs.outer.length - 1]),
          ...Rs.outer.slice(1, -1).reverse(),
          hipR,
          mark(topR)
        ];
        return { d: G.smooth(pts, true, 0.42), legs, top, crotch, topL, topR };
      }
      function neck(R, opts = {}) {
        const hh = R.hh, y = R.y, w = R.w;
        const c0 = R.head.cx, c1 = R.centerAt(y.neckBase);
        const wt = w.neck * (opts.width || 1), wb = w.neckBase * (opts.width || 1);
        const top = y.neckTop;
        const pts = [
          [c0 - wt, top],
          [c0 - wt * 1, y.chin + 0.05 * hh],
          [c1 - wb * 0.98, y.neckBase - 0.02 * hh],
          [c1 - wb * 1.25, y.neckBase + 0.1 * hh],
          [c1 + wb * 1.25, y.neckBase + 0.1 * hh],
          [c1 + wb * 0.98, y.neckBase - 0.02 * hh],
          [c0 + wt * 1, y.chin + 0.05 * hh],
          [c0 + wt, top]
        ];
        return { d: G.smooth(pts, true, 0.4), top, base: y.neckBase };
      }
      module.exports = { torso, limb, trousers, neck };
    }
  });

  // src/core/context.js
  var require_context = __commonJS({
    "src/core/context.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var C = require_color();
      var T = require_tokens();
      var B = require_body();
      var SP = require_spaces();
      var REG = require_registry();
      function mulberry(seed) {
        let a = seed >>> 0;
        return () => {
          a |= 0;
          a = a + 1831565813 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }
      function defaultHead(R) {
        const w = R.head.w;
        return {
          w,
          crown: -0.5,
          hairline: -0.28,
          temple: -0.2,
          templeW: w * 0.93,
          brow: -0.085,
          eyeY: 0,
          eyeX: 0.155,
          eyeW: 0.125,
          eyeH: 0.05,
          cheekY: 0.1,
          cheekW: w,
          noseY: 0.205,
          noseW: 0.075,
          noseTipY: 0.17,
          mouthY: 0.31,
          mouthW: 0.135,
          jawY: 0.33,
          jawW: w * 0.8,
          chinY: 0.5,
          chinW: 0.12,
          earTop: -0.05,
          earBot: 0.19,
          earX: w * 0.97,
          hatLine: -0.33,
          // head-space y where a hat's brow band sits
          outline: null
          // set by the head part: the skull/face outline path in head space
        };
      }
      var UNDER = {
        outer: { ease: 0.012, waist: 0, drop: 0.075, arm: 0.025, cuff: 0.04 },
        // under a coat: hidden, so tight
        inner: { ease: 0.02, waist: 0.01, drop: 0, arm: 0.03, cuff: 0.045 }
        // under a waistcoat or dress: still partly seen
      };
      function underCaps(ctx) {
        const u = ctx.under;
        return u && u.torso ? UNDER[u.torso] : null;
      }
      function underArm(ctx, o) {
        var _a;
        const u = ctx.under;
        if (!u || !u.arms || !o || o.ease == null) return o;
        const c = UNDER[u.arms], cuff = ((_a = o.from) != null ? _a : 0) >= 0.8, hw0 = o.hw;
        const head = (u0) => u.arms === "outer" && !cuff ? 0.7 + 0.3 * Math.min(1, Math.max(0, u0 / 0.16)) : 1;
        return { ...o, ease: Math.min(o.ease, cuff ? c.cuff : c.arm), hw: (u0, b) => Math.min(hw0 ? hw0(u0, b) : b, b) * head(u0), widthScale: Math.min(o.widthScale || 1, 1) };
      }
      function underTorso(ctx, o = {}) {
        var _a;
        const c = underCaps(ctx);
        if (!c) return o;
        return { ...o, ease: Math.min((_a = o.ease) != null ? _a : 0.03, c.ease), shoulderDrop: Math.max(o.shoulderDrop || 0, c.drop) };
      }
      function exprGain(pxHead) {
        const t = T.STYLE.exprGain || [];
        if (!t.length || !(pxHead > 0)) return 1;
        if (pxHead >= t[0][0]) return t[0][1];
        for (let i = 1; i < t.length; i++) if (pxHead >= t[i][0]) {
          const [p0, g0] = t[i - 1], [p1, g1] = t[i];
          return g1 + (g0 - g1) * (pxHead - p1) / (p0 - p1);
        }
        return t[t.length - 1][1];
      }
      function makeCtx(S, R, o) {
        const scheme = o.scheme;
        const rng = mulberry(S.seed);
        const hsp = SP.headSpace(R), tsp = SP.torsoSpace(R), bsp = SP.boneSpace(R);
        let n = 0;
        const ctx = {
          S,
          R,
          G,
          C,
          T,
          Z: T.Z,
          scheme,
          lod: o.lod,
          scale: o.scale,
          rng,
          warnings: o.warnings,
          pid: (name) => `${name}-${n++}`,
          tok: (name) => {
            const v = T.tok(name);
            if (v) return v;
            ctx.warn(`colour "${name}" is not a token; drew grey (use cloth-*, brand tokens or #rrggbb)`);
            return T.tok("cloth-graphite");
          },
          mat: (colour, kind = "cloth", opts) => {
            const m = C.material(colour, kind, scheme, opts);
            if (m && m._bad && !o.warnings.some((w) => w.includes(`"${m._bad}"`))) ctx.warn(`colour "${m._bad}" is not a token; drew grey (use cloth-*, brand tokens or #rrggbb)`);
            return m;
          },
          skin: C.material(S.skin, "skin", scheme),
          hairMat: (colour) => C.material(colour || S.hair.color, "hair", scheme),
          /* Scheme-aware accents (opt-in). Gradient-map schemes recolour by luminance, so in militants, veteran,
             intellectual and characters a red band or an orange flame can land on the same brown as the jacket.
             mapped(c): what colour c becomes under the scheme (c itself when the scheme has no map).
             accent(c, role): the colour to draw so the result is the scheme's accent. Where the scheme maps and does not
               keep spot colours, it returns the grey that lands on a stop: role "accent" (default) the most saturated
               stop (militants' yellow), "light" the lightest, "dark" the darkest, or a number 0–1 for a map position.
               Anywhere else it returns c unchanged (spot: true keeps colours in crews, hound, shadows, paranormal).
             contrast(a, b): contrast ratio of two colours after mapping (≥ 3 reads as a shape against its neighbour). */
          mapped: (c) => {
            const h = ctx.tok(c);
            return scheme && scheme.map ? C.mapThrough(h, scheme.map) : h;
          },
          accent: (c, role = "accent") => {
            const h = ctx.tok(c);
            if (!scheme || !scheme.map || scheme.spotKeep) return h;
            const st = scheme.map, n2 = st.length - 1;
            let t;
            if (typeof role === "number") t = Math.max(0, Math.min(1, role));
            else if (role === "light") t = 1;
            else if (role === "dark") t = 0;
            else {
              let best = 0, bi = n2;
              st.forEach((x, i) => {
                const [r, g2, b] = C.rgb(x), ch = Math.max(r, g2, b) - Math.min(r, g2, b);
                if (ch > best) {
                  best = ch;
                  bi = i;
                }
              });
              t = n2 ? bi / n2 : 0;
            }
            const g = Math.round(t * 255);
            return C.hex([g, g, g]);
          },
          contrast: (a, b) => C.contrast(ctx.mapped(a), ctx.mapped(b)),
          px: (n2) => n2 / o.scale,
          // output px → kit units
          hh: R.hh,
          sides: ["R", "L"],
          sx: R.sx,
          hp: hsp.hp,
          hs: hsp.hs,
          tp: tsp.tp,
          ts: tsp.ts,
          tyAt: tsp.yAt,
          bone: bsp.bone,
          body: {
            torso: (opts) => B.torso(R, underTorso(ctx, opts)),
            limb: (limb, side, opts) => B.limb(R, limb, side, limb === "arm" ? underArm(ctx, opts) : opts),
            trousers: (opts) => B.trousers(R, opts),
            neck: (opts) => B.neck(R, opts)
          },
          head: defaultHead(R),
          // gain: how hard face parts push the expression at this LOD (T.STYLE.exprGain; 1 at hi, more when the face is small)
          expr: { brow: { raise: 0, angle: 0, knit: 0 }, lid: { upper: 0, lower: 0, bags: 0, crinkle: 0, arc: 0 }, mouth: { curve: 0, width: 1, open: 0, smirk: 0, teeth: 0, snarl: 0, press: 0, dimple: 0 }, cheek: { apple: 0, wedge: 0, jaw: 0 }, nose: { wrinkle: 0 }, gaze: [0, 0], gain: exprGain(R.hh * o.scale) },
          // true if a head-space x (or kit x when kit=true) sits on the shadow side (viewer-right with the default key light)
          isShadowSide: (x, kit = false) => {
            return o.light.side * (kit ? x - R.centerAt(R.y.chest) : x) > 0;
          },
          light: o.light,
          // the resolved light (light.js): face parts read the key's side and pattern from it
          lodAtLeast: (lvl) => ({ lo: 0, mid: 1, hi: 2 })[o.lod] >= { lo: 0, mid: 1, hi: 2 }[lvl],
          part(kind, name, opts = {}) {
            const p = REG.get(kind, name);
            if (!p) {
              ctx.warn(`${kind} "${name}" not found (available: ${REG.list(kind).map((x) => x.name).join(", ") || "none"})`);
              return [];
            }
            const r = p.draw(ctx, opts);
            return Array.isArray(r) ? r : r && r.pieces ? r.pieces : [];
          },
          cuts: o.cuts,
          /* remove a region from every piece whose id matches the regex (e.g. arm and sleeve ends inside a pocket) */
          cut: (match, d) => {
            o.cuts.push({ match, d });
          },
          under: null,
          underCaps: () => underCaps(ctx),
          hems: {},
          /* a garment that wraps the torso records its (side) hem so under-layers ending just below it get tucked in */
          coverHem: (slot, y) => {
            var _a;
            ctx.hems[slot] = Math.min((_a = ctx.hems[slot]) != null ? _a : Infinity, y);
          },
          warn: (msg) => {
            if (!o.warnings.includes(msg)) o.warnings.push(msg);
          }
        };
        return ctx;
      }
      module.exports = { makeCtx, defaultHead, UNDER, mulberry, exprGain };
    }
  });

  // src/core/spec.js
  var require_spec = __commonJS({
    "src/core/spec.js"(exports, module) {
      "use strict";
      var BUILD = { slight: 0.88, slim: 0.9, average: 1, athletic: 1.06, broad: 1.15, stocky: 1.18, heavy: 1.25, huge: 1.35 };
      var V1_TOP = { turtleneck: "turtleneck", tee: "tee", suit: "suit-jacket", jacket: "field-jacket", coat: "overcoat", tactical: "tactical-jacket", dress: "shift-dress", overalls: "overalls" };
      var V1_HAIR = { buzz: "buzz", flattop: "flattop", bob: "bowl-bob", sidepart: "side-part", short: "short", afro: "afro", long: "long", beanie: "short", bald: "bald" };
      var V1_FACE = ["goatee", "moustache", "beard", "stubble", "glasses", "scar", "pimples", "unibrow"];
      var V1_SHOES = { shoes: "oxfords", boots: "combat-boots", cowboy: "cowboy-boots", heels: "heels" };
      function hash(s) {
        let h = 2166136261;
        for (const c of String(s)) {
          h ^= c.charCodeAt(0);
          h = Math.imul(h, 16777619);
        }
        return h >>> 0;
      }
      function isV1(s) {
        const f = s.face || {};
        return !!(s.top || s.bottom && !s.outfit || s.shoes || s.hands === "pockets" || V1_FACE.some((k) => f[k]) || s.hair && ["sidepart", "beanie"].includes(s.hair.style));
      }
      function upgradeV1(s) {
        if (!isV1(s)) return s;
        const o = { ...s };
        const top = s.top || {}, bot = s.bottom || {}, sh = s.shoes || {};
        if (!s.outfit && (s.top || s.bottom || s.shoes)) {
          o.outfit = {};
          if (top.type === "overalls") {
            o.outfit.base = { type: "tee", color: top.color, sleeves: top.sleeves || "short" };
            o.outfit.dress = { type: "overalls", color: top.overalls || bot.color };
          } else if (top.type === "dress" || bot.type === "dress") {
            o.outfit.dress = { type: "shift-dress", color: top.color || bot.color, length: bot.length, sleeves: top.sleeves };
            if (bot.tights) o.outfit.legs = { type: "tights", color: bot.tights };
          } else {
            const t = V1_TOP[top.type] || "tee";
            if (["suit-jacket", "field-jacket", "overcoat", "tactical-jacket"].includes(t)) {
              o.outfit.base = top.turtle ? { type: "turtleneck", color: top.turtle } : { type: t === "suit-jacket" ? "shirt" : "tee", color: top.shirt || "cloth-cream" };
              o.outfit.outer = { type: t, color: top.color, pattern: top.pattern, buttons: top.buttons, pockets: top.pockets, belt: top.belted };
              if (top.tie) o.outfit.neck = { type: "tie", color: top.tie };
            } else o.outfit.base = { type: t, color: top.color, pattern: top.pattern, sleeves: top.sleeves };
            if (bot.type === "skirt") o.outfit.bottom = { type: bot.length === "mini" ? "mini-skirt" : bot.cut === "pencil" || bot.length === "knee" ? "pencil-skirt" : "a-line-skirt", color: bot.color };
            else o.outfit.bottom = { type: bot.cargo ? "cargo-trousers" : "trousers", color: bot.color || top.color, pattern: bot.pattern, cut: bot.cut };
          }
          o.outfit.feet = { type: V1_SHOES[sh.type] || "oxfords", color: sh.color };
        }
        if (s.hair) {
          o.hair = { ...s.hair, style: V1_HAIR[s.hair.style] || s.hair.style };
          if (s.hair.style === "beanie" && !s.hair.hat) o.hair.hat = { type: "beanie", color: s.hair.hatColor || s.hair.color };
        }
        if (s.hands === "pockets") o.pose = { ...o.pose || {}, arms: { R: "pocket", L: "pocket" } };
        if (s.bigLeg) o.body = { ...o.body || {}, bigLeg: s.bigLeg === "right" ? "R" : s.bigLeg === "left" ? "L" : s.bigLeg };
        const f = s.face || {};
        o.face = { ...f };
        if (f.goatee || f.moustache || f.beard || f.stubble) o.face.facialHair = { type: f.goatee ? "goatee" : f.beard ? "beard-full" : f.moustache ? "moustache" : "stubble" };
        if (f.glasses) o.face.eyewear = f.glasses === "shades" ? "shades" : "round-wire";
        for (const k of V1_FACE) delete o.face[k];
        const marks = [];
        if (f.scar) marks.push({ type: "scar" });
        if (f.pimples) marks.push({ type: "spots" });
        if (marks.length) o.face.marks = marks;
        if (f.unibrow) o.face.brows = "unibrow";
        if (f.nose === "broken") o.face.nose = "broken";
        if (typeof s.build === "string" && !s.shape) o.shape = { heavy: "rect", broad: "rect", athletic: "invtri", slight: "column", average: "lean" }[s.build] || "lean";
        o.props = (s.props || []).map((p) => typeof p === "string" ? { type: p } : { ...p, side: p.side === "right" ? "R" : p.side === "left" ? "L" : p.side });
        delete o.top;
        delete o.bottom;
        delete o.shoes;
        delete o.hands;
        return o;
      }
      var KEY_FIX = { colour: "color", colour2: "color2", grey: "grey", eye: "eyes", brow: "brows", lip: "lips", hairstyle: "style" };
      function fixKeys(o, path, fixed) {
        if (!o || typeof o !== "object" || Array.isArray(o)) return;
        for (const k of Object.keys(o)) {
          const to = KEY_FIX[k];
          if (to && to !== k && o[to] === void 0) {
            o[to] = o[k];
            delete o[k];
            fixed.push(`${path}${k} \u2192 ${to}`);
          }
          if (o[to || k] && typeof o[to || k] === "object" && !Array.isArray(o[to || k])) fixKeys(o[to || k], `${path}${to || k}.`, fixed);
        }
      }
      function normalise(input) {
        var _a, _b, _c, _d;
        const raw = JSON.parse(JSON.stringify(input || {}));
        const fixed = [];
        fixKeys(raw, "", fixed);
        let s = upgradeV1(raw);
        s._fixed = fixed;
        s.id = s.id || "figure";
        s.heightIn = +s.heightIn || 68;
        s.figure = s.figure || "masc";
        s.shape = s.shape || (s.figure === "fem" ? "slim" : "lean");
        s.build = typeof s.build === "number" ? s.build : BUILD[s.build] || 1;
        if (s.face && typeof s.face.age === "number") {
          if (s.face.age <= 3) s.face.ageLevel = (_a = s.face.ageLevel) != null ? _a : s.face.age;
          else s.age = (_b = s.age) != null ? _b : s.face.age;
          delete s.face.age;
        }
        s.age = (_c = s.age) != null ? _c : 35;
        s.skin = s.skin || "fair";
        s.seed = Number.isInteger(s.seed) ? s.seed >>> 0 : s.seed != null ? hash(String(s.seed)) : hash(s.id);
        s.body = s.body || {};
        if (s.bigLeg && !s.body.bigLeg) s.body.bigLeg = s.bigLeg === "right" ? "R" : s.bigLeg === "left" ? "L" : s.bigLeg;
        if (typeof s.pose === "string") s.pose = { stance: s.pose };
        const p = s.pose = s.pose && typeof s.pose === "object" ? s.pose : {};
        p.stance = p.stance || "square";
        if (typeof p.arms === "string") p.arms = { R: p.arms, L: p.arms };
        if (Array.isArray(p.arms)) p.arms = { R: p.arms[0], L: (_d = p.arms[1]) != null ? _d : p.arms[0] };
        if (typeof p.hands === "string") p.hands = { R: p.hands, L: p.hands };
        p.arms = { R: "down", L: "down", ...p.arms || {} };
        if (p.arms.R === "cross" || p.arms.L === "cross") p.arms.R = p.arms.L = "cross";
        p.head = p.head || {};
        s.head = { shape: "oval", ...s.head || {} };
        if (typeof s.face === "string") {
          s._fixed.push(`face "${s.face}" is not an object; ignored`);
          s.face = {};
        }
        s.face = { eyes: "almond", brows: "straight", nose: "straight", mouth: "neutral", expression: "neutral", ...s.face || {} };
        if (typeof s.face.facialHair === "string") s.face.facialHair = { type: s.face.facialHair };
        if (typeof s.face.eyewear === "string") s.face.eyewear = { type: s.face.eyewear };
        if (typeof s.face.makeup === "string") s.face.makeup = { type: s.face.makeup };
        if (typeof s.face.mask === "string") s.face.mask = { type: s.face.mask };
        if (s.jewelry && !s.jewellery) {
          s.jewellery = s.jewelry;
          s._fixed.push("jewelry \u2192 jewellery");
        }
        delete s.jewelry;
        s.jewellery = [].concat(s.jewellery || []).map((j) => typeof j === "string" ? { type: j } : j);
        s.face.marks = [].concat(s.face.marks || []).map((m) => typeof m === "string" ? { type: m } : m);
        if (typeof s.hair === "string") s.hair = { style: s.hair };
        s.hair = { style: "short", color: "cloth-chocolate", ...s.hair || {} };
        if (typeof s.hair.hat === "string") s.hair.hat = { type: s.hair.hat, color: s.hair.hatColor };
        s.outfit = s.outfit || { base: { type: "tee", color: "cloth-cream" }, bottom: { type: "trousers", color: "cloth-charcoal" }, feet: { type: "oxfords", color: "cloth-black" } };
        for (const k of Object.keys(s.outfit)) if (typeof s.outfit[k] === "string") s.outfit[k] = { type: s.outfit[k] };
        s.props = [].concat(s.props || []).map((x) => typeof x === "string" ? { type: x } : x);
        if (typeof s.companion === "string") s.companion = { type: s.companion };
        return s;
      }
      var TOP_KEYS = ["id", "name", "plate", "code", "halo", "heightIn", "figure", "shape", "build", "heads", "skin", "age", "seed", "body", "pose", "head", "face", "hair", "outfit", "jewellery", "props", "companion", "scheme", "notes", "archetype", "playbook", "bigLeg", "top", "bottom", "shoes", "hands", "$comment"];
      var SLOTS = ["base", "mid", "outer", "neck", "bottom", "dress", "legs", "feet", "waist", "hands"];
      var COLOUR_KEYS = ["color", "color2", "grey", "frame", "lens", "lips", "band", "shaftColor", "buttonColor", "cuff", "pocketSquare", "browColor", "eyeColor"];
      var COLOUR_WORDS = { lens: ["clear", "dark", "mirror"] };
      function validate(raw, S, warn, o, L) {
        const near = (v, list) => {
          const l = String(v).toLowerCase();
          return list.find((x) => x.startsWith(l.slice(0, 3)));
        };
        const choose = (what, v, list) => {
          if (v == null || list.includes(v)) return true;
          const n = near(v, list);
          warn(`${what} "${v}" is not valid${n ? ` (did you mean "${n}"?)` : ""}; choose from: ${list.join(", ")}`);
          return false;
        };
        const clamp = (what, v, lo, hi, set) => {
          if (v == null || typeof v !== "number") return;
          if (!isFinite(v) || v < lo || v > hi) {
            const c = Math.max(lo, Math.min(hi, isFinite(v) ? v : lo));
            warn(`${what} ${v} is outside ${lo}\u2013${hi}; using ${c}`);
            set(c);
          }
        };
        for (const f of S._fixed || []) warn(`spec key ${f}`);
        for (const k of Object.keys(raw || {})) if (!TOP_KEYS.includes(k)) warn(`spec field "${k}" is not used (fields: ${TOP_KEYS.filter((x) => !["top", "bottom", "shoes", "hands", "$comment"].includes(x)).join(", ")})`);
        if (raw && raw.heightIn != null && isNaN(+raw.heightIn)) warn(`heightIn "${raw.heightIn}" is not a number of inches; using 68`);
        clamp("heightIn", S.heightIn, 40, 96, (v) => S.heightIn = v);
        clamp("heads", S.heads, 5, 10, (v) => S.heads = v);
        if (raw && typeof raw.build === "string" && !(raw.build in BUILD)) warn(`build "${raw.build}" is not valid; choose a number 0.85\u20131.35 or: ${Object.keys(BUILD).join(", ")}`);
        clamp("build", S.build, 0.6, 1.6, (v) => S.build = v);
        choose("figure", S.figure, ["masc", "fem"]);
        choose("shape", S.shape, L.shapes);
        choose("skin", S.skin, L.skins);
        for (const [k, v] of Object.entries(S.body || {})) {
          if (k === "type") choose("body.type", v, L.parts("body"));
          else if (k === "bigLeg") choose("body.bigLeg", v, ["R", "L"]);
          else if (k === "belly") clamp("body.belly", v, 0, 1.5, (x) => S.body.belly = x);
          else if (["shoulders", "chest", "waist", "hips", "neck", "arms", "legs", "hands", "feet"].includes(k)) clamp(`body.${k}`, v, 0.5, 2, (x) => S.body[k] = x);
          else warn(`body.${k} is not used (body: type, shoulders, chest, waist, hips, neck, arms, legs, hands, feet, belly, bigLeg)`);
        }
        const P = S.pose || {};
        choose("pose.stance", P.stance, ["square", "easy", "wide"]);
        if (P.weight != null) choose("pose.weight", P.weight, ["R", "L"]);
        for (const sd of ["R", "L"]) {
          const av = P.arms[sd];
          if (av && typeof av === "object") {
            choose(`pose.arms.${sd}.a`, av.a, L.armPoses);
            choose(`pose.arms.${sd}.b`, av.b, L.armPoses);
            if (av.as != null) choose(`pose.arms.${sd}.as`, av.as, L.armPoses);
            clamp(`pose.arms.${sd}.t`, av.t, 0, 1, (v) => av.t = v);
          } else choose(`pose.arms.${sd}`, av, L.armPoses);
        }
        if (P.hands) {
          for (const sd of ["R", "L"]) if (P.hands[sd]) choose(`pose.hands.${sd}`, P.hands[sd], L.parts("hands"));
        }
        clamp("pose.stoop", P.stoop, 0, 1, (v) => P.stoop = v);
        if (P.head) {
          clamp("pose.head.tilt", P.head.tilt, -10, 10, (v) => P.head.tilt = v);
          clamp("pose.head.yaw", P.head.yaw, -25, 25, (v) => P.head.yaw = v);
        }
        const sc = o.scheme || S.scheme;
        if (sc) choose("scheme", sc, L.schemes);
        if (o.lod) choose("lod", o.lod, ["hi", "mid", "lo"]);
        const colourCheck = (obj, path) => {
          if (!obj || typeof obj !== "object") return;
          for (const [k, v] of Object.entries(obj)) {
            if (COLOUR_KEYS.includes(k) && typeof v === "string" && !L.isColour(v) && !(COLOUR_WORDS[k] || []).includes(v)) warn(`${path}${k} "${v}" is not a colour token (use cloth-*, brand tokens such as ink-900, or #rrggbb)`);
            else if (v && typeof v === "object" && !Array.isArray(v) && k !== "block") colourCheck(v, `${path}${k}.`);
          }
        };
        colourCheck(S.face, "face.");
        colourCheck(S.hair, "hair.");
        colourCheck(S.companion, "companion.");
        (S.props || []).forEach((p, i) => colourCheck(p, `props[${i}].`));
        (S.jewellery || []).forEach((j, i) => colourCheck(j, `jewellery[${i}].`));
        if (S.halo && !L.isColour(S.halo)) warn(`halo "${S.halo}" is not a colour token`);
        for (const [slot, g] of Object.entries(S.outfit || {})) {
          if (!SLOTS.includes(slot)) {
            warn(`outfit.${slot} is not a slot; slots: ${SLOTS.join(", ")}`);
            continue;
          }
          if (!g) continue;
          colourCheck(g, `outfit.${slot}.`);
          const pat = g.pattern && (typeof g.pattern === "string" ? g.pattern : g.pattern.type);
          if (pat) choose(`outfit.${slot}.pattern`, pat, L.parts("textile"));
        }
      }
      module.exports = { normalise, upgradeV1, validate, BUILD, hash };
    }
  });

  // src/parts/jewellery/_jewel.js
  var require_jewel = __commonJS({
    "src/parts/jewellery/_jewel.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var REG = require_registry();
      var { mulberry } = require_context();
      var { hash } = require_spec();
      var KAPPA = 0.5523;
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      function ellipseCCW(cx, cy, rx, ry = rx, rot = 0) {
        const P = (x, y) => G.rot([cx + x, cy + y], rot, [cx, cy]);
        const k = KAPPA;
        const seg = [
          [P(rx, -ry * k), P(rx * k, -ry), P(0, -ry)],
          [P(-rx * k, -ry), P(-rx, -ry * k), P(-rx, 0)],
          [P(-rx, ry * k), P(-rx * k, ry), P(0, ry)],
          [P(rx * k, ry), P(rx, ry * k), P(rx, 0)]
        ];
        const s0 = P(rx, 0);
        let d = `M${G.f(s0[0])} ${G.f(s0[1])}`;
        for (const s of seg) d += " C" + s.map((p) => G.f(p[0]) + " " + G.f(p[1])).join(" ");
        return d + " Z";
      }
      function ring(cx, cy, rx, ry, t, rot = 0) {
        return G.ellipse(cx, cy, rx, ry, rot) + ellipseCCW(cx, cy, Math.max(rx - t, rx * 0.2), Math.max(ry - t, ry * 0.2), rot);
      }
      function arcPts(cx, cy, rx, ry, a0, a1, n = 6) {
        const out = [];
        for (let i = 0; i <= n; i++) {
          const a = a0 + (a1 - a0) * i / n;
          out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
        }
        return out;
      }
      var matKind = (tok) => /^metal-/.test(String(tok)) ? "metal" : "satin";
      function jmat(ctx, token, dflt = "metal-brass") {
        const t = token || dflt;
        return ctx.mat(t, matKind(t));
      }
      var minPx = (ctx) => ctx.px(ctx.lod === "lo" ? 2.4 : ctx.lod === "mid" ? 1.7 : 1.1);
      function earsCovered(ctx) {
        const F = ctx.S.face || {};
        const m = F.mask && F.mask.type ? REG.get("mask", F.mask.type) : null;
        if (!m) return false;
        const cv = [].concat((typeof m.covers === "function" ? m.covers(F.mask, ctx.S) : m.covers) || []);
        return cv.includes("ears");
      }
      function earAnchors(ctx) {
        const name = ctx.S.head && ctx.S.head.ears || "normal";
        const part = REG.get("ears", name) || REG.get("ears", "normal");
        if (!part) return null;
        let pcs;
        try {
          const r = part.draw(ctx, ctx.S.head || {});
          pcs = Array.isArray(r) ? r : r && r.pieces || [];
        } catch (e) {
          return null;
        }
        const cx = ctx.R.head.cx, out = {};
        for (const side of ["R", "L"]) {
          const pc = pcs.find((p) => p && p.id === `ear-${side}` && p.d);
          if (!pc) continue;
          let pts;
          try {
            pts = G.parse(pc.d).filter((s) => s.p.length).map((s) => s.p[s.p.length - 1]);
          } catch (e) {
            continue;
          }
          if (!pts.length) continue;
          let bot = pts[0], top = pts[0], far = pts[0];
          for (const p of pts) {
            if (p[1] > bot[1]) bot = p;
            if (p[1] < top[1]) top = p;
            if (Math.abs(p[0] - cx) > Math.abs(far[0] - cx)) far = p;
          }
          out[side] = { bot, top, out: far, h: bot[1] - top[1], k: ctx.R.sx(side) };
        }
        return out;
      }
      function polysOf(d, per = 6) {
        const polys = [];
        let pts = null, cur = null;
        const flush = () => {
          if (pts && pts.length > 2) polys.push(pts);
          pts = null;
        };
        for (const s of G.parse(d)) {
          if (s.c === "M") {
            flush();
            cur = s.p[0];
            pts = [cur];
          } else if (!pts) continue;
          else if (s.c === "L") {
            cur = s.p[0];
            pts.push(cur);
          } else if (s.c === "C") {
            const [a, b, p] = s.p;
            for (let i = 1; i <= per; i++) {
              const t = i / per, u = 1 - t;
              pts.push([u * u * u * cur[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * p[0], u * u * u * cur[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * p[1]]);
            }
            cur = p;
          } else if (s.c === "Q") {
            const [a, p] = s.p;
            for (let i = 1; i <= per; i++) {
              const t = i / per, u = 1 - t;
              pts.push([u * u * cur[0] + 2 * u * t * a[0] + t * t * p[0], u * u * cur[1] + 2 * u * t * a[1] + t * t * p[1]]);
            }
            cur = p;
          }
        }
        flush();
        return polys;
      }
      function inPolys(polys, x, y) {
        let w = 0;
        for (const P of polys) for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const a = P[j], b = P[i], cr = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
          if (a[1] <= y) {
            if (b[1] > y && cr > 0) w++;
          } else if (b[1] <= y && cr < 0) w--;
        }
        return w !== 0;
      }
      function hairCover(ctx) {
        var _a;
        const Hh = ctx.S.hair;
        if (!Hh || !Hh.style) return null;
        const F = ctx.S.face || {}, mk = F.mask && F.mask.type ? REG.get("mask", F.mask.type) : null;
        if (mk && [].concat((typeof mk.covers === "function" ? mk.covers(F.mask, ctx.S) : mk.covers) || []).includes("hair")) return null;
        const part = REG.get("hair", Hh.style);
        if (!part) return null;
        const saved = ctx.rng;
        let pcs = [];
        try {
          ctx.rng = mulberry(hash(`${ctx.S.seed}:hair:${part.name}:`));
          const r = part.draw(ctx, Hh);
          pcs = Array.isArray(r) ? r : r && r.pieces || [];
        } catch (e) {
          pcs = [];
        } finally {
          ctx.rng = saved;
        }
        const shapes = [];
        for (const p of pcs) if (p && p.d && p.mat && ((_a = p.z) != null ? _a : 0) > ctx.Z.earring) {
          try {
            const q = polysOf(p.d);
            if (q.length) shapes.push(q);
          } catch (e) {
          }
        }
        if (!shapes.length) return null;
        const inside = (p) => shapes.some((q) => inPolys(q, p[0], p[1]));
        const hides = (p, r) => {
          if (inside(p)) return true;
          let n = 1, c = 0;
          for (const f of [0.3, 0.6, 0.85, 1]) for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2 + f;
            n++;
            if (inside([p[0] + Math.cos(a) * r * f, p[1] + Math.sin(a) * r * f])) c++;
          }
          return c / n >= 0.1;
        };
        return { inside, hides };
      }
      function yawAway(ctx, k) {
        const y = ctx.R.head.yaw || 0;
        return Math.sign(y) * k;
      }
      function neckAt(ctx, Y) {
        const { R, hh } = ctx, y = R.y;
        const y0 = y.chin + 0.05 * hh, y1 = y.neckBase - 0.02 * hh;
        const t = clamp((Y - y0) / (y1 - y0), 0, 1.4);
        const c0 = R.head.cx, c1 = R.centerAt(y.neckBase);
        const wt = R.w.neck, wb = R.w.neckBase * 0.98;
        return { c: c0 + (c1 - c0) * Math.min(t, 1), hw: wt + (wb - wt) * Math.min(t, 1) + (t > 1 ? (t - 1) * (R.w.neckBase * 0.27) : 0) };
      }
      function strandSamples(pts, n, tension = 0.5) {
        const dense = G.resample(pts, 80, tension);
        const cum = [0];
        for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + G.dist(dense[i], dense[i - 1]));
        const L = cum[cum.length - 1], out = [];
        for (let j = 0; j < n; j++) {
          const s = L * (j + 0.5) / n;
          let i = 1;
          while (i < cum.length - 1 && cum[i] < s) i++;
          const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
          out.push({ p: G.lerp(dense[i - 1], dense[i], t), t: (j + 0.5) / n, tan: G.norm(G.sub(dense[i], dense[i - 1])) });
        }
        return { samples: out, length: L, dense };
      }
      function bandPath(b, u0, u1, hwAbs, bow) {
        const V = (u) => hwAbs / b.hw(u);
        const vs = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
        const sag = (v) => bow * (1 - v * v);
        const edge = (u, dir) => (dir > 0 ? vs : vs.slice().reverse()).map((v) => b.bp([u + sag(v), v * V(u)]));
        const mark = (pts) => pts.map((p, i) => i === 0 || i === pts.length - 1 ? [p[0], p[1], true] : p);
        return G.smooth([...mark(edge(u0, 1)), ...mark(edge(u1, -1))], true, 0.4);
      }
      module.exports = { bandPath, G, KAPPA, clamp, ellipseCCW, ring, arcPts, matKind, jmat, minPx, earsCovered, earAnchors, hairCover, yawAway, neckAt, strandSamples };
    }
  });

  // src/parts/jewellery/earrings.js
  var require_earrings = __commonJS({
    "src/parts/jewellery/earrings.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var J = require_jewel();
      var { G } = J;
      var STYLES = ["hoop", "stud", "drop", "disc"];
      var ALIAS = { hoops: "hoop", studs: "stud", pearl: "drop", pearls: "drop", teardrop: "drop", tear: "drop", button: "disc", clip: "disc", mod: "disc", disk: "disc" };
      var glint = (cx, cy, rx, ry, a0, a1, w) => ({ d: G.brush(J.arcPts(cx, cy, rx, ry, a0, a1, 5), [w * 0.15, w, w * 0.15]), fill: "light", o: 0.95 });
      function hoop(ctx, side, A, o, mat, z, cover) {
        var _a;
        const { hh } = ctx, k = A.k, size = o.size, mid = ctx.lod === "mid";
        const rMin = ctx.px(ctx.lod === "lo" ? 4.2 : ctx.lod === "mid" ? 3.4 : 0);
        let R = Math.max(0.088 * hh * size, rMin);
        const t = Math.max(0.023 * hh * Math.pow(size, 0.6) * ((_a = o.thick) != null ? _a : 1), mid ? ctx.px(2.6) : J.minPx(ctx));
        const away = J.yawAway(ctx, k), sq = away > 0 ? 1 - 0.55 * Math.abs(Math.sin(ctx.R.head.yaw || 0)) : 1;
        if (away > 0 && Math.abs(ctx.R.head.yaw || 0) > 0.14) z = ctx.Z.head - 0.2;
        const cx = A.bot[0] + k * 0.1 * R, cy = A.bot[1] + R - 0.012 * hh;
        const rx = R * sq;
        const out = [];
        const lines = ctx.lodAtLeast("hi") ? [glint(cx, cy, rx - t * 0.5, R - t * 0.5, Math.PI * 1.08, Math.PI * 1.55, t * 0.42)] : [];
        if (ctx.lodAtLeast("mid") && ctx.C.lum(mat.base) > 0.7) lines.push({ d: G.brush(J.arcPts(cx, cy, rx - t * 0.74, R - t * 0.74, Math.PI * 0.03, Math.PI * 0.62, 6), [t * 0.08, t * 0.56, t * 0.5, t * 0.45, t * 0.3, t * 0.2, t * 0.06]), fill: "shade", o: 0.85 });
        out.push({ id: `earring-hoop-${side}`, z, d: J.ring(cx, cy, rx, R, t), mat, lines, light: { form: mid ? 0.9 : 0.45 } });
        const pr = Math.max(0.017 * hh * Math.sqrt(size), J.minPx(ctx) * 0.8), pc = [A.bot[0] + k * 4e-3 * hh, A.bot[1] - 6e-3 * hh];
        if (!(cover && cover.inside(pc))) out.push({ id: `earring-post-${side}`, z: z + 0.01, d: G.circle(pc[0], pc[1], pr), mat, light: { form: 0.3, sheen: false } });
        return out;
      }
      function stud(ctx, side, A, o, mat, z, cover) {
        const { hh } = ctx, k = A.k;
        const r = Math.max(0.036 * hh * o.size, ctx.px(ctx.lod === "lo" ? 3.2 : ctx.lod === "mid" ? 2.4 : 1.6));
        const c = [A.bot[0] - k * 2e-3 * hh, A.bot[1] - 0.03 * hh];
        if (cover && (cover.hides(c, r) || cover.inside(A.bot))) return [];
        const out = [{ id: `earring-stud-${side}`, z, d: G.circle(c[0], c[1], r), mat, light: { form: 0.5 }, over: ctx.lodAtLeast("hi") ? [{ d: G.circle(c[0] - r * 0.32, c[1] - r * 0.34, r * 0.2), fill: "light", o: 0.95 }] : [] }];
        if (o.stone) {
          const sm = J.jmat(ctx, o.stone, "file-500");
          out.push({ id: `earring-stone-${side}`, z: z + 0.01, d: G.circle(c[0], c[1], r * 0.58), mat: sm, light: { form: 0.4 }, over: ctx.lodAtLeast("mid") ? [{ d: G.circle(c[0] - r * 0.18, c[1] - r * 0.2, r * 0.16), fill: "light", o: 0.95 }] : [] });
        }
        return out;
      }
      function drop(ctx, side, A, o, mat, z, cover) {
        const { hh } = ctx, k = A.k, size = o.size;
        const gem = o.gem === "tear" || o.gem === "teardrop" ? "tear" : "pearl";
        const gemMat = J.jmat(ctx, o.gemColor, gem === "pearl" ? "cloth-cream" : "metal-brass");
        const metal = mat;
        const rp = Math.max(0.043 * hh * size, ctx.px(ctx.lod === "lo" ? 3.6 : ctx.lod === "mid" ? 2.8 : 1.8));
        const capR = Math.max(0.017 * hh * Math.sqrt(size), J.minPx(ctx) * 0.8);
        const cap = [A.bot[0], A.bot[1] - 8e-3 * hh];
        const top = [cap[0] + k * 2e-3 * hh, cap[1] + 0.022 * hh + capR];
        const out = [];
        const stoneAt = [top[0], top[1] + rp * 0.92 + (gem === "pearl" ? 0 : rp * 0.9)];
        if (cover && cover.hides(stoneAt, rp)) return [];
        const capHidden = !!(cover && cover.inside(cap));
        out.push({ id: `earring-link-${side}`, z, d: G.brush([cap, top], Math.max(J.minPx(ctx), 0.011 * hh)), mat: metal, light: { form: 0.3, sheen: false } });
        if (gem === "pearl") {
          const c = [top[0], top[1] + rp * 0.92];
          out.push({ id: `earring-pearl-${side}`, z: z + 0.01, d: G.circle(c[0], c[1], rp), mat: gemMat, light: { form: 0.55 }, over: ctx.lodAtLeast("mid") ? [{ d: G.circle(c[0] - rp * 0.34, c[1] - rp * 0.36, rp * 0.2), fill: "light", o: 0.95 }] : [] });
        } else {
          const L = rp * 3.4, w = rp * 1.7;
          const tip = top, bc = [top[0], top[1] + L - w / 2];
          const pts = [tip, [tip[0] + w * 0.2, tip[1] + L * 0.2], [bc[0] + w * 0.5, bc[1] - w * 0.05], [bc[0], bc[1] + w * 0.5], [bc[0] - w * 0.5, bc[1] - w * 0.05], [tip[0] - w * 0.2, tip[1] + L * 0.2]];
          pts[0] = [tip[0], tip[1], true];
          out.push({ id: `earring-tear-${side}`, z: z + 0.01, d: G.smooth(pts, true, 0.45), mat: gemMat, light: { form: 0.6 }, over: ctx.lodAtLeast("mid") ? [{ d: G.brush([[bc[0] - w * 0.2, bc[1] - w * 0.1], [bc[0] - w * 0.24, bc[1] + w * 0.12]], [w * 0.03, w * 0.13, w * 0.03]), fill: "light", o: 0.95 }] : [] });
        }
        if (!capHidden) out.push({ id: `earring-cap-${side}`, z: z + 0.02, d: G.circle(cap[0], cap[1], capR), mat: metal, light: { form: 0.3, sheen: false } });
        return out;
      }
      function disc(ctx, side, A, o, mat, z, cover) {
        const { hh } = ctx, k = A.k;
        const r = Math.max(0.09 * hh * o.size, ctx.px(ctx.lod === "lo" ? 4.6 : ctx.lod === "mid" ? 3.6 : 2));
        const away = J.yawAway(ctx, k), sq = away > 0 ? 1 - 0.4 * Math.abs(Math.sin(ctx.R.head.yaw || 0)) : 1;
        const c = [A.bot[0] + k * 6e-3 * hh, A.bot[1] - 0.012 * hh];
        if (cover && (cover.hides(c, r) || cover.inside(A.bot))) return [];
        const lines = [];
        if (ctx.lodAtLeast("mid")) lines.push({ d: J.ring(c[0], c[1], r * 0.8 * sq, r * 0.8, r * 0.07), fill: "shade", o: 0.5 });
        if (ctx.lodAtLeast("hi")) lines.push(glint(c[0], c[1], r * 0.62 * sq, r * 0.62, Math.PI * 1.1, Math.PI * 1.55, r * 0.12));
        return [{ id: `earring-disc-${side}`, z, d: G.ellipse(c[0], c[1], r * sq, r), mat, lines, light: { form: 0.5 } }];
      }
      register({
        kind: "jewellery",
        name: "earrings",
        aliases: ["earring"],
        describe: "Earrings on the lobes: the big 60s hoop (hanging below the lobe), a stud, a pearl or teardrop drop, or a mod disc (the cover's white button). Under the hair: where hair covers the lobe a stud or disc is not drawn and a hoop shows only below the hem; follows head tilt and yaw (the far hoop hangs behind the jaw).",
        params: {
          style: "hoop (default) | stud | drop | disc",
          side: "both (default) | R | L",
          color: "metal-brass by default; any token (cloth-white for white hoops and discs); for drop it is the pearl or tear colour",
          size: "0.5-2.2 (1)",
          thick: "hoop wire thickness multiplier (1)",
          gem: "drop only: pearl (default) | tear",
          metal: "drop only: the cap and link metal token (metal-brass)",
          stone: "stud only: a token for a centre stone"
        },
        example: { jewellery: [{ type: "earrings", style: "hoop" }] },
        draw(ctx, o) {
          let style = ALIAS[o.style] || o.style || "hoop";
          const opt = { ...o };
          if (o.style && ALIAS[o.style] && (o.style === "pearl" || o.style === "pearls")) opt.gem = o.gem || "pearl";
          if (o.style === "teardrop" || o.style === "tear") opt.gem = "tear";
          if (!STYLES.includes(style)) {
            ctx.warn(`earrings style "${o.style}" is not valid; choose from: ${STYLES.join(", ")}`);
            style = "hoop";
          }
          opt.style = style;
          opt.size = J.clamp(+o.size || 1, 0.5, 2.2);
          if (J.earsCovered(ctx)) return [];
          const anchors = J.earAnchors(ctx);
          if (!anchors) return [];
          const sd = String(o.side || "both").toUpperCase(), sides = sd === "R" ? ["R"] : sd === "L" ? ["L"] : ["R", "L"];
          if (o.side && !["BOTH", "R", "L"].includes(sd)) ctx.warn(`earrings side "${o.side}" is not valid; choose both, R or L`);
          const z = ctx.Z.earring, out = [], cover = J.hairCover(ctx);
          const mat = J.jmat(ctx, style === "drop" ? o.metal : o.color, "metal-brass");
          for (const side of sides) {
            const A = anchors[side];
            if (!A) continue;
            const fn = { hoop, stud, drop, disc }[style];
            out.push(...fn(ctx, side, A, style === "drop" ? { ...opt, gemColor: o.color } : opt, mat, z, cover));
          }
          return out;
        }
      });
      module.exports = { STYLES };
    }
  });

  // src/parts/props/_insignia.js
  var require_insignia = __commonJS({
    "src/parts/props/_insignia.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var NAMES = ["fist", "torque", "star", "peace", "bolt", "eye", "key", "anchor", "cross", "crescent", "gear", "wings"];
      var TAU = Math.PI * 2;
      var K = 0.5523;
      var area = (pts) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          a += p[0] * q[1] - q[0] * p[1];
        }
        return a / 2;
      };
      var cw = (pts) => area(pts) >= 0 ? pts : pts.slice().reverse();
      var ccw = (pts) => area(pts) <= 0 ? pts : pts.slice().reverse();
      var solid = (pts) => G.poly(cw(pts));
      var hole = (pts) => G.poly(ccw(pts));
      var rect = (x0, y0, x1, y1) => solid([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      var circ = (cx, cy, r) => G.ellipse(cx, cy, r, r);
      var holeCircle = (cx, cy, r) => {
        const P = (x, y) => [cx + x, cy + y], k = K * r;
        const seg = [[P(r, -k), P(k, -r), P(0, -r)], [P(-k, -r), P(-r, -k), P(-r, 0)], [P(-r, k), P(-k, r), P(0, r)], [P(k, r), P(r, k), P(r, 0)]];
        let d = `M${G.f(cx + r)} ${G.f(cy)}`;
        for (const s of seg) d += " C" + s.map((p) => G.f(p[0]) + " " + G.f(p[1])).join(" ");
        return d + " Z";
      };
      var polar = (cx, cy, r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
      var ribbonPts = (pts, w) => {
        const L = [], R = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], n = G.perp(G.norm(G.sub(b, a)));
          L.push(G.add(pts[i], G.mul(n, w / 2)));
          R.push(G.sub(pts[i], G.mul(n, w / 2)));
        }
        return [...L, ...R.reverse()];
      };
      var arc = (cx, cy, r, a0, a1, n) => {
        const o = [];
        for (let i = 0; i <= n; i++) o.push(polar(cx, cy, r, a0 + (a1 - a0) * i / n));
        return o;
      };
      var bar = (a, b, w) => {
        const d = G.norm(G.sub(b, a)), n = G.perp(d), h = w / 2;
        return solid([G.add(a, G.mul(n, h)), G.add(b, G.mul(n, h)), G.sub(b, G.mul(n, h)), G.sub(a, G.mul(n, h))]);
      };
      var GLYPH = {
        /* raised fist, from the back: four knuckle bumps on a rounded block, finger gaps, a crease under the knuckles for the thumb, the wrist.
           One outline (no overlapping solids), so the gaps and the crease can be true holes. */
        fist() {
          const r = 0.19, cy = -0.58, xs = [-0.5, -0.1667, 0.1667, 0.5], hw = 0.69, w = 0.4, yb = 0.52, rc = 0.2;
          const o = [];
          xs.forEach((x, i) => {
            const jx = Math.atan2(-Math.sqrt(r * r - 0.1667 * 0.1667), 0.1667);
            const a0 = i === 0 ? Math.PI : Math.PI - jx, a1 = i === 3 ? TAU : TAU + jx;
            o.push(...arc(x, cy, r, a0, a1, i === 0 || i === 3 ? 9 : 7));
          });
          o.push(...arc(hw - rc, yb - rc, rc, 0, Math.PI / 2, 5));
          o.push([w, yb], [w, 1], [-w, 1], [-w, yb]);
          o.push(...arc(-hw + rc, yb - rc, rc, Math.PI / 2, Math.PI, 5));
          let d = solid(o);
          for (const x of [-0.3333, 0, 0.3333]) d += hole([[x - 0.03, -0.64], [x + 0.03, -0.64], [x + 0.03, -0.22], [x - 0.03, -0.22]]);
          d += hole([[-0.56, -0.12], [0.5, -0.12], [0.5, -0.03], [-0.56, -0.03]]);
          d += hole([[-0.2, 0.06], [-0.11, 0.06], [-0.11, 0.36], [-0.2, 0.36]]);
          return d;
        },
        /* the Red Torque: an open neck ring with ball terminals */
        torque() {
          const a0 = -0.45, a1 = a0 + TAU - 0.95, ro = 0.98, ri = 0.6, rm = (ro + ri) / 2;
          const o = arc(0, 0, ro, a0, a1, 22), i = arc(0, 0, ri, a1, a0, 22);
          let d = solid([...o, ...i]);
          d += circ(...polar(0, 0, rm, a0), 0.27) + circ(...polar(0, 0, rm, a1), 0.27);
          return d;
        },
        star() {
          const pts = [];
          for (let i = 0; i < 10; i++) pts.push(polar(0, 0.06, i % 2 ? 0.44 : 1.02, -Math.PI / 2 + i * Math.PI / 5));
          return solid(pts);
        },
        peace() {
          let d = circ(0, 0, 1) + holeCircle(0, 0, 0.8);
          d += bar([0, -0.95], [0, 0.95], 0.2);
          d += bar([0, 0.05], polar(0, 0, 0.9, Math.PI * 0.75), 0.2) + bar([0, 0.05], polar(0, 0, 0.9, Math.PI * 0.25), 0.2);
          return d;
        },
        bolt() {
          return solid([[0.28, -1], [-0.58, 0.12], [-0.06, 0.12], [-0.32, 1], [0.62, -0.22], [0.06, -0.22]]);
        },
        eye() {
          const lid = [[-1, 0, true], [-0.52, -0.5], [0, -0.64], [0.52, -0.5], [1, 0, true], [0.52, 0.42], [0, 0.52], [-0.52, 0.42]];
          let d = G.smooth(cw(lid.map((p) => p.slice(0, 2))).map((p) => Math.abs(p[0]) === 1 ? [...p, true] : p), true, 0.5);
          d += holeCircle(0, -0.04, 0.4) + circ(0, -0.04, 0.19);
          for (const [x, y, a] of [[0, -0.66, -Math.PI / 2], [-0.52, -0.52, -Math.PI * 0.69], [0.52, -0.52, -Math.PI * 0.31]]) d += solid([polar(x, y, 0.1, a + Math.PI / 2), polar(x, y, 0.1, a - Math.PI / 2), polar(x, y, 0.4, a)]);
          return d;
        },
        key() {
          let d = circ(0, -0.62, 0.4) + holeCircle(0, -0.62, 0.18);
          d += rect(-0.1, -0.28, 0.1, 1) + rect(0.1, 0.58, 0.4, 0.76) + rect(0.1, 0.84, 0.3, 1);
          return G.rotate(G.mapPath(d, (p) => [p[0] * 0.95, p[1] * 0.95]), -Math.PI / 4);
        },
        anchor() {
          let d = circ(0, -0.8, 0.2) + holeCircle(0, -0.8, 0.09);
          d += rect(-0.42, -0.58, 0.42, -0.45);
          d += rect(-0.09, -0.62, 0.09, 0.9);
          const arm = arc(0, 0.1, 0.74, 0.18, Math.PI - 0.18, 14);
          d += solid(ribbonPts(arm, 0.2));
          for (const s of [-1, 1]) d += solid([[s * 0.5, 0], [s * 0.98, -0.08], [s * 0.92, 0.1], [s * 0.74, 0.42], [s * 0.66, 0.2]]);
          return d;
        },
        cross() {
          return solid([[-0.19, -1], [0.19, -1], [0.19, -0.6], [0.64, -0.6], [0.64, -0.24], [0.19, -0.24], [0.19, 1], [-0.19, 1], [-0.19, -0.24], [-0.64, -0.24], [-0.64, -0.6], [-0.19, -0.6]]);
        },
        crescent() {
          const dx = 0.42, ri = 0.74, x = (1 + dx * dx - ri * ri) / (2 * dx), y = Math.sqrt(1 - x * x), a = Math.atan2(y, x);
          const outer = arc(0, 0, 1, a, TAU - a, 24);
          const ia = Math.atan2(y, x - dx), inner = arc(dx, 0, ri, TAU - ia, ia, 24);
          return solid([...outer, ...inner]);
        },
        gear() {
          const pts = [];
          for (let i = 0; i < 8; i++) {
            const t = i * TAU / 8, rr = 0.74;
            pts.push(polar(0, 0, rr, t - 0.3), polar(0, 0, 1, t - 0.15), polar(0, 0, 1, t + 0.15), polar(0, 0, rr, t + 0.3), polar(0, 0, rr, t + TAU / 16));
          }
          return solid(pts) + holeCircle(0, 0, 0.34);
        },
        wings() {
          const P0 = [0.12, -0.1], C = [0.5, -0.8], P2 = [1.04, -0.72], half = [P0];
          for (const t of [0.25, 0.5, 0.75, 1]) half.push([(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * C[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * C[1] + t * t * P2[1]]);
          half.push([0.8, -0.5], [1, -0.34], [0.72, -0.22], [0.92, -0.04], [0.64, 0.04], [0.78, 0.24], [0.48, 0.2], [0.5, 0.42], [0.12, 0.22]);
          const left = half.map((p) => [-p[0], p[1]]);
          return solid(half) + solid(left) + circ(0, 0.06, 0.24);
        }
      };
      function insignia(name, cx, cy, size) {
        const fn = GLYPH[name];
        if (!fn) return "";
        return G.mapPath(fn(), (p) => [cx + p[0] * size, cy + p[1] * size]);
      }
      module.exports = { insignia, NAMES };
    }
  });

  // src/parts/jewellery/necklace.js
  var require_necklace = __commonJS({
    "src/parts/jewellery/necklace.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var J = require_jewel();
      var K = require_kit();
      var { G } = J;
      var STYLES = ["chain", "beads", "choker", "dog-tags", "pearls"];
      var ALIAS = { chains: "chain", necklaces: "chain", "love-beads": "beads", bead: "beads", ribbon: "choker", velvet: "choker", dogtags: "dog-tags", "dog-tag": "dog-tags", tags: "dog-tags", pearl: "pearls" };
      var DEFAULT = {
        chain: { color: "metal-brass", drop: 0.62 },
        beads: { color: "cloth-orange", drop: 0.98 },
        choker: { color: "cloth-black", drop: 0 },
        "dog-tags": { color: "metal-steel", drop: 0.82 },
        pearls: { color: "cloth-cream", drop: 0.4 }
      };
      var V = [[0, 1], [0.14, 1.04], [0.44, 0.7], [0.78, 0.32], [1, 0]];
      var U = [[0, 1], [0.26, 1.2], [0.6, 1], [0.86, 0.56], [1, 0]];
      function strandPath(ctx, shape, drop, widen = 1) {
        const { R, hh } = ctx, nb = R.y.neckBase;
        const ya = nb - 0.1 * hh, yb = nb + drop * hh;
        const nk = J.neckAt(ctx, ya);
        const hw = nk.hw * 0.985;
        const P = (x, Y) => Y < nb ? [J.neckAt(ctx, Y).c + x, Y] : R.torsoPt(x, Y);
        const half = shape.map(([f, k]) => [ya + (yb - ya) * f, k * hw * (k > 1 ? widen : 1)]);
        const left = half.map(([Y, x]) => P(-x, Y)), right = half.slice(0, -1).reverse().map(([Y, x]) => P(x, Y));
        return [...left, ...right];
      }
      var castO = (ctx) => ({ x: 55e-4 * ctx.hh, y: 95e-4 * ctx.hh });
      var shadowPiece = (ctx, id, d, z) => ({ id, z: z - 5e-3, d, fill: "ink-900", light: false, opacity: 0.26 });
      var catch_ = (c, r) => ({ d: G.circle(c[0] - r * 0.34, c[1] - r * 0.36, r * 0.22), fill: "light", o: 0.95 });
      function beadStrand(ctx, id, pts, radii, mats, z, o = {}) {
        const out = [], so = castO(ctx);
        out.push(shadowPiece(ctx, `${id}-shadow`, radii.map((b) => G.circle(b.p[0] + so.x, b.p[1] + so.y, b.r)).join(""), z));
        mats.forEach((m, mi) => {
          let d = "";
          const over = [];
          radii.forEach((b, i) => {
            if (i % mats.length !== mi) return;
            d += G.circle(b.p[0], b.p[1], b.r);
            if (ctx.lodAtLeast("mid") && b.r * ctx.scale > 2.6) over.push(catch_(b.p, b.r));
          });
          if (!d) return;
          const r0 = radii.reduce((a, b) => a + b.r, 0) / radii.length;
          out.push({ id: `${id}-${mi}`, z: z + mi * 1e-3, d, mat: m, over, light: { dx: r0 * 0.42, dy: r0 * 0.22, bands: false, sheen: false, rim: false } });
        });
        return out;
      }
      function charm(ctx, kind, c, mat, z) {
        const { hh } = ctx;
        const out = [];
        const r = Math.max(0.05 * hh, ctx.px(ctx.lod === "lo" ? 4.4 : 3));
        if (kind === "cross") {
          const w = r * 0.34, L = r * 1.25;
          out.push({ id: "necklace-charm", z, d: G.poly([[c[0] - w, c[1]], [c[0] + w, c[1]], [c[0] + w, c[1] + L * 0.5], [c[0] + L * 0.65, c[1] + L * 0.5], [c[0] + L * 0.65, c[1] + L * 0.5 + w * 2], [c[0] + w, c[1] + L * 0.5 + w * 2], [c[0] + w, c[1] + L * 1.8], [c[0] - w, c[1] + L * 1.8], [c[0] - w, c[1] + L * 0.5 + w * 2], [c[0] - L * 0.65, c[1] + L * 0.5 + w * 2], [c[0] - L * 0.65, c[1] + L * 0.5], [c[0] - w, c[1] + L * 0.5]]), mat, light: { form: 0.6 } });
        } else if (kind === "gem") {
          const gm = J.jmat(ctx, "file-500");
          const cy = c[1] + r * 0.9;
          out.push({ id: "necklace-charm", z, d: G.poly([[c[0], cy - r * 0.95], [c[0] + r * 0.75, cy - r * 0.15], [c[0], cy + r * 0.95], [c[0] - r * 0.75, cy - r * 0.15]]), mat: gm, light: { form: 0.6 } });
        } else {
          const cy = c[1] + r * 0.95;
          out.push({ id: "necklace-charm", z, d: G.circle(c[0], cy, r), mat, light: { form: 0.7 } });
          if (kind !== "disc") {
            let I;
            try {
              I = require_insignia();
            } catch (e) {
              I = null;
            }
            if (I && I.NAMES.includes(kind) && ctx.lodAtLeast("mid")) out.push({ id: "necklace-charm-glyph", z: z + 0.01, d: I.insignia(kind, c[0], cy, r * 0.62), mat, fill: "deep", light: false, opacity: 0.9 });
          }
        }
        return out;
      }
      function tag(ctx, c, w, h, rot, mat, id, z) {
        const r = Math.min(w, h) * 0.3;
        const x0 = c[0] - w / 2, x1 = c[0] + w / 2, y0 = c[1], y1 = c[1] + h;
        const d = G.smooth([[x0 + r, y0], [x1 - r, y0], [x1, y0 + r], [x1, y1 - r * 0.4], [x1 - r * 0.6, y1], [x0 + r * 0.6, y1], [x0, y1 - r * 0.4], [x0, y0 + r]], true, 0.28);
        const over = [{ d: G.circle(c[0], y0 + h * 0.12, w * 0.085), fill: "deep", o: 0.9 }];
        const lines = ctx.lodAtLeast("mid") ? [{ d: G.brush([[c[0] - w * 0.3, y0 + h * 0.42], [c[0] + w * 0.3, y0 + h * 0.42]], h * 0.06), fill: "deep", o: 0.65 }, { d: G.brush([[c[0] - w * 0.3, y0 + h * 0.62], [c[0] + w * 0.22, y0 + h * 0.62]], h * 0.06), fill: "deep", o: 0.65 }, { d: G.brush([[c[0] - w * 0.3, y0 + h * 0.8], [c[0] + w * 0.3, y0 + h * 0.8]], h * 0.05), fill: "deep", o: 0.5 }] : [];
        return { id, z, d: rot ? G.rotate(d, rot, [c[0], y0]) : d, mat, lines: rot ? [] : lines, over: rot ? [] : over, light: { form: 0.8 } };
      }
      register({
        kind: "jewellery",
        name: "necklace",
        aliases: ["necklaces"],
        describe: "A necklace over the base layer: a thin chain (optional charm), chunky love beads, a velvet choker, the Veteran's ball chain with two dog tags, or a strand of pearls. Under jackets and collars, so it shows in open ones.",
        params: {
          style: "chain (default) | beads | choker | dog-tags | pearls",
          color: "token: metal-brass (chain), cloth-orange (beads), cloth-black (choker), metal-steel (dog-tags), cloth-cream (pearls)",
          color2: "beads only: a second colour, alternated bead by bead",
          drop: "length below the neck base in head heights (chain 0.62, beads 0.98, dog-tags 0.82, pearls 0.4)",
          charm: "chain and choker: disc | cross | gem | any insignia name (fist, torque, star, peace \u2026)",
          rows: "pearls: 1-3 strands"
        },
        example: { jewellery: [{ type: "necklace", style: "chain" }] },
        draw(ctx, o) {
          var _a;
          const { hh, Z } = ctx;
          let style = ALIAS[o.style] || o.style || "chain";
          if (!STYLES.includes(style)) {
            ctx.warn(`necklace style "${o.style}" is not valid; choose from: ${STYLES.join(", ")}`);
            style = "chain";
          }
          const D = DEFAULT[style];
          const drop = J.clamp((_a = o.drop) != null ? _a : D.drop, 0.05, 1.6);
          const z = Z.necklace, out = [];
          const mat = J.jmat(ctx, o.color, D.color);
          const min = J.minPx(ctx);
          if (style === "choker") {
            const y = ctx.R.y.chin + 0.108 * hh;
            const nk = J.neckAt(ctx, y), hw = nk.hw * 1.025, w = Math.max(0.05 * hh, ctx.px(ctx.lod === "lo" ? 3.6 : 2.6));
            const sag = 0.026 * hh;
            const pts = [[nk.c - hw, y - sag * 0.2], [nk.c - hw * 0.55, y + sag * 0.55], [nk.c, y + sag], [nk.c + hw * 0.55, y + sag * 0.55], [nk.c + hw, y - sag * 0.2]];
            out.push({ id: "necklace-choker", z, d: K.ribbon(pts, [w * 0.85, w, w * 0.85], { n: 28 }), mat: J.jmat(ctx, o.color, D.color), light: { form: 0.5 }, lines: ctx.lodAtLeast("mid") ? [{ d: K.ribbon([pts[0], pts[1], pts[2], pts[3], pts[4]].map((p) => [p[0], p[1] - w * 0.3]), [w * 0.04, w * 0.1, w * 0.04], { n: 20 }), fill: "light", o: 0.55 }] : [] });
            if (o.charm !== false) out.push(...charm(ctx, o.charm || "disc", [nk.c, y + sag + w * 0.1], J.jmat(ctx, "metal-brass"), z + 0.02));
            return out;
          }
          const shape = style === "pearls" || style === "chain" && drop < 0.5 ? U : V;
          const path = strandPath(ctx, shape, drop, style === "pearls" ? 1 : 1);
          const dense = G.resample(path, 40, 0.5);
          if (style === "chain" || style === "dog-tags") {
            const w = Math.max(style === "chain" ? 0.013 * hh : 0.011 * hh, min * 1.15);
            const ballMat = mat;
            const so = castO(ctx);
            out.push(shadowPiece(ctx, "necklace-chain-shadow", G.brush(path.map((p) => [p[0] + so.x, p[1] + so.y]), w * 1.15, { samples: 40 }), z));
            out.push({ id: "necklace-chain", z, d: G.brush(path, w, { samples: 40 }), mat: ballMat, light: { form: 0.25, sheen: false } });
            if (style === "dog-tags") {
              if (ctx.lodAtLeast("hi")) {
                const n = 64, S = J.strandSamples(path, n), r = w * 0.55;
                out.push({ id: "necklace-balls", z: z + 2e-3, d: S.samples.map((s) => G.circle(s.p[0], s.p[1], r)).join(""), mat: ballMat, fill: "light", light: false, opacity: 0.55 });
              }
              const low = path.reduce((a, b) => b[1] > a[1] ? b : a);
              const tw = Math.max(0.125 * hh, ctx.px(ctx.lod === "lo" ? 8 : 6)), th = tw * 1.6;
              const tmat = J.jmat(ctx, o.color, "metal-steel");
              out.push(tag(ctx, [low[0] + 0.022 * hh, low[1] + 8e-3 * hh], tw, th, 0.1, tmat, "necklace-tag-b", z + 0.01));
              out.push(tag(ctx, [low[0] - 0.012 * hh, low[1] - 4e-3 * hh], tw, th, 0, tmat, "necklace-tag-a", z + 0.02));
            } else if (o.charm) {
              const low = path.reduce((a, b) => b[1] > a[1] ? b : a);
              out.push(...charm(ctx, o.charm === true ? "disc" : o.charm, [low[0], low[1] - 4e-3 * hh], J.jmat(ctx, o.charmColor, o.color || "metal-brass"), z + 0.02));
            }
            return out;
          }
          if (style === "beads") {
            const r0 = Math.max(0.027 * hh, ctx.px(ctx.lod === "lo" ? 3.1 : 2.1));
            const S = J.strandSamples(path, Math.max(8, Math.round(J.strandSamples(path, 10).length / (2 * r0 * 1.04))), 0.5);
            const radii = S.samples.map((s) => ({ p: s.p, r: r0 * (0.92 + 0.16 * Math.sin(s.t * Math.PI)) }));
            const mats = o.color2 ? [mat, J.jmat(ctx, o.color2, "cloth-cream")] : [mat];
            out.push(...beadStrand(ctx, "necklace-beads", path, radii, mats, z));
            return out;
          }
          const rows = J.clamp(Math.round(o.rows || 1), 1, 3);
          for (let row = 0; row < rows; row++) {
            const dr = drop + row * 0.09, p2 = row ? strandPath(ctx, shape, dr) : path;
            const rMax = Math.max(0.034 * hh, ctx.px(ctx.lod === "lo" ? 2.9 : 2));
            const S0 = J.strandSamples(p2, 10);
            const n = Math.max(10, Math.round(S0.length / (2 * rMax * 0.97)));
            const S = J.strandSamples(p2, n, 0.5);
            const radii = S.samples.map((s) => ({ p: s.p, r: rMax * (0.62 + 0.38 * Math.sin(s.t * Math.PI)) }));
            out.push(...beadStrand(ctx, `necklace-pearls${row ? "-" + row : ""}`, p2, radii, [mat], z + row * 3e-3));
          }
          return out;
        }
      });
      module.exports = { STYLES, strandPath };
    }
  });

  // src/parts/jewellery/wrist.js
  var require_wrist = __commonJS({
    "src/parts/jewellery/wrist.js"() {
      "use strict";
      var { register } = require_registry();
      var J = require_jewel();
      var { G } = J;
      var HFP = null;
      try {
        HFP = require_anchors().HAND_FOR_POSE;
      } catch (e) {
        HFP = null;
      }
      var sidesOf = (ctx, o, dflt = "L") => {
        const s = String(o.side || dflt).toUpperCase();
        if (o.side && !["R", "L", "BOTH"].includes(s)) ctx.warn(`${o.type || "wrist piece"} side "${o.side}" is not valid; choose R, L or both`);
        return s === "BOTH" ? ["R", "L"] : s === "R" ? ["R"] : ["L"];
      };
      function wristEase(ctx) {
        const O = ctx.S.outfit || {}, t = (s) => O[s] && O[s].type || "";
        if (O.outer) return 0.07;
        if (/cardigan/.test(t("mid")) || O.dress && /boiler|gown/.test(t("dress"))) return 0.045;
        if (/shirt|blouse|turtleneck|knit/.test(t("base"))) return 0.045;
        return 8e-3;
      }
      var bandPath = J.bandPath;
      register({
        kind: "jewellery",
        name: "bracelet",
        aliases: ["bangle"],
        describe: "A bracelet round the wrist, over the cuff: stacked bangles (default), a wide cuff, or a string of beads. A bold band with a highlight; it rides up with a folded forearm.",
        params: { side: "L (default) | R | both", style: "bangle (default) | cuff | beads", color: "token (metal-brass)", count: "bangles: 1-3 stacked (2)", color2: "beads: second colour" },
        example: { jewellery: [{ type: "bracelet", side: "L" }] },
        draw(ctx, o) {
          var _a;
          const { hh, R } = ctx, out = [];
          const style = ["bangle", "cuff", "beads"].includes(o.style) ? o.style : "bangle";
          if (o.style && style !== o.style) ctx.warn(`bracelet style "${o.style}" is not valid; choose from: bangle, cuff, beads`);
          const mat = J.jmat(ctx, o.color, style === "beads" ? "cloth-orange" : "metal-brass");
          const min = J.minPx(ctx);
          for (const side of sidesOf(ctx, { ...o, type: "bracelet" })) {
            const b = ctx.bone("arm", side, "lower"), A = R.arms[side], len = b.len;
            const hw = (u) => b.hw(u) + (wristEase(ctx) + 8e-3) * hh;
            const z = A.z + 0.7;
            if (style === "beads") {
              const n = 7, r0 = Math.max(0.021 * hh, ctx.px(ctx.lod === "lo" ? 2.6 : 1.7)), mats = o.color2 ? [mat, J.jmat(ctx, o.color2, "cloth-cream")] : [mat];
              const u0 = 0.9;
              mats.forEach((m, mi) => {
                let d = "";
                for (let i = 0; i < n; i++) {
                  if (i % mats.length !== mi) continue;
                  const v = -1 + 2 * (i + 0.5) / n, c = b.bp([u0 + 0.02 * (1 - v * v), v * (hw(u0) / b.hw(u0)) * 0.92]);
                  d += G.circle(c[0], c[1], r0);
                }
                if (d) out.push({ id: `bracelet-beads-cuff-${side}${mi || ""}`, z: z + mi * 1e-3, d, mat: m, light: { dx: r0 * 0.42, dy: r0 * 0.22, bands: false, sheen: false, rim: false } });
              });
              continue;
            }
            const count = style === "cuff" ? 1 : J.clamp(Math.round((_a = o.count) != null ? _a : 2), 1, 3);
            const t = style === "cuff" ? Math.max(0.1 * hh, ctx.px(4)) : Math.max(0.036 * hh, min * 1.5);
            const gap = style === "cuff" ? 0 : t * 0.55;
            for (let i = 0; i < count; i++) {
              const u1 = 0.965 - i * (t + gap) / len, u0 = u1 - t / len;
              const hwA = hw(u1) * (1 + 4e-3 * i), bow = 0.012 + t / len * 0.35;
              const d = bandPath(b, u0, u1, hwA, bow);
              const lines = ctx.lodAtLeast("hi") ? [{ d: G.brush([b.bp([u0 + (u1 - u0) * 0.3, -0.62 * hwA / b.hw(u0)]), b.bp([u0 + (u1 - u0) * 0.3 + bow * 0.4, -0.1 * hwA / b.hw(u0)]), b.bp([u0 + (u1 - u0) * 0.3 + bow * 0.7, 0.28 * hwA / b.hw(u0)])], [t * 0.05, t * 0.22, t * 0.05]), fill: "light", o: 0.9 }] : [];
              out.push({ id: `bracelet-${i}-cuff-${side}`, z: z + i * 1e-3, d, mat, lines, light: { form: 0.55 } });
            }
          }
          return out;
        }
      });
      register({
        kind: "jewellery",
        name: "watch",
        aliases: ["wristwatch"],
        describe: "A wristwatch on the forearm just above the hand: leather or metal strap, a round case with a cream or dark dial, hands and tick marks at hi detail. Rides over the cuff.",
        params: { side: "L (default) | R | both", color: "case metal token (metal-chrome)", strap: "strap token (leather-brown); a metal-* token makes a bracelet strap", dial: "dial token (cloth-cream)" },
        example: { jewellery: [{ type: "watch", side: "L" }] },
        draw(ctx, o) {
          const { hh, R } = ctx, out = [];
          const caseMat = J.jmat(ctx, o.color, "metal-chrome"), strapTok = o.strap || "leather-brown";
          const strapMat = /^metal-/.test(strapTok) ? ctx.mat(strapTok, "metal") : ctx.mat(strapTok, "leather");
          for (const side of sidesOf(ctx, { ...o, type: "watch" })) {
            const b = ctx.bone("arm", side, "lower"), A = R.arms[side], len = b.len, k = R.sx(side);
            const ease = wristEase(ctx) + 6e-3;
            const hw = (u) => b.hw(u) + ease * hh;
            const z = A.z + 0.7;
            const sw = Math.max(0.095 * hh, ctx.px(ctx.lod === "lo" ? 4.4 : 3.2));
            const u1 = 0.97, u0 = u1 - sw / len, um = (u0 + u1) / 2;
            out.push({
              id: `watch-strap-cuff-${side}`,
              z,
              d: bandPath(b, u0, u1, hw(u1) * 1, 0.012),
              mat: strapMat,
              light: { form: 0.5 },
              lines: ctx.lodAtLeast("mid") && !/^metal-/.test(strapTok) ? [{ d: G.brush([b.bp([u0 + 0.01, -0.9]), b.bp([u0 + 0.014, 0.9])], [sw * 0.02, sw * 0.07, sw * 0.02]), fill: "deep", o: 0.55 }] : []
            });
            const r = Math.max(0.073 * hh, ctx.px(ctx.lod === "lo" ? 3.6 : 2.6));
            const cc = b.bp([um + 0.012, k * 0.1 * 1]);
            out.push({ id: `watch-case-cuff-${side}`, z: z + 0.01, d: G.circle(cc[0], cc[1], r), mat: caseMat, light: { form: 0.55 } });
            const dial = J.jmat(ctx, o.dial, "cloth-cream");
            const rd = r * 0.74;
            const over = [];
            if (ctx.lodAtLeast("mid")) {
              over.push({ d: G.brush([cc, [cc[0] + Math.cos(-2.62) * rd * 0.5, cc[1] + Math.sin(-2.62) * rd * 0.5]], [rd * 0.2, rd * 0.13]), fill: "ink-900", o: 0.9 });
              over.push({ d: G.brush([cc, [cc[0] + Math.cos(-0.52) * rd * 0.76, cc[1] + Math.sin(-0.52) * rd * 0.76]], [rd * 0.15, rd * 0.08]), fill: "ink-900", o: 0.9 });
            }
            if (ctx.lodAtLeast("hi")) for (let i = 0; i < 4; i++) {
              const a = i * Math.PI / 2;
              over.push({ d: G.circle(cc[0] + Math.cos(a) * rd * 0.82, cc[1] + Math.sin(a) * rd * 0.82, rd * 0.07), fill: "ink-900", o: 0.8 });
            }
            out.push({ id: `watch-dial-cuff-${side}`, z: z + 0.02, d: G.circle(cc[0], cc[1], rd), mat: dial, over, light: { form: 0.3, sheen: false } });
            if (ctx.lodAtLeast("hi")) out.push({ id: `watch-crown-cuff-${side}`, z: z + 5e-3, d: G.brush([[cc[0] + k * r * 0.95, cc[1] - r * 0.15], [cc[0] + k * r * 1.28, cc[1] - r * 0.15]], r * 0.3), mat: caseMat, light: { form: 0.4 } });
          }
          return out;
        }
      });
      var FINGER = {
        relaxed: [-0.056, 0.7, 0.027],
        grip: [-0.069, 0.6, 0.034],
        fist: [-0.069, 0.6, 0.034],
        hip: [-0.048, 0.52, 0.026],
        lapel: [-0.061, 0.64, 0.036],
        tucked: [-0.05, 0.425, 0.034],
        cigarette: [-0.1, 0.72, 0.03],
        peace: [-0.108, 0.74, 0.042]
      };
      register({
        kind: "jewellery",
        name: "ring",
        aliases: ["rings"],
        describe: "A ring on the ring finger: a metal band with a small stone. Hi level of detail only (it would be a speck at line-up size); it sits over the hand and rises with a raised forearm.",
        params: { side: "L (default) | R | both", color: "metal token (metal-brass)", stone: "token for the stone (none by default)" },
        example: { jewellery: [{ type: "ring", side: "L", stone: "file-500" }] },
        draw(ctx, o) {
          if (!ctx.lodAtLeast("hi")) return [];
          const { R } = ctx, out = [];
          let H;
          try {
            H = require_relaxed().handSpace;
          } catch (e) {
            return [];
          }
          const mat = J.jmat(ctx, o.color, "metal-brass");
          for (const side of sidesOf(ctx, { ...o, type: "ring" })) {
            const A = R.arms[side];
            const named = ctx.S.pose && ctx.S.pose.hands && ctx.S.pose.hands[side];
            const hand = named || HFP && HFP[A.pose] || "relaxed";
            const f = FINGER[hand];
            if (!f) continue;
            const hs = H(ctx, side), L = hs.len, [x, y, hw] = f;
            const a = hs.hp([x - hw * 1.06, y]), b = hs.hp([x + hw * 1.06, y]);
            const w = 0.026 * L;
            const zr = hand === "tucked" ? A.z + (side === "R" ? -0.59 : -0.19) : A.z + 0.9;
            out.push({ id: `ring-band-hand-${side}`, z: zr, d: G.brush([a, b], [w, w]), mat, light: { form: 0.5 } });
            if (o.stone) {
              const sm = J.jmat(ctx, o.stone, "file-500"), c = hs.hp([x, y - 0.012]);
              out.push({ id: `ring-stone-hand-${side}`, z: zr + 0.01, d: G.circle(c[0], c[1], 0.024 * L), mat: sm, light: { form: 0.4 }, over: [{ d: G.circle(c[0] - 8e-3 * L, c[1] - 9e-3 * L, 6e-3 * L), fill: "light", o: 0.95 }] });
            }
          }
          return out;
        }
      });
    }
  });

  // src/parts/legwear/legwear.js
  var require_legwear = __commonJS({
    "src/parts/legwear/legwear.js"() {
      "use strict";
      var { register } = require_registry();
      var { shoeBuild, footSpecFor, footShows } = require_shoe();
      function legTube(ctx, s, from, mat, o) {
        var _a;
        const { G, hh } = ctx;
        const lb = ctx.body.limb("leg", s, { from, to: 1, ease: (_a = o.ease) != null ? _a : 0.012, capStart: "flat", capEnd: "flat" });
        const id = `${o.id}-${s}`, out = [];
        const foot = shoeBuild(ctx, s, footSpecFor(ctx));
        lb.pieces.forEach((pc, i) => {
          var _a2, _b;
          const last = i === lb.pieces.length - 1;
          const lines = [];
          if (ctx.lodAtLeast("mid") && last) {
            const a = lb.at(Math.max(from, lb.split)), b = lb.at(0.97);
            lines.push({ d: G.brush([G.add(a, [-0.02 * hh * ctx.R.sx(s), 0]), G.lerp(a, b, 0.5), G.add(b, [-0.01 * hh * ctx.R.sx(s), 0])], [2e-3 * hh, 0.02 * hh, 4e-3 * hh]), fill: "light", o: (_a2 = o.gloss) != null ? _a2 : 0.35 });
          }
          out.push({ id: `${id}-${pc.seg}`, z: ctx.Z.tights + (pc.seg === "lower" ? 0.01 : 0), d: pc.d, mat, pattern: o.pattern, opacity: o.opacity, spot: o.spot, lines, light: { form: (_b = o.form) != null ? _b : 0.9 } });
        });
        if (footShows(ctx)) out.push({ id: `${id}-foot`, z: ctx.Z.tights + 0.02, d: foot.footD, mat, pattern: o.pattern, opacity: o.opacity, spot: o.spot, light: { form: 0.8 } });
        return { out, lb, foot };
      }
      register({
        kind: "legwear",
        name: "tights",
        describe: "Full-length tights, opaque by default; sheer: true gives smoke-sheer nylons over the skin. Pattern-capable.",
        params: { color: "token (default cloth-black; sheer default cloth-ash)", sheer: "true for nylons", pattern: "textile name", gloss: "0..1 shin sheen" },
        example: { outfit: { bottom: { type: "mini-skirt", color: "cloth-charcoal" }, legs: { type: "tights", color: "cloth-mustard" } } },
        // a skirt, so the legs show
        draw(ctx, o) {
          var _a;
          const sheer = !!o.sheer;
          const mat = ctx.mat(o.color || (sheer ? "cloth-ash" : "cloth-black"), "knit");
          const out = [];
          for (const s of ["R", "L"]) out.push(...legTube(ctx, s, 0, mat, { id: "tights", opacity: sheer ? 0.62 : void 0, pattern: o.pattern, spot: o.spot, gloss: (_a = o.gloss) != null ? _a : sheer ? 0.5 : 0.3 }).out);
          return out;
        }
      });
      register({
        kind: "legwear",
        name: "knee-socks",
        describe: "Knee-high socks with a ribbed fold-over top, white by default (Mary Janes, plaid skirts).",
        params: { color: "token (default cloth-white)", pattern: "textile name", band: "token for a contrast top band" },
        example: { outfit: { bottom: { type: "mini-skirt", color: "cloth-navy" }, legs: { type: "knee-socks", color: "cloth-white" }, feet: { type: "mary-janes", color: "cloth-black" } } },
        // a skirt, so the socks show
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-white", "knit");
          const out = [];
          for (const s of ["R", "L"]) {
            const probe = ctx.body.limb("leg", s, {});
            const from = probe.split + 0.06;
            const { out: pcs, lb } = legTube(ctx, s, from, mat, { id: "kneesock", pattern: o.pattern, spot: o.spot, ease: 0.016, gloss: 0.3 });
            const first = pcs[0], a = lb.at(from), n = ctx.R.sx(s);
            const top = lb.at(from + 0.02), hw = lb.hw(from) + 0.02 * hh;
            first.lines = [
              ...first.lines || [],
              { d: G.poly([[a[0] - hw, a[1] - 5e-3 * hh], [a[0] + hw, a[1] - 5e-3 * hh], [top[0] + hw, top[1] + 0.07 * hh], [top[0] - hw, top[1] + 0.07 * hh]]), fill: o.band || "shade", o: o.band ? 1 : 0.55 },
              { d: G.brush([[a[0] - hw, a[1] + 0.075 * hh], [a[0] + hw, a[1] + 0.075 * hh]], 8e-3 * hh), fill: "deep", o: 0.45 }
            ];
            if (ctx.lodAtLeast("mid")) for (let i = -3; i <= 3; i++) first.lines.push({ d: G.brush([[a[0] + i / 3.4 * hw, a[1]], [a[0] + i / 3.4 * hw, a[1] + 0.07 * hh]], 5e-3 * hh), fill: "deep", o: 0.3 });
            out.push(...pcs);
          }
          return out;
        }
      });
      register({
        kind: "legwear",
        name: "ankle-socks",
        describe: "Short ankle socks with a turned cuff, white with an optional contrast stripe; show above low shoes.",
        params: { color: "token (default cloth-white)", stripe: "token for a cuff stripe" },
        example: { outfit: { bottom: { type: "mini-skirt", color: "cloth-rust" }, legs: { type: "ankle-socks", color: "cloth-white", stripe: "cloth-red" }, feet: { type: "loafers", color: "cloth-black" } } },
        // a skirt and low shoes, so the socks show
        draw(ctx, o) {
          const { G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-white", "knit");
          const out = [];
          for (const s of ["R", "L"]) {
            const { out: pcs, lb } = legTube(ctx, s, 0.925, mat, { id: "anklesock", pattern: o.pattern, spot: o.spot, ease: 0.02, gloss: 0 });
            const a = lb.at(0.925), hw = lb.hw(0.925) + 0.02 * hh;
            pcs[0].lines = [...pcs[0].lines || [], { d: G.brush([[a[0] - hw, a[1] + 0.04 * hh], [a[0] + hw, a[1] + 0.04 * hh]], 0.04 * hh), fill: "shade", o: 0.5 }];
            if (o.stripe) pcs[0].lines.push({ d: G.brush([[a[0] - hw, a[1] + 0.025 * hh], [a[0] + hw, a[1] + 0.025 * hh]], 0.014 * hh), fill: o.stripe });
            out.push(...pcs);
          }
          return out;
        }
      });
    }
  });

  // src/parts/makeup/_mk.js
  var require_mk = __commonJS({
    "src/parts/makeup/_mk.js"(exports, module) {
      "use strict";
      var REG = require_registry();
      var { hg, clamp, lerp } = require_hg();
      function eyeGeo(ctx, s) {
        const face = ctx.S.face || {};
        const p = REG.get("eyes", face.eyes) || REG.get("eyes", "almond");
        return p.shape(ctx, s, face);
      }
      function mouthMetrics(ctx) {
        try {
          const U = require_util();
          if (U.mouthBox) return U.mouthBox(ctx, {});
        } catch (e) {
        }
        const H = ctx.head, M = ctx.expr.mouth, mw = H.mouthW / 2 * (M.width || 1);
        return { mw, yTop: H.mouthY - 0.02, y: H.mouthY, yl: H.mouthY, yr: H.mouthY, yBot: H.mouthY + 0.035, open: M.open || 0 };
      }
      function lips(ctx, colour, o = {}) {
        var _a, _b, _c;
        const { C, skin, T } = ctx;
        const g = hg(ctx);
        const m = mouthMetrics(ctx);
        const gap = 35e-4;
        const oAmt = Math.max(0, Math.min(1.2, (_b = (_a = m.open) != null ? _a : ctx.expr.mouth.open) != null ? _b : 0));
        const inner = oAmt > 0.05 ? m.depth != null ? m.depth * 0.96 : 3e-3 + 0.045 * oAmt : 0;
        const botY = m.yBot - 0.03 + 0.034 * (1 - Math.min(1, oAmt * 2));
        const mw = m.mw * 1.02, yl = m.yl, yr = m.yr, y = m.y;
        const up = [[-mw, yl, true], [-mw * 0.5, m.yTop + 4e-3], [-0.012, m.yTop - 1e-3], [0, m.yTop + 4e-3], [0.012, m.yTop - 1e-3], [mw * 0.5, m.yTop + 4e-3], [mw, yr, true], [mw * 0.5, y - gap], [0, y - gap * 0.6], [-mw * 0.5, y - gap]];
        const lo = [[-mw * 0.92, yl + gap + inner * 0.15, true], [-mw * 0.4, y + gap * 1.2 + inner * 0.9], [0, y + gap + inner], [mw * 0.4, y + gap * 1.2 + inner * 0.9], [mw * 0.92, yr + gap + inner * 0.15, true], [mw * 0.55, botY - 2e-3], [0, botY + 4e-3 * (1 - Math.min(1, oAmt * 2))], [-mw * 0.55, botY - 2e-3]];
        const upD = g.smoothD(up, true, 0.4), loD = g.smoothD(lo, true, 0.45);
        const v2 = ctx.lod !== "hi";
        const upC = C.mix(colour, skin.deep, v2 ? 0.62 : 0.3), loC = C.mix(colour, T.PAPER, ((_c = o.gloss) != null ? _c : 0.06) + (v2 ? 0.26 : 0));
        const over = [{ d: upD, fill: upC }, { d: loD, fill: loC }];
        if (ctx.lod === "hi") over.push({ d: g.brushD([[-mw * 0.35, y + inner + gap * 2 + 8e-3], [0, y + inner + gap * 2 + 0.011], [mw * 0.3, y + inner + gap * 2 + 8e-3]], [2e-3, 6e-3, 2e-3]), fill: C.mix(colour, T.PAPER, 0.5), o: 0.55 });
        return { id: "makeup-lips", z: ctx.Z.face + 0.15, over };
      }
      function liner(ctx, s, o = {}) {
        var _a, _b;
        const { C, skin, T } = ctx;
        const g = hg(ctx);
        const e = eyeGeo(ctx, s);
        const ink = T.INK;
        const lod = ctx.lod, k = (_a = o.k) != null ? _a : 1;
        const lw = g.atLeast(0.034 * k, lod === "lo" ? 3 : lod === "mid" ? 2.3 : 1.7);
        const wing = (_b = o.wing) != null ? _b : 0.056, up = Math.max(0, e.tilt) * 6e-3;
        const pts = [...e.TU.map((t) => [e.X(t), e.yU(t) - lw * 0.38]), [e.xo + s * wing, e.yU(1) - lw * 0.38 - 6e-3 - wing * (0.5 + up * 6)]];
        const prof = [0.4, 0.8, 1.05, 1.15, 1.15, 1.05, 0.9, 0.7, 0.1];
        const over = [];
        const h = e.h, cy = e.cy;
        if (o.lid) {
          const cr = [[e.X(0.04), cy - h * 1.5], [e.X(0.35), cy - h * 2.1], [e.X(0.75), cy - h * 1.95], [e.xo + s * 0.02, cy - h * 1.15]];
          const back = e.TU.slice().reverse().map((t) => [e.X(t), e.yU(t) - lw * 0.5]);
          over.push({ d: g.smoothD([...cr, ...back], true, 0.45), fill: C.mix(skin.light, T.tok(o.lid), 0.5), o: 0.8 });
        }
        if (o.crease) {
          const cr = [[e.X(0.04), cy - h * 1.5], [e.X(0.35), cy - h * 2.1], [e.X(0.75), cy - h * 1.95], [e.xo + s * 0.02, cy - h * 1.15]];
          over.push({ d: g.brushD(cr, [0.1, 0.4, 0.38, 0.1].map((x) => x * lw)), fill: ink, o: 0.92 });
        }
        over.push({ d: g.brushD(pts, prof.map((x) => x * lw)), fill: ink });
        if (o.lower !== false) over.push({ d: g.brushD([[e.X(0.14), e.yL(0.14) + 3e-3], [e.X(0.42), e.yL(0.42) + 4e-3], [e.X(0.78), e.yL(0.78) + 3e-3], [e.xo + s * 0.016, e.yL(1)]], [0.22, 0.4, 0.45, 0.15].map((x) => x * lw)), fill: ink, o: 0.9 });
        if (o.lashes && lod !== "lo") {
          const n = lod === "hi" ? 7 : 4;
          for (let i = 0; i < n; i++) {
            const t = 0.3 + 0.7 * i / (n - 1), a = 1.35 - 0.95 * (i / (n - 1)), L = (0.024 + 8e-3 * (i / (n - 1))) * (o.lashK || 1);
            const bx = e.X(t), by = e.yU(t) - lw * 0.6;
            over.push({ d: g.brushD([[bx, by], [bx + s * Math.cos(a) * L * 0.5, by - Math.sin(a) * L * 0.55 - 1e-3], [bx + s * Math.cos(a) * L, by - Math.sin(a) * L]], [lw * 0.22, lw * 0.18, 1e-3]), fill: ink });
          }
          if (lod === "hi") for (let i = 0; i < 4; i++) {
            const t = 0.3 + 0.5 * (i / 3), bx = e.X(t), by = e.yL(t) + 4e-3;
            over.push({ d: g.brushD([[bx, by], [bx + s * 3e-3, by + 0.012], [bx + s * 7e-3, by + 0.022]], [lw * 0.14, lw * 0.1, 1e-3]), fill: ink, o: 0.85 });
          }
        }
        return { id: `makeup-liner-${s < 0 ? "R" : "L"}`, z: ctx.Z.face + 0.3, over };
      }
      module.exports = { eyeGeo, mouthMetrics, lips, liner };
    }
  });

  // src/parts/makeup/looks.js
  var require_looks = __commonJS({
    "src/parts/makeup/looks.js"() {
      "use strict";
      var { register } = require_registry();
      var { lips, liner } = require_mk();
      var PARAMS = { lips: "lip colour token", lid: "colour token for the lid shadow" };
      var asObj = (o) => o && typeof o === "object" ? o : {};
      register({
        kind: "makeup",
        name: "mod",
        describe: "Heavy 60s mod eyes: thick black liner with a long wing, a drawn crease over a pale lid, lashes, and pale lips (the Swinger).",
        params: { ...PARAMS, lips: "lip colour token; default a pale, near-white pink" },
        example: { face: { makeup: { type: "mod" }, expression: "cool" } },
        draw(ctx, opts) {
          opts = asObj(opts);
          const { C, skin, T } = ctx;
          const out = [];
          for (const s of [-1, 1]) out.push(liner(ctx, s, { k: 1.15, wing: 0.06, crease: true, lashes: true, lid: opts.lid || "paper-000" }));
          const lipC = T.tok(opts.lips) || C.mix(C.mix(skin.light, T.PAPER, 0.55), skin.blush, 0.1);
          out.push(lips(ctx, lipC, { gloss: 0.1 }));
          return out;
        }
      });
      register({
        kind: "makeup",
        name: "classic",
        describe: "Classic winged liner, lashes and lipstick (default red): the elegant 60s face.",
        params: { ...PARAMS, lips: "lip colour token; default cloth-red" },
        example: { face: { makeup: { type: "classic", lips: "cloth-red" } } },
        draw(ctx, opts) {
          opts = asObj(opts);
          const { T } = ctx;
          const out = [];
          for (const s of [-1, 1]) out.push(liner(ctx, s, { k: 0.7, wing: 0.04, lashes: true, lower: false, lid: opts.lid }));
          out.push(lips(ctx, T.tok(opts.lips) || T.tok("cloth-red"), { gloss: 0.1 }));
          return out;
        }
      });
    }
  });

  // src/parts/marks/_marks.js
  var require_marks = __commonJS({
    "src/parts/marks/_marks.js"(exports, module) {
      "use strict";
      var U = require_util();
      function scarPath(ctx, at) {
        const H = ctx.head, ex = H.eyeX;
        const side = (at || "").endsWith("-L") ? 1 : -1;
        switch (at) {
          case "across":
            return [[-0.24, -0.215], [-0.19, -0.1], [-0.135, 0.01], [-0.08, 0.12], [-0.035, 0.235]];
          case "lip":
            return [[0.05, H.mouthY - 0.07], [0.056, H.mouthY - 0.02], [0.05, H.mouthY + 0.03], [0.044, H.mouthY + 0.075]];
          case "nose":
            return [[-0.045, 0], [0, 0.07], [0.05, 0.145]];
          case "brow-L":
          case "brow-R":
            return [[side * (ex + 0.06), H.brow - 0.075], [side * (ex + 0.02), H.brow - 5e-3], [side * (ex - 5e-3), H.brow + 0.055]];
          case "cheek-L":
          case "cheek-R":
          default:
            return [[side * 0.27, 0.075], [side * 0.215, 0.14], [side * 0.15, 0.205], [side * 0.12, 0.235]];
        }
      }
      function spot(ctx, at, dflt) {
        const H = ctx.head;
        const m = { "cheek-L": [0.2, 0.15], "cheek-R": [-0.2, 0.15], lip: [0.06, H.mouthY - 0.045], chin: [0, 0.43], nose: [0, 0.07], "brow-L": [H.eyeX, H.brow - 0.04], "brow-R": [-H.eyeX, H.brow - 0.04], forehead: [0.1, -0.2], temple: [0.27, -0.1] };
        return keepInside(ctx, m[at] || dflt || m["cheek-L"], 0.012);
      }
      function keepInside(ctx, p, r = 0.012) {
        const e = U.edgeAt(U.outlinePoly(ctx), p[1]);
        if (!e) return p;
        const m = r + 0.045;
        return [Math.max(e.l + m, Math.min(e.r - m, p[0])), p[1]];
      }
      function keepOnScreen(ctx, c, r = 0.012) {
        const e = U.edgeAt(U.outlinePoly(ctx).map((q) => ctx.hp(q)), c[1]);
        if (!e) return c;
        const m = (r + 0.045) * ctx.R.head.k;
        return [Math.max(e.l + m, Math.min(e.r - m, c[0])), c[1]];
      }
      function frame(pts, t) {
        const n = pts.length - 1, f = Math.min(n - 1e-6, t * n), i = Math.floor(f), u = f - i;
        const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return { p: [a[0] + dx * u, a[1] + dy * u], t: [dx / l, dy / l], n: [-dy / l, dx / l] };
      }
      module.exports = { scarPath, spot, keepInside, keepOnScreen, frame, U };
    }
  });

  // src/parts/marks/plaster.js
  var require_plaster = __commonJS({
    "src/parts/marks/plaster.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_marks();
      register({
        kind: "mark",
        name: "plaster",
        params: { at: "nose|cheek-L|cheek-R|brow-L|brow-R", color: "cloth token (default cream)", cross: "true: a second strip makes a cross" },
        example: { face: { marks: [{ type: "plaster", at: "nose" }] } },
        describe: "Sticking plaster: a cream strip with a pad and holes, slapped across the nose bridge or a cheek or brow.",
        draw(ctx, opts) {
          const { G, C, skin } = ctx;
          const U = M.U;
          const at = opts.at || "nose";
          const nose = at === "nose";
          const c = M.spot(ctx, at, [0, 0.07]);
          const ang = nose ? -0.5 : (at.endsWith("R") ? 0.5 : -0.5) + 0.2, len = nose ? 0.2 : 0.14, wid = nose ? 0.075 : 0.058;
          const R = (x, y) => {
            const ca = Math.cos(ang), sa = Math.sin(ang);
            return [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca];
          };
          const strip = (a) => {
            const l = len / 2, w = wid / 2, r = w * 0.55;
            const Rr = (x, y) => {
              const ca = Math.cos(a), sa = Math.sin(a);
              return [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca];
            };
            return G.smooth([[...Rr(-l, -w + r), true], [...Rr(-l + r, -w), true], [...Rr(l - r, -w), true], [...Rr(l, -w + r), true], [...Rr(l, w - r), true], [...Rr(l - r, w), true], [...Rr(-l + r, w), true], [...Rr(-l, w - r), true]], true, 0);
          };
          const depth = nose ? (p) => 0.03 + 0.04 * U.clamp((p[1] - 0) / 0.2, 0, 1) : 0.02;
          const tok = ctx.T.tok(opts.color) || ctx.tok("cloth-cream");
          const mat = ctx.mat(opts.color || "cloth-cream", "cloth");
          const pieces = [];
          const hs = (d) => U.hsD(ctx, d, depth);
          const pad = G.smooth([[...R(-len * 0.17, -wid * 0.3)], [...R(len * 0.17, -wid * 0.3)], [...R(len * 0.17, wid * 0.3)], [...R(-len * 0.17, wid * 0.3)]], true, 0.12);
          const lines = [{ d: hs(pad), fill: C.mix(tok, skin.deep, 0.22), o: 0.9 }];
          if (ctx.lod === "hi") for (const [dx, dy] of [[-0.3, -0.25], [0.3, 0.25], [-0.62, 0.25], [0.62, -0.25]]) lines.push({ d: hs(G.ellipse(...R(dx * len * 0.8, dy * wid), 35e-4, 35e-4)), fill: C.mix(tok, skin.deep, 0.4), o: 0.8 });
          pieces.push({ id: "mark-plaster", z: ctx.Z.face + 0.7, d: hs(strip(ang)), mat, lines, light: { form: 0.7 } });
          if (opts.cross) pieces.push({ id: "mark-plaster-2", z: ctx.Z.face + 0.71, d: hs(strip(ang + Math.PI / 2)), mat, light: { form: 0.7 } });
          return pieces;
        }
      });
    }
  });

  // src/parts/marks/scar.js
  var require_scar = __commonJS({
    "src/parts/marks/scar.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_marks();
      register({
        kind: "mark",
        name: "scar",
        params: { at: "brow-R|brow-L|cheek-R|cheek-L|lip|nose|across", stitches: "true|false (default true for across)", size: "0.8\u20131.4" },
        example: { face: { marks: [{ type: "scar", at: "across" }] } },
        describe: "Scar: a pale raised line with a shadow edge and stitch ticks. `at` places it (brow, cheek, lip, nose) or runs it diagonally across the whole face.",
        draw(ctx, opts) {
          var _a;
          const { G, C, skin } = ctx;
          const U = M.U;
          const at = opts.at || "cheek-R", k = opts.size || 1;
          const pts = M.scarPath(ctx, at);
          const b = U.bold(ctx), px = (n) => U.hpx(ctx, n);
          const v2 = ctx.lod === "mid";
          const w = Math.max(0.011 * k * (at === "across" ? 1.15 : 1), px(ctx.lod === "lo" ? 2.2 : 1.9)) * (v2 ? 1.45 : 1);
          const hs = (d) => U.hsD(ctx, d, 0.02);
          const pale = C.mix(skin.light, ctx.tok("paper-000"), 0.62);
          const over = [];
          over.push({ d: hs(G.brush(pts.map((p) => [p[0] + 6e-3 * (v2 ? 1.6 : 1), p[1] + 4e-3 * (v2 ? 1.6 : 1)]), [1e-3, w * 0.8, w * 0.9, w * 0.8, 1e-3])), fill: skin.deep, o: v2 ? 0.85 : 0.55 });
          over.push({ d: hs(G.brush(pts, [w * 0.25, w, w * 1.1, w, w * 0.25])), fill: pale, o: 0.96 });
          const stitches = (_a = opts.stitches) != null ? _a : at === "across";
          if (stitches) {
            const lo = ctx.lod === "lo", mid = ctx.lod === "mid";
            const n = at === "across" ? lo ? 4 : 5 : lo ? 3 : 4;
            const tl = Math.max(0.032 * k, px(lo ? 7 : mid ? 6 : 5)) / 2, tw = Math.max(4e-3 * b, px(lo ? 1.5 : mid ? 1.2 : 0.8));
            for (let i = 0; i < n; i++) {
              const f = M.frame(pts, (i + 0.7) / (n + 0.4));
              const a = [f.p[0] - f.n[0] * tl, f.p[1] - f.n[1] * tl], c = [f.p[0] + f.n[0] * tl, f.p[1] + f.n[1] * tl];
              over.push({ d: hs(G.brush([a, c], [tw, tw])), fill: pale, o: 0.95 });
            }
          }
          if (ctx.head.outline) return [{ id: "mark-scar", z: ctx.Z.face + 0.6, d: ctx.hs(ctx.head.outline), mat: skin, fill: "transparent", light: false, lines: over }];
          return [{ id: "mark-scar", z: ctx.Z.face + 0.6, over }];
        }
      });
    }
  });

  // src/parts/marks/spots.js
  var require_spots = __commonJS({
    "src/parts/marks/spots.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_marks();
      var SPOTS = [[0.19, 0.12, 1], [0.255, 0.2, 0.8], [-0.22, 0.19, 0.9], [0.12, -0.19, 0.9], [-0.1, 0.4, 0.7], [0.075, 0.37, 0.8], [-0.19, 0.06, 0.7], [0.28, 0.09, 0.6]];
      register({
        kind: "mark",
        name: "spots",
        params: { count: "2\u20138 (default 6)" },
        example: { face: { marks: [{ type: "spots" }] } },
        describe: "A few subtle red blemishes on the cheeks, forehead and chin, some with a pale head (Alfie).",
        draw(ctx, opts) {
          const { G, C, skin } = ctx;
          const U = M.U;
          const n = Math.min(SPOTS.length, opts.count || 3);
          const over = [];
          const red = C.mix(skin.shade, skin.blush, 0.3);
          for (let i = 0; i < n; i++) {
            const [x, y, sz] = SPOTS[i];
            const jx = (ctx.rng() - 0.5) * 0.02, jy = (ctx.rng() - 0.5) * 0.02;
            const r = Math.max(0.016 * sz, U.hpx(ctx, ctx.lod === "lo" ? 1.8 : 1.3));
            const c = M.keepOnScreen(ctx, ctx.hp(M.keepInside(ctx, [x + jx, y + jy], r), { depth: 0.02 }), r);
            const k = ctx.R.head.k;
            over.push({ d: G.ellipse(c[0], c[1], r * k * 0.8, r * k * 0.8), fill: red, o: 0.6 });
          }
          return [{ id: "mark-spots", z: ctx.Z.face + 0.5, over }];
        }
      });
      register({
        kind: "mark",
        name: "freckles",
        params: { count: "10\u201330" },
        example: { face: { marks: [{ type: "freckles" }] } },
        describe: "Freckles dusted over the nose bridge and cheeks.",
        draw(ctx, opts) {
          const { G, C, skin } = ctx;
          const U = M.U;
          const k = ctx.R.head.k;
          const n = opts.count || 22;
          const over = [];
          const col = C.mix(skin.line, skin.blush, 0.4);
          for (let i = 0; i < n; i++) {
            const s = ctx.rng() < 0.5 ? -1 : 1, x = s * (0.03 + ctx.rng() * 0.2), y = 0.045 + ctx.rng() * 0.12 + Math.abs(x) * 0.1;
            const r = Math.max(45e-4 + ctx.rng() * 35e-4, U.hpx(ctx, 0.8));
            const c = ctx.hp([x, y], { depth: 0.02 });
            over.push({ d: G.ellipse(c[0], c[1], r * k, r * k * 0.9), fill: col, o: 0.7 });
          }
          return [{ id: "mark-freckles", z: ctx.Z.face + 0.5, over }];
        }
      });
      register({
        kind: "mark",
        name: "mole",
        params: { at: "cheek-L|cheek-R|lip|chin|forehead|temple" },
        example: { face: { marks: [{ type: "mole", at: "cheek-L" }] } },
        describe: "A single beauty mark: a small dark dot.",
        draw(ctx, opts) {
          const { G, C, skin } = ctx;
          const U = M.U;
          const k = ctx.R.head.k;
          const p = M.spot(ctx, opts.at || "lip", [0.2, 0.15]);
          const r = Math.max(95e-4 * (opts.size || 1), U.hpx(ctx, 1.4));
          const c = M.keepOnScreen(ctx, ctx.hp(p, { depth: 0.02 }), r);
          return [{ id: "mark-mole", z: ctx.Z.face + 0.5, over: [{ d: G.ellipse(c[0], c[1], r * k, r * k), fill: C.mix(skin.deep, ctx.T.INK, 0.45) }] }];
        }
      });
    }
  });

  // src/parts/masks/balaclava.js
  var require_balaclava = __commonJS({
    "src/parts/masks/balaclava.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var M = require_mask();
      var TALL = { bun: 0.17, beehive: 0.27, pompadour: 0.09, flip: 0.04 };
      var HOOD_COVERS = ["hair", "ears", "brows", "nose", "facialHair", "makeup", "mark", "age"];
      function holesFor(ctx, o, outline) {
        const H = ctx.head, ex = H.eyeX, ey = H.eyeY, out = [], edges = [], rims = [];
        const lod = ctx.lod, k = lod === "lo" ? 1.18 : lod === "mid" ? 1.08 : 1;
        const m = Math.max(ctx.px(2), 0.012 * ctx.R.head.k), fit = (pts) => M.fitInside(ctx, pts, outline, m);
        if (o.eyes === "two") {
          for (const s of [-1, 1]) {
            const hw = 0.1 * k, hh = 0.072 * k, cx = s * (ex + 2e-3), cy = ey + 4e-3;
            const ring = fit(M.superellipse(cx, cy, hw, hh, { n: 2.7, N: 26 }));
            out.push(ring);
            edges.push(topEdgeOf(ring, hh));
            rims.push(ring);
          }
        } else {
          const hw = (ex + 0.118) * (lod === "lo" ? 1.04 : 1), hh = 0.07 * k, cy = ey + 3e-3;
          const ring = fit(M.superellipse(0, cy, hw, hh, { n: 3.3, N: 36 }));
          out.push(ring);
          edges.push(topEdgeOf(ring, hh));
          rims.push(ring);
        }
        if (o.mouth) {
          const mb = M.U.mouthBox(ctx, ctx.S.face);
          const cy = (mb.yTop + mb.yBot) / 2 + 4e-3, hh = Math.max(0.05, (mb.yBot - mb.yTop) / 2 + 0.032 * k);
          const ring = fit(M.superellipse(0, cy, mb.mw + 0.05 * k, hh, { n: 2.5, N: 26 }));
          out.push(ring);
          edges.push(topEdgeOf(ring, hh));
          rims.push(ring);
        }
        return { holes: out, edges, rims };
      }
      function topEdgeOf(ring, hh) {
        const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const up = ring.filter((p) => p[1] < cy + hh * 0.05).sort((a, b) => a[0] - b[0]);
        const out = [];
        for (let i = 0; i < up.length; i += 2) out.push(up[i]);
        return out.length >= 3 ? out : up;
      }
      function bib(ctx, knit, o) {
        const { R, G } = ctx, y = R.y, hh = R.hh;
        const c0 = R.head.cx, c1 = R.centerAt(y.neckBase);
        const wt = R.w.neck * 1.16, wb = R.w.neckBase * 1.2, yb = y.neckBase + 0.085 * hh;
        const pts = [
          [c0 - wt, y.neckTop],
          [c0 - wt * 1.02, y.chin + 0.02 * hh],
          [c1 - wb, y.neckBase - 0.04 * hh],
          [c1 - wb * 1.34, y.neckBase + 0.035 * hh],
          [c1 - wb * 0.7, yb + 0.01 * hh],
          [c1, yb + 0.03 * hh],
          [c1 + wb * 0.7, yb + 0.01 * hh],
          [c1 + wb * 1.34, y.neckBase + 0.035 * hh],
          [c1 + wb, y.neckBase - 0.04 * hh],
          [c0 + wt * 1.02, y.chin + 0.02 * hh],
          [c0 + wt, y.neckTop]
        ];
        const d = G.smooth(pts, true, 0.4);
        const out = { id: "mask-balaclava-bib", z: ctx.Z.outer - 1, d, mat: knit, light: { form: 0.85 } };
        const sh = [{ d: ctx.hs(G.smooth([[-0.3, 0.42], [-0.12, 0.5], [0.12, 0.52], [0.3, 0.42], [0.26, 0.6], [0, 0.68], [-0.26, 0.6]], true, 0.5)), o: 0.55, fill: "deep" }];
        out.shade = ctx.lodAtLeast("mid") ? sh : [];
        if (ctx.lodAtLeast("hi")) {
          const lines = [];
          for (let i = -5; i <= 5; i++) {
            const xt = c0 + i * wt * 0.3, xb = c1 + i * wb * 0.34;
            lines.push({ d: G.brush([[xt, y.chin], [(xt + xb) / 2, (y.chin + y.neckBase) / 2], [xb, yb]], [hh * 2e-3, hh * 0.011, hh * 2e-3]), fill: "shade", o: 0.45 });
          }
          out.lines = lines;
        }
        return out;
      }
      function rolled(ctx, o, knit) {
        const { G } = ctx, sk = M.skull(ctx), cw = (sk.H.skullW || sk.H.w) + 0.03;
        const sm = (pts, t = 0.45) => ctx.hs(G.smooth(pts, true, t));
        const sym = (L) => M.sym(L);
        const lean = 0.05;
        const slouch = ([x, y, s]) => {
          const t = M.clamp((-0.3 - y) / 0.33, 0, 1);
          return [x * (x > 0 ? 1 + 0.05 * t : 1 - 0.01 * t) + lean * t * t, y - 0.025 * t * t, s];
        };
        const ex = TALL[ctx.S.hair && ctx.S.hair.style || ""] || 0;
        const dome = sym([[0, -0.625 - ex], [-cw * 0.6, -0.61 - ex], [-cw * (1.03 + ex * 0.25), -0.5 - ex * 0.7], [-cw * (1.1 + ex * 0.2), -0.36], [-cw * (1.1 + ex * 0.15), -0.27, true], [-cw * 0.55, -0.235], [0, -0.23]]).map(slouch);
        const roll = sym([[0, -0.3], [-cw * 0.6, -0.3], [-cw * 1.12, -0.31, true], [-cw * 1.15, -0.1, true], [-cw * 0.62, -0.14], [0, -0.155]]);
        const mid = ctx.lodAtLeast("mid"), hi = ctx.lodAtLeast("hi");
        const domeLines = [];
        if (mid) for (let i = -6; i <= 6; i++) {
          const x = i * cw * 0.16;
          domeLines.push({ d: ctx.hs(G.brush([[x * 1 + lean * 0.4, -0.6], [x * 1.02 + lean * 0.3, -0.45], [x * 1, -0.32]], [3e-3, 0.012, 4e-3])), fill: "shade", o: 0.4 });
        }
        const rollLines = [];
        if (mid) for (const y of [-0.235, -0.17]) {
          rollLines.push({ d: ctx.hs(G.brush([[-cw * 1.08, y + 0.02], [-cw * 0.5, y + 0.035], [0, y + 0.04], [cw * 0.5, y + 0.035], [cw * 1.08, y + 0.02]], [4e-3, 0.016, 0.018, 0.016, 4e-3])), fill: "deep", o: 0.55 });
          if (hi) rollLines.push({ d: ctx.hs(G.brush([[-cw * 1, y - 6e-3], [-cw * 0.5, y + 8e-3], [0, y + 0.012]], [3e-3, 0.01, 6e-3])), fill: "light", o: 0.5 });
        }
        const pieces = [
          { id: "mask-balaclava-cap", z: ctx.Z.hat, d: sm(dome, 0.45), mat: knit, lines: domeLines, lit: [{ d: ctx.hs(G.brush([[-cw * 0.95, -0.4], [-cw * 0.7, -0.53], [-cw * 0.25, -0.59]], [4e-3, 0.05, 4e-3])), o: 0.45 }], light: { form: 1.15 } },
          { id: "mask-balaclava-roll", z: ctx.Z.hat + 0.1, d: sm(roll, 0.4), mat: knit, lines: rollLines, lit: [{ d: ctx.hs(G.brush([[-cw * 1.04, -0.285], [-cw * 0.5, -0.282], [0, -0.28]], [4e-3, 0.02, 6e-3])), o: 0.55 }], light: { form: 1 } }
        ];
        pieces.push(...M.shadowBand(ctx, "mask-balaclava-roll-shadow", [[-0.37, -0.1], [-0.2, -0.138], [0, -0.155], [0.2, -0.138], [0.37, -0.1]], 0.055, { shift: 0.02 }));
        return pieces;
      }
      register({
        kind: "mask",
        name: "balaclava",
        aliases: ["ski-mask"],
        describe: "Knit balaclava: a wool hood over the whole head and neck with a slit or two eye holes (a mouth hole on request). The bank robber, the unknown suspect. rolled: true turns it into a watch cap.",
        params: { eyes: '"slit" (one wide eye slot, default) | "two" (two holes)', mouth: "true cuts a mouth hole (the mouth part shows through)", color: "knit colour token (default cloth-charcoal)", rolled: "true rolls it up into a beanie on the crown; the face and hair are left alone" },
        example: { face: { mask: { type: "balaclava", color: "cloth-charcoal", eyes: "slit" } } },
        covers: (o) => o && o.rolled ? [] : o && o.mouth ? HOOD_COVERS : [...HOOD_COVERS, "mouth"],
        draw(ctx, o) {
          const { G } = ctx;
          const knit = ctx.mat(M.tokOr(ctx, o.color, "cloth-charcoal"), "knit");
          if (o.rolled) return rolled(ctx, o, knit);
          const sk = M.skull(ctx), lod = ctx.lod, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
          const kk = ctx.R.head.k, amt = (p, i) => (0.013 + 0.014 * M.clamp((-0.26 - sk.poly[i][1]) / 0.22, 0, 1)) * kk;
          const outerKit = M.thin(M.relax(M.grow(sk.kit, amt), 3), 2);
          const { holes, edges, rims } = holesFor(ctx, o, outerKit);
          const d = G.smooth(outerKit, true, 0.5);
          for (const h of holes) ctx.cut("^mask-balaclava$", M.path(ctx, h, 0.5, 0.012));
          const tone = M.tone(ctx, { mouth: o.mouth ? 0 : 1, cheek: 1, nose: 1 });
          const pale = ctx.C.mix(knit.base, ctx.tok("cloth-cream"), 0.2), dark = ctx.C.mix(knit.base, ctx.tok("ink-900"), 0.5);
          const lines = [];
          if (mid) lines.push(...M.knitRibs(ctx, { sp: hi ? 0.032 : 0.07, w: hi ? 0.0105 : 0.02, op: hi ? 0.5 : 0.3, y1: sk.H.chinY + 0.01 }));
          if (mid) for (const ring of rims) lines.push({ d: M.holeRim(ctx, ring, 0.013), fill: dark, o: 0.55 });
          const pieces = [{
            id: "mask-balaclava",
            z: ctx.Z.maskOver,
            d,
            mat: knit,
            shade: tone.shade,
            deep: tone.deep,
            lit: tone.lit.map((s) => ({ ...s, fill: pale })),
            lines,
            light: { form: 1.05, sheenO: 0.5 }
          }];
          if (mid) for (const [i, e] of edges.entries()) pieces.push(...M.shadowBand(ctx, `mask-balaclava-hole-shadow${i}`, e, 0.034, { shift: 0.01, hw: 1, o: 0.8, core: 0.5 }));
          pieces.push(bib(ctx, knit, o));
          return pieces;
        }
      });
      module.exports = { holesFor, bib };
    }
  });

  // src/parts/masks/bandana.js
  var require_bandana = __commonJS({
    "src/parts/masks/bandana.js"(exports, module) {
      "use strict";
      var REG = require_registry();
      var { register } = REG;
      var M = require_mask();
      function printOf(ctx, p, color2, base = 0.4) {
        if (!p) return null;
        const spec = typeof p === "string" ? { type: p } : { ...p };
        if (!REG.get("textile", spec.type)) {
          ctx.warn(`mask pattern "${spec.type}" is not a textile (available: ${REG.list("textile").map((x) => x.name).join(", ")})`);
          return null;
        }
        if (spec.scale == null) spec.scale = base;
        if (spec.color2 == null && color2 && ctx.T.tok(color2)) spec.color2 = color2;
        return spec;
      }
      register({
        kind: "mask",
        name: "bandana",
        aliases: ["kerchief", "outlaw"],
        describe: "Outlaw bandana: a cloth triangle tied behind the head, over the nose and mouth, its point hanging below the chin. Plain or printed (polka, check, stripes). The stick-up artist, the demonstrator, the dusty rider.",
        params: { color: "cloth token (default cloth-red)", pattern: "any textile name (polka, gingham, tartan, argyle, \u2026) or { type, color2, scale }", color2: "print colour token", size: "0.85\u20131.2: how far the point hangs" },
        example: { face: { mask: { type: "bandana", color: "cloth-red", pattern: "polka" } } },
        covers: ["nose", "mouth", "facialHair"],
        draw(ctx, o) {
          const { G } = ctx, H = ctx.head, k = ctx.R.head.k, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
          const sk = M.skull(ctx), wid = sk.wid;
          const cloth = ctx.mat(M.tokOr(ctx, o.color, "cloth-red"), "cloth");
          const sz = M.clamp(o.size || 1, 0.8, 1.25);
          const tip = H.chinY + 0.235 * sz;
          const K = (pts, d0) => M.K(ctx, pts, d0);
          const yTop = 0.125, yJaw = 0.43;
          const { L, R } = M.sides(ctx, sk, (y) => 6e-3 + 0.02 * M.clamp((y - yTop) / 0.3, 0, 1), yTop, yJaw);
          const sharp = (p) => [p[0], p[1], true];
          const edge = K([[-0.25, 0.108, false, 0.015], [-0.17, 0.086, false, 0.03], [-0.085, 0.066, false, 0.042], [0, 0.058, false, 0.052], [0.085, 0.066, false, 0.042], [0.17, 0.086, false, 0.03], [0.25, 0.108, false, 0.015]], 0.03);
          const jaw = sk.poly.reduce((m, q) => Math.abs(q[1] - yJaw) < Math.abs(m[1] - yJaw) ? q : m, sk.poly[0]);
          const xj = Math.abs(jaw[0]) + 0.02;
          const lowL = K([[-xj * 0.66, H.chinY + 0.03 * sz, false, 0.02], [-xj * 0.34, H.chinY + 0.12 * sz, false, 0.035], [-xj * 0.12, H.chinY + 0.195 * sz, false, 0.045]], 0.03);
          const lowR = K([[xj * 0.12, H.chinY + 0.195 * sz, false, 0.045], [xj * 0.34, H.chinY + 0.12 * sz, false, 0.035], [xj * 0.66, H.chinY + 0.03 * sz, false, 0.02]], 0.03);
          const tipP = K([[0, tip, true, 0.05]], 0.05);
          const ring = [sharp(L[0]), ...M.thin(L.slice(1, -1), 2), L[L.length - 1], ...lowL, ...tipP, ...lowR, R[0], ...M.thin(R.slice(1, -1), 2), sharp(R[R.length - 1]), ...edge.slice().reverse()];
          const d = G.smooth(ring, true, 0.45);
          const tone = M.tone(ctx, { nose: 1, cheek: 0.5, mouth: 0.7 });
          const shade = [...tone.shade], deep = [...tone.deep], lit = [...tone.lit];
          const B = (pts, ws, d0 = 0.04) => M.stroke(ctx, pts, ws, d0);
          const lines = [];
          if (mid) {
            deep.push({ d: M.path(ctx, [[-0.3, 0.44], [-0.1, 0.5], [0.1, 0.5], [0.3, 0.44], [0.2, 0.62], [0, 0.66], [-0.2, 0.62]], 0.5, 0.04), o: 0.5 });
            shade.push({ d: B([[0.06, 0.52], [0.09, H.chinY + 0.12], [0.02, tip - 0.02]], [4e-3, 0.03, 4e-3]), o: 0.55 });
            lit.push({ d: B([[-0.08, 0.53], [-0.1, H.chinY + 0.12], [-0.03, tip - 0.03]], [4e-3, 0.022, 4e-3]), o: 0.45 });
            lines.push({ d: B([[-0.25, 0.108], [-0.17, 0.086], [-0.085, 0.066], [0, 0.058], [0.085, 0.066], [0.17, 0.086], [0.25, 0.108]], [4e-3, 0.014, 0.018, 0.02, 0.018, 0.014, 4e-3]), fill: "light", o: 0.55 });
          }
          if (hi) {
            lines.push({ d: B([[-0.24, 0.13], [-0.16, 0.108], [-0.08, 0.09], [0, 0.083], [0.08, 0.09], [0.16, 0.108], [0.24, 0.13]], [4e-3, 0.01, 0.013, 0.014, 0.013, 0.01, 4e-3]), fill: "shade", o: 0.5 });
          }
          const pat = printOf(ctx, o.pattern, o.color2);
          const pieces = [{ id: "mask-bandana", z: ctx.Z.mask, d, mat: cloth, ...pat ? { pattern: pat } : {}, shade, deep, lit, lines, light: { form: 1, sheenO: 0.4 } }];
          return pieces;
        }
      });
      module.exports = { printOf };
    }
  });

  // src/parts/masks/blank.js
  var require_blank = __commonJS({
    "src/parts/masks/blank.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_mask();
      register({
        kind: "mask",
        name: "blank",
        aliases: ["white-mask", "plain-mask", "egg-mask"],
        describe: "Blank full-head mask, after the book's cover: a smooth cream egg over the whole head with two dark almond eye slits, a bare ridge of nose and the hint of a mouth. The man in the suit nobody can describe.",
        params: { color: "mask colour token (default cloth-cream)", slits: "eye slit colour token (default ink-900)", chips: "false: no chips in the glaze (default: a few at hi)" },
        example: { face: { mask: { type: "blank", color: "cloth-cream" } } },
        covers: ["hair", "ears", "brows", "eyes", "nose", "mouth", "facialHair", "makeup", "mark", "age", "eyewear"],
        draw(ctx, o) {
          var _a;
          const { G, C } = ctx, H = ctx.head, k = ctx.R.head.k, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
          const sk = M.skull(ctx);
          const col = M.tokOr(ctx, o.color, "cloth-cream");
          const mat = ctx.mat(col, "satin");
          const slit = ctx.tok(M.tokOr(ctx, o.slits, "ink-900"));
          const hatted = !!(ctx.S.hair && ctx.S.hair.hat && ctx.S.hair.hat.type);
          const amt = (p, i) => {
            const [x, y] = sk.poly[i];
            const crown = Math.pow(M.clamp((-0.2 - y) / 0.3, 0, 1), 1.15);
            const mid2 = 1 - Math.pow(Math.min(1, Math.abs(x) / Math.max(0.08, sk.wid(y))), 2.4);
            if (hatted) return 0.012 * k * M.clamp((y + 0.36) / 0.08, 0, 1);
            return (0.012 + 0.07 * crown * (0.45 + 0.55 * mid2)) * k;
          };
          const yE = 0.06, yB = ((_a = H.chinY) != null ? _a : 0.5) + 0.03;
          let wE = 0;
          for (let y = -0.1; y <= 0.2; y += 0.02) wE = Math.max(wE, sk.wid(y));
          const ellW = (y) => wE * Math.sqrt(Math.max(0, 1 - Math.pow((y - yE) / (yB - yE), 2)));
          const fill = (y) => {
            const t = M.clamp((y - 0.1) / 0.3, 0, 1);
            return t * t * (3 - 2 * t);
          };
          const outer0 = M.grow(sk.kit, amt).map((q, i) => {
            const [x, y] = sk.poly[i], e = fill(y) * Math.max(0, ellW(y) * 0.98 - sk.wid(y) - 0.012);
            if (e <= 0 || Math.abs(x) < 0.02) return q;
            const a = ctx.hp([x, y], { depth: 0 }), b = ctx.hp([x + Math.sign(x) * e, y], { depth: 0 });
            return [q[0] + b[0] - a[0], q[1] + b[1] - a[1]];
          });
          const outer = M.thin(M.relax(outer0, 9), 3);
          const d = G.smooth(outer, true, 0.5);
          const B = (pts, ws, d0 = 0.05) => M.stroke(ctx, pts, ws, d0);
          const ex = H.eyeX, ey = H.eyeY, ny = H.noseY, nty = H.noseTipY, my = H.mouthY;
          const shade = [], deep = [], lit = [], lines = [], over = [];
          if (mid) {
            lit.push({ d: B([[-0.012, -0.03], [-0.026, ny * 0.5], [-0.04, nty - 0.01]], [6e-3, 0.03, 0.036], 0.07), o: 0.7 });
            shade.push({ d: B([[0.024, -0.02], [0.05, ny * 0.5], [0.07, ny + 0.01]], [6e-3, 0.034, 0.05], 0.07), o: 0.75 });
            shade.push({ d: B([[0.05, ny - 0.03], [0.1, ny + 0], [0.17, ny + 0.06]], [0.01, 0.04, 0.012], 0.05), o: 0.45 });
            deep.push({ d: B([[0.03, ny - 0], [0.06, ny + 0.012], [0.02, ny + 0.03]], [0.01, 0.026, 6e-3], 0.07), o: 0.5 });
            for (const s of [-1, 1]) shade.push({ d: B([[s * (ex + 0.1), ey - 0.045], [s * (ex + 0.14), ey + 0.02], [s * (ex + 0.12), ey + 0.1]], [6e-3, 0.04, 6e-3], 0.04), o: s > 0 ? 0.5 : 0.22 });
            shade.push({ d: B([[-0.06, my + 0.03], [0, my + 0.045], [0.06, my + 0.03]], [4e-3, 0.02, 4e-3], 0.06), o: 0.45 });
            lit.push({ d: B([[-0.05, my - 0.012], [0, my - 0.02], [0.05, my - 0.012]], [4e-3, 0.014, 4e-3], 0.06), o: 0.5 });
          }
          if (mid) {
            const nw = H.noseW, tip = H.noseTipY, mw = H.mouthW;
            const E = (x, y, d1 = 0.05, sharp = false) => sharp ? [x, y, true, d1] : [x, y, false, d1];
            const edge = [
              E(0.25, -0.7, 0, true),
              E(0.16, -0.46, 0.02),
              E(0.1, -0.3, 0.04),
              E(0.082, -0.185, 0.06),
              // down the forehead to the brow ridge
              E(0.05, -0.08, 0.08),
              E(0.036, 0.02, 0.09),
              E(0.046, ny * 0.55, 0.09),
              E(nw * 0.95, ny - 0.035, 0.1),
              // the bridge, widening to the wing
              E(nw * 1.18, ny + 2e-3, 0.1),
              E(nw * 0.55, ny + 0.03, 0.08),
              E(0.026, my - 0.05, 0.06),
              // under the wing and back in under the nose
              E(mw * 0.55, my - 0.012, 0.05),
              E(mw * 0.5, my + 0.022, 0.05),
              E(0.03, my + 0.052, 0.05),
              // the lip line and the corner of the mouth
              E(0.066, 0.43, 0.04),
              E(0.15, 0.53, 0, true)
              // the chin
            ];
            const out2 = [E(0.95, 0.75, 0, true), E(0.95, -0.75, 0, true)];
            const shadeD = M.path(ctx, [...edge, ...out2], 0.4);
            deep.push({ d: shadeD, o: 0.75 });
          }
          const slitD = (s) => ctx.hs(G.ellipse(s * (ex + 2e-3), ey + 4e-3, 0.085 * (mid ? 1 : 1.2), 0.04 * (mid ? 1 : 1.3), s * -0.12), { depth: 0.07 });
          for (const s of [-1, 1]) over.push({ d: slitD(s), fill: slit, o: 0.96 });
          if (hi && o.chips !== false) {
            const chip = ctx.tok("paper-100");
            for (const [x, y, a, b, r] of [[-0.19, -0.34, 0.03, 0.012, -0.5], [-0.12, 0.02, 0.012, 8e-3, 0.2], [-0.2, 0.23, 0.02, 0.01, 0.4]]) over.push({ d: ctx.hs(G.ellipse(x, y, a, b, r), { depth: 0.04 }), fill: chip, o: 0.85 });
          }
          return [{ id: "mask-blank", z: ctx.Z.maskOver, d, mat, shade, deep, lit, lines, over, light: { form: mid ? 0.5 : 0.95, sheenO: 0.75 } }];
        }
      });
    }
  });

  // src/parts/masks/domino.js
  var require_domino = __commonJS({
    "src/parts/masks/domino.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_mask();
      register({
        kind: "mask",
        name: "domino",
        aliases: ["eye-mask", "masquerade"],
        describe: "Domino eye mask: a small glossy mask round the eyes with eye holes, a notch over the nose and flicked-up wings, tied with ribbons. The masked ball, the cat burglar, the anonymous tip-off.",
        params: { color: "mask colour token (default cloth-black)", ribbon: "ribbon colour token (default: the mask colour)", wings: "0\u20131.5: how far the temple wings flick up (default 1)" },
        example: { face: { mask: { type: "domino", color: "cloth-black" } } },
        covers: [],
        draw(ctx, o) {
          var _a;
          const { G, C } = ctx, H = ctx.head, k = ctx.R.head.k, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid");
          const sk = M.skull(ctx), wid = sk.wid;
          const col = M.tokOr(ctx, o.color, "cloth-black");
          const mat = ctx.mat(col, "cloth"), ribM = ctx.mat(M.tokOr(ctx, o.ribbon, col), "cloth");
          const wing = M.clamp((_a = o.wings) != null ? _a : 1, 0, 1.5);
          const ex = H.eyeX, ey = H.eyeY;
          const wt = Math.min(0.318, wid(-0.08) - 0.018);
          const d0 = 0.028;
          const lowW = Math.min(0.3, wid(0.05) - 0.012);
          const lo = !mid, sy = lo ? 1.4 : 1, lift = lo ? 0.06 : 0.034;
          const Y = (y) => ey + (y - ey) * sy;
          const L = [
            [0, Y(-0.1), false, 0.04],
            [-0.085, Y(-0.117), false, d0],
            [-0.17, Y(-0.13), false, d0],
            [-wt * 0.8, Y(-0.138) - 0.01 * wing, false, d0],
            [-wt, Y(-0.16) - lift * wing, true, 0.012],
            [-wt * 0.98, Y(-0.095), false, 0.01],
            [-lowW, Y(-0.02), false, 0.012],
            [-lowW * 0.93, Y(0.055), false, d0],
            [-0.2, Y(0.108), false, d0],
            [-0.125, Y(0.112), false, d0],
            [-0.07, Y(0.088), false, 0.04],
            [0, Y(0.074), false, 0.05]
          ];
          let outline = M.sym(L);
          const m = Math.max(ctx.px(1.5), 0.01 * k);
          outline = M.fitInside(ctx, outline, sk.kit, m, d0);
          const d = M.path(ctx, outline, 0.45);
          const lod = ctx.lod, kk = lod === "lo" ? 1.2 : lod === "mid" ? 1.1 : 1;
          const rims = [];
          for (const s of [-1, 1]) {
            let ring = M.superellipse(s * (ex + 2e-3), ey + 2e-3, 0.092 * kk, 0.056 * kk, { n: 2.5, N: 26, lift: 0.42, side: s });
            ring = M.fitInside(ctx, ring, sk.kit, m, 0.012);
            rims.push(ring);
            ctx.cut("^mask-domino$", M.path(ctx, ring, 0.5, 0.012));
          }
          const dark = C.mix(mat.base, ctx.tok("ink-900"), 0.55);
          const lines = [], lit = [];
          if (mid) for (const r of rims) lines.push({ d: M.holeRim(ctx, r, 0.012), fill: dark, o: 0.6 });
          const B = (pts, ws, d1 = 0.03) => M.stroke(ctx, pts, ws, d1);
          lit.push({ d: B([[-wt * 0.72, Y(-0.134) - 8e-3 * wing], [-0.17, Y(-0.122)], [-0.08, Y(-0.108)]], [3e-3, 9e-3, 3e-3]), o: 0.5 });
          if (lo) {
            const e = M.U.hpx(ctx, 1.7), pa = ctx.tok("paper-100"), yy = (y) => Y(y) + e * 0.5;
            const top = [[-wt * 0.9, yy(-0.14) - 0.012 * wing], [-0.17, yy(-0.13)], [-0.085, yy(-0.117)], [0, yy(-0.1)]];
            const full = [...top, ...top.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
            lit.push({ d: B(full, [e * 0.3, e, e * 1.15, e * 1.2, e * 1.15, e, e * 0.3]), o: 0.8, fill: pa });
          }
          const pieces = [{ id: "mask-domino", z: ctx.Z.mask, d, mat, lit, lines, light: { form: 0.9, sheenO: 0.28 } }];
          if (mid) for (const [i, r] of rims.entries()) {
            const top = r.filter((p) => p[1] < ey + 0.01).sort((a, b) => a[0] - b[0]);
            if (top.length > 3) pieces.push(...M.shadowBand(ctx, `mask-domino-hole-shadow${i}`, top.filter((_, j) => j % 2 === 0), 0.022, { shift: 8e-3, hw: 1, o: 0.7, core: 0.45 }));
          }
          const rw = Math.max(0.017, M.U.hpx(ctx, lod === "lo" ? 2.4 : 1.7));
          for (const s of [-1, 1]) {
            const tag = s < 0 ? "R" : "L";
            const ex2 = wid(-0.19) - 0.012;
            pieces.push({ id: `mask-domino-ribbon-${tag}`, z: ctx.Z.mask - 0.05, d: B(M.tuck(ctx, [[s * (wt - 0.02), -0.15 - 0.03 * wing], [s * Math.min(wt + 0.02, ex2 - 0.01), -0.172 - 0.03 * wing], [s * ex2, -0.19 - 0.03 * wing]], sk.kit, rw * k * 0.6 + ctx.px(1), 0), [rw, rw, rw * 0.9], 0), clip: "head", mat: ribM, light: false });
          }
          return pieces;
        }
      });
    }
  });

  // src/parts/masks/gas-mask.js
  var require_gas_mask = __commonJS({
    "src/parts/masks/gas-mask.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_mask();
      var YT = -0.1;
      register({
        kind: "mask",
        name: "gas-mask",
        aliases: ["respirator"],
        describe: "Rubber gas mask: a near-black face-piece, two big round eyepieces (clear them for a glow), a filter canister on the cheek and straps into the hair. The Militants' riot kit, the soldier, the gas attack.",
        params: {
          color: "rubber colour token (default cloth-black)",
          lenses: "eyepiece colour token (default glass-dark; cloth-mustard when glow is on)",
          glow: "true: emissive eyepieces with a soft stippled halo, kept in the spot colour in the dark schemes",
          filter: '"side" (a canister on the viewer-right cheek, the book) | "front" (a round filter at the mouth)',
          canister: "canister colour token (default metal-gun)",
          strap: "strap colour token (default leather-black)",
          side: '"L" puts the side canister on the viewer-left'
        },
        example: { face: { mask: { type: "gas-mask", color: "cloth-black", lenses: "cloth-mustard", glow: true } } },
        covers: ["nose", "mouth", "facialHair", "eyes", "brows", "eyewear", "makeup"],
        draw(ctx, o) {
          const { G, C } = ctx, H = ctx.head, k = ctx.R.head.k, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid"), lo = !mid;
          const sk = M.skull(ctx), wid = sk.wid;
          const rubber = ctx.mat(M.tokOr(ctx, o.color, "cloth-black"), "cloth");
          const strapM = ctx.mat(M.tokOr(ctx, o.strap, "leather-black"), "leather");
          const metal = ctx.mat(M.tokOr(ctx, o.canister, "metal-gun"), "metal");
          const glow = !!o.glow;
          const duo = !!(ctx.scheme && ctx.scheme.map && !ctx.scheme.spotKeep);
          const lensTok = M.tokOr(ctx, o.lenses, glow ? "cloth-mustard" : "glass-dark");
          const pale = C.mix(rubber.base, ctx.tok("cloth-cream"), 0.22), pale2 = C.mix(rubber.base, ctx.tok("cloth-cream"), 0.4), dark = C.mix(rubber.base, ctx.tok("ink-900"), 0.55);
          const out = [];
          const wt = wid(YT) - 0.012;
          const top = [[-wt, YT - 0.02], [-wt * 0.8, YT - 0.05], [-wt * 0.45, YT - 0.066], [0, YT - 0.07], [wt * 0.45, YT - 0.066], [wt * 0.8, YT - 0.05], [wt, YT - 0.02]];
          const amt = (y) => -0.012 + 0.05 * M.clamp((y - 0.34) / 0.17, 0, 1);
          const shellPts = M.shell(ctx, sk, amt, YT, top);
          const face = G.smooth(shellPts, true, 0.5);
          const S = (pts, t = 0.5, d = 0.03) => G.smooth(M.K(ctx, pts, d), true, t);
          const B = (pts, ws, d = 0.03) => M.stroke(ctx, pts, ws, d);
          const ex = H.eyeX, ey = H.eyeY, my = H.mouthY;
          const shade = [], deep = [], lit = [], lines = [];
          if (mid) {
            shade.push({ d: B([[0.03, -0.06], [0.05, 0.05], [0.07, 0.2]], [0.01, 0.05, 0.03]), o: 0.7 });
            lit.push({ d: B([[-0.01, -0.12], [-0.02, 0], [-0.035, 0.16]], [6e-3, 0.03, 0.02]), o: 0.55, fill: pale });
            lit.push({ d: B([[-0.3, 0.12], [-0.25, 0.2], [-0.2, 0.3]], [6e-3, 0.06, 8e-3]), o: 0.5, fill: pale });
            shade.push({ d: B([[ex * 0.5 - 0.02, 0.14], [0.075, 0.24], [0.1, 0.34]], [5e-3, 0.02, 6e-3]), o: 0.55 });
            shade.push({ d: B([[-ex * 0.5 + 0.02, 0.14], [-0.075, 0.24], [-0.1, 0.34]], [5e-3, 0.016, 6e-3]), o: 0.4 });
            deep.push({ d: B([[-0.2, 0.47], [0, 0.52], [0.2, 0.47]], [0.01, 0.05, 0.01]), o: 0.5 });
          }
          if (hi) {
            lit.push({ d: B([[-wt * 0.85, YT - 0.045], [-wt * 0.4, YT - 0.066], [0, YT - 0.072]], [4e-3, 0.014, 0.012]), o: 0.55, fill: pale2 });
          }
          out.push({ id: "mask-gas", z: ctx.Z.mask, d: face, mat: rubber, shade, deep, lit, lines, light: { form: 1.05, sheenO: 0.5 } });
          const strapW = Math.max(0.05, M.U.hpx(ctx, lo ? 3 : 2));
          const zS = ctx.Z.mask - 0.3;
          const tk = (pts) => M.tuck(ctx, pts, sk.kit, strapW * k * 0.6 + ctx.px(1), 0);
          out.push({ id: "mask-gas-strap-top", z: zS, d: B(tk([[0, YT - 0.06], [0, -0.3], [0, -0.47]]), [strapW, strapW, strapW * 0.9], 0), clip: "head", mat: strapM, light: { form: 0.5 } });
          for (const s of [-1, 1]) {
            const tag = s < 0 ? "R" : "L";
            out.push({ id: `mask-gas-strap-temple-${tag}`, z: zS, d: B(tk([[s * wt * 0.82, YT - 0.03], [s * (wid(YT - 0.05) - 0.035), YT - 0.052], [s * (wid(YT - 0.08) - 0.012), YT - 0.07]]), [strapW, strapW, strapW * 0.9], 0), clip: "head", mat: strapM, light: { form: 0.5 } });
            out.push({ id: `mask-gas-strap-jaw-${tag}`, z: zS, d: B(tk([[s * (wid(0.31) - 0.045), 0.315], [s * (wid(0.28) - 0.012), 0.275]]), [strapW, strapW * 0.9], 0), clip: "head", mat: strapM, light: { form: 0.5 } });
          }
          const lx = ex + 4e-3, ly = ey - 0.012, rx = 0.091, ry = 0.118, rim = 0.016;
          const ell = (P, u, v, a, b, rot = 0) => M.mapD(G.ellipse(u, v, a, b, rot), P);
          const lensM = ctx.mat(lensTok, "flat");
          const lensHex = ctx.tok(lensTok);
          const rimM = ctx.mat(M.tokOr(ctx, o.rim, "metal-steel"), "metal");
          for (const s of [-1, 1]) {
            const tag = s < 0 ? "R" : "L";
            const P = M.plate(ctx, s * lx, ly, 0.045, { w: rx + rim + 0.01, outline: sk.kit });
            const spot = glow ? { spot: true } : {};
            if (glow) {
              out.push({ id: `mask-gas-haze-${tag}`, z: ctx.Z.mask + 0.04, d: ell(P, 0, 0, rx * 1.38, ry * 1.34), fill: lensHex, opacity: 0.07, light: false, ...spot });
              if (mid) out.push({
                id: `mask-gas-halo-${tag}`,
                z: ctx.Z.mask + 0.05,
                d: ell(P, 0, 0, rx * 1.62, ry * 1.55),
                fill: "none",
                mat: ctx.mat("cloth-black", "flat"),
                light: false,
                ...spot,
                lines: [[1.62, 0.1], [1.4, 0.2], [1.22, 0.34]].map(([f, op]) => ({ d: ell(P, 0, 0, rx * f, ry * f * 0.96), fill: lensHex, stip: true, o: op }))
              });
            }
            out.push({ id: `mask-gas-rim-${tag}`, z: ctx.Z.mask + 0.1, d: ell(P, 0, 0, rx + rim, ry + rim), mat: rimM, light: { form: 0.7 } });
            const lensLit = [], lensShade = [], lensLines = [];
            if (glow) {
              let hot = C.mix(lensHex, ctx.tok("paper-100"), 0.62), core = C.mix(lensHex, ctx.tok("paper-100"), 0.28), limb = C.mix(lensHex, ctx.tok("signal-700"), 0.55), flame = C.mix(lensHex, ctx.tok("signal-500"), 0.7), body = lensHex;
              if (duo) {
                body = ctx.accent(lensHex, "accent");
                core = ctx.accent(lensHex, 0.9);
                hot = ctx.accent(lensHex, "light");
                limb = ctx.accent(lensHex, 0.3);
                flame = ctx.accent(lensHex, 0.5);
              }
              lensShade.push({ d: ell(P, 0, 0, rx, ry), fill: limb });
              lensShade.push({ d: ell(P, 0, 0, rx * 0.86, ry * 0.86), fill: body });
              if (mid) lensShade.push({ d: ell(P, -rx * 0.12, -ry * 0.1, rx * 0.56, ry * 0.52), fill: core });
              if (mid) lensShade.push({ d: ell(P, -rx * 0.2, -ry * 0.18, rx * 0.26, ry * 0.24), fill: hot });
              if (hi) for (const [u, v, w, h, r] of [[0.28, 0.36, 0.2, 0.34, 0.5], [0.46, 0.1, 0.12, 0.3, 0.7], [0.12, 0.5, 0.14, 0.22, 0.3]]) lensLines.push({ d: ell(P, rx * u, ry * v, rx * w, ry * h, r), fill: flame, o: 0.75 });
            } else {
              lensLit.push({ d: M.mapD(G.brush([[-rx * 0.62, ry * 0.15], [-rx * 0.5, -ry * 0.5], [-rx * 0.05, -ry * 0.8]], [4e-3, 0.026, 6e-3]), P), o: 0.5 });
              if (hi) lensLit.push({ d: ell(P, rx * 0.4, ry * 0.45, rx * 0.12, ry * 0.07, -0.5), o: 0.3 });
            }
            out.push({ id: `mask-gas-lens-${tag}`, z: ctx.Z.mask + 0.2, d: ell(P, 0, 0, rx, ry), mat: lensM, fill: "base", light: false, shade: lensShade, lit: lensLit, lines: lensLines, ...spot });
          }
          if (o.filter !== "front" && mid) {
            const Pv = M.plate(ctx, 0, my + 0.045, 0.1);
            const rv = 0.085, ev = (a, b) => M.mapD(G.ellipse(0, 0, a, b), Pv);
            out.push({
              id: "mask-gas-voice",
              z: ctx.Z.mask + 0.02,
              d: ev(rv, rv * 0.96),
              mat: rubber,
              fill: pale,
              light: { form: 0.5, sheenO: 0.3 },
              lines: [{ d: ev(rv * 0.6, rv * 0.58), fill: dark, o: 0.95 }, ...hi ? [-1, 0, 1].map((i) => ({ d: M.mapD(G.brush([[-rv * 0.5, i * rv * 0.24], [0, i * rv * 0.24 + 3e-3], [rv * 0.5, i * rv * 0.24]], [3e-3, 8e-3, 3e-3]), Pv), fill: pale2, o: 0.5 })) : []]
            });
          }
          const front = o.filter === "front";
          if (front) {
            const P = M.plate(ctx, 0, my + 0.04, 0.1);
            const R0 = 0.12;
            out.push({
              id: "mask-gas-filter",
              z: ctx.Z.mask + 0.3,
              d: ell(P, 0, 0, R0, R0 * 1.02),
              mat: metal,
              light: { form: 0.9 },
              lines: mid ? [{ d: ell(P, 0, 0, R0 * 0.72, R0 * 0.72), fill: "deep", o: 0.8 }, ...hi ? [-2, -1, 0, 1, 2].map((i) => ({ d: M.mapD(G.brush([[-R0 * 0.55, i * R0 * 0.2], [0, i * R0 * 0.2 + 6e-3], [R0 * 0.55, i * R0 * 0.2]], [4e-3, 0.012, 4e-3]), P), fill: "light", o: 0.5 })) : []] : []
            });
          } else {
            const sd = o.side === "L" ? -1 : 1;
            const P = M.plate(ctx, sd * 0.215, 0.335, 0.085);
            const cap = 0.082;
            const barrel = M.mapD(G.brush([[-sd * 0.14, -0.1], [-sd * 0.07, -0.05], [0, 0]], [0.1, 0.15, 0.17]), P);
            out.push({
              id: "mask-gas-canister",
              z: ctx.Z.mask + 0.3,
              d: barrel,
              mat: metal,
              light: { form: 0.9 },
              lit: [{ d: M.mapD(G.brush([[-sd * 0.12, -0.12], [-sd * 0.05, -0.09], [0, -0.075]], [4e-3, 0.018, 6e-3]), P), o: 0.5 }],
              lines: hi ? [-1, 0, 1].map((i) => ({ d: M.mapD(G.brush([[-sd * (0.1 - i * 0.012), -0.07 + i * 0.035], [-sd * (0.05 - i * 0.012), -0.025 + i * 0.03]], [6e-3, 6e-3]), P), fill: "deep", o: 0.45 })) : []
            });
            out.push({
              id: "mask-gas-canister-cap",
              z: ctx.Z.mask + 0.31,
              d: ell(P, 0, 0, cap, cap * 1.05),
              mat: metal,
              light: { form: 0.8 },
              lines: mid ? [{ d: ell(P, sd * 4e-3, 6e-3, cap * 0.62, cap * 0.64), fill: "deep", o: 0.35 }] : [],
              over: mid ? [{ d: ell(P, sd * 0.01, 0.014, cap * 0.3, cap * 0.34), fill: ctx.tok("ink-900"), o: 0.95 }] : []
            });
          }
          return out;
        }
      });
    }
  });

  // src/parts/masks/stocking.js
  var require_stocking = __commonJS({
    "src/parts/masks/stocking.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_mask();
      var LONG = /* @__PURE__ */ new Set(["long-straight", "bob", "bowl-bob", "ponytail"]);
      var keepHair = (o, S) => o && o.hair === "keep" || !(o && o.hair === "flat") && !!(S && S.hair && LONG.has(S.hair.style));
      register({
        kind: "mask",
        name: "stocking",
        aliases: ["nylon", "nylon-mask", "pantyhose"],
        describe: "Nylon stocking over the head: a sheer tinted veil that flattens the face and the hair into an anonymous mask, with a knot on the crown and a tail flopping to one side. The bank job, the smash-and-grab, the man nobody can describe.",
        params: {
          color: "nylon tint token (default cloth-camel; cloth-salmon for a pink pair, cloth-charcoal for smoke)",
          sheer: "0.3\u20130.75: how opaque the nylon is (default 0.52)",
          tail: '"L" | "R" the side the tail flops to (default "L": viewer-right) | "none": a bald knot',
          knot: "false: no knot at all, just the veil",
          hair: '"flat" (the hair is pressed flat into a skull cap in its own colour) | "keep" (drawn as it is and veiled). Default: flat, except long hair (long-straight, bob, bowl-bob, ponytail), which keeps'
        },
        example: { face: { mask: { type: "stocking", color: "cloth-camel" } } },
        covers: (o, S) => keepHair(o, S) ? [] : ["hair"],
        draw(ctx, o) {
          var _a, _b;
          const { G, C } = ctx, H = ctx.head, k = ctx.R.head.k, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid"), lo = !mid;
          const sk = M.skull(ctx), wid = sk.wid;
          const tintTok = M.tokOr(ctx, o.color, "cloth-camel");
          const nylon = ctx.mat(tintTok, "cloth");
          const sheer0 = M.clamp(+o.sheer || 0.52, 0.3, 0.78);
          const sheer = mid ? sheer0 : Math.max(sheer0, 0.85);
          const keep = keepHair(o, ctx.S);
          const bald = ctx.S.hair && ctx.S.hair.style === "bald";
          const hatted = !!(ctx.S.hair && ctx.S.hair.hat && ctx.S.hair.hat.type);
          const knotOn = o.knot !== false && !hatted;
          const zCap = ctx.Z.maskOver - 0.1, zV = keep ? (_a = ctx.Z.maskVeil) != null ? _a : ctx.Z.hair + 0.1 : ctx.Z.maskOver + 0.2;
          const out = [];
          if (!keep && !bald && mid) {
            const crownF = (y) => Math.pow(M.clamp((-0.2 - y) / 0.3, 0, 1), 1.3);
            const { L, R } = M.sides(ctx, sk, (y) => 6e-3 + 0.016 * crownF(y), -0.7, -0.045);
            const hl = (_b = H.hairline) != null ? _b : -0.28;
            const line = M.K(ctx, [
              [-(wid(-0.045) - 4e-3), -0.045, true, 0.01],
              [-(wid(-0.1) - 0.026), -0.12, false, 0.02],
              [-(wid(-0.18) - 0.05), -0.21, false, 0.03],
              [-0.2, hl + 0.01, false, 0.035],
              [-0.09, hl + 0.04, false, 0.04],
              [0, hl + 0.046, false, 0.04],
              [0.09, hl + 0.04, false, 0.04],
              [0.2, hl + 0.01, false, 0.035],
              [wid(-0.18) - 0.05, -0.21, false, 0.03],
              [wid(-0.1) - 0.026, -0.12, false, 0.02],
              [wid(-0.045) - 4e-3, -0.045, true, 0.01]
            ], 0.03);
            const ring = [[L[0][0], L[0][1], true], ...M.thin(L.slice(1, -1), 2), L[L.length - 1], ...line, R[0], ...M.thin(R.slice(1, -1), 2), R[R.length - 1]];
            const hm = ctx.hairMat();
            const capLit = mid ? [{ d: M.stroke(ctx, [[-0.28, -0.4], [-0.15, -0.5], [0.05, -0.54]], [4e-3, 0.05, 4e-3], 0.02), o: 0.45 }] : [];
            out.push({ id: "mask-stocking-hair", z: zCap, d: G.smooth(ring, true, 0.5), mat: hm, lit: capLit, light: { form: 1, sheenO: 0.45 } });
          }
          const e0 = H.earTop - 0.03, e1 = H.earBot + 0.03;
          const earBump = (y) => y > e0 && y < e1 ? 0.034 * Math.sin((y - e0) / (e1 - e0) * Math.PI) : 0;
          const amt = (p, i) => {
            const y = sk.poly[i][1];
            const crown = Math.pow(M.clamp((-0.2 - y) / 0.3, 0, 1), 1.3);
            return ((keep ? 9e-3 + 0.04 * crown : 0.011 + 0.014 * crown) + earBump(y)) * k;
          };
          const outer = M.thin(M.relax(M.grow(sk.kit, amt), 3), 2);
          const d = G.smooth(outer, true, 0.5);
          const tone = M.tone(ctx, { nose: 0.6, cheek: 0.55, mouth: 0.45 });
          const B = (pts, ws, d0 = 0.03) => M.stroke(ctx, pts, ws, d0);
          const lit = [...tone.lit], shade = [...tone.shade], deep = [...tone.deep], vlines = [];
          if (mid) {
            lit.push({ d: B([[-0.2, -0.36], [-0.12, -0.3], [0.02, -0.28]], [0.01, 0.07, 0.012]), o: 0.35 });
            lit.push({ d: B([[-0.27, 0], [-0.24, 0.12], [-0.17, 0.25]], [8e-3, 0.05, 8e-3]), o: 0.3 });
            if (knotOn) for (const [x1, y1, x2, y2] of [[-0.02, -0.52, -0.16, -0.44], [0, -0.52, -0.05, -0.4], [0.03, -0.52, 0.12, -0.44]]) vlines.push({ d: B([[x1, y1, false, 0.03], [(x1 + x2) / 2, (y1 + y2) / 2, false, 0.03], [x2, y2, false, 0.03]], [3e-3, 8e-3, 3e-3]), fill: "shade", o: 0.32 });
          }
          out.push({ id: "mask-stocking", z: zV, d, mat: nylon, opacity: sheer, shade, deep, lit, lines: vlines, light: { form: 0.3, sheenO: 0.4 } });
          if (mid) {
            const lighter = C.mix(ctx.skin.light || ctx.skin.base, tintTok, 0.55);
            const ny = H.noseY, nw = H.noseW, my = H.mouthY, mw = H.mouthW;
            const ell = (cx, cy, a, b, rot = 0, depth = 0.05) => ctx.hs(G.ellipse(cx, cy, a, b, rot), { depth });
            const patch = (id, cx, cy, a, b, op, depth) => {
              out.push({ id, z: zV + 0.01, d: ell(cx, cy, a, b, 0, depth), fill: lighter, opacity: op, light: false });
              out.push({
                id: `${id}-fringe`,
                z: zV + 0.01,
                d: ell(cx, cy, a * 1.35, b * 1.3, 0, depth),
                fill: "none",
                mat: ctx.mat(tintTok, "flat"),
                light: false,
                lines: [{ d: ell(cx, cy, a * 1.35, b * 1.3, 0, depth), fill: lighter, stip: true, o: op * 0.9 }]
              });
            };
            patch("mask-stocking-press-nose", 4e-3, ny - 0.045, nw * 0.95, 0.11, 0.3, 0.05);
            patch("mask-stocking-press-mouth", 0, my + 5e-3, mw * 0.92, 0.04, 0.34, 0.03);
          }
          if (knotOn) {
            const side = o.tail === "R" ? -1 : 1;
            const bare = o.tail === "none";
            const kn = ctx.mat(tintTok, "cloth");
            const cr = -0.5 - (keep ? 0.035 : 0.014);
            const dens = Math.min(0.92, sheer + 0.36);
            const wN = lo ? 1.2 : 1;
            const zT = zV + 0.03;
            const P = (x, y) => [side * x, y, false, 0.02];
            const L2 = (pts) => pts.map(([x, y]) => [x, y, false, 0.02]);
            if (bare) {
              out.push({
                id: "mask-stocking-knot",
                z: zT,
                d: ctx.hs(G.ellipse(0, cr + 5e-3, 0.06, 0.042, 0), { depth: 0.02 }),
                mat: kn,
                opacity: dens,
                light: { form: 0.5, sheenO: 0.4 },
                lines: mid ? [-1, 0, 1].map((i) => ({ d: M.stroke(ctx, [[i * 0.03, cr - 0.02, false, 0.02], [i * 0.017, cr + 5e-3, false, 0.02], [i * 0.02, cr + 0.03, false, 0.02]], [3e-3, 9e-3, 3e-3]), fill: "shade", o: 0.5 })) : []
              });
            } else {
              let c = [P(0, cr + 0.016), P(0.012, cr - 0.068), P(0.075, cr - 0.128), P(0.17, cr - 0.122), P(0.265, cr - 0.062), P(0.33, cr + 0.05), P(0.365, cr + 0.19), P(0.37, cr + 0.33), P(0.35, cr + 0.45)];
              let hwp = [0.056, 0.022, 0.026, 0.04, 0.05, 0.058, 0.064, 0.068, 0.07];
              if (lo) {
                c = c.slice(0, 5);
                hwp = hwp.slice(0, 5);
              }
              const hw = (t) => {
                const m = hwp.length - 1, x = t * m, i = Math.min(m - 1, Math.floor(x));
                return (hwp[i] + (hwp[i + 1] - hwp[i]) * (x - i)) * k * wN;
              };
              const d2 = G.tube(M.K(ctx, c, 0.02), hw, { capStart: "round", capEnd: "round", samples: 28 });
              const tailLit = mid ? [
                { d: M.stroke(ctx, L2([P(0.07, cr - 0.148), P(0.17, cr - 0.142), P(0.25, cr - 0.09), P(0.3, cr - 0.01)]), [4e-3, 0.016, 0.014, 4e-3]), o: 0.55 },
                { d: M.stroke(ctx, L2([P(0.325, cr + 0.1), P(0.335, cr + 0.22), P(0.33, cr + 0.34)]), [4e-3, 0.016, 4e-3]), o: 0.4 }
              ] : [];
              const tailShade = mid ? [{ d: M.stroke(ctx, L2([P(0.41, cr + 0.08), P(0.428, cr + 0.22), P(0.418, cr + 0.38)]), [4e-3, 0.026, 6e-3]), o: 0.55 }] : [];
              const tailLines = mid ? [
                // the twist at the neck of the knot, a crumple across the leg and the seam of the foot
                ...[0, 1].map((i) => ({ d: M.stroke(ctx, L2([P(-0.025 + i * 0.03, cr - 0.045 + i * 0.012), P(0.04 + i * 0.012, cr - 0.08 + i * 0.012)]), [3e-3, 8e-3, 3e-3]), fill: "shade", o: 0.55 })),
                { d: M.stroke(ctx, L2([P(0.306, cr + 0.215), P(0.37, cr + 0.235), P(0.43, cr + 0.215)]), [3e-3, 8e-3, 3e-3]), fill: "shade", o: 0.4 },
                { d: M.stroke(ctx, L2([P(0.31, cr + 0.4), P(0.352, cr + 0.42), P(0.402, cr + 0.4)]), [3e-3, 7e-3, 3e-3]), fill: "shade", o: 0.5 }
              ] : [];
              out.push({ id: "mask-stocking-tail", z: zT, d: d2, mat: kn, opacity: dens, lit: tailLit, shade: tailShade, lines: tailLines, light: { form: 0.7, sheenO: 0.4 } });
            }
          }
          return out;
        }
      });
    }
  });

  // src/parts/masks/surgical.js
  var require_surgical = __commonJS({
    "src/parts/masks/surgical.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_mask();
      register({
        kind: "mask",
        name: "surgical",
        aliases: ["medical-mask", "gauze-mask"],
        describe: "Surgical mask: a pleated gauze mask over nose, mouth and chin with ties running to the ears. The orderly, the pharmacist, the burglar who watches the news.",
        params: { color: "cloth token (default cloth-white; cloth-sky for the pale blue ward mask)", ties: "tie colour token (default the mask colour)", pleats: "2\u20134 (default 3)" },
        example: { face: { mask: { type: "surgical", color: "cloth-sky" } } },
        covers: ["nose", "mouth", "facialHair"],
        draw(ctx, o) {
          const { G, C } = ctx, H = ctx.head, k = ctx.R.head.k, hi = ctx.lodAtLeast("hi"), mid = ctx.lodAtLeast("mid"), lod = ctx.lod;
          const sk = M.skull(ctx), wid = sk.wid;
          const col = M.tokOr(ctx, o.color, "cloth-white");
          const cloth = ctx.mat(col, "cloth"), tieM = ctx.mat(M.tokOr(ctx, o.ties, col), "cloth");
          const half = (y) => Math.min(0.285, wid(y) + 8e-3);
          const cy = H.chinY;
          const L = [
            [0, 0.046, false, 0.055],
            [-0.1, 0.064, false, 0.04],
            [-0.19, 0.092, false, 0.025],
            [-half(0.125), 0.125, true, 0.012],
            [-half(0.2), 0.2, false, 0.01],
            [-half(0.3), 0.3, false, 0.01],
            [-half(0.38), 0.38, false, 0.012],
            [-half(0.45), 0.45, false, 0.015],
            [-half(cy - 0.02) * 0.9, cy - 0.01, false, 0.03],
            [-0.08, cy + 0.035, false, 0.04],
            [0, cy + 0.045, false, 0.045]
          ];
          const d = M.path(ctx, M.sym(L), 0.45);
          const tone = M.tone(ctx, { nose: 1.1, cheek: 0.4, mouth: 0.8 });
          const shade = [...tone.shade], deep = [...tone.deep], lit = [...tone.lit], lines = [];
          const B = (pts, ws, d1 = 0.035) => M.stroke(ctx, pts, ws, d1);
          const np = Math.round(M.clamp(o.pleats || 3, 2, 4));
          if (mid) for (let i = 0; i < np; i++) {
            const y = 0.17 + (cy - 0.04 - 0.17) * (i + 0.25) / np;
            const m = half(y) * 0.97;
            const row = (dy, w, dd) => [-1, -0.5, 0, 0.5, 1].map((t) => [t * m, y + dy + 0.022 * (1 - t * t), false, dd]);
            lines.push({ d: B(row(0, 0, 0.03), [4e-3, 0.016, 0.02, 0.016, 4e-3]), fill: "shade", o: 0.6 });
            if (hi) lit.push({ d: B(row(0.016, 0, 0.03), [3e-3, 8e-3, 0.01, 8e-3, 3e-3]), o: 0.5 });
          }
          if (mid) deep.push({ d: B([[-half(0.44) * 0.8, cy - 0.02], [0, cy + 0.022], [half(0.44) * 0.8, cy - 0.02]], [4e-3, 0.018, 4e-3]), o: 0.35 });
          const pieces = [{ id: "mask-surgical", z: ctx.Z.mask, d, mat: cloth, shade, deep, lit, lines, light: { form: 0.95, sheenO: 0.4 } }];
          const tw = Math.max(0.014, M.U.hpx(ctx, lod === "lo" ? 2.2 : lod === "mid" ? 1.6 : 1.2));
          const tk = (pts) => M.tuck(ctx, pts, sk.kit, tw * k * 0.6 + ctx.px(1), 0.01);
          for (const s of [-1, 1]) {
            const tag = s < 0 ? "R" : "L";
            pieces.push({ id: `mask-surgical-tie-up-${tag}`, z: ctx.Z.mask - 0.05, d: B(tk([[s * (half(0.125) - 0.012), 0.128], [s * (wid(0.06) - 0.014), 0.07], [s * (wid(H.earTop) - 6e-3), H.earTop + 0.05]]), [tw, tw, tw * 0.9], 0.01), mat: tieM, light: false });
            pieces.push({ id: `mask-surgical-tie-low-${tag}`, z: ctx.Z.mask - 0.05, d: B(tk([[s * (half(0.43) - 0.012), 0.43], [s * (wid(0.3) - 0.022), 0.31], [s * (wid(H.earBot) - 6e-3), H.earBot - 0.012]]), [tw, tw, tw * 0.9], 0.01), mat: tieM, light: false });
          }
          return pieces;
        }
      });
    }
  });

  // src/parts/mid/apron.js
  var require_apron = __commonJS({
    "src/parts/mid/apron.js"() {
      "use strict";
      var { register } = require_registry();
      register({
        kind: "mid",
        name: "apron",
        describe: "Bib apron with a neck strap, waist ties and a patch pocket (style: bistro for a waist apron); waistcoat: colour puts a waistcoat under it.",
        params: { color: "fabric token", style: "bib|bistro", length: "hip|thigh|knee|calf", waistcoat: "colour token or { color, buttons }", pattern: "textile name" },
        example: { outfit: { base: { type: "shirt", color: "cloth-white", sleeves: "rolled" }, mid: { type: "apron", color: "cloth-white", style: "bistro", waistcoat: "cloth-charcoal" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          const bistro = o.style === "bistro";
          const mat = ctx.mat(o.color || "cloth-white", o.kind || "canvas");
          const y = R.y, w = R.w;
          const hemY = (_a = { hip: y.waist + 0.8 * hh, thigh: y.crotch + 0.5 * hh, knee: y.knee, calf: y.knee + 0.7 * hh }[o.length || (bistro ? "knee" : "knee")]) != null ? _a : y.knee;
          const topY = bistro ? y.waist - 0.04 * hh : y.chest - 0.34 * hh;
          const wc = w.chest;
          const P = (k, x, Y) => R.torsoPt(k * x, Y);
          const half = (Y) => Y <= y.waist ? 0 : 1;
          const pts = [];
          const cap = ctx.underCaps ? ctx.underCaps() : null;
          const wW = w.waist + Math.min(0.05, cap ? cap.waist : 0.05) * hh, hipW = Math.max(w.hip, w.waist) + 0.035 * hh, hemW = hipW + 0.02 * hh;
          const side = (k) => {
            const out2 = [];
            if (!bistro) out2.push([...P(k, 0.3 * hh + wc * 0.1, topY), true], P(k, 0.4 * hh + wc * 0.18, y.chest - 0.1 * hh), P(k, wc * 0.68, y.chest + 0.3 * hh), P(k, wW * 0.97, y.waist - 0.06 * hh));
            else out2.push([...P(k, wW, topY), true]);
            out2.push(P(k, wW, y.waist + 0.03 * hh), P(k, hipW, y.hip + 0.1 * hh), [...P(k, hemW, hemY), true]);
            return out2;
          };
          const Rs = side(-1), Ls = side(1).reverse();
          const d = G.smooth([...Rs, ...Ls], true, 0.4);
          const lines = [], over = [];
          if (ctx.lodAtLeast("mid")) {
            lines.push({ d: G.brush([P(-1, wW, y.waist + 0.04 * hh), P(0, 0, y.waist + 0.06 * hh), P(1, wW, y.waist + 0.04 * hh)], [0.05 * hh, 0.05 * hh, 0.05 * hh]), fill: "shade", o: 0.6 });
            for (const x of [-0.42, 0.3]) lines.push({ d: G.brush([P(1, x * hipW, y.waist + 0.1 * hh), P(1, x * hipW * 1.05, (y.waist + hemY) / 2), P(1, x * hipW * 1.1, hemY - 0.1 * hh)], [2e-3 * hh, 0.022 * hh, 2e-3 * hh]), fill: "shade", o: 0.5 });
            lines.push({ d: G.brush([P(1, hemW * 0.9, hemY - 0.03 * hh), P(0, 0, hemY - 0.03 * hh), P(-1, hemW * 0.9, hemY - 0.03 * hh)], 0.035 * hh), fill: "shade", o: 0.5 });
            if (hemY > y.waist + 0.9 * hh) {
              const py = y.waist + 0.62 * hh, ph = 0.3 * hh, pw = hipW * 0.62;
              const pk = G.poly([P(-1, pw, py), P(1, pw, py), P(1, pw, py + ph), P(-1, pw, py + ph)]);
              lines.push({ d: G.brush([P(-1, pw, py), P(1, pw, py)], 0.016 * hh), fill: "deep", o: 0.7 });
              lines.push({ d: pk, fill: "shade", o: 0.28 });
              lines.push({ d: G.brush([P(1, pw, py), P(1, pw, py + ph)], [2e-3 * hh, 0.02 * hh]), fill: "shade", o: 0.55 });
            }
          }
          const out = [];
          if (o.waistcoat) out.push(...ctx.part("mid", "waistcoat", typeof o.waistcoat === "string" ? { color: o.waistcoat } : o.waistcoat));
          out.push({ id: "apron", z: 34, d, mat, pattern: o.pattern, lines, over, light: { form: 1 } });
          if (!bistro) {
            const nb = y.neckBase, c = R.centerAt(nb);
            const strap = [];
            for (const k of [-1, 1]) strap.push(G.brush([P(k, 0.3 * hh + wc * 0.1, topY + 0.02 * hh), P(k, w.neck * 1.25, (topY + nb) / 2), P(k, w.neck * 1.12, nb - 0.1 * hh)], [0.06 * hh, 0.055 * hh, 0.05 * hh]));
            out.push({ id: "apron-strap", z: 34.1, d: strap[0], mat, light: { form: 0.8 } }, { id: "apron-strap2", z: 34.1, d: strap[1], mat, light: { form: 0.8 } });
          }
          if (ctx.lodAtLeast("mid")) {
            const a = P(1, wW * 0.98, y.waist + 0.06 * hh);
            const t1 = G.brush([a, [a[0] + 0.05 * hh, a[1] + 0.2 * hh], [a[0] + 0.03 * hh, a[1] + 0.42 * hh]], [0.05 * hh, 0.05 * hh, 0.04 * hh]);
            const t2 = G.brush([a, [a[0] - 0.04 * hh, a[1] + 0.16 * hh], [a[0] - 0.08 * hh, a[1] + 0.33 * hh]], [0.05 * hh, 0.045 * hh, 0.04 * hh]);
            out.push({ id: "apron-tie", z: 34.2, d: t1, mat, light: { form: 0.8 } }, { id: "apron-tie2", z: 34.15, d: t2, mat, light: { form: 0.8 } });
          }
          return out;
        }
      });
    }
  });

  // src/parts/tops/tee.js
  var require_tee = __commonJS({
    "src/parts/tops/tee.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var S = require_shared();
      var { sleeves, torsoFolds } = S;
      function neckRib(ctx, b, w = 0.034, fill = "shade") {
        const { G, hh } = ctx;
        const np = b.neckPts.map((p) => [p[0], p[1] + w * 0.5 * hh]);
        const mid = Math.floor(np.length / 2);
        const wd = [w * hh * 0.8, w * hh, w * hh * 0.8];
        if (np.length === 3) return [G.brush([np[0], np[1]], w * hh), G.brush([np[1], np[2]], w * hh)].map((d) => ({ d, fill }));
        return [{ d: G.brush(np.slice(0, mid + 1), np.slice(0, mid + 1).map(() => w * hh)), fill }, { d: G.brush(np.slice(mid), np.slice(mid).map(() => w * hh)), fill }];
      }
      register({
        kind: "top",
        name: "tee",
        describe: "Crew or V neck T-shirt with sloped shoulders and set-in sleeves; untucked unless tucked: true.",
        params: { color: "fabric token", sleeves: "short|long|rolled", tucked: "true|false", pattern: "textile name", neckline: "crew|v|scoop|boat", length: "crop|normal" },
        example: { outfit: { base: { type: "tee", color: "cloth-white" } } },
        sleeves,
        torsoFolds,
        draw(ctx, o) {
          const { R, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-white", o.kind || "cloth");
          const tucked = !!o.tucked;
          const crop = o.length === "crop";
          const hem = crop ? R.y.waist - 0.05 * hh : tucked ? R.y.waist + 0.25 * hh : R.y.hip + 0.12 * hh;
          const b = S.bodice(ctx, { ease: tucked ? 0.035 : 0.045, neckline: o.neckline || "crew", hem, hemDrop: crop ? 0 : 0.02 });
          const lines = torsoFolds(ctx, b, { hemFolds: !tucked && !crop, waist: tucked });
          if (ctx.lodAtLeast("mid")) lines.push(...neckRib(ctx, b));
          const len = o.sleeves === "long" ? 1 : o.sleeves === "rolled" ? 0.5 : 0.32;
          return [
            { id: "tee", yoke: true, z: tucked ? Z.tucked : Z.top, d: b.d, mat, pattern: o.pattern, lines, light: { form: 1 } },
            ...sleeves(ctx, mat, { to: len, ease: len > 0.6 ? 0.035 : 0.04, pattern: o.pattern, prefix: "tee" })
          ];
        }
      });
      module.exports = { sleeves, torsoFolds, neckRib };
    }
  });

  // src/parts/mid/layers.js
  var require_layers = __commonJS({
    "src/parts/mid/layers.js"() {
      "use strict";
      var { register } = require_registry();
      var S = require_shared();
      var { sleeves, torsoFolds } = require_tee();
      register({
        kind: "mid",
        name: "tactical-vest",
        describe: "Sleeveless tactical vest: padded straps, centre zip, two rows of pouches, MOLLE webbing and side adjusters.",
        params: { color: "fabric token", pouches: "true|false" },
        example: { outfit: { base: { type: "tee", color: "cloth-black", sleeves: "long" }, mid: { type: "tactical-vest", color: "cloth-olive" } } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-olive", o.kind || "canvas");
          const y = R.y, hem = y.hip + 0.12 * hh;
          ctx.coverHem("mid", hem);
          const b = S.bodice(ctx, { ease: 0.055, waistEase: 0.05, neckline: "v", neckX: 0.03, depth: 0.3, armhole: "cut", strap: 0.62, hem, hemDrop: 0 });
          const lines = torsoFolds(ctx, b, { hemFolds: false, armShadow: false, strong: false });
          const over = [];
          if (ctx.lodAtLeast("mid")) {
            lines.push(S.centreLine(ctx, b.neckMid[1], hem, { dx: 0, w: 0.014, fill: "deep", o: 0.85 }));
            for (const s of ["R", "L"]) {
              const k = R.sx(s), P = b.pts[s];
              lines.push({ d: G.brush([P.strapTop, P.armA, P.armB, P.armpit].map((p) => [p[0], p[1]]), [0.03 * hh, 0.03 * hh, 0.03 * hh, 6e-3 * hh]), fill: "deep", o: 0.45 });
              const pw = Math.min(0.2 * hh, R.w.chest * 0.26);
              const pouch = (cx, top, h, flap) => {
                const a2 = R.torsoPt(k * (cx - pw / 2), top), c2 = R.torsoPt(k * (cx + pw / 2), top + h);
                const x0 = Math.min(a2[0], c2[0]), x1 = Math.max(a2[0], c2[0]);
                lines.push({ d: G.poly([[x0, a2[1]], [x1, a2[1]], [x1, c2[1]], [x0, c2[1]]]), fill: "deep", o: 0.5 });
                const rect = (ya, yb, xa = x0, xb = x1) => G.poly([[xa, ya], [xb, ya], [xb, yb], [xa, yb]]), yf = a2[1] + flap * hh;
                lines.push({ d: rect(a2[1], yf), fill: "shade", o: 0.8 });
                lines.push({ d: rect(yf, yf + 0.045 * hh), fill: "deep", o: 0.35 });
                lines.push({ d: rect(yf - 6e-3 * hh, yf + 4e-3 * hh), fill: "deep", o: 0.85 });
                lines.push({ d: rect(a2[1], a2[1] + 8e-3 * hh), fill: "light", o: 0.4 });
                lines.push({ d: rect(yf + 0.01 * hh, c2[1] - 0.01 * hh, k > 0 ? x0 : x1 - 8e-3 * hh, k > 0 ? x0 + 8e-3 * hh : x1), fill: "light", o: 0.22 });
                over.push({ d: G.ellipse((x0 + x1) / 2, a2[1] + flap * hh * 0.85, 0.012 * hh), fill: "light", o: 0.7 });
              };
              if (o.pouches !== false) {
                pouch(R.w.chest * 0.3, y.chest + 0.1 * hh, 0.3 * hh, 0.08);
                pouch(R.w.chest * 0.66, y.chest + 0.1 * hh, 0.3 * hh, 0.08);
                pouch(R.w.waist * 0.5, y.waist + 0 * hh, 0.34 * hh, 0.1);
              }
              const a = R.torsoPt(k * R.w.chest * 0.9, y.chest + 0.05 * hh), c = R.torsoPt(k * R.w.waist * 0.92, y.waist + 0.1 * hh);
              lines.push({ d: G.brush([a, c], [0.03 * hh, 0.03 * hh]), fill: "deep", o: 0.6 });
              over.push({ d: G.ellipse((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, 0.016 * hh), fill: "light", o: 0.8 });
            }
            for (const f of [0.3, 0.5, 0.7]) lines.push({ d: G.brush([R.torsoPt(-R.w.waist * 0.95, y.waist + f * 0.44 * hh), R.torsoPt(0, y.waist + f * 0.44 * hh), R.torsoPt(R.w.waist * 0.95, y.waist + f * 0.44 * hh)], 0.012 * hh), fill: "shade", o: 0.35 });
          }
          return [{ id: "tactical-vest", z: Z.mid, d: b.d, mat, lines, over, light: { form: 1 } }];
        }
      });
      register({
        kind: "mid",
        name: "cardigan",
        describe: "Open knit cardigan with rib button bands, patch pockets and long sleeves; closed: true buttons it up.",
        params: { color: "fabric token", closed: "true|false", pattern: "textile name" },
        example: { outfit: { base: { type: "shirt", color: "cloth-white" }, mid: { type: "cardigan", color: "cloth-camel" } } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-camel", o.kind || "knit");
          const y = R.y, hem = y.hip + 0.18 * hh;
          ctx.coverHem("mid", hem);
          const b = S.bodice(ctx, { ease: 0.055, waistEase: 0.05, neckline: "v", neckX: 0.04, depth: 0.85, hem, hemDrop: 0 });
          const folds = torsoFolds(ctx, b, { hemFolds: false });
          const apexY = b.neckMid[1];
          const gap = (Y) => (o.closed ? 0 : 0.02 + 0.1 * Math.max(0, (Y - apexY) / (hem - apexY))) * hh;
          const out = [], over = [];
          for (const s of ["R", "L"]) {
            const k = R.sx(s), P = b.pts[s];
            const front = (Y, fy) => R.torsoPt(k * gap(Y) * -1 * -1, fy != null ? fy : Y);
            const fr = (Y) => R.torsoPt(k * gap(Y), Y);
            const keys = ["neck", "trap", "shTop", "shPt", "shOut", "armpit", "chest", "waist", "hip", "hipLow", "hem"].filter((n) => P[n]);
            const pts = keys.map((n) => P[n]);
            pts.push([...fr(hem), true], fr(y.waist), [...fr(apexY), true]);
            const d = G.smooth(pts, true, 0.45);
            const lines = [...folds];
            if (ctx.lodAtLeast("mid")) {
              const e0 = fr(apexY), e1 = fr(y.waist), e2 = fr(hem);
              lines.push({ d: G.brush([e0, e1, e2], [0.07 * hh, 0.07 * hh, 0.07 * hh].map((v) => v * 0.9)), fill: "shade", o: 0.5 });
              lines.push({ d: G.brush([[e0[0] + k * 0.035 * hh, e0[1]], [e1[0] + k * 0.035 * hh, e1[1]], [e2[0] + k * 0.035 * hh, e2[1]]], 8e-3 * hh), fill: "deep", o: 0.5 });
              lines.push({ d: G.brush([P.neck, G.lerp(P.neck, e0, 0.5), e0], 0.05 * hh), fill: "shade", o: 0.45 });
              const hs = P.hem, hc = fr(hem);
              lines.push({ d: G.brush([[hs[0], hs[1] - 0.04 * hh], [(hs[0] + hc[0]) / 2, hs[1] - 0.04 * hh], [hc[0], hc[1] - 0.04 * hh]], 0.08 * hh), fill: "shade", o: 0.45 });
              const pa = R.torsoPt(k * R.w.hip * 0.9, y.waist + 0.32 * hh), pc = R.torsoPt(k * R.w.hip * 0.42, y.waist + 0.62 * hh);
              const x0 = Math.min(pa[0], pc[0]), x1 = Math.max(pa[0], pc[0]);
              lines.push({ d: G.poly([[x0, pa[1]], [x1, pa[1]], [x1, pc[1]], [x0, pc[1]]]), fill: "shade", o: 0.3 });
              lines.push({ d: G.brush([[x0, pa[1]], [x1, pa[1]]], 0.016 * hh), fill: "deep", o: 0.6 });
            }
            if (s === "L" && ctx.lodAtLeast("mid")) {
              const ys = [];
              for (let i = 0; i < 5; i++) ys.push(apexY + 0.15 * hh + (hem - apexY - 0.4 * hh) * i / 4);
              for (const Y of ys) {
                const c = fr(Y);
                over.push({ d: G.ellipse(c[0] + k * 0, c[1], 0.018 * hh), fill: "deep", o: 0.9 });
                if (ctx.lodAtLeast("hi")) over.push({ d: G.ellipse(c[0] - 5e-3 * hh, c[1] - 5e-3 * hh, 6e-3 * hh), fill: "light", o: 0.7 });
              }
            }
            out.push({ id: `cardigan-${s}`, z: Z.mid, d, mat, pattern: o.pattern, lines, over: s === "L" ? over : [], light: { form: 1 } });
          }
          out.push(...sleeves(ctx, mat, { to: 0.95, ease: 0.05, pattern: o.pattern, prefix: "cardigan", zAdd: 0.35, hemBand: 0.06, hemO: 0.5 }));
          return out;
        }
      });
    }
  });

  // src/parts/mid/waistcoat.js
  var require_waistcoat = __commonJS({
    "src/parts/mid/waistcoat.js"() {
      "use strict";
      var { register } = require_registry();
      var S = require_shared();
      var { torsoFolds } = require_tee();
      register({
        kind: "mid",
        name: "waistcoat",
        describe: "Fitted waistcoat (the bartender): deep V neck, buttons, pointed hem, welt pockets; the shirt shows in the V and at the armholes.",
        params: { color: "fabric token", pattern: "textile name", buttons: "4-7", piping: "true (cream on dark cloth, charcoal on light) | a contrast token: thin edge piping round the V, armholes and hem" },
        example: { outfit: { base: { type: "shirt", color: "cloth-white", sleeves: "rolled" }, mid: { type: "waistcoat", color: "cloth-charcoal" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-charcoal", o.kind || "wool");
          const sideHem = R.y.waist + 0.38 * hh;
          ctx.coverHem("mid", sideHem);
          const b = S.bodice(ctx, { ease: 0.055, waistEase: 0.04, neckline: "v", neckX: 0.09, depth: 0.78, armhole: "cut", strap: 0.5, hem: sideHem, hemDrop: 0.28, hemPoint: true });
          const lines = torsoFolds(ctx, b, { hemFolds: false, waist: true, armShadow: false, strong: false });
          const over = [];
          const apexY = b.neckMid[1], pointY = sideHem + 0.28 * hh;
          if (ctx.lodAtLeast("mid")) {
            const [Lc, ap, Rc] = [b.neckPts[0], b.neckPts[Math.floor(b.neckPts.length / 2)], b.neckPts[b.neckPts.length - 1]];
            lines.push({ d: G.brush([Lc, G.lerp(Lc, ap, 0.5), ap], 0.016 * hh), fill: "light", o: 0.45 }, { d: G.brush([ap, G.lerp(ap, Rc, 0.5), Rc], 0.016 * hh), fill: "light", o: 0.45 });
            lines.push({ d: G.brush([ap, b.hemMid], [6e-3 * hh, 0.012 * hh]), fill: "deep", o: 0.6 });
            for (const s of ["R", "L"]) {
              const P = b.pts[s];
              lines.push({ d: G.brush([P.strapTop, P.armA, P.armB, P.armpit].map((p) => [p[0], p[1]]), [0.012 * hh, 0.02 * hh, 0.02 * hh, 4e-3 * hh]), fill: "deep", o: 0.45 });
              const k = R.sx(s), a = R.torsoPt(k * R.w.waist * 0.78, R.y.waist + 0.1 * hh), c = R.torsoPt(k * R.w.waist * 0.4, R.y.waist + 0.16 * hh);
              lines.push({ d: G.brush([a, c], [0.012 * hh, 0.014 * hh]), fill: "deep", o: 0.85 });
              lines.push({ d: G.brush([[a[0], a[1] - 0.014 * hh], [c[0], c[1] - 0.014 * hh]], 8e-3 * hh), fill: "light", o: 0.4 });
            }
            const n = (_a = o.buttons) != null ? _a : 6, y0 = apexY + 0.12 * hh, y1 = pointY - 0.16 * hh, ys = [];
            for (let i = 0; i < n; i++) ys.push(y0 + (y1 - y0) * i / Math.max(1, n - 1));
            over.push(...S.buttons(ctx, ys, { r: 0.016, fill: "deep" }));
          }
          if (o.piping) {
            const pc = typeof o.piping === "string" ? o.piping : ctx.C.lum(mat.base) < 0.35 ? "cloth-cream" : "cloth-charcoal";
            const w = (ctx.lodAtLeast("mid") ? 0.022 : 0.034) * hh;
            const edge = (a, c) => lines.push({ d: G.brush([a, G.lerp(a, c, 0.5), c], w), fill: pc, o: 0.95 });
            const nk = b.neckPts, ap = nk[Math.floor(nk.length / 2)];
            edge(nk[0], ap);
            edge(ap, nk[nk.length - 1]);
            for (const s of ["R", "L"]) {
              const P = b.pts[s];
              lines.push({ d: G.brush([P.strapTop, P.armA, P.armB, P.armpit].map((q) => [q[0], q[1]]), w), fill: pc, o: 0.95 });
              edge([b.pts[s].hem[0], b.pts[s].hem[1]], b.hemMid);
            }
          }
          return [{ id: "waistcoat", z: Z.mid, d: b.d, mat, pattern: o.pattern, lines, over, light: { form: 1 } }];
        }
      });
    }
  });

  // src/parts/neckwear/pendant.js
  var require_pendant = __commonJS({
    "src/parts/neckwear/pendant.js"() {
      "use strict";
      var { register } = require_registry();
      register({
        kind: "neckwear",
        name: "pendant",
        describe: "Chain with a pendant (pendant: tags|disc|cross|peace) hanging into the open collar; the Veteran's dog tags.",
        params: { pendant: "tags|disc|cross|peace", color: "metal token (default metal-steel)", drop: "chain drop in head-heights below the neck base (default 0.8)" },
        example: { outfit: { base: { type: "tee", color: "cloth-olive" }, neck: { type: "pendant", pendant: "tags" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "metal-steel", "metal");
          const nb = R.y.neckBase, wn = R.w.neck, drop = ((_a = o.drop) != null ? _a : 0.8) * hh;
          const P = (x, Y) => R.torsoPt(x, Y);
          const cw = (ctx.lodAtLeast("mid") ? 0.013 : 0.02) * hh;
          const pts = [P(-wn * 1, nb - 0.12 * hh), P(-wn * 0.95, nb + 0.2 * hh), P(-wn * 0.55, nb + drop * 0.62), P(0, nb + drop), P(wn * 0.55, nb + drop * 0.62), P(wn * 0.95, nb + 0.2 * hh), P(wn * 1, nb - 0.12 * hh)];
          const out = [{ id: "pendant-chain", z: 31.6, d: G.brush(pts, cw), mat, light: { form: 0.2 }, opacity: 0.95 }];
          const c = pts[3];
          const kind = o.pendant || "tags";
          const plate = (cx, cy, w, h, rotA, id, z) => {
            const r = Math.min(w, h) * 0.3;
            const d = G.smooth([[cx - w / 2 + r, cy - h / 2], [cx + w / 2 - r, cy - h / 2], [cx + w / 2, cy - h / 2 + r], [cx + w / 2, cy + h / 2 - r], [cx + w / 2 - r, cy + h / 2], [cx - w / 2 + r, cy + h / 2], [cx - w / 2, cy + h / 2 - r], [cx - w / 2, cy - h / 2 + r]], true, 0.3);
            const lines = ctx.lodAtLeast("mid") ? [{ d: G.brush([[cx - w * 0.3, cy - h * 0.1], [cx + w * 0.3, cy - h * 0.1]], 0.012 * hh), fill: "deep", o: 0.7 }, { d: G.brush([[cx - w * 0.3, cy + h * 0.12], [cx + w * 0.2, cy + h * 0.12]], 0.012 * hh), fill: "deep", o: 0.7 }, { d: G.ellipse(cx, cy - h * 0.4, 0.012 * hh), fill: "deep", o: 0.8 }] : [];
            return { id, z, d: rotA ? G.rotate(d, rotA, [cx, cy]) : d, mat, lines: rotA ? [] : lines, light: { form: 0.8 } };
          };
          if (kind === "tags") {
            out.push(plate(c[0] + 0.02 * hh, c[1] + 0.12 * hh, 0.1 * hh, 0.17 * hh, 0, "pendant-tag-b", 31.62));
            out.push(plate(c[0] - 0.025 * hh, c[1] + 0.09 * hh, 0.1 * hh, 0.17 * hh, 0, "pendant-tag-a", 31.64));
          } else if (kind === "cross") {
            out.push({ id: "pendant-cross", z: 31.64, d: G.poly([[c[0] - 0.014 * hh, c[1]], [c[0] + 0.014 * hh, c[1]], [c[0] + 0.014 * hh, c[1] + 0.05 * hh], [c[0] + 0.05 * hh, c[1] + 0.05 * hh], [c[0] + 0.05 * hh, c[1] + 0.08 * hh], [c[0] + 0.014 * hh, c[1] + 0.08 * hh], [c[0] + 0.014 * hh, c[1] + 0.17 * hh], [c[0] - 0.014 * hh, c[1] + 0.17 * hh], [c[0] - 0.014 * hh, c[1] + 0.08 * hh], [c[0] - 0.05 * hh, c[1] + 0.08 * hh], [c[0] - 0.05 * hh, c[1] + 0.05 * hh], [c[0] - 0.014 * hh, c[1] + 0.05 * hh]]), mat, light: { form: 0.6 } });
          } else {
            const r = (kind === "peace" ? 0.065 : 0.05) * hh, cy = c[1] + r + 0.01 * hh;
            const lines = kind === "peace" && ctx.lodAtLeast("mid") ? [
              { d: G.brush([[c[0], cy - r * 0.85], [c[0], cy + r * 0.85]], 0.012 * hh), fill: "deep", o: 0.8 },
              { d: G.brush([[c[0], cy], [c[0] - r * 0.6, cy + r * 0.65]], 0.012 * hh), fill: "deep", o: 0.8 },
              { d: G.brush([[c[0], cy], [c[0] + r * 0.6, cy + r * 0.65]], 0.012 * hh), fill: "deep", o: 0.8 }
            ] : [];
            out.push({ id: "pendant-disc", z: 31.64, d: G.ellipse(c[0], cy, r, r), mat, lines, light: { form: 0.8 } });
          }
          return out;
        }
      });
    }
  });

  // src/parts/neckwear/scarf.js
  var require_scarf = __commonJS({
    "src/parts/neckwear/scarf.js"() {
      "use strict";
      var { register } = require_registry();
      function ribbon(G, pts, hw, n = 18) {
        const c = G.resample(pts, n, 0.5), L = [], Rr = [];
        c.forEach((p, i) => {
          const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)], nn = G.perp(G.norm(G.sub(b, a))), t = i / (n - 1), w = typeof hw === "function" ? hw(t) : hw;
          L.push(G.add(p, G.mul(nn, w)));
          Rr.push(G.sub(p, G.mul(nn, w)));
        });
        const d = G.smooth([...L.map((p, i) => i === L.length - 1 ? [...p, true] : p), ...Rr.reverse().map((p, i) => i === 0 ? [...p, true] : p)], true, 0.3);
        Rr.reverse();
        return { d, L, R: Rr, c, n };
      }
      register({
        kind: "neckwear",
        name: "scarf",
        describe: "Racer's scarf: wrapped neck, side knot, two fringed ends hanging (or trail: true to blow one end out); stripe: colour adds end stripes.",
        params: { color: "fabric token", stripe: "second colour token", side: "L|R (knot side)", trail: "true|false", layer: "over (default)|under" },
        example: { outfit: { base: { type: "tee", color: "cloth-white", sleeves: "long" }, neck: { type: "scarf", color: "cloth-red", stripe: "cloth-white" } } },
        draw(ctx, o) {
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-red", o.kind || "knit");
          const z = o.layer === "under" ? 31.6 : 39;
          const k = (o.side || "L") === "L" ? 1 : -1;
          const nb = R.y.neckBase, wn = R.w.neck;
          const P = (x, Y) => R.torsoPt(x, Y);
          const out = [];
          const top = R.y.chin + 0.05 * hh;
          const wrap = G.smooth([P(-wn * 1.3, top), P(wn * 1.3, top), P(wn * 1.6, nb - 0.02 * hh), P(wn * 1.7, nb + 0.07 * hh), P(wn * 0.8, nb + 0.17 * hh), P(0, nb + 0.2 * hh), P(-wn * 0.8, nb + 0.17 * hh), P(-wn * 1.7, nb + 0.07 * hh), P(-wn * 1.6, nb - 0.02 * hh)].map((p, i) => i === 1 ? p : p), true, 0.45);
          const wl = [];
          if (ctx.lodAtLeast("mid")) {
            wl.push({ d: G.brush([P(-wn * 1.5, nb - 0 * hh), P(0, nb + 0.07 * hh), P(wn * 1.5, nb - 0 * hh)], [2e-3 * hh, 0.03 * hh, 2e-3 * hh]), fill: "shade", o: 0.55 });
            wl.push({ d: G.brush([P(-wn * 1.45, nb + 0.1 * hh), P(-wn * 0.3, nb + 0.17 * hh)], [2e-3 * hh, 0.02 * hh]), fill: "light", o: 0.35 });
          }
          out.push({ id: "scarf-wrap", z, d: wrap, mat, lines: wl, light: { form: 1 } });
          const kc = P(k * 0.09 * hh, nb + 0.16 * hh);
          out.push({ id: "scarf-knot", z: z + 0.1, d: G.ellipse(kc[0], kc[1], 0.1 * hh, 0.085 * hh, k * 0.25), mat, lines: ctx.lodAtLeast("mid") ? [{ d: G.brush([[kc[0] - 0.06 * hh, kc[1] - 0.01 * hh], [kc[0], kc[1] + 0.03 * hh], [kc[0] + 0.07 * hh, kc[1]]], [2e-3 * hh, 0.02 * hh, 2e-3 * hh]), fill: "deep", o: 0.6 }] : [], light: { form: 1 } });
          const stripeTok = o.stripe;
          const end = (id, zz, pts, wd, withFringe) => {
            const r = ribbon(G, pts, (t) => wd * (0.9 + 0.1 * t) * hh);
            const lines = [];
            if (ctx.lodAtLeast("mid")) {
              lines.push({ d: G.brush(r.c.slice(1, -1).map((p) => G.add(p, [wd * 0.45 * hh, 0])), r.c.slice(1, -1).map((_, i, a) => (Math.sin(i / (a.length - 1) * Math.PI) * 0.03 + 2e-3) * hh)), fill: "shade", o: 0.5 });
              if (stripeTok) for (const [t0, t1] of [[0.74, 0.8], [0.86, 0.92]]) {
                const i0 = Math.round(t0 * (r.n - 1)), i1 = Math.round(t1 * (r.n - 1));
                lines.push({ d: G.poly([r.L[i0], r.L[i1], r.R[i1], r.R[i0]]), fill: stripeTok, o: 1 });
              }
            }
            const fr = [];
            if (withFringe) for (let i = 0; i < 7; i++) {
              const a = G.lerp(r.L[r.n - 1], r.R[r.n - 1], i / 6);
              fr.push({ d: G.brush([[a[0], a[1] - 5e-3 * hh], [a[0] + (i / 6 - 0.5) * 0.025 * hh, a[1] + 0.055 * hh]], [0.012 * hh, 4e-3 * hh]), fill: mat.base, o: 1 });
            }
            out.push({ id, z: zz, d: r.d, mat, lines, over: fr, light: { form: 1 } });
          };
          const top0 = [kc[0], kc[1] + 0.03 * hh];
          if (o.trail) {
            end("scarf-end-short", z - 0.05, [top0, P(-k * 0.06 * hh, nb + 0.4 * hh), P(-k * 0.09 * hh, nb + 0.72 * hh)], 0.08, true);
            end("scarf-end-trail", z + 0.05, [top0, P(k * 0.45 * hh, nb + 0.2 * hh), P(k * 0.95 * hh, nb + 0.05 * hh), P(k * 1.45 * hh, nb + 0.18 * hh)], 0.075, true);
          } else {
            end("scarf-end-short", z - 0.05, [top0, P(-k * 0.05 * hh, nb + 0.45 * hh), P(-k * 0.1 * hh, nb + 0.82 * hh)], 0.08, true);
            end("scarf-end-long", z + 0.05, [top0, P(k * 0.1 * hh, nb + 0.55 * hh), P(k * 0.08 * hh, nb + 1.05 * hh), P(k * 0.14 * hh, nb + 1.35 * hh)], 0.085, true);
          }
          return out;
        }
      });
      register({
        kind: "neckwear",
        name: "neckerchief",
        describe: "60s neckerchief: a triangular kerchief knotted at the throat, point lying on the chest; works over an open collar.",
        params: { color: "fabric token", pattern: "textile name", layer: "under (default)|over", spot: "true|false" },
        example: { outfit: { base: { type: "tee", color: "cloth-white" }, neck: { type: "neckerchief", color: "cloth-orange" } } },
        draw(ctx, o) {
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-orange", o.kind || "satin");
          const z = o.layer === "over" ? 39 : 31.6;
          const nb = R.y.neckBase, wn = R.w.neck, P = (x, Y) => R.torsoPt(x, Y);
          let spot = o.spot;
          if (spot == null) {
            try {
              const [, s] = ctx.C.toHsl(ctx.tok(o.color || "cloth-orange"));
              spot = s > 0.3;
            } catch (e) {
              spot = false;
            }
          }
          const d = G.smooth([P(-wn * 1.5, nb - 0.07 * hh), P(wn * 1.5, nb - 0.07 * hh), P(wn * 1.7, nb + 0.07 * hh), [...P(0, nb + 0.66 * hh), true], P(-wn * 1.7, nb + 0.07 * hh)], true, 0.4);
          const lines = ctx.lodAtLeast("mid") ? [
            { d: G.brush([P(-wn * 1.4, nb + 0 * hh), P(0, nb + 0.08 * hh), P(wn * 1.4, nb + 0 * hh)], [2e-3 * hh, 0.03 * hh, 2e-3 * hh]), fill: "shade", o: 0.5 },
            { d: G.brush([P(wn * 0.3, nb + 0.15 * hh), P(wn * 0.9, nb + 0.3 * hh), P(0, nb + 0.62 * hh)], [2e-3 * hh, 0.05 * hh, 2e-3 * hh]), fill: "shade", o: 0.6 }
          ] : [];
          const kn = P(0, nb + 0.1 * hh);
          const tails = [-1, 1].map((s) => G.brush([[kn[0], kn[1]], [kn[0] + s * 0.07 * hh, kn[1] + 0.05 * hh], [kn[0] + s * 0.12 * hh, kn[1] + 0.12 * hh]], [0.035 * hh, 0.05 * hh, 0.012 * hh]));
          return [
            { id: "neckerchief", z, d, mat, pattern: o.pattern, lines, spot: !!spot, light: { form: 1 } },
            { id: "neckerchief-tail-a", z: z + 0.05, d: tails[0], mat, spot: !!spot, light: { form: 0.7 } },
            { id: "neckerchief-tail-b", z: z + 0.05, d: tails[1], mat, spot: !!spot, light: { form: 0.7 } },
            { id: "neckerchief-knot", z: z + 0.1, d: G.ellipse(kn[0], kn[1], 0.04 * hh, 0.035 * hh), mat, spot: !!spot, light: { form: 0.7 } }
          ];
        }
      });
    }
  });

  // src/parts/neckwear/tie.js
  var require_tie = __commonJS({
    "src/parts/neckwear/tie.js"() {
      "use strict";
      var { register } = require_registry();
      function isSpot(ctx, o) {
        if (o.spot != null) return !!o.spot;
        try {
          const [, s, l] = ctx.C.toHsl(ctx.tok(o.color || "cloth-red"));
          return s > 0.3 && l > 0.15;
        } catch (e) {
          return false;
        }
      }
      register({
        kind: "neckwear",
        name: "tie",
        describe: "Slim 60s tie, knot under the collar points; spot: true keeps its colour in duotone schemes; loose: true hangs it low off an open collar (park bench).",
        params: { color: "fabric token", width: "slim|regular", loose: "true|false", spot: "true|false (default: saturated colours)", pattern: "textile name" },
        example: { outfit: { base: { type: "shirt", color: "cloth-white" }, neck: { type: "tie", color: "cloth-red" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-red", o.kind || "satin");
          const loose = !!o.loose, reg = o.width === "regular";
          const nb = R.y.neckBase;
          const kY = nb - 0.01 * hh + (loose ? 0.3 * hh : 0);
          const anchor = R.torsoPt(0, kY);
          const ang = loose ? (_a = o.angle) != null ? _a : 0.09 : 0;
          const T = (u, v) => G.rot([anchor[0] + u * hh, anchor[1] + v * hh], ang, anchor);
          const kw = reg ? 0.085 : 0.065, kb = kw * 0.72, kh = loose ? 0.17 : 0.13, mw = reg ? 0.1 : 0.072;
          const tipV = (R.y.waist + (loose ? -0.02 : 0.12) * hh - kY) / hh;
          const spot = isSpot(ctx, o);
          const bl = [[-0.032, kh - 0.01], [-0.045, kh + 0.1], [-mw * 0.92, kh + 0.42], [-mw, tipV - 0.04], [-mw, tipV, true], [0, tipV + 0.032, true], [mw, tipV, true], [mw, tipV - 0.04], [mw * 0.92, kh + 0.42], [0.045, kh + 0.1], [0.032, kh - 0.01]].map(([u, v, s]) => s ? [...T(u, v), true] : T(u, v));
          const bladeLines = [];
          const knot = G.smooth([[...T(-kw, 0), true], [...T(kw, 0), true], T(kw * 0.95, kh * 0.4), [...T(kb, kh), true], [...T(-kb, kh), true], T(-kw * 0.95, kh * 0.4)], true, 0.35);
          const kLines = [];
          if (ctx.lodAtLeast("mid")) {
            bladeLines.push({ d: G.brush([T(0.5 * mw, kh + 0.06), T(0.62 * mw, (kh + tipV) / 2), T(0.55 * mw, tipV - 0.04)], [2e-3 * hh, 0.04 * hh, 2e-3 * hh]), fill: "shade", o: 0.65 });
            bladeLines.push({ d: G.brush([T(-0.04, kh + 0.02), T(0, kh + 0.045), T(0.04, kh + 0.02)], [2e-3 * hh, 0.04 * hh, 2e-3 * hh]), fill: "deep", o: 0.75 });
            if (ctx.lodAtLeast("hi")) bladeLines.push({ d: G.brush([T(-0.5 * mw, kh + 0.12), T(-0.56 * mw, (kh + tipV) / 2)], [2e-3 * hh, 0.012 * hh, 2e-3 * hh]), fill: "light", o: 0.5 });
            kLines.push({ d: G.brush([T(kw * 0.35, 0), T(kw * 0.7, kh * 0.5), T(kb * 0.5, kh)], [2e-3 * hh, 0.03 * hh, 2e-3 * hh]), fill: "shade", o: 0.7 });
            kLines.push({ d: G.brush([T(0, kh * 0.3), T(0, kh)], [0.012 * hh, 4e-3 * hh]), fill: "deep", o: 0.6 });
          }
          return [
            { id: "tie", z: 31.5, d: G.smooth(bl, true, 0.4), mat, pattern: o.pattern, lines: bladeLines, spot, light: { form: 1, sheenO: 0.55 } },
            { id: "tie-knot", z: 31.55, d: knot, mat, pattern: o.pattern, lines: kLines, spot, light: { form: 1, sheenO: 0.55 } }
          ];
        }
      });
      register({
        kind: "neckwear",
        name: "bow-tie",
        describe: "Butterfly bow tie at the collar, for waiters, bartenders and dandies; spot-colour capable.",
        params: { color: "fabric token", size: "0.8-1.3", spot: "true|false" },
        example: { outfit: { base: { type: "shirt", color: "cloth-white" }, neck: { type: "bow-tie", color: "cloth-black" } } },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-black", o.kind || "satin");
          const sz = (_a = o.size) != null ? _a : 1.6, c = R.torsoPt(0, R.y.neckBase + 0.04 * hh);
          const T = (u, v) => [c[0] + u * hh * sz, c[1] + v * hh * sz];
          const spot = isSpot(ctx, o), out = [];
          for (const k of [-1, 1]) {
            const d = G.smooth([[...T(k * 0.02, -0.02), true], T(k * 0.1, -0.065), [...T(k * 0.17, -0.075), true], [...T(k * 0.17, 0.075), true], T(k * 0.1, 0.065), [...T(k * 0.02, 0.02), true]], true, 0.35);
            const lines = ctx.lodAtLeast("mid") ? [{ d: G.brush([T(k * 0.04, 0), T(k * 0.1, 0.01), T(k * 0.15, 0)], [2e-3 * hh, 0.014 * hh, 2e-3 * hh]), fill: "deep", o: 0.6 }] : [];
            out.push({ id: `bow-tie-wing-${k < 0 ? "R" : "L"}`, z: 31.6, d, mat, lines, spot, light: { form: 0.7 } });
          }
          out.push({ id: "bow-tie-knot", z: 31.65, d: G.smooth([T(-0.035, -0.035), T(0.035, -0.035), T(0.035, 0.035), T(-0.035, 0.035)], true, 0.25), mat, spot, light: { form: 0.6 } });
          return out;
        }
      });
    }
  });

  // src/parts/nose-mouth/_mouth.js
  var require_mouth = __commonJS({
    "src/parts/nose-mouth/_mouth.js"(exports, module) {
      "use strict";
      var U = require_util();
      var { darkSkin } = require_hg();
      var { fx } = require_fx();
      var DEF = {
        w: 1,
        up: 0.019,
        lo: 0.03,
        bow: 0.5,
        lineW: 0.0115,
        curveK: 1,
        base: 0,
        // base: resting corner lift (+ up / − down)
        shadeU: 1,
        lipK: 0.45,
        hard: 0,
        tick: 0,
        openMin: 0,
        lipsDefault: null,
        hi: 1,
        dropLo: 0,
        seam: 0
      };
      var openDepth = (o) => o > 0.02 ? 0.048 * o * (1 + 0.45 * o) + 4e-3 : 0;
      function geom(ctx, opts, def) {
        const H = ctx.head, X = fx(ctx), M = X.mouth;
        const v = { ...DEF, ...def };
        const edge = H.widthAt ? H.widthAt(H.mouthY) : H.w * 0.8;
        const mw = Math.min(H.mouthW / 2 * 1.3 * v.w * M.width * (opts.mouthWidth || 1), Math.max(0.05, edge - 0.09));
        const y = H.mouthY;
        const c = M.curve * 0.02 * v.curveK + v.base, sm = M.smirk * 0.022;
        const yl = y - c - Math.max(0, -sm), yr = y - c - Math.max(0, sm);
        const y0 = y + 3e-3;
        const open = Math.max(M.open, v.openMin);
        const D = open > 0.12 ? Math.max(openDepth(open), Math.min(U.hpx(ctx, ctx.lod === "lo" ? 3.8 : ctx.lod === "mid" ? M.teeth > 0.5 ? 4.4 : 3.6 : 0), 0.085 * open + 0.024)) : openDepth(open);
        const pts = [[-mw, yl, true], [-mw * 0.62, U.lerp(y0, yl, 0.3) + 15e-4], [-mw * 0.22, y0 + 8e-4], [0, y0], [mw * 0.22, y0 + 8e-4], [mw * 0.62, U.lerp(y0, yr, 0.3) + 15e-4], [mw, yr, true]];
        return { v, X, M, mw, y, y0, yl, yr, c, open, D, line: pts, yTop: y0 - v.up - v.bow * 4e-3, yBot: y0 + v.lo + D };
      }
      function lineY(line, x) {
        if (x <= line[0][0]) return line[0][1];
        for (let i = 1; i < line.length; i++) if (x <= line[i][0]) return U.lerp(line[i - 1][1], line[i][1], (x - line[i - 1][0]) / (line[i][0] - line[i - 1][0] || 1));
        return line[line.length - 1][1];
      }
      function build(ctx, opts, def) {
        const { G, C, T, skin } = ctx;
        const g = geom(ctx, opts, def), v = g.v, { mw, y0, yl, yr, open, D, M } = g;
        const lod = ctx.lod, b = U.bold(ctx), px = (n) => U.hpx(ctx, n);
        const lipTok = T.tok(opts.lips) || (v.lipsDefault ? ctx.tok(v.lipsDefault) : null);
        const lip = lipTok ? C.mix(skin.lip, lipTok, 0.85) : skin.lip;
        const v2 = lod !== "hi";
        const lineC = C.mix(skin.deep, T.INK, v2 ? 0.6 : 0.4);
        const over = [];
        const emph = Math.min(1, Math.abs(M.curve) * 0.5 + Math.abs(M.smirk) * 0.5 + Math.min(1, open) + M.press * 0.5 + Math.abs(M.snarl) * 0.5);
        const lw = Math.max(v.lineW * b, px(lod === "lo" ? 2.2 : 1.7)) * (lod === "hi" ? 1 : 1 + 0.32 * emph) * (1 + 0.18 * M.press);
        const lwV2 = lw * (v2 ? 1 + 0.4 * darkSkin(ctx) : 1);
        const lowShift = open > 0.02 ? D * 0.92 : 0;
        const hs = (d) => U.hsD(ctx, d, 0.03);
        const teethC = C.mix(ctx.tok("paper-100"), skin.light, lod === "hi" ? 0.3 : 0.12);
        const inside = C.mix(skin.deep, T.INK, 0.65);
        const press = M.press;
        if (ctx.lodAtLeast("mid")) {
          const lo = v.lo * (lod === "mid" ? 1.1 : 1) * (1 - 0.28 * press) + v.dropLo, up = v.up * (1 - 0.15 * press);
          const tx = (f) => mw * f;
          const topY = (f) => U.lerp(y0, f < 0 ? yl : yr, Math.abs(f) * 0.85) - up * (1 - Math.abs(f) * 0.55);
          const upper = [[-mw, yl, true], [tx(-0.62), topY(-0.62) + 2e-3], [tx(-0.24), topY(-0.24) - v.bow * 45e-4], [tx(-0.07), topY(-0.07) + v.bow * 12e-4], [0, topY(0) + v.bow * 4e-3], [tx(0.07), topY(0.07) + v.bow * 12e-4], [tx(0.24), topY(0.24) - v.bow * 45e-4], [tx(0.62), topY(0.62) + 2e-3], [mw, yr, true], ...g.line.slice(1, -1).reverse()];
          over.push({ d: hs(G.smooth(upper, true, 0.38)), fill: C.mix(lip, skin.deep, lipTok ? v2 ? 0.5 : 0.22 : v2 ? 0.78 : 0.5), o: 1 });
          const lower = [[-mw * 0.92, U.lerp(y0, yl, 0.9) + 2e-3 + lowShift * 0.35, true], [-mw * 0.5, y0 + lo * 0.78 + lowShift], [0, y0 + lo + lowShift], [mw * 0.5, y0 + lo * 0.78 + lowShift], [mw * 0.92, U.lerp(y0, yr, 0.9) + 2e-3 + lowShift * 0.35, true], [0, y0 + 4e-3 + lowShift * 0.5]];
          const dk = lod === "hi" ? 0 : darkSkin(ctx);
          const lowerC = lipTok ? C.mix(skin.base, lip, 0.92) : C.mix(C.mix(C.mix(skin.light, skin.base, 0.35), lip, v.lipK * 0.7), skin.light, 0.6 * dk);
          over.push({ d: hs(G.smooth(lower, true, 0.42)), fill: v2 && lipTok ? C.mix(lowerC, T.PAPER, 0.12 + 0.12 * dk) : v2 && dk > 0.1 ? C.mix(lowerC, T.PAPER, 0.48 * dk) : lowerC });
          if (lod === "hi") over.push({ d: hs(G.brush([[-mw * 0.4, y0 + lo * 0.5 + lowShift], [-mw * 0.1, y0 + lo * 0.62 + lowShift], [mw * 0.18, y0 + lo * 0.56 + lowShift]], [1e-3, 45e-4, 1e-3])), fill: skin.light, o: lipTok ? 0.55 : 0.7 });
          const sy = y0 + lo + 0.012 + lowShift;
          over.push({ d: hs(G.smooth([[-mw * 0.62, sy - 3e-3], [0, sy - 7e-3], [mw * 0.7, sy - 3e-3], [mw * 0.3, sy + 0.02 * v.shadeU * (1 + 0.4 * press)], [-mw * 0.2, sy + 0.016 * v.shadeU * (1 + 0.4 * press)]], true, 0.5)), fill: skin.shade, o: 0.8 });
        }
        if (open > 0.02) {
          const rb = 0.8 - 0.14 * Math.max(0, Math.min(1, -M.curve));
          const bot = [[mw * 0.62, y0 + D * rb + 2e-3], [0, y0 + D + 2e-3], [-mw * 0.62, y0 + D * rb + 2e-3]];
          const openD = hs(G.smooth([[-mw * 0.985, U.lerp(y0, yl, 1), true], [-mw * 0.62, lineY(g.line, -mw * 0.62) - 2e-3], [-mw * 0.22, y0 - 3e-3], [mw * 0.22, y0 - 3e-3], [mw * 0.62, lineY(g.line, mw * 0.62) - 2e-3], [mw * 0.985, yr, true], ...bot], true, 0.4));
          over.push({ d: openD, fill: inside });
          if (open >= 0.75 && lod !== "lo") {
            const tt = Math.min(1, (open - 0.6) * 1.6);
            over.push({ d: hs(G.smooth([[-mw * 0.46, y0 + D * 0.88], [-mw * 0.2, y0 + D * (1 - 0.34 * tt)], [mw * 0.22, y0 + D * (1 - 0.38 * tt)], [mw * 0.48, y0 + D * 0.86], [0, y0 + D * 0.99]], true, 0.5)), fill: C.mix(skin.lip, skin.deep, 0.55), o: 0.85 });
          }
          const tf = M.teeth;
          if (tf > 0.02) {
            const share = tf * (0.82 - 0.42 * Math.max(0, Math.min(1, (D - 0.045) / 0.075)));
            const Th = Math.max(Math.min(D * share, lod === "hi" ? 0.05 : 0.07), lod === "hi" ? 0 : Math.min(px(2.2), D * 0.72)), ty = (x) => lineY(g.line, x) + 15e-4;
            const xs = [-0.66, -0.33, 0, 0.33, 0.66];
            const top = xs.map((f) => [mw * f, ty(mw * f)]);
            const botT = xs.slice().reverse().map((f) => [mw * f, ty(mw * f) + Th * (1 - 0.18 * Math.abs(f))]);
            over.push({ d: hs(G.smooth([[top[0][0] - mw * 0.06, top[0][1] + 4e-3], ...top, [top[4][0] + mw * 0.06, top[4][1] + 4e-3], ...botT], true, 0.3)), fill: teethC, o: 0.97 });
            const sk = lod === "hi" ? 1 : 0.55;
            if (lod !== "lo") over.push({ d: hs(G.brush(top.map(([x, yy]) => [x, yy + Math.min(Th * 0.2, 0.01)]), [1e-3, Math.min(Th * 0.55, 0.02) * sk, Math.min(Th * 0.6, 0.022) * sk, Math.min(Th * 0.55, 0.02) * sk, 1e-3])), fill: C.mix(skin.deep, T.INK, 0.45), o: lod === "hi" ? 0.5 : 0.4 });
          }
        }
        if (Math.abs(M.snarl) > 0.1) {
          const s = Math.sign(M.snarl), a = Math.min(1.1, Math.abs(M.snarl)), rise = Math.max(0.026 * a, lod === "hi" ? 0 : U.hpx(ctx, lod === "lo" ? 2.8 : 2.4) * Math.min(1, a)), yc = s < 0 ? yl : yr;
          const P = (f, dy) => [s * mw * f, lineY(g.line, s * mw * f) + dy];
          over.push({ d: hs(G.smooth([[s * mw * 1, yc, true], P(0.76, -rise * 0.9), P(0.5, -rise * 0.62), P(0.22, -2e-3), P(0.44, 3e-3), P(0.76, 25e-4)], true, 0.4)), fill: inside });
          if (lod !== "lo") over.push({ d: hs(G.poly([[s * mw * 0.66, lineY(g.line, s * mw * 0.66) - rise * 0.78], [s * mw * 0.38, lineY(g.line, s * mw * 0.38) - rise * 0.5], [s * mw * 0.5, lineY(g.line, s * mw * 0.5) + 5e-4]], true)), fill: teethC, o: 0.95 });
        }
        const lines = g.line.map((p) => [p[0], p[1]]);
        const ws = v.hard || press > 0.3 ? [4e-3, lwV2 * 0.9, lwV2 * 1.15, lwV2 * 1.2, lwV2 * 1.15, lwV2 * 0.9, 4e-3] : [2e-3, lwV2 * 0.5, lwV2 * 0.95, lwV2, lwV2 * 0.95, lwV2 * 0.5, 2e-3];
        const lineK = open > 0.3 ? 0.62 : 1;
        over.push({ d: hs(G.brush(lines, ws.map((w, i) => i === 0 || i === 6 ? Math.max(w, 3e-3) : w * lineK))), fill: lineC });
        const tick = Math.max(v.tick, lod === "hi" ? 0 : press * 0.55) * (1 - (M.slack || 0));
        if (tick) for (const s of [-1, 1]) {
          const cy = s < 0 ? yl : yr;
          over.push({ d: hs(G.brush([[s * mw * 0.9, cy - 1e-3], [s * mw * 1.05, cy + 8e-3 * tick], [s * mw * 1.13, cy + 0.024 * tick]], [lw * 1.2, lw * 1, 2e-3])), fill: lineC, o: 0.95 });
        }
        if (M.dimple > 0.1) {
          const sides = Math.abs(M.smirk) > 0.3 ? [Math.sign(M.smirk)] : [-1, 1];
          for (const s of sides) {
            const cy = s < 0 ? yl : yr, k = Math.min(1, M.dimple);
            over.push({ d: hs(G.brush([[s * mw * 1.04, cy - 6e-3 * k], [s * mw * 1.12, cy + 2e-3], [s * mw * 1.1, cy + 0.016 * k]], [2e-3, Math.max(9e-3 * k, px(1.3)), 2e-3])), fill: lineC, o: lod === "hi" ? 0.6 : 0.85 });
          }
        }
        return [{ id: "mouth", z: ctx.Z.face + 0.1, over }];
      }
      function metricsOf(ctx, opts, def) {
        const g = geom(ctx, opts, def);
        return { mw: g.mw, yTop: g.yTop, y: g.y0, yl: g.yl, yr: g.yr, yBot: g.yBot + 0.03, open: g.open, depth: g.D };
      }
      module.exports = { build, metricsOf, geom, DEF, openDepth, lineY };
    }
  });

  // src/parts/nose-mouth/mouth-neutral.js
  var require_mouth_neutral = __commonJS({
    "src/parts/nose-mouth/mouth-neutral.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var M = require_mouth();
      var DEFN = {};
      var params = { mouthWidth: "0.8\u20131.25", lips: "lip colour token (make-up) \u2014 else skin lip tone" };
      function mouthPts(ctx, o = {}) {
        const g = M.geom(ctx, o, DEFN);
        return { mw: g.mw, y: g.y0, yl: g.yl, yr: g.yr, line: g.line };
      }
      register({
        kind: "mouth",
        name: "neutral",
        params,
        example: { face: { mouth: "neutral" } },
        describe: "Closed mouth: a shaped dark line, darker upper lip, lit lower lip, the shade beneath. Reads curve, smirk, width and open from the expression.",
        mouthPts,
        metrics: (ctx, o) => M.metricsOf(ctx, o, DEFN),
        draw: (ctx, opts) => M.build(ctx, opts, DEFN)
      });
      module.exports = { mouthPts };
    }
  });

  // src/parts/nose-mouth/mouth-variants.js
  var require_mouth_variants = __commonJS({
    "src/parts/nose-mouth/mouth-variants.js"() {
      "use strict";
      var { register } = require_registry();
      var M = require_mouth();
      var params = { mouthWidth: "0.8\u20131.25", lips: "lip colour token (make-up) \u2014 else skin lip tone" };
      function mouth(name, describe, def) {
        register({ kind: "mouth", name, describe, params, example: { face: { mouth: name } }, metrics: (ctx, o) => M.metricsOf(ctx, o, def), draw: (ctx, opts) => M.build(ctx, opts, def) });
      }
      mouth("wide", "Wide easy mouth, long line, full lower lip and a soft curve: the open, talkative Booker mouth.", { w: 1.34, up: 0.02, lo: 0.034, lineW: 0.0125, curveK: 1.1, base: 3e-3 });
      mouth("grim", "Hard downturned mouth: a thick flat line, thin tight lips and corner ticks pulling down. Stacey, soldiers, the Watch.", { w: 1.06, up: 0.012, lo: 0.02, lineW: 0.016, base: -0.014, hard: 1, tick: 0.75, bow: 0.2, shadeU: 1.3, curveK: 0.8 });
      mouth("full", "Full soft lips with a strong cupid's bow and a deep lower lip.", { w: 1.04, up: 0.029, lo: 0.042, bow: 1, lineW: 0.0105, lipK: 0.6 });
      mouth("thin", "Thin, long, tight lips: a severe pencil of a mouth.", { w: 1.1, up: 8e-3, lo: 0.014, bow: 0.2, lineW: 0.0115, shadeU: 0.7, base: -2e-3 });
      mouth("pout", "60s lipstick pout: small, full, heart-shaped lips with a bright lower-lip highlight. Defaults to a red lipstick; pass lips to change it.", { w: 0.84, up: 0.032, lo: 0.046, bow: 1.5, lineW: 9e-3, base: 2e-3, lipsDefault: "cloth-red", lipK: 0.8 });
    }
  });

  // src/parts/nose-mouth/_nose.js
  var require_nose = __commonJS({
    "src/parts/nose-mouth/_nose.js"(exports, module) {
      "use strict";
      var U = require_util();
      var DEF = {
        w: 1,
        // overall width multiplier (also scaled by opts.noseWidth)
        start: 0,
        // 0..1: where along the bridge the shadow plane begins (flat noses start low)
        bridge: [0.011, 0.022, 0.03],
        // right-edge half-width of the bridge at u = 0, 0.5, 0.82 (before the wing)
        ridgeShift: null,
        // (y) => x offset of the ridge (broken noses)
        wing: 0.88,
        // outer wing half-width as a fraction of noseW*w at the nostril line
        tipW: 0.034,
        // half-width of the tip pad
        nostril: { rx: 0.0195, ry: 92e-4, gap: 0.4, tilt: 0.28, dy: 0 },
        dBase: 0,
        dTip: 0,
        // shift the base / tip line (head units)
        plane: 1,
        // strength of the shadow plane
        line: 1,
        // weight of the ridge line
        under: 1,
        // strength of the shade beneath
        hook: 0,
        // hooked: the tip hangs toward the lip
        bump: 0,
        // a bump on the ridge (hooked / roman)
        lit: 1,
        // lit-bridge stroke strength (hi)
        tipHi: 1,
        tilt: 0,
        // whole-nose crookedness (tip pushed sideways)
        kink: null
        // broken nose: { y, a, b } the bridge sits at x = a above height y and x = b below it
      };
      function buildNose(ctx, opts, def) {
        const { G, C, T, skin } = ctx;
        const H = ctx.head;
        const v = { ...DEF, ...def, nostril: { ...DEF.nostril, ...def.nostril || {} } };
        const b = U.bold(ctx), px = (n) => U.hpx(ctx, n);
        const wK = (opts.noseWidth || 1) * v.w, lK = opts.noseLength || 1;
        const top = H.brow + 0.035 + v.start * (H.noseTipY - H.brow - 0.1);
        const ny = H.noseY + (lK - 1) * 0.045 + v.dBase;
        const ty = H.noseTipY + (lK - 1) * 0.04 + v.dTip;
        const nw = H.noseW * wK;
        const L = ny - top;
        const depth = (p) => 0.012 + 0.05 * U.clamp((p[1] - top) / (L || 1), 0, 1);
        const hs = (d) => U.hsD(ctx, d, depth);
        const ink = C.mix(skin.deep, T.INK, 0.5);
        const planeC = C.mix(skin.shade, skin.deep, 0.38);
        const kink = v.kink;
        const ridge = (y) => {
          let x = v.tilt * U.clamp((y - top) / L, 0, 1);
          if (kink) {
            const s = U.clamp((y - (kink.y - 0.01)) / 0.02, 0, 1);
            x += kink.a * (1 - s) + kink.b * s;
          }
          return x;
        };
        const edge = (u) => U.table([[0, v.bridge[0]], [0.5, v.bridge[1]], [0.82, v.bridge[2]]], u) * wK;
        const yAt = (u) => top + u * L;
        const wingX = nw * v.wing, tipY = ty;
        const R = [];
        const steps = [0, 0.22, 0.5, 0.74];
        for (const u of steps) {
          const y = yAt(u);
          R.push([ridge(y) + edge(u) + (v.bump && u > 0.15 && u < 0.6 ? v.bump * 0.6 * Math.sin((u - 0.15) / 0.45 * Math.PI) : 0), y]);
        }
        R.push([ridge(ty - 0.02) + Math.max(edge(0.82), v.tipW * wK * 0.9), ty - 0.022]);
        R.push([wingX * 0.99, ny - 0.016 - v.hook * 0], [wingX * 0.86, ny + 6e-3 + v.hook * 4e-3], [wingX * 0.5, ny + 0.015 + v.hook * 0.012]);
        const Rg = [[ridge(ny + 4e-3) + 6e-3, ny + 6e-3 + v.hook * 0.012], [ridge(ty) + 0.016 * wK, ty + 6e-3], [ridge(yAt(0.7)) + 4e-3, yAt(0.7)], [ridge(yAt(0.4)) + 2e-3, yAt(0.4)], [ridge(yAt(0.12)), yAt(0.12)]];
        const planePts = [...R, ...Rg];
        const pieces = [];
        pieces.push({ id: "nose-plane", z: ctx.Z.face, d: hs(G.smooth(planePts, true, 0.42)), fill: planeC, light: false, opacity: U.clamp(0.82 * v.plane, 0, 1) });
        const over = [];
        const lo = ctx.lod === "lo";
        const us = v.under;
        over.push({ d: hs(G.smooth([[-nw * 0.8, ny + 8e-3], [nw * 0.95, ny + 6e-3], [nw * 0.92 + 5e-3, ny + 0.03 * us + 0.012], [nw * 0.3, ny + 0.04 * us + 0.012 + b * 2e-3], [-nw * 0.35, ny + 0.026 * us + 8e-3]], true, 0.5)), fill: skin.deep, o: 0.5 * us });
        const wl = Math.max(75e-4 * v.line * b, px(1.1));
        over.push({ d: hs(G.brush([[-v.tipW * wK * 0.7 + ridge(ty), ty + 4e-3], [-wingX * 0.97, ny - 0.02], [-wingX * 0.92, ny - 2e-3], [-wingX * 0.55, ny + 0.012]], [2e-3, wl, wl * 0.9, 2e-3])), fill: skin.line, o: 0.85 });
        over.push({ d: hs(G.brush([[wingX * 0.96, ny - 0.03], [wingX * 1.01, ny - 8e-3], [wingX * 0.72, ny + 0.012], [wingX * 0.4, ny + 0.017]], [2e-3, wl * 1.1, wl * 1.2, 2e-3])), fill: skin.deep, o: 0.8 });
        const rl = Math.max(58e-4 * v.line * b, px(1.15));
        const lp = [[ridge(top + 0.01) + edge(0) * 0.7, top + 0.01], [ridge(yAt(0.35)) + edge(0.35) * 0.55, yAt(0.35)], [ridge(yAt(0.7)) + edge(0.7) * 0.5, yAt(0.7)], [ridge(ty) + v.tipW * wK * 0.78, ty - 4e-3], [wingX * 0.8 + (v.hook ? 4e-3 : 0), ny - 0.014]];
        over.push({ d: hs(G.brush(lp, [1e-3, rl, rl * 1.1, rl * 1.05, rl * 0.3])), fill: ctx.C.mix(skin.line, skin.deep, 0.55), o: lo ? 0.9 : 0.82 });
        const N = v.nostril, nr = Math.max(N.rx * wK, px(1.7)), nrY = Math.max(N.ry * (1 + (b - 1) * 0.5), px(1.1));
        const nyc = ny + 2e-3 + N.dy;
        for (const s of [-1, 1]) over.push({ d: hs(G.ellipse(ridge(ny) + s * nw * N.gap * (v.nostril.gapK || 1), nyc, nr, nrY, s * N.tilt)), fill: ink });
        if (ctx.lodAtLeast("mid") && !lo) {
          over.push({ d: hs(G.brush([[ridge(ty) + 5e-3, ty + 0.012], [ridge(ty) + 0.012, ny - 4e-3]], [4e-3, 0.012, 4e-3])), fill: skin.shade, o: 0.45 });
        }
        if (ctx.lodAtLeast("mid") && !lo) {
          const hiK = ctx.lod === "hi" ? 1 : 1.5;
          if (v.lit > 0) {
            over.push({ d: hs(G.brush([[ridge(yAt(0.18)) - edge(0.18) * 0.55, yAt(0.18)], [ridge(yAt(0.5)) - edge(0.5) * 0.45, yAt(0.5)], [ridge(ty - 0.012) - 0.01, ty - 0.012]], [1e-3, Math.max(65e-4 * v.lit, px(1.5)), Math.max(5e-3 * v.lit, px(1.3)), 1e-3])), fill: skin.light, o: 0.68 });
          }
          if (v.tipHi > 0) over.push({ d: hs(G.brush([[ridge(ty) - 0.024, ty + 2e-3], [ridge(ty) - 4e-3, ty - 0.01], [ridge(ty) + 0.018, ty - 1e-3]], [1e-3, Math.max(85e-4 * v.tipHi, px(1.9)), 1e-3])), fill: skin.light, o: 0.95 });
          if (v.tipHi > 0 && ctx.lod === "mid") over.push({ d: hs(G.ellipse(ridge(ty) - 6e-3, ty - 4e-3, 0.026 * wK, 0.02)), fill: skin.light, o: 0.3 });
        }
        if (v.extra) over.push(...v.extra(ctx, { hs, ridge, top, ny, ty, nw, L, yAt, wl, rl, b, px, planeC, ink, wingX }));
        pieces.push({ id: "nose-detail", z: ctx.Z.face + 0.01, over });
        return pieces;
      }
      module.exports = { buildNose, DEF };
    }
  });

  // src/parts/nose-mouth/nose-straight.js
  var require_nose_straight = __commonJS({
    "src/parts/nose-mouth/nose-straight.js"() {
      "use strict";
      var { register } = require_registry();
      var { buildNose } = require_nose();
      register({
        kind: "nose",
        name: "straight",
        describe: "Straight nose: a long shadow plane down the shadow side, one bold ridge line into the wing, two nostrils and the shade beneath.",
        params: { noseWidth: "0.8\u20131.4", noseLength: "0.9\u20131.15" },
        example: { face: { nose: "straight" } },
        draw: (ctx, opts) => buildNose(ctx, opts, {})
      });
    }
  });

  // src/parts/nose-mouth/nose-variants.js
  var require_nose_variants = __commonJS({
    "src/parts/nose-mouth/nose-variants.js"() {
      "use strict";
      var { register } = require_registry();
      var { buildNose } = require_nose();
      var P = { noseWidth: "0.8\u20131.4", noseLength: "0.9\u20131.15" };
      register({
        kind: "nose",
        name: "broad",
        params: P,
        example: { face: { nose: "broad" } },
        describe: "Broad nose with wide flared wings, a heavy tip pad and a strong dark base: big nostrils and a deep shade beneath (Booker).",
        draw: (ctx, opts) => buildNose(ctx, opts, {
          w: 1.38,
          wing: 0.98,
          tipW: 0.04,
          bridge: [0.014, 0.027, 0.04],
          dBase: 6e-3,
          under: 1.4,
          line: 1.2,
          plane: 1.1,
          nostril: { rx: 0.021, ry: 0.0105, gap: 0.46, tilt: 0.2 }
        })
      });
      register({
        kind: "nose",
        name: "broken",
        params: P,
        example: { face: { nose: "broken" } },
        describe: "Crooked broken nose: the bridge jogs sideways at a kink, the shadow plane jogs with it and a pale ridge scar marks the break (the Garbage Loader).",
        draw: (ctx, opts) => buildNose(ctx, opts, {
          tilt: -6e-3,
          kink: { y: 0.075, a: 0.016, b: -0.014 },
          bridge: [0.012, 0.025, 0.031],
          lit: 1.6,
          line: 1.15,
          nostril: { rx: 0.0165, ry: 82e-4, gap: 0.4, tilt: 0.16 },
          extra: (ctx2, g) => {
            const { C, skin } = ctx2;
            const out = [];
            out.push({ d: g.hs(ctx2.G.brush([[g.ridge(0.075) + 0.045, 0.062], [g.ridge(0.075) + 0.012, 0.074], [g.ridge(0.075) - 0.03, 0.09]], [2e-3, g.rl * 1.5, 2e-3])), fill: skin.deep, o: 0.7 });
            out.push({ d: g.hs(ctx2.G.brush([[g.ridge(-0.02) - 4e-3, -0.03], [g.ridge(0.06) - 8e-3, 0.058], [g.ridge(0.1) - 0.022, 0.11], [g.ridge(0.13) - 0.02, 0.142]], [2e-3, 7e-3, 65e-4, 2e-3])), fill: skin.light, o: 0.85 });
            return out;
          }
        })
      });
      register({
        kind: "nose",
        name: "hooked",
        params: P,
        example: { face: { nose: "hooked" } },
        describe: "Narrow hooked nose: a bump on the bridge and a tip that hangs toward the lip, small hidden nostrils, a hard shadow under the hook.",
        draw: (ctx, opts) => buildNose(ctx, opts, {
          w: 0.92,
          wing: 0.8,
          tipW: 0.028,
          bump: 0.012,
          hook: 1,
          dTip: 0.018,
          dBase: 6e-3,
          under: 1.5,
          bridge: [0.011, 0.02, 0.026],
          nostril: { rx: 0.0125, ry: 55e-4, gap: 0.42, tilt: 0.4 },
          extra: (ctx2, g) => [{ d: g.hs(ctx2.G.smooth([[g.ridge(g.ty) - 0.02, g.ty + 0.02], [g.ridge(g.ty) + 0.04, g.ty + 0.014], [g.ridge(g.ty) + 0.01, g.ny + 0.02]], true, 0.5)), fill: ctx2.skin.deep, o: 0.55 }]
        })
      });
      register({
        kind: "nose",
        name: "button",
        params: P,
        example: { face: { nose: "button" } },
        describe: "Small upturned button nose: a short soft plane, a round tip pad with a highlight, nostrils showing.",
        draw: (ctx, opts) => buildNose(ctx, opts, {
          w: 0.78,
          start: 0.4,
          wing: 0.9,
          tipW: 0.032,
          dBase: -0.012,
          dTip: -0.014,
          bridge: [0.01, 0.016, 0.026],
          under: 0.7,
          line: 0.8,
          plane: 0.8,
          nostril: { rx: 0.0125, ry: 85e-4, gap: 0.42, tilt: 0.1, dy: 0 }
        })
      });
      register({
        kind: "nose",
        name: "flat",
        params: P,
        example: { face: { nose: "flat" } },
        describe: "Boxer's flat nose: a low flattened bridge, a short plane, wide spread wings and big round nostrils.",
        draw: (ctx, opts) => buildNose(ctx, opts, {
          w: 1.3,
          start: 0.42,
          wing: 1,
          tipW: 0.042,
          dBase: 2e-3,
          dTip: 6e-3,
          bridge: [0.016, 0.034, 0.042],
          under: 1.2,
          line: 1.1,
          lit: 0.7,
          nostril: { rx: 0.019, ry: 0.0105, gap: 0.5, tilt: 0.1 },
          extra: (ctx2, g) => [{ d: g.hs(ctx2.G.smooth([[g.ridge(0.06) - 0.03, 0.07], [g.ridge(0.06) + 0.03, 0.068], [g.ridge(0.06) + 0.035, 0.1], [g.ridge(0.06) - 0.028, 0.104]], true, 0.5)), fill: ctx2.skin.shade, o: 0.35 }]
        })
      });
    }
  });

  // src/parts/outer/_coat.js
  var require_coat = __commonJS({
    "src/parts/outer/_coat.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var tee = {};
      var shared = null;
      try {
        tee = require_tee();
      } catch (e) {
      }
      try {
        shared = require_shared();
      } catch (e) {
      }
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      function hemAt(R, h) {
        const y = R.y, hh = R.hh;
        const [key, add] = Array.isArray(h) ? h : [h, 0];
        const base = { waist: y.waist, hip: y.hip, crotch: y.crotch, thigh: y.crotch + (y.knee - y.crotch) * 0.5, knee: y.knee, shin: y.knee + (y.ankle - y.knee) * 0.4, ankle: y.ankle }[key];
        return base + (add || 0) * hh;
      }
      var crisp = (pts, soft = []) => G.smooth(pts.map((p, i) => soft.includes(i) ? [p[0], p[1]] : [p[0], p[1], true]), true, 0.4);
      var brushN = (n) => n <= 3 ? 5 : n === 4 ? 7 : Math.min(9, n + 3 | 1);
      var brush = (pts, ws, o = {}) => G.brush(pts, ws, { samples: brushN(pts.length), ...o });
      var W = (ctx, pts, ws, fill, o) => ({ d: brush(pts, ws.map((v) => v * ctx.hh)), fill, o });
      function sleevesLocal(ctx, mat, o = {}) {
        var _a, _b;
        const { R } = ctx, out = [];
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          const lb = ctx.body.limb("arm", s, { ease: (_a = o.ease) != null ? _a : 0.05, to: (_b = o.to) != null ? _b : 1, capStart: "round", hw: o.hw });
          lb.pieces.forEach((pc) => {
            var _a2;
            return out.push({ id: `${o.prefix || "coat"}-sleeve-${s}-${pc.seg}`, z: A.z + ((_a2 = o.zAdd) != null ? _a2 : 0.2) + (pc.seg === "lower" ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat, pattern: o.pattern, light: { form: 1 } });
          });
        }
        return out;
      }
      var sleevesFn = tee.sleeves || sleevesLocal;
      var foldsFn = tee.torsoFolds || (() => []);
      function coverLower(ctx, t, rebuild) {
        const low = ctx.lowerOutline;
        if (!low || !shared || !shared.flatten) return;
        const { R, hh } = ctx, margin = 8e-3 * hh, step = 4e-3 * hh, knot = 0.03 * hh, slope = 0.5;
        const poly = shared.flatten(G, low), coat = shared.flatten(G, t.d);
        const top = poly.reduce((m, q) => Math.min(m, q[1]), Infinity);
        const extra = { R: [], L: [] };
        let moved = false;
        for (const sd of ["R", "L"]) {
          const o = R.sx(sd), pts = t.pts[sd], yEnd = pts.hem ? pts.hem[1] : t.hem;
          const ys = [], base = [], e = [];
          for (let Y = top - 0.2 * hh; Y <= yEnd; Y += step) {
            const xc = shared.edgeAt(coat, Y, sd), xb = shared.edgeAt(poly, Y, sd);
            if (xc === null) continue;
            ys.push(Y);
            base.push(xc);
            e.push(xb !== null && o * (xb + o * margin) > o * xc ? xb + o * margin : xc);
          }
          if (e.length < 2) continue;
          for (let i = 1; i < e.length; i++) {
            const lim = e[i - 1] - o * slope * step;
            if (o * lim > o * e[i]) e[i] = lim;
          }
          for (let i = e.length - 2; i >= 0; i--) {
            const lim = e[i + 1] - o * slope * step;
            if (o * lim > o * e[i]) e[i] = lim;
          }
          const at = (Y) => {
            const i = Math.max(0, Math.min(e.length - 2, Math.floor((Y - ys[0]) / step)));
            const f = Math.max(0, Math.min(1, (Y - ys[i]) / (ys[i + 1] - ys[i])));
            return e[i] + (e[i + 1] - e[i]) * f;
          };
          const changed = e.map((x, i) => o * x > o * base[i] + 5e-4 * hh);
          const first = changed.indexOf(true), last = changed.lastIndexOf(true);
          if (first < 0) continue;
          moved = true;
          for (const n of ["waist", "hip", "hipLow", "hem"]) {
            const p = pts[n];
            if (p && p[1] >= ys[0] && p[1] <= yEnd) {
              const x = at(p[1]);
              if (o * x > o * p[0]) p[0] = x;
            }
          }
          for (let Y = ys[first] - knot; Y <= ys[last] + knot && Y < yEnd; Y += knot) {
            if (["waist", "hip", "hipLow", "hem"].some((n) => pts[n] && Math.abs(pts[n][1] - Y) < 0.012 * hh)) continue;
            if (Y < ys[0]) continue;
            extra[sd].push([at(Y), Y]);
          }
        }
        if (moved) rebuild(extra);
      }
      function frame(ctx, o, S) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i;
        const { R, hh } = ctx, y = R.y;
        const open = (_b = (_a = o.open) != null ? _a : S.open) != null ? _b : false;
        const e = ((_c = o.ease) != null ? _c : S.ease) * hh;
        const hem = hemAt(R, (_d = o.hem) != null ? _d : S.hem);
        ctx.coverHem("outer", hem);
        const high = S.neck === "high" && !open && o.zip !== "half" || o.zip === "up" && !open;
        const vd = high ? 0 : open ? S.openDepth : (_e = o.depth) != null ? _e : S.vDepth;
        const ease = (_f = o.ease) != null ? _f : S.ease, pinch = S.pinch || 0;
        let t;
        if (shared && shared.bodice) {
          t = shared.bodice(ctx, { ease, waistEase: ease - pinch, neckline: high ? "high" : "v", neckX: 0, depth: high ? void 0 : vd + 0.03, hem, flare: S.flare || 0, drop: S.shoulderDrop || 0, hemDrop: (_g = S.hemCurve) != null ? _g : 0.012, neckH: 0.3 });
        } else t = ctx.body.torso({ ease, hem, flare: S.flare || 0, neckline: high ? "high" : "v", depth: vd, shoulderDrop: S.shoulderDrop || 0, hemCurve: (_h = S.hemCurve) != null ? _h : 0.012 });
        const ord = ["neckTop", "neck", "trap", "strapTop", "armA", "armB", "shTop", "shPt", "shOut", "armpit", "chest", "waist", "hip", "hipLow", "hem"];
        const rebuild = (extra) => {
          const side = (sd) => {
            const L = ord.filter((n) => t.pts[sd][n]).map((n) => t.pts[sd][n]);
            for (const q of extra && extra[sd] || []) {
              let j = L.length;
              while (j > 0 && L[j - 1][1] > q[1]) j--;
              L.splice(j, 0, q);
            }
            return L;
          };
          const Rp = side("R"), Lp = side("L").reverse();
          t.d = G.smooth([...Rp, t.hemMid, ...Lp, ...t.neckPts.slice(1, -1)], true, 0.45);
        };
        if (t.neckPts && S.softShoulder !== false) {
          for (const sd of ["R", "L"]) {
            const P = t.pts[sd], k = R.sx(sd);
            if (P.shPt) P.shPt = [P.shPt[0] - k * 0.035 * hh, P.shPt[1] - 0.012 * hh];
            if (P.shOut) P.shOut = [P.shOut[0] - k * 0.03 * hh, P.shOut[1] + 0.02 * hh];
          }
          rebuild();
        }
        if (t.neckPts && ((_i = o.coverLower) != null ? _i : S.coverLower)) coverLower(ctx, t, rebuild);
        const nb = y.neckBase;
        const F = { ctx, R, hh, S, t, e, hem, open, high, vd, nb, mat: null };
        F.X = (s, rx, Y) => R.torsoPt(R.sx(s) * rx * (R.widthAt(Y) + e), Y);
        F.A = (s, x, Y) => R.torsoPt(R.sx(s) * x * hh, Y);
        F.Wd = (Y) => R.widthAt(Y) + e;
        F.Vs = {};
        for (const s of ["R", "L"]) {
          const k = R.sx(s);
          F.Vs[s] = open ? [R.torsoPt(k * S.gapB * hh, nb + vd * hh)[0], nb + vd * hh] : high ? [R.centerAt(nb), nb + 0.1 * hh] : [t.neckMid[0], t.neckMid[1]];
        }
        F.V = [R.centerAt(nb + vd * hh), nb + vd * hh];
        return F;
      }
      var bodyD = (F) => F.t.d;
      function panelD(F, s) {
        const { t, R, hh, S } = F;
        const k = R.sx(s), P = t.pts[s];
        const order = ["trap", "shTop", "shPt", "shOut", "armpit", "chest", "waist", "hip", "hipLow", "hem"];
        const pts = [[P.neck[0], P.neck[1], true], ...order.filter((n) => P[n]).map((n) => P[n].map((v) => v))];
        const hemY = F.hem;
        const IH = [...R.torsoPt(k * S.gapH * hh, hemY), true];
        const IM = R.torsoPt(k * (S.gapB + S.gapH) * 0.5 * hh, R.y.waist + 0.3 * hh);
        const B = [F.Vs[s][0], F.Vs[s][1], true];
        return G.smooth([...pts, IH, IM, B], true, 0.42);
      }
      function btn(ctx, c, r, fill, hi) {
        const out = [{ d: G.ellipse(c[0], c[1], r, r), fill, o: 1 }];
        if (ctx.lodAtLeast("hi") && hi !== false) out.push({ d: G.ellipse(c[0] - r * 0.3, c[1] - r * 0.32, r * 0.38, r * 0.38), fill: "light", o: 0.8 });
        return out;
      }
      function lapelShapes(F, s, kind, o = {}) {
        var _a;
        const { R, hh } = F, k = R.sx(s);
        const N0 = F.t.pts[s].neck, V = F.Vs[s];
        const lw = (_a = o.lapelW) != null ? _a : 1;
        const nx = (dx, dy) => [N0[0] + k * dx * hh * lw, N0[1] + dy * hh];
        const cx = (dx, dy) => [N0[0] + k * dx * hh, N0[1] + dy * hh];
        const mid = (a, b, f, dx) => {
          const m = G.lerp(a, b, f);
          return [m[0] + k * dx * hh, m[1]];
        };
        const n0 = [N0[0], N0[1]];
        const Ct0 = cx(-0.075, -0.15), Ct1 = cx(0.07, -0.15);
        let lapel = null, collar = null, notch = null, tip = null;
        if (kind === "notch" || kind === "wide") {
          const wd = kind === "wide";
          const g = nx(wd ? 0.09 : 0.07, wd ? 0.22 : 0.17), pk = nx(wd ? 0.4 : 0.27, wd ? 0.3 : 0.23), ck = nx(wd ? 0.37 : 0.25, wd ? 0.15 : 0.12);
          const m = mid(pk, V, 0.5, 0.05 * lw);
          lapel = crisp([n0, g, pk, m, V], [3]);
          const c1 = wd ? cx(0.12, -0.19) : Ct1, c0 = wd ? cx(-0.085, -0.19) : Ct0;
          collar = crisp([c0, c1, ck, g, n0]);
          notch = G.poly([g, ck, pk]);
          tip = pk;
        } else if (kind === "peak") {
          const pk = nx(0.4, 0.03), m = mid(pk, V, 0.45, 0.07 * lw), ck = [G.lerp(n0, pk, 0.62)[0], G.lerp(n0, pk, 0.62)[1] - 0.025 * hh];
          lapel = crisp([n0, pk, m, V], [2]);
          collar = crisp([Ct0, Ct1, ck, n0]);
          tip = pk;
        } else if (kind === "shawl") {
          const s1 = nx(0.3, 0.2), m = mid(s1, V, 0.5, 0.05);
          collar = null;
          lapel = crisp([cx(-0.08, -0.18), cx(0.13, -0.17), s1, m, V, n0], [3]);
          tip = s1;
        } else if (kind === "flap") {
          const ck = nx(0.3, 0.24), cb = G.lerp(n0, V, clamp(0.24 * hh / Math.max(1, G.dist(n0, V)), 0.1, 0.6));
          collar = crisp([Ct0, Ct1, ck, [cb[0] - k * 0.015 * hh, cb[1]], n0]);
          tip = ck;
        }
        return { lapel, collar, notch, tip, N0: n0, V };
      }
      function lapelPieces(F, mat, o) {
        const { ctx, R, hh } = F, { Z } = ctx;
        const out = [], shade = [], lines = [];
        const kind = o.lapel;
        if (!kind || kind === "none") return { pieces: out, shade };
        for (const s of ["R", "L"]) {
          const sh = lapelShapes(F, s, kind, o);
          const k = R.sx(s);
          if (sh.lapel) {
            const ls = [];
            if (ctx.lodAtLeast("mid")) {
              const a = sh.N0, b = sh.V;
              ls.push({ d: brush([G.lerp(a, b, 0.18), G.lerp(a, b, 0.55), G.lerp(a, b, 0.92)].map((p) => [p[0] + k * 0.03 * hh, p[1]]), [2e-3 * hh, 0.02 * hh, 2e-3 * hh]), fill: "shade", o: 0.55 });
            }
            out.push({ id: `${o.prefix}-lapel-${s}`, z: Z.collar, d: sh.lapel, mat, pattern: o.pattern, lines: ls, light: { form: 0.9 } });
            shade.push({ d: G.translate(sh.lapel, 0.016 * hh, 0.028 * hh), fill: mat.deep, o: 0.55 });
          }
          if (sh.collar) {
            out.push({ id: `${o.prefix}-collar-${s}`, z: Z.collar + 0.05, d: sh.collar, mat: o.collarMat || mat, pattern: o.collarMat ? void 0 : o.pattern, light: { form: 0.7 } });
            shade.push({ d: G.translate(sh.collar, 0.01 * hh, 0.03 * hh), fill: mat.deep, o: 0.5 });
          }
          if (sh.notch) shade.push({ d: sh.notch, fill: mat.deep, o: 0.8 });
        }
        return { pieces: out, shade };
      }
      function collarUp(F, mat, o) {
        var _a;
        const { ctx, R, hh } = F, out = [];
        const h = (_a = o.h) != null ? _a : 0.42;
        for (const s of ["R", "L"]) {
          const k = R.sx(s), N0 = F.t.pts[s].neck;
          const cx = (dx, dy) => [N0[0] + k * dx * hh, N0[1] + dy * hh];
          const d = crisp([cx(-0.03, 0.02), cx(-0.05, -h * 0.7), cx(0.12, -h), cx(0.26, -h * 0.55), cx(0.42, 0.1), cx(0.2, 0.2)], []);
          const ls = ctx.lodAtLeast("mid") ? [W(ctx, [cx(0.03, -0.05), cx(0.1, -h * 0.6), cx(0.13, -h * 0.9)], [2e-3, 0.03, 2e-3], "shade", 0.6)] : [];
          out.push({ id: `${o.prefix}-collar-up-${s}`, z: ctx.Z.collar + 0.06, d, mat: o.collarMat || mat, pattern: o.pattern, lines: ls, light: { form: 0.8 } });
        }
        return out;
      }
      function standCollar(F, mat, o) {
        var _a, _b, _c, _d;
        const { ctx, R, hh } = F, out = [];
        const nb = F.nb, h = (_a = o.h) != null ? _a : 0.2, gap = ((_b = o.gap) != null ? _b : 0.018) * hh, wn = R.w.neck, nbw = R.w.neckBase;
        const sp = (_c = o.splay) != null ? _c : 0;
        for (const s of ["R", "L"]) {
          const k = R.sx(s), P = (x, Y) => R.torsoPt(k * x, Y);
          const lo = P(nbw + 0.075 * hh, nb + 0.025 * hh), uo = P(wn + 0.06 * hh + sp * hh, nb - h * hh), ui = P(gap, nb - h * hh + 0.012 * hh), li = [...P(gap, nb + ((_d = o.drop) != null ? _d : 0.07) * hh), true];
          const d = G.smooth([[...lo, true], [...uo, true], [...ui, true], li, G.lerp(li, lo, 0.5)], true, 0.3);
          const ls = [];
          if (ctx.lodAtLeast("mid")) ls.push({ d: brush([P(gap + 0.01 * hh, nb - h * 0.9 * hh), P(gap + 0.02 * hh, nb + 0), P(gap * 0.5, nb + 0.06 * hh)], [2e-3 * hh, 0.012 * hh, 3e-3 * hh]), fill: "deep", o: 0.6 });
          out.push({ id: `${o.prefix}-collar-${s}`, z: ctx.Z.collar, d, mat: o.collarMat || mat, pattern: o.pattern, lines: ls, light: { form: 0.8 } });
        }
        return out;
      }
      function flapPocket(F, p, s, fx) {
        const { ctx, R, hh } = F, k = R.sx(s);
        const Y = (typeof p.at === "string" ? R.y[p.at] : F.nb) + (p.dy || 0) * hh;
        const cx = F.X(s, p.rx, Y)[0];
        const w = p.w * hh, h = p.h * hh, sl = (p.slant || 0) * hh;
        const x0 = cx - w / 2, x1 = cx + w / 2;
        const yIn = Y - sl * k * 0, yo = Y + sl;
        const inn = k < 0 ? x1 : x0, out = k < 0 ? x0 : x1;
        const a = [inn, Y], b = [out, yo], c = [out, yo + h], d = [inn, Y + h];
        const poly = p.point ? [a, b, [out, yo + h * 0.82], [(inn + out) / 2, (Y + yo) / 2 + h * 1.12], [inn, Y + h * 0.82]] : [a, b, c, d];
        const dpoly = crisp(poly);
        fx.shade.push({ d: G.translate(dpoly, 6e-3 * hh, 0.016 * hh), fill: F.mat.deep, o: 0.75 });
        if (p.lit !== false) fx.lit.push({ d: dpoly, o: 0.22 });
        fx.lines.push({ d: brush([a, G.lerp(a, b, 0.5), b], [3e-3 * hh, 8e-3 * hh, 3e-3 * hh]), fill: "deep", o: 0.6 });
        if (p.btn !== false) {
          const bc = p.point ? [(inn + out) / 2, (Y + yo) / 2 + h * 0.74] : [(inn + out) / 2, (Y + yo) / 2 + h * 0.62];
          fx.over.push(...btn(ctx, bc, 0.017 * hh, F.btnFill, false));
        }
        if (p.bellows && ctx.lodAtLeast("mid")) {
          for (const xx of [inn + (out - inn) * 0.08, out - (out - inn) * 0.08]) fx.lines.push({ d: brush([[xx, Y + h * 0.9], [xx, Y + h * 1.9]], [2e-3 * hh, 0.012 * hh]), fill: "shade", o: 0.5 });
          fx.lines.push({ d: brush([[inn, Y + h * 1.9], [out, yo + h * 1.9]], [2e-3 * hh, 0.012 * hh, 2e-3 * hh]), fill: "deep", o: 0.45 });
        }
      }
      function weltPocket(F, p, s, fx) {
        const { ctx, R, hh } = F, k = R.sx(s);
        const Y = (typeof p.at === "string" ? R.y[p.at] : F.nb) + (p.dy || 0) * hh;
        const cx = F.X(s, p.rx, Y)[0], w = p.w * hh, sl = (p.slant || 0) * hh;
        const inn = cx - k * w / 2, out = cx + k * w / 2;
        fx.lines.push({ d: brush([[inn, Y], [(inn + out) / 2, Y + sl * 0.5], [out, Y + sl]], [4e-3 * hh, 0.016 * hh, 6e-3 * hh]), fill: "deep", o: 0.9 });
        if (p.lip !== false && ctx.lodAtLeast("mid")) fx.lines.push({ d: brush([[inn, Y - 0.012 * hh], [out, Y + sl - 0.012 * hh]], [3e-3 * hh, 4e-3 * hh]), fill: "light", o: 0.45 });
      }
      function patchPocket(F, p, s, fx) {
        const { ctx, R, hh } = F, k = R.sx(s);
        const Y = (typeof p.at === "string" ? R.y[p.at] : F.nb) + (p.dy || 0) * hh;
        const cx = F.X(s, p.rx, Y)[0], w = p.w * hh, h = p.h * hh;
        const x0 = cx - w / 2, x1 = cx + w / 2;
        const d = crisp([[x0, Y], [x1, Y], [x1, Y + h * 0.9], [x1 - w * 0.08, Y + h], [x0 + w * 0.08, Y + h], [x0, Y + h * 0.9]]);
        fx.shade.push({ d: G.translate(d, 8e-3 * hh, 0.018 * hh), fill: F.mat.deep, o: 0.7 });
        fx.lit.push({ d, o: 0.2 });
        fx.lines.push({ d: brush([[x0, Y + 0.02 * hh], [x1, Y + 0.02 * hh]], [0.012 * hh, 0.012 * hh]), fill: "shade", o: 0.5 });
        if (p.zip && ctx.lodAtLeast("mid")) fx.lines.push({ d: brush([[x0 + w * 0.06, Y + 0.05 * hh], [x1 - w * 0.06, Y + 0.05 * hh]], 0.01 * hh), fill: "deep", o: 0.8 });
        if (p.btn) fx.over.push(...btn(ctx, [(x0 + x1) / 2, Y + h * 0.18], 0.016 * hh, F.btnFill, false));
      }
      function addPockets(F, list, fx) {
        const { R } = F;
        for (const p of list || []) {
          for (const s of p.sides || ["R", "L"]) {
            if (p.hand && R.arms[s].pose === "pocket" && F.S.pocketHands !== false) continue;
            const q = { ...p, rx: p.rx };
            ({ flap: flapPocket, welt: weltPocket, patch: patchPocket }[p.type] || flapPocket)(F, q, s, fx);
          }
        }
      }
      function pocketHands(F, mat, o) {
        const { ctx, R, hh } = F, out = [];
        if (o.pocketHands === false) return out;
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          if (A.pose !== "pocket") continue;
          const k = R.sx(s), wr = A.wrist, top = R.y.waist + 0.05 * hh;
          const pa = [R.centerAt(top) + k * R.widthAt(top) * 0.55, top + 0.07 * hh], pb = [k * R.w.hip * 0.98 + R.pelvisShift, R.y.hip + 0.12 * hh];
          ctx.cut(`(arm|sleeve|cuff|hand)-${s}`, G.poly([pa, pb, [pb[0] + k * 0.6 * hh, pb[1] + 0.2 * hh], [pb[0] + k * 0.6 * hh, wr[1] + 1.2 * hh], [pa[0] - k * 0.6 * hh, wr[1] + 1.2 * hh], [pa[0] - k * 0.6 * hh, pa[1] + 0.05 * hh]]));
          const lip = [pa, G.lerp(pa, pb, 0.5), pb];
          const items = [{ d: brush(lip, [6e-3 * hh, 0.024 * hh, 0.01 * hh]), fill: mat.deep }];
          if (ctx.lodAtLeast("mid")) items.push({ d: brush(lip.map((p) => [p[0], p[1] - 0.018 * hh]), [2e-3 * hh, 8e-3 * hh, 4e-3 * hh]), fill: mat.light, o: 0.5 });
          out.push({ id: `${o.prefix}-pocket-mouth-${s}`, z: A.z + 0.9, over: items });
        }
        return out;
      }
      function beltPieces(F, mat, o) {
        var _a, _b, _c;
        const { ctx, R, hh } = F, { Z } = ctx, out = [];
        const bm = o.beltMat || mat, Y = R.y.waist + ((_a = o.beltDy) != null ? _a : 0.04) * hh, th = ((_b = o.beltH) != null ? _b : 0.085) * hh;
        const xw = F.Wd(Y) + 0.012 * hh;
        const a = R.torsoPt(-xw, Y), b = R.torsoPt(xw, Y), c = R.torsoPt(0, Y + 0.012 * hh);
        const top = [R.torsoPt(-xw, Y - th / 2), R.torsoPt(0, Y - th / 2 + 0.012 * hh), R.torsoPt(xw, Y - th / 2)];
        const bot = [R.torsoPt(xw, Y + th / 2), R.torsoPt(0, Y + th / 2 + 0.012 * hh), R.torsoPt(-xw, Y + th / 2)];
        const d = G.smooth([[...top[0], true], top[1], [...top[2], true], [...bot[0], true], bot[1], [...bot[2], true]], true, 0.4);
        const lines = [];
        if (ctx.lodAtLeast("mid")) lines.push({ d: brush([R.torsoPt(-xw, Y + th * 0.32), R.torsoPt(0, Y + th * 0.32 + 0.012 * hh), R.torsoPt(xw, Y + th * 0.32)], [4e-3 * hh, 4e-3 * hh, 4e-3 * hh]), fill: "deep", o: 0.5 });
        out.push({ id: `${o.prefix}-belt`, z: Z.belt, d, mat: bm, lines, light: { form: 0.8 }, clip: F.open ? void 0 : `${o.prefix}-body` });
        const bw = 0.15 * hh, bh = th * 1.18;
        const bx = c[0] + ((_c = o.buckleDx) != null ? _c : 0) * hh;
        const frame2 = G.poly([[bx - bw / 2, c[1] - bh / 2], [bx + bw / 2, c[1] - bh / 2], [bx + bw / 2, c[1] + bh / 2], [bx - bw / 2, c[1] + bh / 2]]);
        const hole = G.poly([[bx - bw * 0.28, c[1] - bh * 0.27], [bx + bw * 0.28, c[1] - bh * 0.27], [bx + bw * 0.28, c[1] + bh * 0.27], [bx - bw * 0.28, c[1] + bh * 0.27]]);
        const metal = ctx.mat(o.buckle || "metal-brass", "metal");
        out.push({ id: `${o.prefix}-buckle`, z: Z.belt + 0.1, d: frame2, mat: metal, over: [{ d: hole, fill: bm.deep }], light: { form: 0.6 } });
        if (o.beltTail !== false) {
          const tp = [[bx + bw * 0.4, c[1] + th * 0.1], [bx + bw * 1.6, c[1] + 0.12 * hh], [bx + bw * 1.9, c[1] + 0.42 * hh]];
          out.push({ id: `${o.prefix}-belt-tail`, z: Z.belt + 0.05, d: brush(tp, [th * 0.8, th * 0.78, th * 0.7]), mat: bm, light: { form: 0.8 } });
        }
        return out;
      }
      function epaulettes(F, mat, o) {
        var _a;
        const { ctx, R, hh } = F, out = [];
        for (const s of ["R", "L"]) {
          const A = R.arms[s], P = F.t.pts[s];
          const line = G.resample([P.neck, P.trap, P.shTop, P.shPt || P.shTop], 14, 0.5);
          const seg = line.slice(2, 10).map((p) => [p[0], p[1] + 0.05 * hh]);
          const w = ((_a = o.epW) != null ? _a : 1) * 0.085 * hh;
          const d = brush(seg, (t) => w * (t < 0.8 ? 1 : 1 - (t - 0.8) * 3.6));
          const lines = ctx.lodAtLeast("mid") ? [W(ctx, seg.slice(1, 6).map((p) => [p[0], p[1] + 0.035 * hh]), [2e-3, 0.014, 0.014, 2e-3], "deep", 0.5)] : [];
          const over = ctx.lodAtLeast("mid") ? btn(ctx, seg[1], 0.015 * hh, F.btnFill, false) : [];
          out.push({ id: `${o.prefix}-epaulette-${s}`, z: Math.max(A.z, 46) + 0.55, d, mat: o.epMat || mat, lines, over, light: { form: 0.7 }, noYoke: false });
        }
        return out;
      }
      function planes(F, o = {}) {
        var _a;
        const { ctx, R, hh, S } = F, y = R.y, X = F.X;
        const shade = [], lines = [];
        const hemY = F.hem, long = hemY > y.crotch + 0.3 * hh;
        const k = (_a = o.planeK) != null ? _a : 0.55;
        const yT = y.chest - 0.35 * hh, yW = y.waist, yH = y.hip + 0.1 * hh;
        const pl = [X("L", 0.78, yT), X("L", 0.52, y.chest + 0.3 * hh), X("L", 0.46, yW), X("L", 0.4, yH), X("L", long ? 0.34 : 0.4, hemY - 0.12 * hh), X("L", 0.38, hemY + 0.05 * hh), X("L", 1.4, hemY + 0.1 * hh), X("L", 1.4, yT)];
        const pts = pl.map((p, i) => i < 5 ? p : [p[0], p[1], true]);
        shade.push({ d: G.smooth([[...pl[0], true], ...pts.slice(1, 5), [...pl[5], true], [...pl[6], true], [...pl[7], true]], true, 0.35), o: k });
        if (ctx.lodAtLeast("mid")) {
          const pa = X("R", 0.34, yW + 0.35 * hh), pb = X("R", 0.2, hemY - 0.08 * hh), pm = G.lerp(pa, pb, 0.5);
          lines.push(W(ctx, [pa, [pm[0] + 0.015 * hh, pm[1]], pb], [2e-3, 0.026, 2e-3], "shade", 0.7));
          if (long) {
            const qa = X("L", 0.2, yH + 0.1 * hh), qb = X("L", 0.12, hemY - 0.02 * hh);
            lines.push(W(ctx, [qa, G.lerp(qa, qb, 0.5), qb], [2e-3, 0.03, 4e-3], "deep", 0.55));
          }
        }
        return { shade, lines };
      }
      function cuffPieces(F, mat, o) {
        var _a, _b;
        const { ctx, R, hh } = F, out = [];
        const to = o.sleeveTo, ease = o.sleeveEase;
        for (const s of ["R", "L"]) {
          const A = R.arms[s];
          const lb = ctx.body.limb("arm", s, { ease: ease + ((_a = o.cuffEase) != null ? _a : 0.012), from: to - ((_b = o.cuffLen) != null ? _b : 0.075), to, capStart: "flat", hw: o.hw });
          lb.pieces.forEach((pc, i) => {
            var _a2, _b2;
            const lines = [];
            if (ctx.lodAtLeast("mid")) {
              const p = lb.at(to - ((_a2 = o.cuffLen) != null ? _a2 : 0.075)), q = lb.at(to - ((_b2 = o.cuffLen) != null ? _b2 : 0.075) + 0.03), dir = G.norm(G.sub(q, p)), n = G.perp(dir), hw = lb.hw(to - 0.07);
              lines.push({ d: brush([G.add(p, G.mul(n, -hw * 1.1)), G.add(p, G.mul(n, hw * 1.1))], 0.02 * hh), fill: "deep", o: 0.55 });
              if (o.cuffButton !== false) {
                const bp = G.add(G.lerp(p, q, 1.8), G.mul(n, hw * 0.45 * (s === "R" ? 1 : -1)));
                lines.push({ d: G.ellipse(bp[0], bp[1], 0.013 * hh), fill: "deep", o: 0.85 });
              }
            }
            out.push({ id: `${o.prefix}-cuff-${s}${lb.pieces.length > 1 ? i : ""}`, z: A.z + 0.6 + (pc.seg === "lower" ? A.foreFront ? 0.05 : -0.05 : 0), d: pc.d, mat: o.cuffMat || mat, pattern: o.cuffMat ? void 0 : o.pattern, lines, light: { form: 0.8 } });
          });
        }
        return out;
      }
      function buildCoat(ctx, opts, S) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
        const { R, hh, Z } = ctx;
        const o = { ...S, ...opts, prefix: S.prefix || S.name };
        const F = frame(ctx, opts, S);
        const kind = S.kind || "wool";
        const mat = ctx.mat(opts.color || S.color, opts.kind || kind);
        const wantBelt = (_a = opts.belt) != null ? _a : S.belt, wantEpaulettes = (_b = opts.epaulettes) != null ? _b : S.epaulettes;
        ctx.outerBelt = !!wantBelt;
        F.mat = mat;
        const metal = opts.buttonColor || S.buttonColor ? ctx.mat(opts.buttonColor || S.buttonColor, "metal") : null;
        F.btnFill = metal ? metal.base : mat.deep;
        o.collarMat = opts.collarColor || S.collarColor ? ctx.mat(opts.collarColor || S.collarColor, S.collarKind || "wool") : null;
        o.sleeveTo = (_d = (_c = opts.sleeveTo) != null ? _c : S.sleeveTo) != null ? _d : 0.95;
        o.sleeveEase = (_e = S.sleeveEase) != null ? _e : 0.05;
        const pieces = [];
        const fx = { shade: [], lit: [], lines: [], over: [], deep: [] };
        const lp = lapelPieces(F, mat, { ...o, lapel: F.high ? "none" : (_f = opts.lapel) != null ? _f : S.lapel, lapelW: (_g = opts.lapelW) != null ? _g : S.lapelW });
        fx.shade.push(...lp.shade);
        const up = ((_h = opts.collar) != null ? _h : S.collar) === "up";
        if (!F.high && up) pieces.push(...collarUp(F, mat, o));
        if (F.high) pieces.push(...standCollar(F, mat, { ...o, ...S.standCollar || {} }));
        pieces.push(...lp.pieces.filter((p) => !up || /-lapel-/.test(p.id)));
        if (ctx.lodAtLeast("mid") && !F.high && F.vd > 0.1) {
          for (const s of ["R", "L"]) {
            const N = F.t.pts[s].neck, V = F.Vs[s], k = R.sx(s);
            pieces.push({ id: `${o.prefix}-vshadow-${s}`, z: Z.outer + 0.2, d: brush([[N[0] - k * 0.01 * hh, N[1] + 0.1 * hh], G.lerp(N, V, 0.5).map((v, i) => i ? v : v - k * 0.015 * hh), [V[0] - k * 0.01 * hh, V[1] - 0.04 * hh]], [2e-3 * hh, 0.05 * hh, 2e-3 * hh]), mat: ctx.mat(mat.deep, "flat"), opacity: 0.3, light: false });
          }
        }
        const pl = planes(F, S.planes || {});
        fx.shade.push(...pl.shade);
        fx.lines.push(...pl.lines);
        if (ctx.lodAtLeast("mid")) fx.lines.push(...foldsFn(ctx, F.t, { hemFolds: false, waist: !!(S.pinch || wantBelt) }));
        addPockets(F, S.pockets, fx);
        if (ctx.lodAtLeast("mid") && !F.open && S.pull !== false && (S.buttons || S.rows)) {
          const Yb = hemAt(R, S.btnTo || ["waist", 0]);
          for (const s2 of ["R", "L"]) {
            const k2 = R.sx(s2), lit2 = s2 === "R";
            const p0 = R.torsoPt(k2 * 0.05 * hh, Yb), p1 = R.torsoPt(k2 * 0.22 * hh, Yb - 0.07 * hh), p2 = R.torsoPt(k2 * 0.36 * hh, Yb - 0.1 * hh);
            fx.lines.push(W(ctx, [p0, p1, p2], [2e-3, lit2 ? 0.016 : 0.024, 2e-3], lit2 ? "shade" : "deep", lit2 ? 0.6 : 0.5));
            const q1 = R.torsoPt(k2 * 0.2 * hh, Yb + 0.08 * hh), q2 = R.torsoPt(k2 * 0.32 * hh, Yb + 0.14 * hh);
            fx.lines.push(W(ctx, [p0, q1, q2], [2e-3, 0.012, 2e-3], "shade", 0.45));
          }
        }
        if (S.extras) S.extras(ctx, F, { mat, fx, pieces, o, opts });
        const rowsOver = [];
        const rows = (_j = (_i = opts.rows) != null ? _i : S.rows) != null ? _j : 1;
        const Yf0 = F.vd > 0.1 ? F.V[1] : F.nb + ((_k = S.btnTop) != null ? _k : 0.2) * hh;
        if (S.front !== false && !F.open) {
          const Y0 = Yf0 + ((_l = S.edgeDy) != null ? _l : 0) * hh, Y1 = F.hem - 0.06 * hh;
          const c = [0, 0.5, 1].map((f) => {
            const Y = Y0 + (Y1 - Y0) * f;
            return S.edgeRx != null ? F.X("R", -S.edgeRx, Y) : R.torsoPt(-0.012 * hh, Y);
          });
          fx.lines.push({ d: brush(c, [2e-3 * hh, 0.011 * hh, 5e-3 * hh]), fill: "deep", o: 0.75 });
        }
        const nBtn = opts.buttons === false ? 0 : (_n = (_m = opts.buttons) != null ? _m : S.buttons) != null ? _n : 0;
        if (nBtn && !F.open || F.open && S.buttonsOpen) {
          const from = Yf0 + (S.btnFromDy || 0) * hh, to = hemAt(R, S.btnTo || ["hip", 0]);
          const r = ((_o = S.btnR) != null ? _o : 0.024) * hh, span = (_p = S.btnSpan) != null ? _p : 1;
          const per = rows === 2 ? Math.ceil(nBtn / 2) : nBtn;
          const ys = [];
          for (let i = 0; i < per; i++) ys.push(from + (per > 1 ? (to - from) * span * i / (per - 1) : 0));
          const cols = rows === 2 ? [-((_q = S.rowX) != null ? _q : 0.3), (_r = S.rowX) != null ? _r : 0.3] : [0];
          for (const cx of cols) for (const Y of ys) {
            const c = R.torsoPt(rows === 2 ? cx * F.Wd(Y) : (S.btnDx || 0) * hh, Y);
            rowsOver.push(...btn(ctx, c, r, F.btnFill));
          }
        }
        const lines = fx.lines, over = [...fx.over, ...rowsOver];
        const lit = fx.lit.map((l) => ({ d: l.d, o: l.o }));
        const bodyLight = { form: 1 };
        if (F.open) {
          for (const s of ["R", "L"]) pieces.push({ id: `${o.prefix}-body-${s}`, yoke: true, z: Z.outer, d: panelD(F, s), mat, pattern: o.pattern, shade: fx.shade, lit, lines, over: s === "L" ? over : over.slice(0, 0), light: bodyLight });
        } else pieces.push({ id: `${o.prefix}-body`, yoke: true, z: Z.outer, d: bodyD(F), mat, pattern: o.pattern, shade: fx.shade, lit, lines, over, light: bodyLight });
        const hw = S.sleeveHw;
        pieces.push(...sleevesFn(ctx, mat, { to: o.sleeveTo, ease: o.sleeveEase, pattern: o.pattern, prefix: o.prefix, zAdd: 0.5, cuff: false, hw, hemBand: 0, cap: S.cap }).map((p) => {
          if (p.id && /arm-.*hemshadow/.test(p.id)) return null;
          return p;
        }).filter(Boolean));
        if (S.cuffs !== false) pieces.push(...cuffPieces(F, mat, { ...o, hw }));
        if (S.cuffStrap) {
          for (const s2 of ["R", "L"]) {
            const A = R.arms[s2], lb = ctx.body.limb("arm", s2, { ease: o.sleeveEase + 0.025, from: o.sleeveTo - 0.2, to: o.sleeveTo - 0.145, capStart: "flat", hw });
            lb.pieces.forEach((pc, i) => pieces.push({ id: `${o.prefix}-cuff-strap-${s2}${i}`, z: A.z + 0.62, d: pc.d, mat, light: { form: 0.8 } }));
          }
        }
        if (S.sleeveExtras) S.sleeveExtras(ctx, F, { mat, pieces, o });
        if (wantEpaulettes) pieces.push(...epaulettes(F, mat, o));
        if (wantBelt) pieces.push(...beltPieces(F, mat, { ...o, beltMat: S.beltColor ? ctx.mat(S.beltColor, "leather") : void 0 }));
        pieces.push(...pocketHands(F, mat, o));
        return pieces;
      }
      module.exports = { buildCoat, frame, hemAt, crisp, W, btn, lapelShapes, standCollar, collarUp, epaulettes, beltPieces, flapPocket, patchPocket, weltPocket, clamp };
    }
  });

  // src/parts/outer/leather.js
  var require_leather = __commonJS({
    "src/parts/outer/leather.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var C = require_coat();
      var G = require_geom();
      function sleeveSheen(ctx, F, { pieces }) {
        if (!ctx.lodAtLeast("mid")) return;
        const { R, hh } = ctx;
        for (const p of pieces) {
          const m = /sleeve-(R|L)-(upper|lower|whole)/.exec(p.id || "");
          if (!m) continue;
          const lb = ctx.body.limb("arm", m[1], { ease: 0.07, to: 0.95 });
          const k = R.sx(m[1]);
          const seg = m[2] === "upper" ? [0.08, 0.3] : m[2] === "lower" ? [Math.max(lb.split + 0.04, 0.5), 0.88] : [0.1, 0.8];
          const pts = [seg[0], (seg[0] + seg[1]) / 2, seg[1]].map((u) => {
            const c = lb.at(u);
            return [c[0] - k * lb.hw(u) * 0.35, c[1]];
          });
          p.lines = [...p.lines || [], C.W(ctx, pts, [3e-3, 0.034, 3e-3], "light", 0.5)];
        }
      }
      function leatherExtras(style) {
        return (ctx, F, { mat, fx, pieces, opts }) => {
          const { R, hh } = ctx, y = R.y;
          if (style === "biker" && ctx.lodAtLeast("mid")) {
            const a = F.V, b = F.X("L", 0.32, y.waist + 0.2 * hh), m = G.lerp(a, b, 0.5);
            fx.lines.push(C.W(ctx, [a, m, b], [4e-3, 0.026, 0.01], "deep", 0.85));
            fx.lines.push(C.W(ctx, [[a[0] + 0.012 * hh, a[1]], [m[0] + 0.012 * hh, m[1]], [b[0] + 0.012 * hh, b[1]]], [3e-3, 8e-3, 5e-3], "light", 0.7));
            for (const s of ["R", "L"]) {
              const sh = C.lapelShapes(F, s, "wide", { lapelW: 1.15 });
              if (sh.tip) fx.over.push(...C.btn(ctx, [sh.tip[0] - R.sx(s) * 0.05 * hh, sh.tip[1] + 0.07 * hh], 0.017 * hh, "metal-steel", false));
            }
          }
          if (ctx.lodAtLeast("mid")) {
            const a = F.X("R", 0.7, y.chest - 0.4 * hh), b = F.X("R", 0.62, y.chest + 0.15 * hh), c2 = F.X("R", 0.58, y.waist + 0.1 * hh);
            fx.lines.push(C.W(ctx, [a, b, c2], [3e-3, 0.05, 3e-3], "light", 0.45));
          }
          if (ctx.lodAtLeast("mid")) for (const s of ["R", "L"]) {
            if (R.arms[s].pose === "pocket") continue;
            const k = R.sx(s), p = F.X(s, 0.56, y.hip - 0.12 * hh), q = F.X(s, 0.8, y.hip + 0.2 * hh);
            fx.lines.push(C.W(ctx, [p, G.lerp(p, q, 0.5), q], [4e-3, 0.014, 6e-3], "deep", 0.8));
            fx.lines.push(C.W(ctx, [[p[0] - k * 0.01 * hh, p[1] - 0.012 * hh], [q[0] - k * 0.01 * hh, q[1] - 0.012 * hh]], [4e-3, 4e-3], "light", 0.55));
          }
        };
      }
      var BIKER = {
        name: "leather-jacket",
        color: "cloth-black",
        kind: "leather",
        ease: 0.07,
        hem: ["hip", 0.1],
        pinch: 0.035,
        shoulderDrop: 0.035,
        vDepth: 1,
        openDepth: 1.35,
        gapB: 0.03,
        gapH: 0.3,
        lapel: "wide",
        lapelW: 1.2,
        epaulettes: true,
        belt: true,
        beltDy: 0.1,
        beltH: 0.065,
        beltTail: false,
        buckle: "metal-steel",
        front: true,
        pull: false,
        sleeveTo: 0.97,
        sleeveEase: 0.06,
        cuffLen: 0.07,
        cuffButton: false,
        sleeveHw: (u, b) => b * (1 - 0.04 * u),
        pockets: [],
        extras: leatherExtras("biker"),
        sleeveExtras: sleeveSheen
      };
      var DRIVING = {
        ...BIKER,
        neck: "high",
        lapel: "none",
        belt: false,
        epaulettes: false,
        vDepth: 0.62,
        ease: 0.075,
        hem: ["hip", 0.12],
        standCollar: { h: 0.19, gap: 0.015, drop: 0.07 },
        buttons: 0,
        pockets: [{ type: "welt", at: "hip", dy: 0.06, rx: 0.64, w: 0.3, slant: 0.1, hand: true }],
        extras(ctx, F, args) {
          leatherExtras("driving")(ctx, F, args);
          const { R, hh } = ctx, Y0 = F.high ? F.nb + 0.08 * hh : F.V[1], Y1 = F.hem - 0.05 * hh;
          if (ctx.lodAtLeast("mid")) {
            args.fx.lines.push({ d: G.brush([0, 0.5, 1].map((f) => R.torsoPt(0.012 * hh, Y0 + (Y1 - Y0) * f)), [3e-3 * hh, 8e-3 * hh, 5e-3 * hh]), fill: "light", o: 0.65 });
            args.fx.over.push(...C.btn(ctx, R.torsoPt(-0.05 * hh, F.nb - 0.02 * hh), 0.017 * hh, "metal-steel", false));
          }
        }
      };
      register({
        kind: "outer",
        name: "leather-jacket",
        aliases: ["leather", "driving-jacket"],
        describe: "Black leather jacket for the militant and the racer: collar, asymmetric zip, belt, epaulettes, long leather highlights. style: driving gives a band collar and centre zip.",
        params: { color: "fabric token", style: "biker (default)|driving", open: "true|false", collar: "up|down", belt: "true|false (override the jacket's own belt)", epaulettes: "true|false (override the jacket's own epaulettes)" },
        example: { outfit: { base: { type: "tee", color: "cloth-cream" }, outer: { type: "leather-jacket", color: "cloth-black" } } },
        draw: (ctx, o) => C.buildCoat(ctx, o, o.style === "driving" ? DRIVING : BIKER)
      });
      module.exports = { BIKER, DRIVING };
    }
  });

  // src/parts/outer/longcoats.js
  var require_longcoats = __commonJS({
    "src/parts/outer/longcoats.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var C = require_coat();
      var G = require_geom();
      function trenchExtras(ctx, F, { mat, fx }) {
        const { R, hh } = ctx, P = F.t.pts.R;
        const a = [P.neck[0] + 0.04 * hh * -1, P.neck[1] + 0.2 * hh], c = F.X("R", 0.92, R.y.chest + 0.05 * hh), d = F.X("R", 0.5, R.y.chest + 0.14 * hh), e = F.X("R", 0.34, R.y.chest - 0.3 * hh);
        const flap = C.crisp([P.trap, P.shTop, [c[0], c[1] - 0.12 * hh], c, d, e], [4]);
        fx.shade.push({ d: G.translate(flap, 6e-3 * hh, 0.02 * hh), fill: mat.deep, o: 0.7 });
        fx.lit.push({ d: flap, o: 0.2 });
        fx.over.push(...C.btn(ctx, [d[0] + 0 * hh, d[1] - 0.03 * hh], 0.02 * hh, F.btnFill, false));
        if (ctx.lodAtLeast("mid")) {
          const Y = R.y.waist + 0.04 * hh;
          for (const s of ["R", "L"]) {
            const k = R.sx(s);
            for (const dx of [0.8, 0.45]) {
              const p = R.torsoPt(k * F.Wd(Y) * dx, Y + 0.05 * hh), q = R.torsoPt(k * F.Wd(Y) * (dx + 0.05), F.hem - 0.1 * hh);
              fx.lines.push(C.W(ctx, [p, G.lerp(p, q, 0.5), q], [2e-3, s === "R" ? 0.02 : 0.034, 4e-3], s === "R" ? "shade" : "deep", s === "R" ? 0.5 : 0.55));
            }
            const pa = R.torsoPt(k * F.Wd(Y) * 0.9, Y - 0.04 * hh), pb = R.torsoPt(k * F.Wd(Y) * 0.55, Y - 0.2 * hh);
            fx.lines.push(C.W(ctx, [pa, G.lerp(pa, pb, 0.5), pb], [2e-3, 0.016, 2e-3], "shade", 0.55));
          }
        }
      }
      var TRENCH = {
        name: "trench",
        color: "cloth-stone",
        kind: "cloth",
        ease: 0.13,
        hem: ["shin", 0],
        flare: 0.09,
        shoulderDrop: 0.04,
        vDepth: 1.1,
        openDepth: 1.5,
        gapB: 0.03,
        gapH: 0.4,
        lapel: "wide",
        lapelW: 1.3,
        rows: 2,
        buttons: 10,
        rowX: 0.3,
        btnFromDy: 0.28,
        btnTo: ["crotch", -0.1],
        edgeRx: 0.42,
        edgeDy: 0.08,
        btnR: 0.03,
        pull: false,
        epaulettes: true,
        belt: true,
        beltH: 0.1,
        buckle: "metal-brass",
        sleeveTo: 0.97,
        sleeveEase: 0.08,
        cuffLen: 0.1,
        cuffStrap: true,
        cuffButton: false,
        pockets: [{ type: "welt", at: "hip", dy: 0.16, rx: 0.66, w: 0.34, slant: 0.1, hand: true }],
        extras: trenchExtras
      };
      var PEA = {
        name: "peacoat",
        color: "cloth-navy",
        kind: "wool",
        ease: 0.125,
        hem: ["crotch", 0.5],
        flare: 0.04,
        shoulderDrop: 0.04,
        vDepth: 0.95,
        openDepth: 1.35,
        gapB: 0.03,
        gapH: 0.36,
        lapel: "wide",
        lapelW: 1.4,
        rows: 2,
        buttons: 6,
        rowX: 0.3,
        btnFromDy: 0.32,
        btnTo: ["waist", 0.4],
        edgeRx: 0.42,
        edgeDy: 0.1,
        btnR: 0.036,
        buttonColor: "cloth-black",
        sleeveTo: 0.97,
        sleeveEase: 0.08,
        cuffLen: 0.1,
        pockets: [{ type: "welt", at: "hip", dy: 0.05, rx: 0.64, w: 0.32, slant: 0.16, hand: true }, { type: "welt", at: "chest", dy: 0, rx: 0.6, w: 0.2, slant: -0.01, sides: ["L"] }]
      };
      var OVER = {
        name: "overcoat",
        color: "cloth-charcoal",
        kind: "wool",
        ease: 0.115,
        hem: ["knee", 0.05],
        flare: 0.05,
        shoulderDrop: 0.035,
        vDepth: 1.1,
        openDepth: 1.5,
        gapB: 0.025,
        gapH: 0.36,
        lapel: "notch",
        lapelW: 1.25,
        buttons: 4,
        btnTo: ["waist", 0.2],
        btnR: 0.03,
        edgeRx: 0,
        sleeveTo: 0.96,
        sleeveEase: 0.07,
        cuffLen: 0.09,
        pull: false,
        pockets: [{ type: "flap", at: "hip", dy: 0.14, rx: 0.64, w: 0.36, h: 0.115, slant: 0.03, btn: false, hand: true }, { type: "welt", at: "chest", dy: 0, rx: 0.6, w: 0.22, slant: -0.01, sides: ["L"] }]
      };
      function capeExtras(ctx, F, { mat, fx, pieces, o }) {
        const { R, hh } = ctx, y = R.y;
        for (const s of ["R", "L"]) {
          const k = R.sx(s), P = F.t.pts[s], A = R.arms[s];
          const out = R.w.shoulder + 0.2 * hh, Yh = y.chest + 0.42 * hh;
          const hemSide = R.torsoPt(k * (out - 0.02 * hh), Yh - 0.02 * hh), hemMid = R.torsoPt(k * out * 0.55, Yh + 0.03 * hh), hemCtr = R.torsoPt(k * 0.03 * hh, Yh + 0.06 * hh);
          const pts = [[P.neck[0], P.neck[1], true], P.trap, P.shTop, R.torsoPt(k * (out - 0.08 * hh), y.shoulder + 0.2 * hh), R.torsoPt(k * out, y.chest + 0.12 * hh), [...hemSide, true], hemMid, [...hemCtr, true], [...R.torsoPt(k * 0.025 * hh, y.neckBase + 0.1 * hh), true]];
          const lines = [];
          if (ctx.lodAtLeast("mid")) {
            for (const [fx0, fx1, w] of [[0.3, 0.42, 0.03], [0.55, 0.72, 0.024], [0.8, 0.95, 0.018]]) {
              const a = R.torsoPt(k * out * fx0, y.shoulder + 0.3 * hh), b = R.torsoPt(k * out * fx1, Yh - 0.02 * hh);
              lines.push(C.W(ctx, [a, G.lerp(a, b, 0.5), b], [2e-3, w, 2e-3], k > 0 ? "deep" : "shade", 0.6));
            }
            lines.push(C.W(ctx, [R.torsoPt(k * (out - 0.01 * hh), Yh - 0.035 * hh), R.torsoPt(k * out * 0.55, Yh), R.torsoPt(k * 0.03 * hh, Yh + 0.03 * hh)], [0.012, 0.018, 0.018], "deep", 0.5));
          }
          pieces.push({ id: `${o.prefix}-cape-${s}`, z: 46.8, d: G.smooth(pts, true, 0.4), mat, pattern: o.pattern, lines, light: { form: 1 }, over: s === "R" ? C.btn(ctx, R.torsoPt(0, y.neckBase + 0.12 * hh), 0.036 * hh, F.btnFill) : [] });
        }
      }
      var CAPE = {
        name: "cape-coat",
        color: "cloth-rust",
        kind: "wool",
        ease: 0.1,
        hem: ["knee", -0.05],
        flare: 0.22,
        shoulderDrop: 0.04,
        neck: "v",
        vDepth: 0.55,
        openDepth: 1.2,
        gapB: 0.03,
        gapH: 0.4,
        lapel: "flap",
        buttons: 0,
        front: false,
        pull: false,
        sleeveTo: 0.97,
        sleeveEase: 0.065,
        cuffLen: 0.08,
        cuffButton: false,
        pockets: [],
        extras: capeExtras
      };
      function fleeceExtras(ctx, F, { mat, fx, pieces, o, opts }) {
        const { R, hh } = ctx, fm = ctx.mat(opts.fleeceColor || "cloth-white", "knit"), rng = ctx.rng;
        for (const s of ["R", "L"]) {
          const k = R.sx(s), N0 = F.t.pts[s].neck, V = F.Vs[s];
          const hemY = F.hem - 0.04 * hh, wide = 0.2 * hh;
          const edge = [[N0[0] + k * 0.07 * hh, N0[1] - 0.2 * hh], [N0[0] + k * 0.3 * hh, N0[1] - 0.12 * hh], [N0[0] + k * 0.44 * hh, N0[1] + 0.2 * hh], [V[0] + k * (wide + 0.12 * hh), V[1] - 0.2 * hh], [V[0] + k * wide, V[1] + 0.2 * hh], [R.torsoPt(k * wide, hemY)[0], hemY]];
          const dense = G.resample(edge, 22, 0.5).map((p, i, a) => i === 0 || i === a.length - 1 ? p : [p[0] + (rng() - 0.5) * 0.04 * hh, p[1] + (rng() - 0.5) * 0.03 * hh]);
          const inner = [[V[0], hemY], [V[0], V[1]], [N0[0], N0[1]], [N0[0] - k * 0.075 * hh, N0[1] - 0.17 * hh]];
          const d = G.smooth([...dense, ...inner.map((p) => [p[0], p[1], true])], true, 0.3);
          const lines = ctx.lodAtLeast("mid") ? [{ d: G.brush(dense.filter((_, i) => i % 2 === 0).slice(2), 0.05 * hh), fill: "shade", o: 0.5, stip: true }, { d: G.brush([dense[5], dense[10], dense[16]].map((p) => [p[0] - k * 0.03 * hh, p[1]]), [4e-3 * hh, 0.03 * hh, 4e-3 * hh]), fill: "shade", o: 0.4 }] : [];
          pieces.push({ id: `${o.prefix}-fleece-${s}`, z: ctx.Z.collar, d, mat: fm, lines, light: { form: 0.7 } });
        }
      }
      var SHEAR = {
        name: "shearling",
        color: "cloth-faded-denim",
        kind: "denim",
        ease: 0.1,
        hem: ["hip", 0.28],
        pinch: 0.02,
        shoulderDrop: 0.035,
        vDepth: 0.9,
        openDepth: 1.3,
        gapB: 0.03,
        gapH: 0.4,
        lapel: "none",
        buttons: 0,
        front: false,
        pull: false,
        sleeveTo: 0.97,
        sleeveEase: 0.075,
        cuffLen: 0.09,
        epaulettes: false,
        pockets: [{ type: "flap", at: "chest", dy: 0.15, rx: 0.56, w: 0.3, h: 0.13, btn: true, hand: false }, { type: "welt", at: "hip", dy: 0.1, rx: 0.66, w: 0.3, slant: 0.1, hand: true }],
        extras: fleeceExtras
      };
      var ex = (type, color, o = {}) => ({ outfit: { base: { type: "shirt", color: "cloth-white" }, neck: { type: "tie", color: "cloth-red" }, outer: { type, color, ...o } } });
      var reg = (name, S, describe, example, params, aliases) => register({
        kind: "outer",
        name,
        aliases,
        describe,
        params: { color: "fabric token", pattern: "textile name", open: "true|false (hangs open)", belt: "true|false (override the coat's own belt)", epaulettes: "true|false (override the coat's own epaulettes)", ...params },
        example,
        draw: (ctx, o) => C.buildCoat(ctx, o, S)
      });
      reg(
        "trench",
        TRENCH,
        "Belted double-breasted trench (the Hound): wide lapels, epaulettes, gun flap, cuff straps, hem below the knee; collar: up pops the collar.",
        ex("trench", "cloth-stone"),
        { collar: "up|down", belt: "true (default)|false", buttonColor: "metal token" },
        ["trenchcoat"]
      );
      reg(
        "peacoat",
        PEA,
        "Navy double-breasted peacoat for the dock heavy: big notch collar, six large buttons, slash pockets, mid-thigh.",
        ex("peacoat", "cloth-navy"),
        { collar: "up|down", buttonColor: "token" },
        ["pea-coat"]
      );
      reg(
        "overcoat",
        OVER,
        "Single-breasted knee-length overcoat: notch lapels, flap pockets; collarColor adds a velvet collar.",
        ex("overcoat", "cloth-charcoal"),
        { collarColor: "token (e.g. velvet)", collar: "up|down" },
        ["coat"]
      );
      reg(
        "cape-coat",
        CAPE,
        "60s swing coat in rust: A-line to the knee with a short shoulder cape (to the upper arm) and one big neck button.",
        { outfit: { base: { type: "tee", color: "cloth-cream" }, outer: { type: "cape-coat", color: "cloth-rust" } } },
        {},
        ["swing-coat"]
      );
      reg(
        "shearling",
        SHEAR,
        "Denim-blue jacket with a white fleece collar and front band (the Hull plate); fleeceColor token.",
        { outfit: { base: { type: "tee", color: "cloth-cream" }, outer: { type: "shearling", color: "cloth-faded-denim" } } },
        { fleeceColor: "token (default cloth-white)" },
        ["sherpa-jacket"]
      );
      module.exports = { TRENCH, PEA, OVER, CAPE, SHEAR };
    }
  });

  // src/parts/outer/military.js
  var require_military = __commonJS({
    "src/parts/outer/military.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var C = require_coat();
      var G = require_geom();
      function drawstring(ctx, F, { fx }) {
        if (!ctx.lodAtLeast("mid")) return;
        const { R, hh } = ctx, Y = R.y.waist + 0.08 * hh;
        fx.lines.push(C.W(ctx, [R.torsoPt(-F.Wd(Y), Y), R.torsoPt(0, Y + 0.015 * hh), R.torsoPt(F.Wd(Y), Y)], [4e-3, 0.012, 4e-3], "deep", 0.55));
        for (const s of ["R", "L"]) {
          const k = R.sx(s), lit = s === "R";
          for (const [dx, dy, len] of [[0.9, -0.1, 0.32], [0.62, -0.1, 0.26]]) {
            const a = R.torsoPt(k * F.Wd(Y) * dx, Y), b = R.torsoPt(k * F.Wd(Y) * (dx - len), Y - 0.16 * hh);
            fx.lines.push(C.W(ctx, [a, G.lerp(a, b, 0.5), b], [2e-3, lit ? 0.014 : 0.022, 2e-3], "shade", lit ? 0.5 : 0.7));
          }
          const a2 = R.torsoPt(k * F.Wd(Y) * 0.85, Y + 0.02 * hh), b2 = R.torsoPt(k * F.Wd(Y) * 0.6, Y + 0.2 * hh);
          fx.lines.push(C.W(ctx, [a2, G.lerp(a2, b2, 0.5), b2], [2e-3, 0.016, 2e-3], "shade", 0.5));
        }
      }
      var FIELD = {
        name: "field-jacket",
        color: "cloth-olive",
        kind: "canvas",
        ease: 0.1,
        hem: ["hip", 0.3],
        pinch: 0.085,
        flare: 0.05,
        shoulderDrop: 0.07,
        neck: "v",
        vDepth: 0.55,
        openDepth: 1.3,
        gapB: 0.03,
        gapH: 0.34,
        lapel: "flap",
        standCollar: { h: 0.21, gap: 0.02, drop: 0.1, splay: 0.01 },
        epaulettes: true,
        buttons: 5,
        btnTop: 0.3,
        btnTo: ["hip", 0.1],
        btnR: 0.02,
        sleeveTo: 0.97,
        sleeveEase: 0.075,
        cuffLen: 0.09,
        pockets: [
          { type: "flap", at: "chest", dy: 0.08, rx: 0.5, w: 0.38, h: 0.15, point: true, btn: true, bellows: true },
          { type: "flap", at: "hip", dy: -0.02, rx: 0.64, w: 0.42, h: 0.16, point: true, btn: true, bellows: true, hand: true }
        ],
        extras: drawstring
      };
      var TACT = {
        name: "tactical-jacket",
        color: "cloth-black",
        kind: "cloth",
        ease: 0.055,
        hem: ["hip", 0.14],
        pinch: 0.05,
        coverLower: true,
        shoulderDrop: 0.07,
        neck: "high",
        vDepth: 0.62,
        openDepth: 1.3,
        gapB: 0.03,
        gapH: 0.3,
        lapel: "flap",
        standCollar: { h: 0.23, gap: 0.015, drop: 0.09 },
        buttons: 0,
        front: true,
        pull: false,
        sleeveTo: 0.97,
        sleeveEase: 0.05,
        sleeveHw: (u, b) => b * (1 - 0.05 * u),
        cuffLen: 0.08,
        cuffButton: false,
        pockets: [
          { type: "patch", at: "chest", dy: -0, rx: 0.52, w: 0.3, h: 0.16, zip: true, sides: ["L"] },
          { type: "welt", at: "hip", dy: 0.1, rx: 0.62, w: 0.26, slant: 0.08, hand: true }
        ],
        extras(ctx, F, { mat, fx, pieces, o, opts }) {
          const { R, hh } = ctx;
          const Y0 = F.high ? F.nb + 0.1 * hh : F.V[1], Y1 = F.hem - 0.06 * hh;
          if (ctx.lodAtLeast("mid")) {
            const zp = [0, 0.5, 1].map((f) => R.torsoPt(0.012 * hh, Y0 + (Y1 - Y0) * f));
            fx.lines.push({ d: G.brush(zp, [3e-3 * hh, 7e-3 * hh, 5e-3 * hh]), fill: "light", o: 0.6 });
            fx.over.push({ d: G.brush([R.torsoPt(0.012 * hh, Y0), R.torsoPt(0.014 * hh, Y0 + 0.09 * hh)], [0.014 * hh, 0.01 * hh]), fill: "metal-steel" });
          }
          if (opts.straps !== false) {
            const sm = ctx.mat(opts.strapColor || "cloth-graphite", "canvas");
            for (const s of ["R", "L"]) {
              const k = R.sx(s), a = F.t.pts[s].trap, Yc = R.y.chest;
              const pts = [[a[0] - k * 0.06 * hh, a[1] - 0.01 * hh], R.torsoPt(k * 0.5 * F.Wd(R.y.shoulder + 0.4 * hh), R.y.shoulder + 0.45 * hh), R.torsoPt(k * 0.46 * F.Wd(Yc), Yc + 0.1 * hh), R.torsoPt(k * 0.4 * F.Wd(R.y.waist), R.y.waist - 0.1 * hh)];
              const lines = [];
              if (ctx.lodAtLeast("mid")) {
                lines.push(C.W(ctx, [pts[1], pts[2], pts[3]].map((p) => [p[0] + k * 0.05 * hh, p[1]]), [3e-3, 0.015, 3e-3], "light", 0.3));
              }
              const over = [];
              if (ctx.lodAtLeast("mid")) for (const f of [0.35, 0.78]) {
                const p = G.lerp(pts[1], pts[3], f);
                over.push({ d: G.poly([[p[0] - 0.07 * hh, p[1] - 0.012 * hh], [p[0] + 0.07 * hh, p[1] - 0.012 * hh], [p[0] + 0.07 * hh, p[1] + 0.012 * hh], [p[0] - 0.07 * hh, p[1] + 0.012 * hh]]), fill: "metal-steel", o: 0.8 });
              }
              pieces.push({ id: `tactical-strap-${s}`, z: ctx.Z.strap, d: G.brush(pts, [0.15 * hh, 0.15 * hh, 0.14 * hh, 0.14 * hh]), mat: sm, lines, over, light: { form: 0.8 } });
            }
          }
        }
      };
      var WATCH = {
        name: "watch-tunic",
        color: "cloth-ink-blue",
        kind: "wool",
        ease: 0.085,
        hem: ["crotch", 0.14],
        pinch: 0.02,
        shoulderDrop: 0.03,
        neck: "high",
        openDepth: 1.3,
        gapB: 0.03,
        gapH: 0.3,
        lapel: "none",
        standCollar: { h: 0.21, gap: -4e-3, drop: 0.07 },
        epaulettes: true,
        belt: true,
        beltColor: "leather-black",
        buckle: "metal-brass",
        beltH: 0.12,
        buttons: 6,
        btnTop: 0.12,
        btnTo: ["waist", -0.05],
        btnR: 0.027,
        buttonColor: "metal-brass",
        sleeveTo: 0.96,
        sleeveEase: 0.055,
        cuffLen: 0.08,
        pockets: [
          { type: "flap", at: "chest", dy: 0.12, rx: 0.5, w: 0.27, h: 0.105, btn: true, sides: ["R"] },
          { type: "flap", at: "hip", dy: 0.02, rx: 0.64, w: 0.3, h: 0.115, btn: true, hand: true }
        ],
        extras(ctx, F, { mat, fx, pieces, opts }) {
          const { R, hh } = ctx, brass = ctx.mat("metal-brass", "metal");
          for (const s of ["R", "L"]) {
            const k = R.sx(s), c = R.torsoPt(k * (R.w.neckBase + 0.1 * hh), F.nb - 0.05 * hh);
            pieces.push({ id: `watch-insignia-${s}`, z: ctx.Z.collar + 0.3, d: G.poly([[c[0] - 0.05 * hh, c[1] - 0.012 * hh], [c[0] + 0.05 * hh, c[1] - 0.012 * hh], [c[0] + 0.05 * hh, c[1] + 0.012 * hh], [c[0] - 0.05 * hh, c[1] + 0.012 * hh]]), mat: brass, spot: true, light: { form: 0.5 } });
          }
          if (opts.badge !== false) {
            const Y = R.y.chest - 0.12 * hh, c = F.X("L", 0.52, Y), w = 0.15 * hh, h = 0.19 * hh;
            const d = C.crisp([[c[0] - w / 2, Y], [c[0] + w / 2, Y], [c[0] + w / 2, Y + h * 0.55], [c[0], Y + h], [c[0] - w / 2, Y + h * 0.55]], []);
            pieces.push({ id: "watch-badge", z: ctx.Z.collar + 0.3, d, mat: brass, spot: true, over: [{ d: G.ellipse(c[0], Y + h * 0.4, 0.03 * hh), fill: "ink-900", o: 0.8 }], light: { form: 0.6 } });
          }
        }
      };
      var ex = (type, color, outfit = {}) => ({ outfit: { base: { type: "tee", color: "cloth-cream" }, ...outfit, outer: { type, color } } });
      register({
        kind: "outer",
        name: "field-jacket",
        aliases: ["m65", "army-jacket"],
        describe: "Olive M65-style field jacket (Booker): spread collar, epaulettes, four bellows flap pockets, drawstring waist, snap placket, elbow folds. zip: up zips it to a stand collar.",
        params: { color: "fabric token", open: "true|false (unzipped, hangs open)", zip: "up|half (default half)", pattern: "textile name", epaulettes: "true|false" },
        example: ex("field-jacket", "cloth-olive"),
        draw: (ctx, o) => C.buildCoat(ctx, o, FIELD)
      });
      register({
        kind: "outer",
        name: "tactical-jacket",
        aliases: ["tactical"],
        describe: "Black fitted zip-up tactical jacket (Stacey): stand collar, zip chest pocket, harness shoulder straps (strapColor), zip hip pockets. zip: half opens the collar.",
        params: { color: "fabric token", open: "true|false", zip: "up (default)|half", straps: "true|false", strapColor: "fabric token" },
        example: ex("tactical-jacket", "cloth-black", { base: { type: "tee", color: "cloth-graphite" } }),
        draw: (ctx, o) => C.buildCoat(ctx, o, TACT)
      });
      register({
        kind: "outer",
        name: "watch-tunic",
        aliases: ["tunic", "uniform"],
        describe: "Navy belted tunic for the City Watch: brass buttons, stand collar with insignia, epaulettes, flap pockets, badge on the left chest.",
        params: { color: "fabric token", badge: "true|false", buttonColor: "metal token", open: "true|false", belt: "true|false (override the tunic's own belt)", epaulettes: "true|false (override the tunic's own epaulettes)" },
        example: ex("watch-tunic", "cloth-ink-blue", { base: { type: "shirt", color: "cloth-white" } }),
        draw: (ctx, o) => C.buildCoat(ctx, o, WATCH)
      });
      module.exports = { FIELD, TACT, WATCH };
    }
  });

  // src/parts/outer/tailored.js
  var require_tailored = __commonJS({
    "src/parts/outer/tailored.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var C = require_coat();
      var G = require_geom();
      function pocketSquare(ctx, F, { opts, pieces }) {
        if (!opts.pocketSquare) return;
        const { R, hh } = ctx;
        const sq = ctx.mat(opts.pocketSquare === true ? "cloth-white" : opts.pocketSquare, "cloth");
        const Y = R.y.chest - 0.03 * hh, c = F.X("L", 0.6, Y), w = 0.2 * hh;
        const d = C.crisp([[c[0] - w / 2, Y + 0.012 * hh], [c[0] - w * 0.42, Y - 0.1 * hh], [c[0] - w * 0.12, Y - 0.05 * hh], [c[0] + w * 0.1, Y - 0.12 * hh], [c[0] + w * 0.4, Y - 0.06 * hh], [c[0] + w / 2, Y + 0.012 * hh]]);
        pieces.push({ id: "pocket-square", z: ctx.Z.collar + 0.2, d, mat: sq, spot: true, lines: ctx.lodAtLeast("mid") ? [C.W(ctx, [[c[0] - w * 0.1, Y - 0.04 * hh], [c[0] + w * 0.05, Y - 0.02 * hh]], [2e-3, 0.02, 2e-3], "shade", 0.6)] : [], light: { form: 0.6 } });
      }
      var SUIT = {
        name: "suit-jacket",
        color: "cloth-charcoal",
        kind: "wool",
        ease: 0.075,
        hem: ["crotch", 0.1],
        pinch: 0.04,
        shoulderDrop: 0.035,
        vDepth: 1.12,
        openDepth: 1.4,
        gapB: 0.02,
        gapH: 0.3,
        lapel: "notch",
        buttons: 2,
        btnTo: ["waist", -0.1],
        sleeveTo: 0.93,
        sleeveEase: 0.05,
        sleeveHw: (u, b) => b * (1 - 0.06 * u),
        pockets: [
          { type: "flap", at: "hip", dy: 0.08, rx: 0.62, w: 0.3, h: 0.1, slant: 0, btn: false, hand: true },
          { type: "welt", at: "chest", dy: -0.02, rx: 0.6, w: 0.22, slant: -0.015, sides: ["L"] }
        ],
        extras: pocketSquare
      };
      var BLAZER = {
        ...SUIT,
        name: "blazer",
        color: "cloth-navy",
        buttonColor: "metal-brass",
        buttons: 2,
        vDepth: 1.18,
        ease: 0.08,
        pockets: [
          { type: "patch", at: "hip", dy: 0.06, rx: 0.62, w: 0.3, h: 0.24, hand: true },
          { type: "patch", at: "chest", dy: -0.02, rx: 0.6, w: 0.22, h: 0.15, sides: ["L"] }
        ],
        btnR: 0.027
      };
      var DB = {
        ...SUIT,
        name: "double-breasted",
        color: "cloth-mustard",
        ease: 0.085,
        hem: ["crotch", 0.12],
        vDepth: 0.98,
        openDepth: 1.3,
        lapel: "peak",
        lapelW: 1.15,
        rows: 2,
        buttons: 6,
        rowX: 0.3,
        btnFromDy: 0.28,
        btnTo: ["waist", 0.16],
        edgeRx: 0.42,
        edgeDy: 0.1,
        btnR: 0.027,
        buttonColor: null,
        buttonsOpen: false
      };
      var NEHRU = {
        name: "nehru",
        color: "cloth-rust",
        kind: "wool",
        ease: 0.065,
        hem: ["crotch", 0.14],
        pinch: 0.03,
        shoulderDrop: 0.03,
        neck: "high",
        standCollar: { h: 0.21, gap: 0.02, drop: 0.08 },
        openDepth: 1.3,
        gapB: 0.03,
        gapH: 0.28,
        buttons: 7,
        btnTop: 0.12,
        btnTo: ["hip", 0.12],
        btnR: 0.02,
        sleeveTo: 0.94,
        sleeveEase: 0.05,
        sleeveHw: (u, b) => b * (1 - 0.05 * u),
        lapel: "none",
        pockets: [
          { type: "welt", at: "chest", dy: 0, rx: 0.6, w: 0.2, slant: -0.01, sides: ["L"] },
          { type: "flap", at: "hip", dy: 0.08, rx: 0.62, w: 0.28, h: 0.095, btn: true, hand: true }
        ],
        extras(ctx, F, { fx }) {
          const { R, hh } = ctx;
          for (const dy of [0, -0.1]) fx.over.push(...C.btn(ctx, R.torsoPt(0, F.nb + dy * hh), 0.017 * hh, F.btnFill, false));
        }
      };
      var mk = (name, S, describe, example, params) => register({
        kind: "outer",
        name,
        describe,
        params: { color: "fabric token", pattern: "textile name", open: "true|false (hangs open)", buttons: "count", ...params },
        example,
        draw: (ctx, o) => C.buildCoat(ctx, o, S)
      });
      var base = { base: { type: "shirt", color: "cloth-white" }, neck: { type: "tie", color: "cloth-red" } };
      mk(
        "suit-jacket",
        SUIT,
        "60s slim single-breasted jacket: notch lapels, 2 buttons, flap pockets, breast welt; pocketSquare token optional.",
        { outfit: { ...base, outer: { type: "suit-jacket", color: "cloth-charcoal", pocketSquare: "cloth-white" } } },
        { pocketSquare: "token or true", ease: "0.05-0.12" }
      );
      mk(
        "blazer",
        BLAZER,
        "Navy blazer: notch lapels, brass buttons, patch pockets; pocketSquare optional.",
        { outfit: { ...base, outer: { type: "blazer", color: "cloth-navy" } } },
        { pocketSquare: "token or true", buttonColor: "metal token" }
      );
      mk(
        "double-breasted",
        DB,
        "Double-breasted jacket (the noble, the Characters plate): peak lapels, six buttons, flap pockets; pocketSquare token.",
        { outfit: { ...base, outer: { type: "double-breasted", color: "cloth-mustard", pocketSquare: "cloth-red" } } },
        { pocketSquare: "token or true", buttonColor: "metal token (default tone-on-tone)" }
      );
      mk(
        "nehru",
        NEHRU,
        "Nehru jacket: mandarin stand collar, centre buttons, welt and flap pockets (the intellectual).",
        { outfit: { base: { type: "shirt", color: "cloth-cream" }, outer: { type: "nehru", color: "cloth-rust" } } },
        {}
      );
      module.exports = { SUIT, BLAZER, DB, NEHRU };
    }
  });

  // src/parts/props/armband.js
  var require_armband = __commonJS({
    "src/parts/props/armband.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      var J = require_jewel();
      var INS = null;
      try {
        INS = require_insignia();
      } catch (e) {
        INS = null;
      }
      function armEase(ctx) {
        const O = ctx.S.outfit || {}, t = (s) => O[s] && O[s].type || "";
        if (O.outer) return 0.085;
        if (/cardigan|jumper|sweater|knit/.test(t("mid"))) return 0.06;
        if (/shirt|blouse|turtleneck|knit|tee|polo|jersey/.test(t("base"))) return 0.04;
        if (O.dress) return 0.03;
        return 0.012;
      }
      register({
        kind: "prop",
        name: "armband",
        aliases: ["arm-band"],
        describe: "A band of cloth round the upper arm, over the sleeve, in a bold colour (red by default), with an optional insignia glyph printed on it in the second colour. Follows the arm in any pose; keeps its colour in the spot schemes; in the militants-type gradient maps it is the accent yellow with a dark glyph.",
        params: {
          side: "L (default) | R | both",
          color: "cloth token for the band (alarm-500)",
          insignia: "glyph on the band: fist|torque|star|peace|bolt|eye|key|anchor|cross|crescent|gear|wings",
          color2: "glyph colour token (caution-500: yellow on red, the Militants palette; avoid a white emblem on red)",
          width: "inches along the arm (3)",
          at: "0-1 down the upper arm from the shoulder (0.42)"
        },
        example: { outfit: { outer: { type: "field-jacket", color: "cloth-olive" } }, props: [{ type: "armband", side: "L", insignia: "fist" }] },
        draw(ctx, o) {
          const { G, hh, R } = ctx, out = [];
          const sd = String(o.side || "L").toUpperCase();
          if (o.side && !["L", "R", "BOTH"].includes(sd)) ctx.warn(`armband side "${o.side}" is not valid; choose L, R or both`);
          const sides = sd === "BOTH" ? ["L", "R"] : sd === "R" ? ["R"] : ["L"];
          let glyph = null;
          if (o.insignia != null && o.insignia !== "") {
            const n = String(o.insignia).toLowerCase();
            if (!INS) ctx.warn("armband: the insignia set is unavailable");
            else if (!INS.NAMES.includes(n)) ctx.warn(`armband insignia "${o.insignia}" is not valid; choose from: ${INS.NAMES.join(", ")}`);
            else glyph = (cx, cy, size, rot) => G.rotate(INS.insignia(n, cx, cy, size), rot, [cx, cy]);
          }
          const duo = !!(ctx.scheme && ctx.scheme.map && !ctx.scheme.spotKeep);
          let bandC = duo ? ctx.accent(o.color || "alarm-500") : o.color || "alarm-500";
          let ink = duo ? ctx.accent(o.color2 || "caution-500", "dark") : o.color2 || "caution-500";
          if (duo) {
            const O = ctx.S.outfit || {}, slot = ["outer", "mid", "base"].find((sl) => O[sl] && O[sl].color);
            const sleeve = slot ? O[slot].color : ctx.accent("ink-900", "dark");
            const cands = [ctx.accent(o.color || "alarm-500"), ctx.accent(o.color || "alarm-500", "light"), ctx.accent(o.color || "alarm-500", "dark")];
            bandC = cands.find((c) => ctx.contrast(c, sleeve) >= 3.5) || cands.reduce((a, b) => ctx.contrast(b, sleeve) > ctx.contrast(a, sleeve) ? b : a);
            const glyphs = [ctx.accent(o.color2 || "caution-500", "dark"), ctx.accent(o.color2 || "caution-500", "light")];
            ink = glyphs.find((c) => ctx.contrast(c, bandC) >= 3.5) || glyphs.reduce((a, b) => ctx.contrast(b, bandC) > ctx.contrast(a, bandC) ? b : a);
          }
          const cloth = ctx.mat(bandC, "cloth");
          for (const side of sides) {
            const b = ctx.bone("arm", side, "upper"), A = R.arms[side];
            const wIn = Math.min(Math.max(+o.width || 3, 1.5), 5), uw = Math.min(0.5, K.inch(wIn) / b.len);
            const uc = Math.min(0.8, Math.max(0.2, o.at == null ? 0.42 : +o.at)), u0 = uc - uw / 2, u1 = uc + uw / 2;
            const hwA = b.hw(uc) + armEase(ctx) * hh, bow = 0.016 + uw * 0.18, z = A.z + 0.6;
            out.push({ id: `armband-${side}`, z, d: J.bandPath(b, u0, u1, hwA, bow), mat: cloth, light: { form: 0.55 }, spot: true });
            if (glyph && ctx.lodAtLeast("mid")) {
              const c = b.bp([uc + bow * 0.35, 0]), up = K.norm(K.sub(b.bp([0, 0]), b.bp([1, 0])));
              out.push({ id: `armband-insignia-${side}`, z: z + 0.01, d: glyph(c[0], c[1], Math.min(K.inch(wIn) * 0.4, hwA * 0.62), Math.atan2(up[0], -up[1])), fill: ink, light: false, spot: true });
            }
          }
          return out;
        }
      });
    }
  });

  // src/parts/props/badges.js
  var require_badges = __commonJS({
    "src/parts/props/badges.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      function star(cx, cy, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
        const pts = [];
        for (let i = 0; i < points * 2; i++) {
          const rr = i % 2 ? r * inner : r, a = rot + i * Math.PI / points;
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
        }
        return pts;
      }
      var INSIGNIA;
      function insigniaOf(ctx, name, label) {
        if (INSIGNIA === void 0) {
          try {
            INSIGNIA = require_insignia();
          } catch (e) {
            INSIGNIA = null;
          }
        }
        if (!INSIGNIA) {
          ctx.warn(`${label}: the insignia set is unavailable`);
          return null;
        }
        const n = String(name).toLowerCase();
        if (!INSIGNIA.NAMES.includes(n)) {
          ctx.warn(`${label} insignia "${name}" is not valid; choose from: ${INSIGNIA.NAMES.join(", ")}`);
          return null;
        }
        return (cx, cy, size) => INSIGNIA.insignia(n, cx, cy, size);
      }
      register({
        kind: "prop",
        name: "badge",
        describe: "Shield-shaped metal badge pinned to the chest (City Watch): chrome rim, dark inset, star, number bar.",
        params: { at: "chest-L (default) | chest-R", shape: "shield|star|round", color: "metal token (metal-chrome)", size: "scale (1)", insignia: "optional glyph for the centre instead of the star: fist|torque|star|peace|bolt|eye|key|anchor|cross|crescent|gear|wings" },
        example: { outfit: { outer: { type: "watch-tunic", color: "cloth-ink-blue" } }, props: [{ type: "badge", at: "chest-L" }] },
        draw(ctx, o) {
          const { G, hh, Z } = ctx;
          const a = K.bodyAnchor(ctx, o.at || "chest-L");
          const s = K.inch(1.25) * (o.size || 1);
          const [cx, cy] = [a.pt[0], a.pt[1] + 0.02 * hh];
          const metal = ctx.mat(o.color || "metal-chrome", "metal");
          const inset = ctx.mat("ink-700", "metal");
          const z = Z.collar + 1.5, shape = o.shape || "shield";
          let rim, inn;
          if (shape === "star") {
            rim = G.poly(star(cx, cy, s * 1.35, 6, 0.55));
            inn = G.circle(cx, cy, s * 0.62);
          } else if (shape === "round") {
            rim = G.circle(cx, cy, s * 1.05);
            inn = G.circle(cx, cy, s * 0.8);
          } else {
            rim = G.smooth([[cx - s * 0.95, cy - s * 1.15], [cx + s * 0.95, cy - s * 1.15], [cx + s * 0.95, cy + s * 0.1], [cx + s * 0.55, cy + s * 0.85], [cx, cy + s * 1.25], [cx - s * 0.55, cy + s * 0.85], [cx - s * 0.95, cy + s * 0.1]].map((p, i) => i < 2 ? [p[0], p[1], true] : p), true, 0.3);
            inn = G.smooth([[cx - s * 0.74, cy - s * 0.95], [cx + s * 0.74, cy - s * 0.95], [cx + s * 0.74, cy + s * 0.05], [cx + s * 0.42, cy + s * 0.65], [cx, cy + s * 0.98], [cx - s * 0.42, cy + s * 0.65], [cx - s * 0.74, cy + s * 0.05]].map((p, i) => i < 2 ? [p[0], p[1], true] : p), true, 0.3);
          }
          const out = [{ id: "badge-rim", z, d: rim, mat: metal, light: { form: 0.7 } }, { id: "badge-inset", z: z + 0.01, d: inn, mat: inset, light: { form: 0.4 } }];
          const glyph = o.insignia ? insigniaOf(ctx, o.insignia, "badge") : null;
          if (glyph) out.push({ id: "badge-insignia", z: z + 0.02, d: glyph(cx, shape === "shield" ? cy - s * 0.12 : cy, s * (shape === "star" ? 0.5 : shape === "round" ? 0.62 : 0.56)), mat: metal, light: { form: 0.5 } });
          else out.push({ id: "badge-star", z: z + 0.02, d: G.poly(star(cx, cy - s * 0.12, s * 0.62, 5, 0.42)), mat: metal, light: { form: 0.5 } });
          if (shape === "shield" && ctx.lodAtLeast("mid")) {
            out.push({ id: "badge-bar", z: z + 0.02, d: K.rrect(cx - s * 0.5, cy + s * 0.5, cx + s * 0.5, cy + s * 0.72, 2), mat: metal, light: false });
            out.push({ id: "badge-dots", z: z + 0.03, d: [-0.55, 0.55].map((dx) => G.circle(cx + dx * s, cy - s * 0.85, s * 0.07)).join(""), fill: "ink-900", light: false });
          }
          return out;
        }
      });
      function pinShapes(ctx, kind, cx, cy, r, z) {
        const { G } = ctx;
        const out = [];
        const id = `pin-${kind}-${out.length}`;
        const disc = (c, rr, fill, zz, extra = {}) => out.push({ id: `${id}-${out.length}`, z: z + zz, d: G.circle(c[0], c[1], rr), fill, light: false, spot: true, ...extra });
        if (kind === "flower") {
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            disc([cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55], r * 0.42, "file-500", 0);
          }
          disc([cx, cy], r * 0.38, "caution-500", 0.1);
        } else if (kind === "peace") {
          disc([cx, cy], r, "caution-500", 0);
          disc([cx, cy], r * 0.78, "file-700", 0.05);
          out.push({ id: `${id}-sign`, z: z + 0.1, d: G.brush([[cx, cy - r * 0.62], [cx, cy + r * 0.62]], r * 0.16) + G.brush([[cx, cy], [cx - r * 0.42, cy + r * 0.45]], r * 0.16) + G.brush([[cx, cy], [cx + r * 0.42, cy + r * 0.45]], r * 0.16), fill: "caution-500", light: false, spot: true });
        } else if (kind === "bolt") {
          disc([cx, cy], r, "caution-500", 0);
          disc([cx, cy], r * 0.8, "file-700", 0.05);
          out.push({ id: `${id}-bolt`, z: z + 0.1, d: G.poly([[cx + r * 0.1, cy - r * 0.6], [cx - r * 0.38, cy + r * 0.08], [cx - r * 0.02, cy + r * 0.08], [cx - r * 0.12, cy + r * 0.6], [cx + r * 0.38, cy - r * 0.12], [cx + r * 0.02, cy - r * 0.12]]), fill: "caution-500", light: false, spot: true });
        } else {
          disc([cx, cy], r, "caution-500", 0);
          disc([cx, cy], r * 0.5, "ink-700", 0.05);
        }
        return out;
      }
      function glyphPin(ctx, name, glyph, i, cx, cy, r, z) {
        const { G } = ctx, inv = i % 2 === 1, rim = inv ? "file-700" : "caution-500", field = inv ? "caution-500" : "file-700", id = `pin-${name}-g${i}`;
        return [
          { id: `${id}-rim`, z, d: G.circle(cx, cy, r), fill: rim, light: false, spot: true },
          { id: `${id}-in`, z: z + 0.05, d: G.circle(cx, cy, r * 0.78), fill: field, light: false, spot: true },
          { id: `${id}-glyph`, z: z + 0.1, d: glyph(cx, cy + r * 0.03, r * 0.5), fill: rim, light: false, spot: true }
        ];
      }
      register({
        kind: "prop",
        name: "pin-badges",
        describe: "A little cluster of enamel pin badges and a bomb patch on the jacket chest and shoulder (the Veteran): flower, peace sign, lightning bolt.",
        params: { at: "chest-L (default) | chest-R", set: "array of flower|peace|bolt|round", insignia: "a name or array (up to 4) from fist|torque|star|peace|bolt|eye|key|anchor|cross|crescent|gear|wings: enamel pins carrying those glyphs; replaces the default set unless `set` is also given, then they follow it" },
        example: { outfit: { outer: { type: "field-jacket", color: "cloth-olive" } }, props: [{ type: "pin-badges" }] },
        draw(ctx, o) {
          const { G, hh, Z } = ctx;
          const a = K.bodyAnchor(ctx, o.at || "chest-L");
          const k = a.k || 1, r = K.inch(1.05), z = Z.collar + 1.5;
          const ins = o.insignia ? [].concat(o.insignia).slice(0, 4).map((n) => ({ name: String(n).toLowerCase(), glyph: insigniaOf(ctx, n, "pin-badges") })).filter((e) => e.glyph) : [];
          const set = o.set || (ins.length ? [] : ["flower", "peace", "bolt"]);
          const layout = ins.length ? [[0.06 * k, -0.2], [-0.62 * k, 0.5], [0.02 * k, 1.15], [-0.5 * k, 1.8]] : [[0.5 * k, -0.2], [-0.55 * k, 0.5], [0.6 * k, 1.15], [-0.4 * k, 1.8]];
          let out = [];
          set.slice(0, 4).forEach((kind, i) => {
            out.push(...pinShapes(ctx, kind, a.pt[0] + layout[i][0] * K.inch(2.1), a.pt[1] + layout[i][1] * K.inch(2.1), r * (kind === "bolt" ? 0.75 : 1), z));
          });
          const nearArm = (x, y) => {
            if (!ins.length) return x;
            const b = ctx.bone("arm", k < 0 ? "R" : "L", "upper");
            let best = null;
            for (let s = 0; s <= 24; s++) {
              const u = s / 24, c = b.bp([u, 0]), d = Math.abs(c[1] - y);
              if (!best || d < best.d) best = { d, x: c[0] - k * (b.hw(u) + 0.075 * hh) };
            }
            const lim = best.x - k * (r + K.inch(0.1));
            return k > 0 ? Math.max(Math.min(x, lim), x - K.inch(1), 0) : Math.min(Math.max(x, lim), x + K.inch(1), 0);
          };
          ins.forEach((e, j) => {
            const i = Math.min(set.length, 4) + j, py = a.pt[1] + layout[i][1] * K.inch(2.1);
            if (i < 4) out.push(...glyphPin(ctx, e.name, e.glyph, i, nearArm(a.pt[0] + layout[i][0] * K.inch(2.1), py), py, r, z));
          });
          const as = k < 0 ? "L" : "R";
          const pc = ctx.bone("arm", as, "upper").bp([0.34, 0]), tilt = 0.2 * -k;
          if (o.patch !== false) {
            const za = ctx.R.arms[as].z + 0.9;
            out.push({ id: "pin-patch", z: za, d: G.ellipse(pc[0], pc[1], K.inch(1.1), K.inch(1.45), tilt), fill: "file-700", light: false, spot: true });
            out.push({ id: "pin-patch-rim", z: za + 0.05, d: G.ellipse(pc[0], pc[1], K.inch(0.8), K.inch(1.1), tilt), fill: "caution-500", light: false, spot: true });
            out.push({ id: "pin-patch-in", z: za + 0.06, d: G.ellipse(pc[0], pc[1], K.inch(0.68), K.inch(0.98), tilt), fill: "file-700", light: false, spot: true });
            out.push({ id: "pin-patch-bomb", z: za + 0.1, d: G.ellipse(pc[0], pc[1] + K.inch(0.15), K.inch(0.3), K.inch(0.5), tilt), fill: "caution-500", light: false, spot: true });
          }
          return out;
        }
      });
    }
  });

  // src/parts/props/carried.js
  var require_carried = __commonJS({
    "src/parts/props/carried.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      var floorY = () => 0;
      function caseShapes(ctx, hi, o, dims) {
        const { G } = ctx;
        const k = hi.k;
        const [fw, e, h, top] = dims;
        const F = K.frame(hi.pt, -k * 0.035, K.U, k);
        const P = (pts) => pts.map(F.P);
        const poly = (pts) => G.poly(P(pts));
        const mat = ctx.mat(o.color || dims.color || "leather-black", "leather");
        const brass = ctx.mat("metal-brass", "metal");
        const z = hi.zUnder;
        const y0 = top, y1 = top + h;
        const out = [];
        out.push({ id: "case-end", z, d: poly([[fw, y0 + 0.05], [fw + e, y0 + 0.3], [fw + e, y1 - 0.25], [fw, y1]]), mat, fill: "shade", light: { form: 0.4, bands: false } });
        out.push({ id: "case-top", z: z + 0.01, d: poly([[-fw + 0.4, y0 - 0.35], [fw + 0.2, y0 - 0.3], [fw + e, y0 + 0.3], [fw, y0 + 0.05], [-fw, y0]]), mat, lit: [], light: { form: 0.3 } });
        const flap = y0 + h * 0.27;
        const planeShade = [{ d: poly([[fw * 0.15, y1 + 0.2], [fw + 0.2, y0 + h * 0.35], [fw + 0.2, y1 + 0.2]]), o: 0.8 }];
        const lines = [{ d: K.ribbon(P([[-fw, flap], [0, flap + 0.08], [fw, flap]]), K.inch(0.16)), fill: "deep", o: 0.85 }];
        if (ctx.lodAtLeast("mid")) {
          lines.push({ d: K.ribbon(P([[-fw + 0.35, y0 + 0.3], [fw - 0.35, y0 + 0.3]]), K.inch(0.05)), fill: "light", o: 0.45 });
          lines.push({ d: K.ribbon(P([[-fw + 0.35, y1 - 0.4], [fw - 0.35, y1 - 0.4]]), K.inch(0.05)), fill: "light", o: 0.3 });
        }
        out.push({ id: "case-face", z: z + 0.02, d: G.poly(P([[-fw, y0], [fw, y0], [fw, y1], [-fw, y1]])), mat, shade: planeShade, lines, light: { form: 1 } });
        out.push({ id: "case-handle", z: z + 0.015, d: K.ribbon(P([[-1.5, y0 + 0.1], [-1.3, -0.4], [0, -0.75], [1.3, -0.4], [1.5, y0 + 0.1]]), K.inch(0.42)), mat: ctx.mat("leather-brown", "leather"), light: { form: 0.8 } });
        out.push({ id: "case-latches", z: z + 0.04, d: [-1, 1].map((s) => G.poly(P([[s * 2.3 - 0.55, flap - 0.2], [s * 2.3 + 0.55, flap - 0.2], [s * 2.3 + 0.55, flap + 1.05], [s * 2.3 - 0.55, flap + 1.05]]))).join(""), mat: brass, light: { form: 0.6 } });
        out.push({ id: "case-keyholes", z: z + 0.05, d: [-1, 1].map((s) => G.poly(P([[s * 2.3 - 0.12, flap + 0.25], [s * 2.3 + 0.12, flap + 0.25], [s * 2.3 + 0.12, flap + 0.7], [s * 2.3 - 0.12, flap + 0.7]]))).join(""), fill: "ink-900", light: false });
        out.push({ id: "case-mounts", z: z + 0.04, d: [-1.5, 1.5].map((x) => G.poly(P([[x - 0.35, y0 + 0.05], [x + 0.35, y0 + 0.05], [x + 0.35, y0 + 0.55], [x - 0.35, y0 + 0.55]]))).join(""), mat: brass, light: false });
        if (ctx.lodAtLeast("mid")) {
          out.push({ id: "case-corner", z: z + 0.045, d: G.poly(P([[fw, y1 - 0.9], [fw + e, y1 - 1.15], [fw + e, y1 - 0.25], [fw, y1]])), mat: brass, light: false, opacity: 0.9 });
        }
        return out;
      }
      register({
        kind: "prop",
        name: "briefcase",
        describe: "Hard-sided briefcase hanging from a carry-pose fist (a down arm gets a fist drawn over the hand): brass latches, flap seam, end cap in shade.",
        params: { side: "R|L", color: "leather token (leather-black)" },
        example: { pose: { arms: { R: "carry", L: "down" } }, props: [{ type: "briefcase", side: "R" }] },
        draw(ctx, o) {
          const hi = K.pickArm(ctx, o, ["carry", "down"], "briefcase");
          return hi ? [...caseShapes(ctx, hi, o, [4.3, 3.7, 11.2, 1.9]), ...K.gripFist(ctx, hi, "briefcase")] : [];
        }
      });
      register({
        kind: "prop",
        name: "suitcase",
        describe: "Big travelling suitcase carried by the handle: bigger than the briefcase, with corner guards and a strap.",
        params: { side: "R|L", color: "leather token (leather-brown)" },
        example: { pose: { arms: { R: "carry", L: "down" } }, props: [{ type: "suitcase", side: "R", color: "leather-brown" }] },
        draw(ctx, o) {
          const hi = K.pickArm(ctx, o, ["carry", "down"], "suitcase");
          if (!hi) return [];
          const d = [5.4, 4.4, 15.5, 1.9];
          d.color = "leather-brown";
          const out = caseShapes(ctx, hi, { ...o, color: o.color || "leather-brown" }, d);
          out.push(...K.gripFist(ctx, hi, "suitcase"));
          return out;
        }
      });
      register({
        kind: "prop",
        name: "cane",
        aliases: ["walking-stick"],
        describe: "Walking cane with a crook (or silver knob) handle, brass collar and ferrule, tip on the floor beside the foot (the Noble).",
        params: { side: "R|L", handle: "crook|knob", color: "wood token (wood-dark)" },
        example: { pose: { arms: { R: "carry", L: "down" } }, props: [{ type: "cane", side: "R" }] },
        draw(ctx, o) {
          const { G } = ctx;
          const hi = K.pickArm(ctx, o, ["carry", "down"], "cane");
          if (!hi) return [];
          const k = hi.k, z = hi.zUnder;
          const T = K.add(hi.pt, [0, -K.inch(2.2)]);
          const B = [hi.pt[0] + k * K.inch(2.6), floorY()];
          const sv = K.sub(B, T);
          const F = K.frame(T, Math.atan2(-sv[0], sv[1]), K.U, k);
          const P = (pts) => pts.map(F.P);
          const len = Math.hypot(sv[0], sv[1]) / K.U;
          const wood = ctx.mat(o.color || "wood-dark", "wood"), brass = ctx.mat("metal-brass", "metal");
          const out = [];
          out.push({ id: "cane-shaft", z, d: K.ribbon(P([[0, 0.2], [0, len - 1.3]]), [K.inch(0.66), K.inch(0.5)]), mat: wood, lines: ctx.lodAtLeast("mid") ? [{ d: K.ribbon(P([[0.12, 2.5], [0.14, len * 0.5], [0.12, len - 3]]), [K.inch(0.04), K.inch(0.1), K.inch(0.03)]), fill: "light", o: 0.4 }] : [], light: { form: 0.9 } });
          if ((o.handle || "crook") === "knob") {
            out.push({ id: "cane-knob", z: z + 0.01, d: G.circle(...F.P([0, -0.6]), K.inch(0.95)), mat: ctx.mat("metal-chrome", "metal"), light: { form: 1 } });
          } else {
            out.push({ id: "cane-crook", z: z + 0.01, d: K.ribbon(P([[0, 0.5], [0, -1.2], [-0.45, -2.1], [-1.4, -2.45], [-2.2, -1.9], [-2.35, -1]]), [K.inch(0.55), K.inch(0.55), K.inch(0.46)]), mat: wood, light: { form: 0.9 } });
          }
          out.push({ id: "cane-collar", z: z + 0.02, d: K.ribbon(P([[0, 0.55], [0, 0.95]]), K.inch(0.62)), mat: brass, light: { form: 0.7 } });
          out.push({ id: "cane-ferrule", z: z + 0.02, d: K.ribbon(P([[0, len - 1.2], [0, len]]), [K.inch(0.5), K.inch(0.38)]), mat: brass, light: { form: 0.7 } });
          out.push(...K.gripFist(ctx, hi, "cane"));
          return out;
        }
      });
      register({
        kind: "prop",
        name: "newspaper",
        aliases: ["paper"],
        describe: "Folded broadsheet in a hold-pose hand (or hanging from a carry-pose fist): masthead, headline bar, photo block and ruled columns.",
        params: { side: "R|L", tilt: "radians (0.25)" },
        example: { pose: { arms: { R: "down", L: "hold" } }, props: [{ type: "newspaper", side: "L" }] },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const hi = K.pickArm(ctx, o, ["hold", "carry"], "newspaper");
          if (!hi) return [];
          const k = hi.k;
          const hold = hi.pose === "hold";
          const F = hold ? K.frame(K.add(hi.pt, K.mul(hi.up, K.inch(0.3))), Math.atan2(-hi.dir[0], hi.dir[1]) + Math.PI + ((_a = o.tilt) != null ? _a : 0), K.U, 1) : K.frame(hi.pt, -k * 0.06, K.U, k);
          const P = (pts) => pts.map(F.P);
          const mat = ctx.mat("paper-news", "paper");
          const z = hold ? hi.zOver : hi.zUnder;
          const w = 4.2, h0 = hold ? -6.8 : 0.4, h1 = hold ? 4.4 : 12.6;
          const body = G.poly(P([[-w, h0], [w, h0 + 0.1], [w + 0.1, h1], [-w - 0.1, h1 - 0.1]]));
          const out = [];
          const lines = [];
          const q = (x0, y0, x1, y1) => G.poly(P([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]));
          const ink = [];
          const ht = h1 - h0;
          ink.push(q(-w + 0.45, h0 + ht * 0.07, w - 0.45, h0 + ht * 0.14));
          ink.push(q(-w + 0.45, h0 + ht * 0.2, w - 0.45, h0 + ht * 0.27));
          ink.push(q(-w + 0.45, h0 + ht * 0.3, -0.35, h0 + ht * 0.5));
          for (let c = 0; c < 2; c++) {
            const x0 = c ? 0.5 : -w + 0.45, x1 = c ? w - 0.45 : -0.55;
            for (let r = 0; r < 6; r++) ink.push(q(x0, h0 + ht * (0.54 + r * 0.07), x1 - (r % 3 === 2 ? 1.2 : 0), h0 + ht * (0.54 + r * 0.07) + 0.12));
          }
          for (let r = 0; r < 4; r++) ink.push(q(0.5, h0 + ht * (0.3 + r * 0.055), w - 0.45 - (r === 3 ? 1.6 : 0), h0 + ht * (0.3 + r * 0.055) + 0.12));
          const fold = K.ribbon(P([[-w, h0 + ht * 0.5], [w, h0 + ht * 0.5]]), K.inch(0.1));
          out.push({ id: "news-sheet", z, d: body, mat, shade: [{ d: G.poly(P([[w * 0.3, h1 + 0.5], [w + 1, h0 + ht * 0.2], [w + 1, h1 + 0.5]])), o: 0.7 }], lines: [{ d: fold, fill: "shade", o: 0.6 }], light: { form: 0.7 } });
          out.push({ id: "news-ink", z: z + 0.01, d: ink.join(""), fill: "ink-700", light: false, opacity: 0.85 });
          return out;
        }
      });
      register({
        kind: "prop",
        name: "glass",
        aliases: ["drink"],
        describe: "Drinking glass in a hold-pose hand (whisky tumbler by default; style cocktail for a martini), amber drink and a bright highlight; also raised in a raise-pose hand.",
        params: { side: "R|L", style: "tumbler|cocktail", drink: "token (cloth-ochre)" },
        example: { pose: { arms: { R: "down", L: "hold" } }, props: [{ type: "glass", side: "L" }] },
        draw(ctx, o) {
          const { G } = ctx;
          const hi = K.pickArm(ctx, o, ["hold", "raise"], "glass");
          if (!hi) return [];
          const z = hi.zOver, F = K.frame(K.add(hi.pt, K.mul(hi.up, K.inch(0.15))), 0, K.U, 1);
          const P = (pts) => pts.map(F.P);
          const gl = ctx.mat("glass-dark", "glass");
          const out = [];
          if (o.style === "cocktail") {
            const bowl = G.poly(P([[-1.9, -3.4], [1.9, -3.4], [0.2, -1.2], [-0.2, -1.2]]));
            out.push({ id: "glass-stem", z, d: K.ribbon(P([[0, -1.3], [0, 0]]), K.inch(0.16)), mat: gl, opacity: 0.85 });
            out.push({ id: "glass-foot", z, d: G.ellipse(...F.P([0, 0]), K.inch(1), K.inch(0.16)), mat: gl, opacity: 0.85 });
            out.push({ id: "glass-bowl", z: z + 0.01, d: bowl, mat: gl, opacity: 0.55 });
            out.push({ id: "glass-drink", z: z + 0.02, d: G.poly(P([[-1.55, -3], [1.55, -3], [0.15, -1.3], [-0.15, -1.3]])), fill: o.drink || "paper-100", light: false, opacity: 0.9 });
            out.push({ id: "glass-olive", z: z + 0.03, d: G.circle(...F.P([0.3, -2.2]), K.inch(0.3)), fill: "covert-700", light: false });
          } else {
            const body = G.poly(P([[-1.45, -3.3], [1.45, -3.3], [1.15, 0], [-1.15, 0]]));
            out.push({ id: "glass-body", z, d: body, mat: gl, opacity: 0.55 });
            out.push({ id: "glass-drink", z: z + 0.01, d: G.poly(P([[-1.35, -2.4], [1.35, -2.4], [1.12, -0.12], [-1.12, -0.12]])), mat: ctx.mat(o.drink || "cloth-ochre", "glass"), light: { form: 0.5 }, opacity: 0.95 });
            out.push({ id: "glass-ice", z: z + 0.02, d: G.poly(P([[-0.9, -2.2], [-0.1, -2.25], [-0.05, -1.45], [-0.85, -1.4]])) + G.poly(P([[0.2, -2.1], [0.95, -2.15], [0.9, -1.35], [0.25, -1.3]])), fill: "paper-000", light: false, opacity: 0.55 });
          }
          out.push({ id: "glass-hi", z: z + 0.05, d: K.ribbon(P([[-1, -3], [-0.85, -0.5]]), [K.inch(0.04), K.inch(0.18), K.inch(0.04)]), fill: "paper-000", light: false, opacity: 0.8 });
          return out;
        }
      });
      register({
        kind: "prop",
        name: "book",
        describe: "Closed hardback book held in a hold-pose hand (or hanging from a carry-pose fist): cover, page-block edge, spine band and title plate.",
        params: { side: "R|L", color: "cloth token (cloth-petrol)" },
        example: { pose: { arms: { R: "down", L: "hold" } }, props: [{ type: "book", side: "L" }] },
        draw(ctx, o) {
          const { G } = ctx;
          const hi = K.pickArm(ctx, o, ["hold", "carry"], "book");
          if (!hi) return [];
          const hold = hi.pose === "hold", k = hi.k, z = hold ? hi.zOver : hi.zUnder;
          const F = hold ? K.frame(K.add(hi.pt, K.mul(hi.up, K.inch(0.4))), Math.atan2(-hi.dir[0], hi.dir[1]) + Math.PI + 0.2 * k, K.U, 1) : K.frame(K.add(hi.pt, [0, K.inch(0.8)]), -k * 0.05, K.U, k);
          const P = (pts) => pts.map(F.P);
          const cover = ctx.mat(o.color || "cloth-petrol", "cloth");
          const w = 3, h = 8.4, t = 1.3;
          const out = [];
          out.push({ id: "book-pages", z, d: G.poly(P([[-w + 0.3, 0.2], [w, 0.2], [w + t * 0.5, 0.2 + t * 0.35], [w + t * 0.5, h + t * 0.3], [w, h], [-w + 0.3, h]])), mat: ctx.mat("paper-000", "paper"), light: { form: 0.5 } });
          out.push({ id: "book-cover", z: z + 0.01, d: G.poly(P([[-w, 0], [w, 0], [w, h], [-w, h]])), mat: cover, shade: [{ d: G.poly(P([[w * 0.4, h + 0.2], [w + 0.2, h * 0.3], [w + 0.2, h + 0.2]])), o: 0.7 }], light: { form: 0.9 } });
          out.push({ id: "book-spine", z: z + 0.02, d: G.poly(P([[-w, 0], [-w + 0.55, 0], [-w + 0.55, h], [-w, h]])), mat: cover, fill: "shade", light: { form: 0.3 } });
          out.push({ id: "book-plate", z: z + 0.03, d: G.poly(P([[-1.5, 1.4], [1.9, 1.4], [1.9, 3], [-1.5, 3]])), fill: "cloth-cream", light: false, opacity: 0.9 });
          out.push({ id: "book-rule", z: z + 0.04, d: [2.1, 2.45].map((y) => G.poly(P([[-1.1, y], [1.5, y], [1.5, y + 0.12], [-1.1, y + 0.12]]))).join(""), fill: "ink-700", light: false });
          return out;
        }
      });
      register({
        kind: "prop",
        name: "satchel",
        aliases: ["messenger-bag", "bag"],
        describe: "Leather satchel on a cross-body strap: bag at one hip, strap over the opposite shoulder, flap with a brass buckle.",
        params: { at: "hip-R (default) | hip-L", color: "leather token (leather-brown)" },
        example: { props: [{ type: "satchel", at: "hip-R" }] },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const a = K.bodyAnchor(ctx, o.at || "hip-R");
          const k = a.k || -1;
          const mat = ctx.mat(o.color || "leather-brown", "leather"), brass = ctx.mat("metal-brass", "metal");
          const c = [a.pt[0] - k * K.inch(1.8), a.pt[1] + K.inch(2)];
          const F = K.frame(c, k * 0.04, K.U, 1);
          const P = (pts) => pts.map(F.P);
          const w = 6.2, h = 9.2;
          const sh = K.bodyAnchor(ctx, "shoulder-" + (k < 0 ? "L" : "R")).pt;
          const tp = (x, t) => ctx.tp([x, t]);
          const strapPts = [K.add(sh, [-k * K.inch(0.2), -K.inch(0.1)]), tp(-k * 0.05, 0.36), tp(k * 0.7, 0.7), F.P([-k * w * 0.45, -h / 2 + 0.6])];
          const za = R.arms[k < 0 ? "R" : "L"].z - 0.3;
          const out = [];
          out.push({ id: "satchel-strap", z: Z.strap, d: K.ribbon(strapPts, K.inch(1.1)), mat, light: { form: 0.7 } });
          out.push({ id: "satchel-bag", z: za, d: K.rrect(...F.P([-w, -h / 2]), ...F.P([w, h / 2]), 10), mat, shade: [{ d: G.poly(P([[w * 0.2, h / 2 + 1], [w + 1, -h * 0.1], [w + 1, h / 2 + 1]])), o: 0.7 }], light: { form: 1 } });
          out.push({ id: "satchel-flap", z: za + 0.01, d: G.smooth(P([[-w, -h / 2, true], [w, -h / 2, true], [w, h * 0.05], [0, h * 0.2], [-w, h * 0.05]]), true, 0.3), mat, lines: [{ d: K.ribbon(P([[-w + 0.2, h * 0.07], [0, h * 0.22], [w - 0.2, h * 0.07]]), K.inch(0.16)), fill: "deep", o: 0.9 }], light: { form: 0.9 } });
          out.push({ id: "satchel-buckle", z: za + 0.03, d: K.rrect(...F.P([-0.7, h * 0.08]), ...F.P([0.7, h * 0.3]), 3), mat: brass, light: { form: 0.6 } });
          return out;
        }
      });
      module.exports = { caseShapes };
    }
  });

  // src/parts/props/fx.js
  var require_fx2 = __commonJS({
    "src/parts/props/fx.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      register({
        kind: "prop",
        name: "flies",
        describe: "Two to four flies buzzing round the head, each with a dotted looping flight trail (the Garbage Loader).",
        params: { count: "2-4 (default 3)", size: "scale (1)" },
        example: { props: [{ type: "flies", count: 3 }] },
        draw(ctx, o) {
          const { G, hh, Z } = ctx;
          const n = Math.max(1, Math.min(4, o.count || 3)), sz = (o.size || 1) * hh * 0.14;
          const spots = [[-0.95, -0.5, 0.3], [0.95, -0.22, 2.4], [-0.72, 0.22, 3.6], [0.7, -0.88, 4.5]];
          const body = [], wings = [], eyes = [], trail = [];
          for (let i = 0; i < n; i++) {
            const [hx, hy, a0] = spots[i];
            const p = ctx.hp([hx, hy], { flat: true });
            const ang = a0 + (ctx.rng() - 0.5) * 0.6;
            const d = [Math.cos(ang), Math.sin(ang)], nr = K.perp(d);
            const L = hh * 0.55, w = hh * 0.085, pts = [];
            for (let j = 0; j <= 28; j++) {
              const t = j / 28, ph = t * Math.PI * 2.7;
              pts.push(K.add(K.add(p, K.mul(d, -t * L - (Math.cos(ph) - 1) * w * 0.7)), K.mul(nr, Math.sin(ph) * w)));
            }
            const step = ctx.lodAtLeast("mid") ? 1 : 2;
            for (let j = 3; j < pts.length; j += step) trail.push(G.circle(pts[j][0], pts[j][1], (ctx.lodAtLeast("hi") ? 3.3 : 4.6) * (1 - j / 40) * hh / 236));
            const dirv = K.mul(d, -1);
            const th = Math.atan2(dirv[1], dirv[0]);
            body.push(G.ellipse(p[0], p[1], sz * 0.55, sz * 0.28, th));
            const hd = K.add(p, K.mul(dirv, sz * 0.6));
            body.push(G.ellipse(hd[0], hd[1], sz * 0.24, sz * 0.24));
            eyes.push(G.circle(hd[0] + nr[0] * sz * 0.1, hd[1] + nr[1] * sz * 0.1, sz * 0.13));
            for (const sgn of [-1, 1]) {
              const wc = K.add(K.add(p, K.mul(nr, sgn * sz * 0.5)), K.mul(dirv, -sz * 0.05));
              wings.push(G.ellipse(wc[0], wc[1], sz * 0.62, sz * 0.26, th + sgn * 0.9));
            }
          }
          const out = [];
          if (trail.length) out.push({ id: "fly-trail", z: Z.fx, d: trail.join(""), fill: "ink-500", light: false, opacity: 0.55 });
          out.push({ id: "fly-wings", z: Z.fx + 0.1, d: wings.join(""), fill: "paper-000", light: false, opacity: 0.8 });
          out.push({ id: "fly-body", z: Z.fx + 0.2, d: body.join(""), fill: "cloth-black", light: false });
          out.push({ id: "fly-eyes", z: Z.fx + 0.3, d: eyes.join(""), fill: "alarm-500", light: false, spot: true });
          return out;
        }
      });
    }
  });

  // src/parts/props/leg.js
  var require_leg = __commonJS({
    "src/parts/props/leg.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      register({
        kind: "prop",
        name: "knee-brace",
        describe: "Hinged knee brace over the trousers: steel bars both sides of the knee, thigh and shin straps with brass buckles, kneecap plate with hinge discs (Stacey, right knee).",
        params: { side: "R|L (default R)", color: "strap token (cloth-black)", wide: "extra clearance for baggy trousers, head-heights (0.05)" },
        example: { props: [{ type: "knee-brace", side: "R" }] },
        draw(ctx, o) {
          var _a;
          const { R, G, hh } = ctx;
          const s = o.side || "R";
          const up = ctx.bone("leg", s, "upper"), lo = ctx.bone("leg", s, "lower");
          const knee = R.legs[s].knee;
          const ease = ((_a = o.wide) != null ? _a : 0.05) * hh;
          const U = (u, v) => {
            const p = up.bp([u, v]);
            const q = up.bp([u, 0]);
            const n = K.norm(K.sub(p, q));
            return v ? K.add(p, K.mul(n, Math.sign(v) * ease)) : p;
          };
          const L = (u, v) => {
            const p = lo.bp([u, v]);
            const q = lo.bp([u, 0]);
            const n = K.norm(K.sub(p, q));
            return v ? K.add(p, K.mul(n, Math.sign(v) * ease)) : p;
          };
          const z = ctx.Z.bottom + 0.8;
          const steel = ctx.mat("metal-steel", "metal");
          const strap = ctx.mat(o.color || "cloth-black", "satin");
          const brass = ctx.mat("metal-gun", "metal");
          const out = [];
          {
            const sleeve = G.smooth([U(0.74, -1.14), U(0.74, 1.14), L(0.26, 1.14), L(0.26, -1.14)].map((p) => [p[0], p[1], true]), true, 0.3);
            out.push({ id: "kb-sleeve", z: z + 0.01, d: sleeve, mat: strap, light: { form: 1 } });
          }
          const vOut = 1.06;
          for (const v of [-vOut, vOut]) {
            const pts = [U(0.5, v), U(0.92, v * 1.02), knee.map((x, i) => x + (v > 0 ? 1 : -1) * 0), L(0.1, v * 1.02), L(0.52, v)];
            pts[2] = K.add(up.bp([1, v]), K.mul(K.norm(K.sub(up.bp([1, v]), up.bp([1, 0]))), ease));
            out.push({ id: `kb-bar-${v > 0 ? "a" : "b"}`, z: z + 0.02, d: K.ribbon(pts, K.inch(0.42)), mat: steel, light: { form: 0.7 } });
          }
          const band = (fn, u0, du, id) => {
            const top = [-1.12, 0, 1.12].map((v) => fn(u0 - du, v)), bot = [-1.12, 0, 1.12].map((v) => fn(u0 + du, v));
            bot[1] = K.add(bot[1], [0, K.inch(0.12)]);
            const d = G.smooth([...top, ...bot.reverse()].map((p, i) => i === 0 || i === 2 || i === 3 || i === 5 ? [p[0], p[1], true] : p), true, 0.35);
            out.push({ id, z, d, mat: strap, lines: ctx.lodAtLeast("hi") ? [{ d: K.ribbon([top[0], top[1], top[2]].map((p) => K.add(p, [0, K.inch(0.2)])), K.inch(0.05)), fill: "light", o: 0.35 }] : [] });
            const b = fn(u0, 0.28);
            out.push({ id: id + "-buckle", z: z + 0.05, d: K.rrect(b[0] - K.inch(0.5), b[1] - K.inch(0.5), b[0] + K.inch(0.5), b[1] + K.inch(0.5), 3), mat: brass, light: { form: 0.5 } });
            out.push({ id: id + "-buckle-hole", z: z + 0.06, d: K.rrect(b[0] - K.inch(0.26), b[1] - K.inch(0.26), b[0] + K.inch(0.26), b[1] + K.inch(0.26), 2), fill: "cloth-black", light: false, o: 0.85 });
          };
          band(U, 0.4, 0.11, "kb-strap-thigh");
          band(L, 0.5, 0.11, "kb-strap-shin");
          return out;
        }
      });
    }
  });

  // src/parts/props/militants.js
  var require_militants = __commonJS({
    "src/parts/props/militants.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      var INS = null;
      try {
        INS = require_insignia();
      } catch (e) {
        INS = null;
      }
      var FONT = "'Archivo Compressed', 'Archivo Condensed', Impact, sans-serif";
      var CAP_W = 0.5;
      var clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      var lum = (hex) => {
        const m = /^#?([0-9a-f]{6})/i.exec(hex || "");
        if (!m) return 0.5;
        const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      var contrast = (a, b) => {
        const x = lum(a), y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      function glyphOf(ctx, name, label) {
        if (name == null || name === "") return null;
        if (!INS) {
          ctx.warn(`${label}: the insignia set is unavailable`);
          return null;
        }
        const n = String(name).toLowerCase();
        if (!INS.NAMES.includes(n)) {
          ctx.warn(`${label} insignia "${name}" is not valid; choose from: ${INS.NAMES.join(", ")}`);
          return null;
        }
        return (cx, cy, size, rot) => {
          const d = INS.insignia(n, cx, cy, size);
          return rot ? ctx.G.rotate(d, rot, [cx, cy]) : d;
        };
      }
      function textLines(ctx, t, label) {
        if (t == null || t === "") return [];
        let arr = Array.isArray(t) ? t.map(String) : String(t).split(/\s*(?:\/|\||\n)\s*/);
        arr = arr.map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (arr.length > 3) {
          ctx.warn(`${label}: text has ${arr.length} lines; only the first 3 are drawn`);
          arr = arr.slice(0, 3);
        }
        return arr;
      }
      function legible(ctx, want, board, label) {
        const cb = ctx.tok(board), ct = ctx.tok(want);
        if (contrast(cb, ct) >= 3.2) return want;
        const alt = contrast(cb, ctx.tok("ink-900")) >= contrast(cb, ctx.tok("paper-000")) ? "ink-900" : "paper-000";
        ctx.warn(`${label}: ${want} is hard to read on a ${board} board; used ${alt}`);
        return alt;
      }
      function reads(ctx, a, b, spot) {
        const mapped = ctx.scheme && ctx.scheme.map && !(spot && ctx.scheme.spotKeep);
        return mapped ? ctx.contrast(a, b) >= 3.5 : ctx.C.contrast(ctx.tok(a), ctx.tok(b)) >= 3;
      }
      function glowCloud(ctx, c, R, n, r0, r1) {
        const pts = [];
        let d = "";
        for (let i = 0; i < n; i++) {
          const a = ctx.rng() * Math.PI * 2, t = Math.pow(ctx.rng(), 0.75), r = (r0 + (r1 - r0) * t) * (0.6 + ctx.rng() * 0.8) * 1.1, q = ctx.rng() * (Math.PI / 3);
          const x = c[0] + Math.cos(a) * R * t, y = c[1] + Math.sin(a) * R * t;
          pts.length = 0;
          for (let k = 0; k < 6; k++) pts.push([x + Math.cos(q + k * (Math.PI / 3)) * r, y + Math.sin(q + k * (Math.PI / 3)) * r]);
          d += ctx.G.poly(pts);
        }
        return d;
      }
      function takeFist(ctx, hi, id) {
        if (hi.hand === "fist" || hi.hand === "grip") return { hi, pieces: [] };
        let H;
        try {
          H = require_relaxed().handSpace(ctx, hi.side);
        } catch (e) {
          H = null;
        }
        if (!H) {
          ctx.warn(`${id}: it is gripped by pose.hands.${hi.side}: "fist" (this hand is "${hi.hand}")`);
          return { hi, pieces: [] };
        }
        ctx.cut(`^hand-${hi.side}(-|$)`, ctx.G.poly([[-0.6, -0.06], [0.6, -0.06], [0.6, 1.4], [-0.6, 1.4]].map(H.hp)));
        const pieces = ctx.part("hands", "fist", { side: hi.side }).map((pc) => ({ ...pc, id: String(pc.id).replace(/^hand-/, `${id}-fist-`) }));
        return { hi: { ...hi, pt: H.hp([0, 0.43]), hand: "fist" }, pieces };
      }
      function boardLayout(lines, hasGlyph, S) {
        const m = 0.9 * S, n = lines.length;
        const maxChars = n ? Math.max(...lines.map((l) => l.length)) : 0;
        let fs = 2.7 * S;
        if (n) fs = Math.min(fs, (18 * S - 2 * m - 0.4 * S) / (maxChars * CAP_W));
        const pitch = 1.12 * fs, textH = n * pitch;
        const gs = hasGlyph ? (n ? 2.1 : 3.8) * S : 0, glyphH = hasGlyph ? 2 * gs + (n ? 0.5 * S : 0) : 0;
        const W = Math.min(18 * S, Math.max(n ? maxChars * CAP_W * fs + 2 * m + 0.4 * S : 0, hasGlyph ? 2 * gs + 2 * m : 0, 6 * S));
        return { W, H: 2 * m + textH + glyphH, m, fs, pitch, gs, glyphH, textH };
      }
      register({
        kind: "prop",
        name: "placard",
        aliases: ["sign", "protest-sign"],
        describe: "A protest placard: a board on a wooden pole, lettered in up to three short lines of the condensed bold capitals and/or carrying an insignia glyph. Held aloft in a raised fist (arm pose raise; the open hand is swapped for a fist) leaning out from the head, or carried at the side (carry pose; a down arm gets a fist). The lettering colour is swapped if it would be hard to read on the board.",
        params: {
          text: 'up to 3 short lines, split on / or | ("NO GODS / NO MASTERS"), or an array',
          insignia: "glyph above the lettering: fist|torque|star|peace|bolt|eye|key|anchor|cross|crescent|gear|wings (a fist when there is neither text nor insignia)",
          color: "lettering and glyph token (ink-900)",
          board: "board colour token (paper-100)",
          side: "R|L the arm that holds it (default: the raised arm, else the carrying arm)",
          size: "scale (1)",
          tilt: "radians the pole leans out from the body (0.3 raised, 0.2 carried)",
          pole: "pole wood token (wood-light)"
        },
        example: { pose: { arms: { R: "raise", L: "down" }, hands: { R: "fist" } }, props: [{ type: "placard", side: "R", text: "NO GODS / NO MASTERS" }] },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const pick = K.pickArm(ctx, o, ["raise", "carry", "down"], "placard");
          if (!pick) return [];
          const raised = pick.pose === "raise", fist = raised ? takeFist(ctx, pick, "placard") : { hi: pick, pieces: [] }, hi = fist.hi;
          const k = hi.k, S = clamp(+o.size || 1, 0.4, 2.2);
          const lines = textLines(ctx, o.text, "placard");
          let glyph = glyphOf(ctx, o.insignia, "placard");
          if (!lines.length && !glyph && o.text == null && o.insignia == null) glyph = glyphOf(ctx, "fist", "placard");
          let boardTok = o.board || "paper-100", ink = legible(ctx, o.color || "ink-900", boardTok, "placard");
          const spot = !lines.length;
          if (!reads(ctx, ink, boardTok, spot)) {
            if (reads(ctx, "paper-000", boardTok, spot)) ink = "paper-000";
            else {
              boardTok = "paper-100";
              if (!reads(ctx, ink, boardTok, spot)) ink = "ink-900";
            }
          }
          const L = boardLayout(lines, !!glyph, S);
          const tilt = +((_a = o.tilt) != null ? _a : raised ? 0.3 : 0.2), ang = k * tilt;
          const F = K.frame(hi.pt, ang, K.U, k);
          const gap = (raised ? 4.6 : 22) * S, top = gap + L.H, z = hi.zUnder, out = [];
          const outward = (p) => k * (p[0] - ctx.R.head.cx), o0 = outward(F.P([-L.W / 2, -gap])), slope = outward(F.P([-L.W / 2 + 1, -gap])) - o0;
          const dx = slope > 0 ? clamp((0.56 * ctx.hh - o0) / slope, 0, L.W / 2 - 1.3 * S) : 0;
          const pw = 0.85 * S;
          out.push({ id: "placard-pole", z, d: K.ribbon([F.P([0, 3.8 * S]), F.P([0, -(top - 0.9 * S)])], [K.inch(pw * 0.86), K.inch(pw)]), mat: ctx.mat(o.pole || "wood-light", "wood"), light: { form: 0.9 } });
          const rect = (ins, r) => F.D(K.rrect(dx - L.W / 2 + ins, -top + ins, dx + L.W / 2 - ins, -gap - ins, r));
          const bm = ctx.mat(boardTok, "paper"), board = rect(0, 0.35 * S);
          const back = G.translate(board, K.inch(0.3 * S), K.inch(0.34 * S));
          out.push({ id: "placard-edge", z: z + 0.01, d: back, mat: bm, lines: [{ d: back, fill: "deep", o: 0.85 }], light: false, spot });
          out.push({ id: "placard-board", z: z + 0.02, d: board, mat: bm, light: { form: 0.25 }, spot });
          const inkFill = { fill: ink, light: false, spot };
          if (ctx.lodAtLeast("mid") && L.W > 7 * S) {
            const ins = 0.5 * S, th = 0.17 * S, rp = (i) => [[dx - L.W / 2 + i, -top + i], [dx + L.W / 2 - i, -top + i], [dx + L.W / 2 - i, -gap - i], [dx - L.W / 2 + i, -gap - i]].map(F.P);
            out.push({ id: "placard-border", z: z + 0.03, d: G.poly(rp(ins)) + G.poly(rp(ins + th).reverse()), ...inkFill });
          }
          if (glyph) {
            const gc = F.P([dx, -top + L.m + L.gs]);
            out.push({ id: "placard-insignia", z: z + 0.03, d: glyph(gc[0], gc[1], K.inch(L.gs), ang), ...inkFill });
          }
          if (lines.length) {
            const y0 = -top + L.m + L.glyphH, fsU = K.inch(L.fs), deg = ang * 180 / Math.PI;
            const capPx = 0.7 * fsU / ctx.px(1);
            if (capPx >= 4) {
              const txt = lines.map((s, i) => {
                const c = F.P([dx, y0 + (i + 0.5) * L.pitch]), tl = s.length * CAP_W * fsU;
                return `<text x="${K.f(c[0])}" y="${K.f(c[1] + 0.36 * fsU)}" transform="rotate(${K.f(deg)} ${K.f(c[0])} ${K.f(c[1])})" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${K.f(fsU)}" textLength="${K.f(tl)}" lengthAdjust="spacingAndGlyphs" fill="${ctx.tok(ink)}">${esc(s)}</text>`;
              }).join("");
              out.push({ id: "placard-text", z: z + 0.03, raw: txt });
            } else {
              const bars = lines.map((s, i) => {
                const yc = y0 + (i + 0.5) * L.pitch, w = s.length * CAP_W * L.fs;
                return F.D(K.rrect(dx - w / 2, yc - 0.34 * L.fs, dx + w / 2, yc + 0.34 * L.fs, 0.1));
              }).join("");
              out.push({ id: "placard-text", z: z + 0.03, d: bars, ...inkFill });
            }
          }
          if (hi.pose === "down") out.push(...K.gripFist(ctx, hi, "placard"));
          out.push(...fist.pieces);
          return out;
        }
      });
      register({
        kind: "prop",
        name: "megaphone",
        aliases: ["loud-hailer", "bullhorn"],
        describe: "A loud-hailer at the mouth, gripped by its handle in a fist (arm pose smoke; the hand is swapped for a fist). The cone points out to the figure's side and a little up, not at the viewer, so the face stays clear. Cream cone with a coloured stripe, black mouthpiece and handle, chrome rim.",
        params: {
          side: "R|L the arm in the smoke pose",
          color: "cone colour token (paper-100)",
          color2: "stripe colour token (signal-500)",
          size: "scale (1)",
          tilt: "radians the cone points above horizontal (0.2)"
        },
        example: { pose: { arms: { R: "smoke", L: "down" }, hands: { R: "fist" } }, props: [{ type: "megaphone", side: "R" }] },
        draw(ctx, o) {
          var _a;
          const { G, head: H } = ctx;
          const pick = K.pickArm(ctx, o, ["smoke"], "megaphone");
          if (!pick) return [];
          const fist = takeFist(ctx, pick, "megaphone"), hi = fist.hi;
          const k = hi.k, S = clamp(+o.size || 1, 0.5, 1.8), up = +((_a = o.tilt) != null ? _a : 0.2);
          const m = ctx.hp([k * H.mouthW * 0.55, H.mouthY + 4e-3], { depth: 0.04 });
          const e = K.norm([k * Math.cos(up), -Math.sin(up)]);
          const F = K.frame(m, Math.atan2(e[1] * k, e[0] * k), K.U, k);
          const P = (x, y) => F.P([x * S, y * S]);
          const x0 = 0.5, x1 = 9.2, r0 = 0.8, r1 = 3.25, rAt = (x) => r0 + (r1 - r0) * Math.pow((x - x0) / (x1 - x0), 1.2);
          const xs = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
          const slab = (a, b, grow = 0) => G.poly([...xs(a, b, 4).map((x) => P(x, -(rAt(x) + grow))), ...xs(a, b, 4).reverse().map((x) => P(x, rAt(x) + grow))]);
          const z = ctx.Z.frontProp - 1, body = ctx.mat(o.color || "paper-100", "satin"), out = [];
          const att = P(2.9, rAt(2.9) * 0.85), dv = K.norm(K.sub(hi.pt, att)), end = K.add(hi.pt, K.mul(dv, K.inch(0.5)));
          out.push({ id: "megaphone-handle", z: hi.zUnder, d: K.ribbon([att, K.add(att, K.mul(K.sub(end, att), 0.5)), end], [K.inch(0.9 * S), K.inch(1 * S), K.inch(1 * S)]), mat: ctx.mat("ink-700", "satin"), light: { form: 0.7 } });
          out.push({ id: "megaphone-mouthpiece", z, d: F.D(K.rrect(-0.25 * S, -1 * S, 0.85 * S, 1 * S, 0.4 * S)), mat: ctx.mat("ink-900", "satin"), light: { form: 0.6 } });
          const hl = ctx.lodAtLeast("hi") ? [{ d: G.brush([P(1.4, -rAt(1.4) * 0.72), P(5, -rAt(5) * 0.72), P(8.5, -rAt(8.5) * 0.72)], [K.inch(0.1 * S), K.inch(0.3 * S), K.inch(0.12 * S)]), fill: "light", o: 0.8 }] : [];
          out.push({ id: "megaphone-cone", z: z + 0.01, d: slab(x0, x1), mat: body, lines: hl, light: { form: 0.8 } });
          out.push({ id: "megaphone-stripe", z: z + 0.02, d: slab(4.2, 5.4), mat: ctx.mat(o.color2 || "signal-500", "satin"), light: { form: 0.8 } });
          out.push({ id: "megaphone-rim", z: z + 0.03, d: G.poly([P(8.7, -(rAt(8.7) + 0.02)), P(9.5, -(r1 + 0.26)), P(9.5, r1 + 0.26), P(8.7, rAt(8.7) + 0.02)]), mat: ctx.mat("metal-chrome", "metal"), light: { form: 0.8 } });
          out.push({ id: "megaphone-bell", z: z + 0.04, d: G.ellipse(...P(9.5, 0), K.inch(0.4 * S), K.inch((r1 + 0.1) * S), F.angle), fill: "ink-900", light: false });
          out.push(...fist.pieces);
          if (ctx.lodAtLeast("mid")) out.push({ id: "megaphone-switch", z: hi.zUnder + 0.01, d: G.circle(...K.add(att, K.mul(dv, K.inch(0.9 * S))), K.inch(0.2 * S)), fill: "alarm-500", light: false, spot: true });
          return out;
        }
      });
      register({
        kind: "prop",
        name: "molotov",
        aliases: ["petrol-bomb", "bottle-bomb"],
        describe: "A brown bottle with a white rag in its neck, alight, held up in a raised fist (arm pose raise; the open hand is swapped for a fist), leaning out from the head. The flame is yellow with an orange heart (in the militants-type gradient maps: the accent yellow with a lighter heart), stays in colour in the spot schemes, and has a fine stippled glow (none at small sizes, where the flame is drawn larger instead).",
        params: {
          side: "R|L the raised arm",
          color: "bottle glass token (wood-dark)",
          size: "scale (1)",
          tilt: "radians the bottle leans out from the forearm (0.5)",
          lit: "false for a cold bottle: rag only, no flame"
        },
        example: { pose: { arms: { R: "raise", L: "down" }, hands: { R: "fist" } }, props: [{ type: "molotov", side: "R" }] },
        draw(ctx, o) {
          var _a;
          const { G } = ctx;
          const pick = K.pickArm(ctx, o, ["raise"], "molotov");
          if (!pick) return [];
          const fist = takeFist(ctx, pick, "molotov"), hi = fist.hi;
          const k = hi.k, S = clamp(+o.size || 1, 0.5, 1.8), tilt = +((_a = o.tilt) != null ? _a : 0.5);
          const F = K.frame(hi.pt, k * tilt, K.U, k);
          const P = (x, y) => F.P([x * S, y * S]), poly = (pts) => G.poly(pts.map((p) => P(p[0], p[1])));
          const sm = (pts, t = 0.4) => G.smooth(pts.map((p) => {
            const q = P(p[0], p[1]);
            if (p[2]) q.push(true);
            return q;
          }), true, t);
          const z = hi.zUnder, lit = o.lit !== false, out = [];
          const glass = ctx.mat(o.color || "wood-dark", "glass");
          const bottle = sm([[-1.3, 3], [-1.1, 3.55], [1.1, 3.55], [1.3, 3], [1.3, 0.6], [1.3, -1.4], [1.12, -2.6], [0.78, -3.7], [0.55, -4.5], [0.5, -6.1], [0.74, -6.25, true], [0.74, -6.85, true], [-0.74, -6.85, true], [-0.74, -6.25, true], [-0.5, -6.1], [-0.55, -4.5], [-0.78, -3.7], [-1.12, -2.6], [-1.3, -1.4], [-1.3, 0.6]], 0.3);
          const lines = [{ d: G.brush([P(-0.88, 2.7), P(-0.95, 0.4), P(-0.9, -1.6)], [K.inch(0.05 * S), K.inch(0.3 * S), K.inch(0.08 * S)]), fill: "light", o: 0.5 }];
          if (ctx.lodAtLeast("mid")) lines.push({ d: G.brush([P(-0.3, -3.9), P(-0.27, -5.2), P(-0.28, -6)], [K.inch(0.04 * S), K.inch(0.16 * S), K.inch(0.04 * S)]), fill: "light", o: 0.45 });
          out.push({ id: "molotov-bottle", z, d: bottle, mat: glass, lines, light: { form: 0.7 } });
          const rag = sm([[-0.5, -6.9, true], [0.5, -6.9, true], [1.3, -6.4], [1.95, -5.2], [2.1, -3.8], [1.85, -2.6, true], [1.5, -3.3], [1.15, -2.3, true], [0.85, -3.4], [0.72, -5], [0.45, -6]], 0.35);
          const folds = ctx.lodAtLeast("mid") ? [{ d: G.brush([P(1, -6.1), P(1.4, -4.6), P(1.5, -3.5)], [K.inch(0.04 * S), K.inch(0.12 * S), K.inch(0.04 * S)]), fill: "deep", o: 0.5 }] : [];
          out.push({ id: "molotov-rag", z: z + 0.02, d: rag, mat: ctx.mat("paper-000", "cloth"), lines: folds, light: { form: 0.5 } });
          if (lit) {
            const zf = ctx.Z.frontProp + 0.5, lo = !ctx.lodAtLeast("mid"), fine = ctx.lodAtLeast("hi");
            const duo = !!(ctx.scheme && ctx.scheme.map && !ctx.scheme.spotKeep);
            const flameC = duo ? ctx.accent("caution-500") : "caution-500", heartC = duo ? ctx.accent("signal-500", "light") : "signal-500";
            const fs = lo ? 1.5 : 1, grow = (p) => [p[0] * fs, -6.8 + (p[1] + 6.8) * fs, p[2]];
            const tongue = [[-0.8, -6.75], [-1.15, -7.9], [-0.95, -9.1], [-0.45, -10.4], [-0.25, -12.2, true], [0.3, -10.6], [0.55, -9.8], [1, -10.7, true], [1.3, -9.2], [1.1, -7.7], [0.85, -6.75]];
            const heart = tongue.map((p) => [p[0] * 0.5 + 0.05, -6.8 + (p[1] + 6.75) * 0.58, p[2]]);
            out.push({ id: "molotov-flame", z: zf, d: sm(tongue.map(grow), 0.4), fill: flameC, light: false, spot: true });
            out.push({ id: "molotov-flame-heart", z: zf + 0.01, d: sm(heart.map(grow), 0.4), fill: heartC, light: false, spot: true });
            if (!lo) out.push({ id: "molotov-flame-lick", z: zf + 5e-3, d: G.brush([P(1, -6.7), P(1.75, -5.6), P(2.1, -4.3), P(2.05, -3)], [K.inch(0.5 * S), K.inch(0.42 * S), K.inch(0.22 * S), K.inch(0.04 * S)]), fill: flameC, light: false, spot: true });
            if (!lo) {
              const gc = P(0.1, -9), fr = (f, o2) => ({ d: F.D(G.ellipse(0.1 * S, -9 * S, 3.3 * S * f, 5 * S * f)), fill: flameC, stip: true, o: o2 });
              out.push({ id: "molotov-glow", z: zf - 0.2, over: [fr(1, 0.12), fr(0.78, 0.2), fr(0.56, 0.3), fr(0.36, 0.42)], spot: true });
              out.push({ id: "molotov-glow-dots", z: zf - 0.1, spot: true, over: [
                { d: glowCloud(ctx, gc, K.inch(2.9 * S), fine ? 520 : 240, K.inch(0.05 * S), K.inch(0.02 * S)), fill: flameC, o: 0.55 },
                { d: glowCloud(ctx, gc, K.inch(5 * S), fine ? 300 : 130, K.inch(0.05 * S), K.inch(0.025 * S)), fill: flameC, o: 0.75 }
              ] });
            }
          }
          out.push(...fist.pieces);
          return out;
        }
      });
    }
  });

  // src/parts/props/rifles.js
  var require_rifles = __commonJS({
    "src/parts/props/rifles.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      function rifleShapes(ctx, F, z, o = {}) {
        const { G } = ctx;
        const P = (pts) => pts.map(F.P);
        const poly = (pts) => G.poly(P(pts));
        const furn = ctx.mat(o.color || "cloth-graphite", "satin");
        const steel = ctx.mat(o.metal || "metal-gun", "metal");
        const out = [];
        const piece = (id, d, mat, extra = {}) => out.push({ id: `rifle-${id}`, z: z + out.length * 0.01, d, mat, ...extra });
        const mid = ctx.lodAtLeast("mid");
        piece("stock", poly([[0, -1.9], [1.2, -2.2], [9.8, -1.3], [9.9, 1.7], [4, 2.9], [0.9, 3.1], [0, 2.6]]), furn, mid ? { lines: [{ d: G.brush(P([[2.5, -1.2], [5, -0.5], [8.8, -0.2]]), [K.inch(0.05), K.inch(0.28), K.inch(0.04)]), fill: "deep", o: 0.6 }] } : {});
        piece("grip", poly([[11, 1.2], [13.4, 1.2], [13, 4.9], [11.2, 5.3]]), furn);
        piece("mag", poly([[14.3, 1.2], [17.3, 1.2], [17.9, 5.4], [16.2, 6.1]]), steel);
        piece("receiver", poly([[9.6, -1.7], [17.8, -1.7], [17.8, 1.6], [9.6, 1.6]]), steel, mid ? { lines: [{ d: G.brush(P([[10.4, 0.1], [13.5, -0.2], [16.8, -0.2]]), [K.inch(0.04), K.inch(0.22), K.inch(0.04)]), fill: "deep", o: 0.7 }] } : {});
        piece(
          "handguard",
          poly([[17.8, -1.45], [27.8, -1.2], [27.8, 1.2], [17.8, 1.45]]),
          furn,
          mid ? { lines: [0, 1, 2, 3, 4].map((i) => ({ d: G.brush(P([[19.3 + i * 1.7, -0.8], [19.9 + i * 1.7, 0.8]]), [K.inch(0.08), K.inch(0.2), K.inch(0.08)]), fill: "deep", o: 0.75 })) } : {}
        );
        piece("barrel", poly([[27.8, -0.5], [38.6, -0.5], [38.6, 0.5], [27.8, 0.5]]), steel);
        piece("sight", poly([[28.8, -0.5], [30.2, -0.5], [30, -2.5], [29.1, -2.5]]), steel);
        piece("hider", poly([[38.6, -0.7], [40.4, -0.7], [40.4, 0.7], [38.6, 0.7]]), steel);
        if (o.scope !== false) {
          piece("scope", G.smooth(P([[10.8, -3.5], [19.5, -3.45], [20.9, -4.1], [20.9, -2.6], [19.5, -3.15], [10.8, -3.1]]), true, 0.1), steel);
          piece("scope-mount", G.poly([...P([[12.6, -3.2], [13.6, -3.2], [13.6, -1.7], [12.6, -1.7]])]), steel);
          piece("scope-mount2", G.poly([...P([[17, -3.2], [18, -3.2], [18, -1.7], [17, -1.7]])]), steel);
        }
        return { pieces: out, rear: F.P([6.5, 2.6]), front: F.P([27, 1.3]) };
      }
      var T = (ctx, x, t) => ctx.tp([x, t]);
      register({
        kind: "prop",
        name: "rifle-back",
        aliases: ["rifle-slung", "rifle"],
        describe: "Slung rifle (Stacey): barrel above one shoulder, stock out below the opposite hip, with a leather sling across the chest.",
        params: { side: "L = barrel above the character's left shoulder (default)", scope: "false for iron sights", color: "furniture token", sling: "false to omit the strap" },
        example: { props: [{ type: "rifle-back" }] },
        draw(ctx, o) {
          var _a;
          const { R, hh, G, Z } = ctx;
          const side = o.side || "L", k = side === "L" ? 1 : -1;
          const c = R.centerAt(R.y.chest);
          const v2 = o.angle == null;
          const butt = [c - k * (R.w.hip + (v2 ? 0.5 : 0.26) * hh), R.y.hip + (v2 ? 0.42 : 0.62) * hh];
          const th = ((_a = o.angle) != null ? _a : v2 ? 34 : 21) * Math.PI / 180;
          const ang = Math.atan2(-Math.cos(th), k * Math.sin(th));
          const F = K.frame(butt, ang, K.U, 1);
          const r = rifleShapes(ctx, F, Z.backProp, o);
          const out = r.pieces;
          if (o.sling !== false) {
            const a = T(ctx, k * 0.5, -0.02), b = T(ctx, k * 0.1, 0.3), cc = T(ctx, -k * 0.98, 0.78);
            const w = K.inch(1.1);
            const mat = ctx.mat("leather-brown", "leather");
            out.push({ id: "rifle-sling", z: Z.strap, d: K.ribbon([a, b, cc], w), mat });
            out.push({ id: "rifle-sling-slide", z: Z.strap + 0.1, d: K.rrect(b[0] - w * 0.55, b[1] - K.inch(0.6), b[0] + w * 0.55, b[1] + K.inch(0.6), 5), mat: ctx.mat("metal-steel", "metal"), light: { form: 0.5 } });
          }
          return out;
        }
      });
      register({
        kind: "prop",
        name: "bandolier",
        describe: "Diagonal shoulder-to-hip cartridge belt with brass rounds (Stacey).",
        params: { side: "L = starts at the character's left shoulder (default)", color: "strap token (leather-brown)", rounds: "brass token" },
        example: { props: [{ type: "bandolier" }] },
        draw(ctx, o) {
          const { R, G, Z } = ctx;
          const k = (o.side || "L") === "L" ? 1 : -1;
          const a = T(ctx, k * 0.86, 0.01), b = T(ctx, k * 0.1, 0.45), c = T(ctx, -k * 0.74, 0.9);
          const center = [a, b, c];
          const w = K.inch(2.5);
          const dense = G.resample(center, 80, 0.5);
          let len = 0;
          for (let i = 1; i < dense.length; i++) len += G.dist(dense[i], dense[i - 1]);
          const n = Math.max(8, Math.floor(len / K.inch(ctx.lodAtLeast("mid") ? 1 : 1.5)));
          const out = [{ id: "bandolier-strap", z: Z.strap + 0.2, d: K.ribbon(center, w), mat: ctx.mat(o.color || "leather-brown", "leather"), light: { form: 0.8 } }];
          let cases = "", tips = "", gaps = "";
          for (let i = 0; i < n; i++) {
            const t = (i + 0.7) / (n + 0.4);
            const q = Math.min(dense.length - 2, Math.floor(t * (dense.length - 1)));
            const p = G.lerp(dense[q], dense[q + 1], t * (dense.length - 1) - q);
            const d = K.norm(K.sub(dense[q + 1], dense[q])), nrm = K.perp(d);
            const half = w * 0.43, pw = len / n * 0.62;
            const lo = K.add(p, K.mul(nrm, -half)), hi = K.add(p, K.mul(nrm, half));
            const split = K.along(lo, hi, 0.72);
            cases += K.bar(lo, split, pw);
            tips += K.bar(split, hi, pw * 0.8, pw * 0.5);
            if (i) gaps += K.bar(K.add(lo, K.mul(d, -pw * 0.72)), K.add(hi, K.mul(d, -pw * 0.72)), pw * 0.16);
          }
          out.push({ id: "bandolier-gaps", z: Z.strap + 0.25, d: gaps, fill: "leather-black", light: false, o: 0.7 });
          out.push({ id: "bandolier-cases", z: Z.strap + 0.3, d: cases, mat: ctx.mat(o.rounds || "metal-brass", "metal"), light: { form: 0.35, bands: false } });
          out.push({ id: "bandolier-tips", z: Z.strap + 0.35, d: tips, mat: ctx.mat("cloth-rust", "metal"), light: { form: 0.35 } });
          return out;
        }
      });
      module.exports = { rifleShapes };
      register({
        kind: "prop",
        name: "rifle-shoulder",
        describe: "Rifle resting across the shoulders behind the neck, gripped in a raised fist, barrel poking out past the far shoulder (the Veteran). Use arm pose raise (hands: grip for a fist).",
        params: { side: "R|L the raised arm", scope: "true to add a scope" },
        example: { pose: { arms: { R: "raise", L: "down" }, hands: { R: "grip" } }, props: [{ type: "rifle-shoulder", side: "R", scope: false }] },
        draw(ctx, o) {
          const hi = K.pickArm(ctx, o, ["raise"], "rifle-shoulder");
          if (!hi) return [];
          const k = hi.k, dv = K.norm([-k, -0.1]);
          const ang = Math.atan2(dv[1], dv[0]);
          const origin = K.sub(hi.pt, K.mul(dv, K.inch(15)));
          const F = K.frame(origin, ang, K.U, 1, dv[0] > 0 ? 1 : -1);
          return rifleShapes(ctx, F, ctx.Z.backProp + 0.5, { color: o.color || "wood-dark", scope: o.scope === true }).pieces;
        }
      });
      function pistolShapes(ctx, F, z, o = {}) {
        const { G } = ctx;
        const P = (pts) => pts.map(F.P), poly = (pts) => G.poly(P(pts));
        const steel = ctx.mat(o.metal || "metal-gun", "metal"), grip = ctx.mat(o.color || "wood-dark", "wood");
        const out = [];
        out.push({ id: "pistol-grip", z, d: poly([[-2, -2.5], [1, -2.5], [0.55, 3], [-1.8, 3.2]]), mat: grip });
        out.push({ id: "pistol-slide", z: z + 0.01, d: poly([[-2.3, -4.2], [6, -4.2], [6, -2.3], [-2.3, -2.3]]), mat: steel, lines: ctx.lodAtLeast("mid") ? [0, 1, 2].map((i) => ({ d: G.brush(P([[-1.9 + i * 0.5, -4], [-1.9 + i * 0.5, -2.6]]), [K.inch(0.04), K.inch(0.12), K.inch(0.04)]), fill: "deep", o: 0.7 })) : [] });
        out.push({ id: "pistol-barrel", z: z + 0.02, d: poly([[6, -3.7], [6.9, -3.7], [6.9, -2.7], [6, -2.7]]), mat: steel });
        out.push({ id: "pistol-frame", z: z + 0.015, d: poly([[-0.5, -2.3], [4.2, -2.3], [4.2, -1.4], [2.6, -1.1], [1.5, 0.4], [1, -0.2], [-0.5, -0.2]]), mat: steel });
        if (ctx.lodAtLeast("mid")) out.push({ id: "pistol-guard", z: z + 0.03, d: G.brush(P([[1.5, -1.3], [2.6, -1.2], [3, -0.2], [1.4, 0.1]]), K.inch(0.16)), fill: "ink-900", light: false });
        out.push({ id: "pistol-sight", z: z + 0.02, d: poly([[-2.3, -4.2], [-1.6, -4.2], [-1.6, -4.7], [-2.3, -4.7]]) + poly([[5.2, -4.2], [5.8, -4.2], [5.8, -4.6], [5.2, -4.6]]), mat: steel });
        return out;
      }
      register({
        kind: "prop",
        name: "pistol",
        aliases: ["gun", "revolver"],
        describe: "Automatic pistol gripped at the side in a carry-pose fist, barrel pointing down and a little out (the Hound cover), or in a hold-pose hand with the barrel forward.",
        params: { side: "R|L", color: "grip token (wood-dark)" },
        example: { pose: { arms: { R: "carry", L: "down" } }, props: [{ type: "pistol", side: "R" }] },
        draw(ctx, o) {
          const hi = K.pickArm(ctx, o, ["carry", "hold"], "pistol");
          if (!hi) return [];
          const k = hi.k;
          const dv = K.norm(K.add(hi.pose === "hold" ? [k * 0.9, -0.3] : hi.dir, hi.pose === "hold" ? [0, 0] : [k * 0.35, 0]));
          const a = Math.atan2(dv[1], dv[0]);
          const toBody = -k, gy = -Math.sin(a);
          const F = K.frame(hi.pt, a, K.U, 1, gy * toBody >= 0 ? 1 : -1);
          return pistolShapes(ctx, F, hi.zUnder, o);
        }
      });
      register({
        kind: "prop",
        name: "holster",
        describe: "Belt holster at the hip with a pistol grip poking out of the top (hip), or a shoulder rig under the arm (drawn under the jacket: a closed jacket hides it, an open one shows it).",
        params: { at: "hip-R (default) | hip-L | chest-L", style: "hip|shoulder", color: "leather token (leather-brown)" },
        example: { props: [{ type: "holster", at: "hip-R" }] },
        draw(ctx, o) {
          const { G, R, hh } = ctx;
          const a = K.bodyAnchor(ctx, o.at || "hip-R"), k = a.k || -1;
          const shoulder = o.style === "shoulder" || /^chest/.test(o.at || "");
          const mat = ctx.mat(o.color || "leather-brown", "leather");
          const origin = shoulder ? [a.pt[0], a.pt[1] + K.inch(2.2)] : [a.pt[0] - k * K.inch(0.2), R.y.waist + 0.14 * hh];
          const F = K.frame(origin, shoulder ? -k * 1.35 : k * 0.12, K.U, 1);
          const P = (pts) => pts.map(F.P);
          const z = shoulder ? ctx.Z.outer - 0.6 : ctx.Z.belt + 0.7;
          const out = [];
          const gf = K.frame(F.P([0.4, -0.2]), F.angle + k * 0.15, K.U, 1);
          out.push({ id: "holster-gripcore", z, d: G.poly([[-1.6, -2.9], [1.2, -2.9], [1.4, 0.6], [-1.4, 0.6]].map(gf.P)), mat: ctx.mat("wood-dark", "wood"), light: { form: 0.9 } });
          out.push({ id: "holster-hammer", z: z + 0.01, d: G.poly([[-1.3, -2.9], [0.6, -2.9], [0.5, -3.6], [-1, -3.6]].map(gf.P)), mat: ctx.mat("metal-gun", "metal") });
          out.push({ id: "holster-body", z: z + 0.02, d: G.smooth(P([[-2.3, -0.4, true], [2.5, -0.4, true], [2.2, 5.5], [0.4, 8.6], [-1.2, 8.4], [-2.4, 5]]), true, 0.3), mat, shade: [{ d: G.poly(P([[0.4, 8.8], [2.7, 2], [2.7, 8.8]])), o: 0.55 }], light: { form: 1 } });
          out.push({ id: "holster-strap", z: z + 0.03, d: K.ribbon(P([[-2.5, 0.8], [2.7, 0.8]]), K.inch(0.5)), mat, lines: [], light: { form: 0.7 } });
          out.push({ id: "holster-snap", z: z + 0.04, d: G.circle(...F.P([0, 0.8]), K.inch(0.22)), mat: ctx.mat("metal-brass", "metal"), light: false });
          if (shoulder) for (const pc of out) pc.clip = "chest-skin";
          return out;
        }
      });
    }
  });

  // src/parts/props/smoking.js
  var require_smoking = __commonJS({
    "src/parts/props/smoking.js"(exports, module) {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      function smokeOrigin(ctx, o) {
        var _a;
        const { R, G, head: H } = ctx;
        const wantHand = o.at === "hand" || o.at !== "mouth" && ["R", "L"].some((s) => R.arms[s].pose === "smoke" && (!o.side || o.side === s));
        if (wantHand) {
          const hi = K.pickArm(ctx, { side: o.side }, ["smoke"], o.type || "cigarette");
          if (hi) {
            const m = ctx.hp([hi.k * H.mouthW * 0.55, H.mouthY + 4e-3], { depth: 0.04 });
            let d = K.sub(hi.pt, m);
            const dl = Math.hypot(d[0], d[1]);
            // a hand well away from the mouth (a blended arm, part-way up) holds the cigarette itself, pointing along the fingers
            if (ctx.R.arms[hi.side] && typeof (ctx.S.pose && ctx.S.pose.arms && ctx.S.pose.arms[hi.side]) === "object" && dl > K.inch(2.2)) {
              const fd = K.norm(K.add(hi.dir, K.mul(hi.up, -0.6)));
              return { p0: hi.pt, dir: fd, k: hi.k, hand: hi, z: hi.zOver, held: true };
            }
            d = dl > K.inch(0.8) ? K.mul(d, 1 / dl) : K.norm(K.add(K.mul([hi.k, 0], 0.9), [0, 0.38]));
            return { p0: m, dir: d, k: hi.k, hand: hi, z: Math.max(hi.zOver, ctx.Z.eyewear + 0.5) };
          }
        }
        const side = o.side || "R", k = side === "R" ? -1 : 1;
        const p0 = ctx.hp([k * H.mouthW * 0.5, H.mouthY + 4e-3], { depth: 0.04 });
        const p1 = ctx.hp([k * (H.mouthW * 0.5 + 0.3), H.mouthY + 4e-3 + 0.1 * ((_a = o.droop) != null ? _a : 1)], { depth: 0.06 });
        return { p0, dir: K.norm(K.sub(p1, p0)), k, hand: null, z: ctx.Z.eyewear + 0.5 };
      }
      function smokeWisp(ctx, tip, k, o = {}) {
        var _a;
        const { G, hh } = ctx;
        const out = [];
        const h = hh * ((_a = o.height) != null ? _a : 0.95), sway = hh * 0.16;
        const rn = (n) => (ctx.rng() - 0.5) * n;
        const pts = [tip];
        const N = 7;
        for (let i = 1; i <= N; i++) {
          const t = i / N;
          pts.push([tip[0] + Math.sin(t * 5.2 + 0.6) * sway * (0.25 + t) * -k * 0.9 + k * t * hh * 0.1 + rn(2), tip[1] - t * h]);
        }
        const wid = [1.5, 5, 8, 12, 16, 18, 14, 6].map((w) => w * hh / 236);
        out.push({ id: "smoke-wisp", z: ctx.Z.fx, d: G.brush(pts, wid), fill: "smoke", light: false, opacity: 0.7 });
        const dots = K.dotTrail(ctx, pts, { n: ctx.lodAtLeast("hi") ? 90 : 46, r0: 3.4 * hh / 236, r1: 1.8 * hh / 236, spread: 12 * hh / 236, grow: true, keep: (t) => 0.95 - t * 0.5 });
        if (dots) out.push({ id: "smoke-dots", z: ctx.Z.fx + 0.1, d: dots, fill: "smoke", light: false, opacity: 0.8 });
        if (ctx.lodAtLeast("mid")) {
          const q = [tip[0] + k * 6, tip[1] - h * 0.35];
          const c2 = [q, [q[0] + k * hh * 0.12, q[1] - hh * 0.12], [q[0] - k * hh * 0.04, q[1] - hh * 0.26], [q[0] + k * hh * 0.1, q[1] - hh * 0.4]];
          out.push({ id: "smoke-curl", z: ctx.Z.fx, d: G.brush(c2, [1, 4.5 * hh / 236, 3 * hh / 236, 1]), fill: "smoke", light: false, opacity: 0.4 });
        }
        return out;
      }
      register({
        kind: "prop",
        name: "cigarette",
        aliases: ["cig"],
        describe: "Cigarette with a curling stippled smoke wisp and a glowing ember: in the hand for a smoke-pose arm, else at the mouth corner.",
        params: { at: "mouth|hand (default: hand if an arm is in smoke pose)", side: "R|L", smoke: "false to omit the wisp", droop: "0..2 how far the stick droops" },
        example: { face: { expression: "cool" }, props: [{ type: "cigarette", side: "R" }] },
        draw(ctx, o) {
          const { G, hh } = ctx;
          const org = smokeOrigin(ctx, { ...o, type: "cigarette" });
          const { p0, dir, k } = org;
          const v2 = ctx.lod === "mid";
          const L = K.inch(v2 ? 3.9 : 3.4), w = v2 ? Math.min(Math.max(K.inch(0.4), ctx.px(2.6)), 0.045 * ctx.hh) : K.inch(0.4);
          const pe = K.add(p0, K.mul(dir, L));
          const seg = (a, b) => K.along(p0, pe, a) && [K.along(p0, pe, a), K.along(p0, pe, b)];
          const z = org.z;
          const out = [];
          const [f0, f1] = seg(0, 0.24), [b0, b1] = seg(0.24, 0.9), [a0, a1] = seg(0.9, 1);
          out.push({ id: "cig-filter", z, d: K.bar(f0, f1, w), fill: "cloth-ochre", light: false });
          out.push({ id: "cig-paper", z: z + 0.01, d: K.bar(b0, b1, w), mat: ctx.mat("paper-000", "paper"), light: { form: 0.7 } });
          out.push({ id: "cig-ash", z: z + 0.02, d: K.bar(a0, a1, w * 0.95), fill: "ink-300", light: false });
          out.push({ id: "cig-ember", z: z + 0.03, d: G.circle(pe[0], pe[1], w * 0.62), fill: "signal-500", light: false, spot: true });
          out.push({ id: "cig-ember-core", z: z + 0.04, d: G.circle(pe[0], pe[1], w * 0.3), fill: "caution-500", light: false, spot: true });
          if (ctx.lodAtLeast("mid")) out.push({ id: "cig-ember-glow", z: z - 0.01, d: G.circle(pe[0], pe[1], w * 1.05), fill: "signal-500", light: false, spot: true, opacity: 0.16 });
          if (o.smoke !== false) out.push(...smokeWisp(ctx, pe, k, { height: o.smokeHeight }));
          return out;
        }
      });
      function pipePieces(ctx, org, o) {
        const { G } = ctx;
        const k = org.k;
        const F = K.frame(org.p0, Math.atan2(org.dir[1] * k, org.dir[0] * k), K.U, k);
        const P = (pts) => pts.map(F.P);
        const z = org.z;
        const wood = ctx.mat(o.color || "wood-dark", "wood");
        const stemMat = ctx.mat("cloth-black", "satin");
        const out = [];
        const stem = K.ribbon(P([[0, 0], [1.6, 0.25], [3.2, 0.55], [4.1, 0.55]]), [K.inch(0.3), K.inch(0.36), K.inch(0.44)]);
        const shank = K.ribbon(P([[3.9, 0.55], [4.7, 0.5], [5.4, 0.35]]), K.inch(0.62));
        const bowl = G.smooth(P([[4.5, 0.55], [4.7, 1.1], [5.5, 1.25], [6.2, 0.95], [6.35, -0.2], [6.55, -1.5], [4.7, -1.5], [4.65, -0.3]]), true, 0.5);
        const rimT = G.ellipse(...F.P([5.62, -1.5]), K.inch(0.95), K.inch(0.2), F.angle);
        out.push({ id: "pipe-stem", z, d: stem, mat: stemMat, light: { form: 0.8 } });
        out.push({ id: "pipe-shank", z: z + 0.01, d: shank, mat: wood });
        const bowlLines = [];
        if (ctx.lodAtLeast("mid")) bowlLines.push({ d: G.brush(P([[5, 0.9], [5.6, 1.05], [6.1, 0.7]]), [K.inch(0.04), K.inch(0.18), K.inch(0.04)]), fill: "deep", o: 0.7 });
        out.push({ id: "pipe-bowl", z: z + 0.02, d: bowl, mat: wood, shade: [{ d: G.brush(P([[6.4, -1.4], [6.3, 0], [5.9, 1]]), [K.inch(0.1), K.inch(0.5), K.inch(0.1)]), fill: "deep", o: 0.6 }], lines: bowlLines });
        out.push({ id: "pipe-rim", z: z + 0.03, d: rimT, fill: "cloth-black", light: false });
        out.push({ id: "pipe-ash", z: z + 0.04, d: G.ellipse(...F.P([5.62, -1.5]), K.inch(0.62), K.inch(0.1), F.angle), fill: "ink-300", light: false, o: 0.9 });
        out.push({ id: "pipe-ember", z: z + 0.05, d: G.ellipse(...F.P([5.55, -1.52]), K.inch(0.22), K.inch(0.05), F.angle), fill: "signal-500", light: false, spot: true });
        if (ctx.lodAtLeast("mid")) out.push({ id: "pipe-band", z: z + 0.02, d: K.bar(...P([[3.4, 0.4], [3.4, 0.72]]), K.inch(0.1)), fill: "cloth-cream", light: false });
        return { out, tip: F.P([5.6, -1.7]) };
      }
      register({
        kind: "prop",
        name: "pipe",
        describe: "Bent briar pipe with a faint smoke curl: clamped at the mouth corner, or at the hand of a smoke-pose arm (the Intellectual).",
        params: { at: "mouth|hand", side: "R|L", color: "wood token", smoke: "false to omit the curl" },
        example: { pose: { arms: { R: "down", L: "smoke" } }, props: [{ type: "pipe", side: "L" }] },
        draw(ctx, o) {
          const org = smokeOrigin(ctx, { ...o, type: "pipe", droop: 0.35 });
          const { out, tip } = pipePieces(ctx, org, o);
          if (o.smoke !== false) out.push(...smokeWisp(ctx, tip, org.k, { height: 0.55 }));
          return out;
        }
      });
      module.exports = { smokeOrigin, smokeWisp };
    }
  });

  // src/parts/props/umbrella.js
  var require_umbrella = __commonJS({
    "src/parts/props/umbrella.js"() {
      "use strict";
      var { register } = require_registry();
      var K = require_kit();
      var floorY = () => 0;
      var CANOPY = [1, 1.9, 1.8, 1.35, 0.85, 0.42];
      var canopyW = (t) => {
        const m = CANOPY.length - 1, s = Math.min(0.9999, Math.max(0, t)) * m, i = Math.floor(s);
        return CANOPY[i] + (CANOPY[i + 1] - CANOPY[i]) * (s - i);
      };
      register({
        kind: "prop",
        name: "umbrella",
        aliases: ["brolly", "furled-umbrella"],
        describe: "Long furled umbrella carried like a cane: hooked crook handle in the fist, brass ring, tightly rolled canopy with a fold or two and a snap strap, ferrule on the floor beside the foot (the archivist).",
        params: { side: "R|L", color: "canopy cloth token (cloth-black)", handle: "crook|knob", handleColor: "wood token (wood-dark)", strap: "false to omit the snap strap" },
        example: { pose: { arms: { R: "carry", L: "down" } }, props: [{ type: "umbrella", side: "R" }] },
        draw(ctx, o) {
          const { G } = ctx;
          const hi = K.pickArm(ctx, o, ["carry", "down"], "umbrella");
          if (!hi) return [];
          const k = hi.k, z = hi.zUnder;
          const T = K.add(hi.pt, [0, -K.inch(2.2)]);
          const B = [hi.pt[0] + k * K.inch(2.6), floorY()];
          const sv = K.sub(B, T);
          const F = K.frame(T, Math.atan2(-sv[0], sv[1]), K.U, k);
          const P = (pts) => pts.map(F.P);
          const len = Math.hypot(sv[0], sv[1]) / K.U;
          const cloth = ctx.mat(o.color || "cloth-black", "cloth");
          const wood = ctx.mat(o.handleColor || "wood-dark", "wood");
          const brass = ctx.mat("metal-brass", "metal"), steel = ctx.mat("metal-chrome", "metal");
          const y0 = Math.min(7, len * 0.22), y1 = len - 2;
          const span = y1 - y0;
          const at = (t) => y0 + span * t;
          const wid = (t) => K.inch(canopyW(t));
          const out = [];
          out.push({ id: "umbrella-shaft", z, d: K.ribbon(P([[0, 0.2], [0, y0 + 0.2]]), [K.inch(0.52), K.inch(0.56)]), mat: wood, light: { form: 0.8 } });
          const folds = [];
          if (ctx.lodAtLeast("mid")) {
            folds.push({ d: K.ribbon(P([[0.55, at(0.02)], [0.5, at(0.4)], [0.25, at(0.8)], [0.1, at(0.97)]]), [K.inch(0.1), K.inch(0.5), K.inch(0.38), K.inch(0.1)]), fill: "shade", o: 0.7, stip: true });
            folds.push({ d: K.ribbon(P([[-0.35, at(0.04)], [0.05, at(0.3)], [-0.12, at(0.62)], [0.05, at(0.95)]]), [K.inch(0.03), K.inch(0.13), K.inch(0.1), K.inch(0.02)]), fill: "deep", o: 0.75 });
            folds.push({ d: K.ribbon(P([[0.2, at(0.1)], [-0.2, at(0.45)], [0.05, at(0.78)]]), [K.inch(0.02), K.inch(0.1), K.inch(0.02)]), fill: "deep", o: 0.6 });
            folds.push({ d: K.ribbon(P([[-0.62, at(0.06)], [-0.55, at(0.4)], [-0.3, at(0.82)]]), [K.inch(0.02), K.inch(0.09), K.inch(0.02)]), fill: "light", o: 0.5 });
          }
          out.push({ id: "umbrella-canopy", z: z + 5e-3, d: K.ribbon(P([[0, y0], [0, y1]]), wid), mat: cloth, lines: folds, light: { form: 0.95 } });
          if (o.strap !== false) {
            const ts = 0.26, ys = at(ts);
            out.push({
              id: "umbrella-strap",
              z: z + 0.01,
              d: K.ribbon(P([[0, ys - 0.55], [0, ys + 0.55]]), K.inch(canopyW(ts) + 0.12)),
              mat: ctx.mat("cloth-charcoal", "cloth"),
              light: { form: 0.9 },
              lines: ctx.lodAtLeast("mid") ? [{ d: K.ribbon(P([[0.55, ys - 0.5], [0.5, ys + 0.5]]), K.inch(0.2)), fill: "shade", o: 0.6 }] : [],
              over: ctx.lodAtLeast("mid") ? [{ d: G.circle(...F.P([-0.1, ys + 0.05]), K.inch(0.13)), fill: "metal-chrome", o: 1 }] : []
            });
          }
          out.push({ id: "umbrella-ring", z: z + 0.02, d: K.ribbon(P([[0, y0 - 0.35], [0, y0 + 0.15]]), K.inch(0.7)), mat: brass, light: { form: 0.7 } });
          out.push({ id: "umbrella-ferrule", z: z + 0.02, d: K.ribbon(P([[0, y1 - 0.15], [0, len]]), [K.inch(0.4), K.inch(0.26)]), mat: steel, light: { form: 0.7 } });
          if ((o.handle || "crook") === "knob") {
            out.push({ id: "umbrella-knob", z: z + 0.01, d: G.circle(...F.P([0, -0.5]), K.inch(0.85)), mat: wood, light: { form: 1 } });
          } else {
            out.push({ id: "umbrella-crook", z: z + 0.01, d: K.ribbon(P([[0, 0.5], [0, -1.2], [-0.45, -2.1], [-1.4, -2.55], [-2.3, -2.05], [-2.55, -1.05]]), [K.inch(0.62), K.inch(0.6), K.inch(0.5)]), mat: wood, light: { form: 0.9 } });
          }
          out.push(...K.gripFist(ctx, hi, "umbrella"));
          return out;
        }
      });
    }
  });

  // src/parts/textiles/_tex.js
  var require_tex = __commonJS({
    "src/parts/textiles/_tex.js"(exports, module) {
      "use strict";
      var CLR = require_color();
      var TOK = require_tokens();
      var n = (v) => +v.toFixed(2);
      var r = (v, s) => n(v * s);
      function wrap(id, s, body, angle) {
        return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(s)}" height="${n(s)}"${angle ? ` patternTransform="rotate(${n(angle)})"` : ""}>${body}</pattern>`;
      }
      function tint(id, c2, s, angle) {
        return wrap(id, s, `<rect width="${n(s)}" height="${n(s)}" fill="${c2}" opacity="0.4"/>`, angle);
      }
      var tiny = (s, scale) => s * scale < 3;
      var rect = (x, y, w, h, s) => `M${r(x, s)} ${r(y, s)}h${r(w, s)}v${r(h, s)}h${r(-w, s)}z`;
      var poly = (pts, s) => "M" + pts.map(([x, y]) => `${r(x, s)} ${r(y, s)}`).join("L") + "Z";
      var circle = (cx, cy, rad, s) => `M${r(cx - rad, s)} ${r(cy, s)}a${r(rad, s)} ${r(rad, s)} 0 1 0 ${r(2 * rad, s)} 0a${r(rad, s)} ${r(rad, s)} 0 1 0 ${r(-2 * rad, s)} 0z`;
      function cells(rows, s) {
        const c = s / rows[0].length;
        let d = "";
        rows.forEach((row, y) => {
          let x = 0;
          while (x < row.length) {
            if (row[x] !== "1") {
              x++;
              continue;
            }
            let e = x;
            while (e < row.length && row[e] === "1") e++;
            d += `M${n(x * c)} ${n(y * c)}h${n((e - x) * c)}v${n(c)}h${n(-(e - x) * c)}z`;
            x = e;
          }
        });
        return d;
      }
      function bands(s, period, w) {
        let d = "";
        for (let k = -period; k <= 2 * s; k += period) {
          d += `M${n(-s)} ${n(k + s)}L${n(2 * s)} ${n(k - 2 * s)}L${n(2 * s)} ${n(k + w - 2 * s)}L${n(-s)} ${n(k + w + s)}Z`;
        }
        return d;
      }
      function prng(seed) {
        let a = seed >>> 0;
        return () => {
          a = Math.imul(a, 1664525) + 1013904223 >>> 0;
          return a / 4294967296;
        };
      }
      function contrast({ c1, c2, mat, spec }, o = {}) {
        var _a, _b;
        if (spec && spec.color2) return c2;
        const base = mat && mat.base || c1;
        try {
          const dark = CLR.lum(base) < ((_a = o.split) != null ? _a : 0.4);
          return CLR.mix(base, TOK.tok(dark ? o.onDark || "cloth-cream" : o.onLight || "cloth-charcoal"), (_b = o.k) != null ? _b : 0.7);
        } catch (e) {
          return c2;
        }
      }
      module.exports = { n, r, wrap, tint, tiny, rect, poly, circle, cells, bands, prng, contrast };
    }
  });

  // src/parts/textiles/checks.js
  var require_checks = __commonJS({
    "src/parts/textiles/checks.js"() {
      "use strict";
      var { register } = require_registry();
      var X = require_tex();
      var SETT = {
        // [start, width, opacity] bands for one tartan sett, the same in both directions
        tartan: [[0, 0.22, 0.34], [0.26, 0.04, 0.9], [0.42, 0.12, 0.16], [0.66, 0.04, 0.9], [0.76, 0.24, 0.34]]
      };
      register({
        kind: "textile",
        name: "check",
        aliases: ["glen", "windowpane"],
        describe: "Glen check: broad translucent bands with fine overchecks, the sober suit check.",
        params: { color2: "overcheck colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-ash", pattern: { type: "check", color2: "cloth-charcoal" } } } },
        unitHH: 0.42,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const band = (d, o) => `<path d="${d}" fill="${c2}" opacity="${o}"/>`;
          const body = band(X.rect(0.18, 0, 0.34, 1, s), 0.2) + band(X.rect(0, 0.18, 1, 0.34, s), 0.2) + band(X.rect(0.16, 0, 0.05, 1, s), 0.7) + band(X.rect(0.5, 0, 0.05, 1, s), 0.7) + band(X.rect(0, 0.16, 1, 0.05, s), 0.7) + band(X.rect(0, 0.5, 1, 0.05, s), 0.7) + band(X.rect(0.76, 0, 0.02, 1, s), 0.5) + band(X.rect(0, 0.76, 1, 0.02, s), 0.5);
          return X.wrap(id, s, body, angle);
        }
      });
      register({
        kind: "textile",
        name: "gingham",
        describe: "Gingham: two equal sets of translucent stripes that check where they cross.",
        params: { color2: "stripe colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-white", pattern: { type: "gingham", color2: "cloth-cobalt" } } } },
        unitHH: 0.26,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const body = `<path d="${X.rect(0, 0, 0.5, 1, s)}" fill="${c2}" opacity="0.34"/><path d="${X.rect(0, 0, 1, 0.5, s)}" fill="${c2}" opacity="0.34"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
      register({
        kind: "textile",
        name: "tartan",
        aliases: ["plaid"],
        describe: "Tartan: a broad sett of crossing bands, with thin bright overstripes, in one ink.",
        params: { color2: "main ink (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-khaki", pattern: { type: "tartan", color2: "cloth-brown" } } } },
        unitHH: 0.42,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          let body = "";
          for (const [a, w, o] of SETT.tartan) {
            body += `<path d="${X.rect(a, 0, w, 1, s)}" fill="${c2}" opacity="${o}"/>`;
            body += `<path d="${X.rect(0, a, 1, w, s)}" fill="${c2}" opacity="${o}"/>`;
          }
          return X.wrap(id, s, body, angle);
        }
      });
    }
  });

  // src/parts/textiles/houndstooth.js
  var require_houndstooth = __commonJS({
    "src/parts/textiles/houndstooth.js"() {
      "use strict";
      var { register } = require_registry();
      var X = require_tex();
      var HOUND = [
        "11111100",
        "11111001",
        "11110011",
        "11110110",
        "11000000",
        "10010000",
        "00110000",
        "01100000"
      ];
      register({
        kind: "textile",
        name: "hound",
        aliases: ["houndstooth"],
        describe: "Houndstooth check, the 60s classic: solid 4\xD74 checks with diagonal teeth (Alfie's trousers).",
        params: { color2: "mark colour (default: cream on dark cloth, black on light cloth)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-ash", pattern: { type: "hound", color2: "cloth-black" } } } },
        unitHH: 0.32,
        pattern(a) {
          const { id, size, scale, angle } = a, c2 = X.contrast(a, { onLight: "cloth-black", k: 0.85 });
          if (X.tiny(size, scale)) return X.tint(id, c2, size, angle);
          return X.wrap(id, size, `<path d="${X.cells(HOUND, size)}" fill="${c2}"/>`, angle);
        }
      });
    }
  });

  // src/parts/textiles/spots.js
  var require_spots2 = __commonJS({
    "src/parts/textiles/spots.js"() {
      "use strict";
      var { register } = require_registry();
      var X = require_tex();
      register({
        kind: "textile",
        name: "polka",
        aliases: ["dots"],
        describe: "Polka dot: round dots on a staggered grid, the 60s print.",
        params: { color2: "dot colour (default: cream on dark cloth, navy on light cloth)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-navy", pattern: { type: "polka", color2: "cloth-cream" } } } },
        unitHH: 0.22,
        pattern(a) {
          const { id, size: s, scale, angle } = a, c2 = X.contrast(a, { onLight: "cloth-navy", k: 0.85 });
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const d = X.circle(0.25, 0.25, 0.19, s) + X.circle(0.75, 0.75, 0.19, s);
          return X.wrap(id, s, `<path d="${d}" fill="${c2}" opacity="0.92"/>`, angle);
        }
      });
      register({
        kind: "textile",
        name: "argyle",
        describe: "Argyle: a lattice of diamonds with a fine cross through each, the knitted sock and jumper.",
        params: { color2: "diamond colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { base: { type: "tee", color: "cloth-cream", pattern: { type: "argyle", color2: "cloth-brick" } } } },
        unitHH: 0.3,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const diamond = X.poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]], s);
          const body = `<path d="${diamond}" fill="${c2}" opacity="0.55"/><path d="${X.rect(0.475, 0, 0.05, 1, s)}" fill="${c2}" opacity="0.95"/><path d="${X.rect(0, 0.475, 1, 0.05, s)}" fill="${c2}" opacity="0.95"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
    }
  });

  // src/parts/textiles/stripes.js
  var require_stripes = __commonJS({
    "src/parts/textiles/stripes.js"() {
      "use strict";
      var { register } = require_registry();
      var X = require_tex();
      register({
        kind: "textile",
        name: "pinstripe",
        describe: "Pinstripe: one hairline stripe per repeat, the city suit line.",
        params: { color2: "stripe colour (default: a readable contrast, the cloth pulled toward cream or charcoal)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-charcoal", pattern: { type: "pinstripe", color2: "cloth-stone" } } } },
        unitHH: 0.16,
        pattern(a) {
          const { id, size: s, scale, angle } = a, c2 = X.contrast(a, { k: 0.62 });
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const body = `<path d="${X.rect(0.42, 0, 0.16, 1, s)}" fill="${c2}" opacity="0.9"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
      register({
        kind: "textile",
        name: "chalkstripe",
        describe: "Chalkstripe: wide-spaced, soft chalk marks that break into hand-drawn dashes on flannel (far looser than the pinstripe's hairline).",
        params: { color2: "chalk colour (default: a readable contrast, the cloth pulled toward cream or charcoal)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-navy", pattern: { type: "chalkstripe", color2: "cloth-cream" } } } },
        unitHH: 0.42,
        pattern(a) {
          const { id, size: s, scale, angle } = a, c2 = X.contrast(a, { k: 0.8 });
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          let body = `<path d="${X.rect(0.35, 0, 0.3, 1, s)}" fill="${c2}" opacity="0.14"/>`;
          body += `<path d="${X.rect(0.42, 0, 0.16, 1, s)}" fill="${c2}" opacity="0.12"/>`;
          const dashes = [[0, 0.17, 0], [0.21, 0.08, 0.012], [0.34, 0.23, -8e-3], [0.62, 0.07, 0.014], [0.73, 0.2, 0], [0.97, 0.03, 0.02]];
          for (const [y, h, dx] of dashes) body += `<path d="${X.rect(0.465 + dx, y, 0.07, h, s)}" fill="${c2}" opacity="0.62"/>`;
          body += `<path d="${X.rect(0.56, 0.12, 0.02, 0.05, s)}" fill="${c2}" opacity="0.5"/><path d="${X.rect(0.41, 0.58, 0.02, 0.04, s)}" fill="${c2}" opacity="0.5"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
      register({
        kind: "textile",
        name: "breton",
        aliases: ["sailor"],
        describe: "Breton: even horizontal bands, the sailor's stripe.",
        params: { color2: "band colour (default: navy on light cloth, cream on dark cloth)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { base: { type: "tee", color: "cloth-white", pattern: { type: "breton", color2: "cloth-navy" } } } },
        unitHH: 0.14,
        pattern(a) {
          const { id, size: s, scale, angle } = a, c2 = X.contrast(a, { onLight: "cloth-navy", k: 0.8 });
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const body = `<path d="${X.rect(0, 0, 1, 0.25, s)}" fill="${c2}" opacity="0.95"/><path d="${X.rect(0, 0.5, 1, 0.25, s)}" fill="${c2}" opacity="0.95"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
    }
  });

  // src/parts/textiles/tortoise.js
  var require_tortoise = __commonJS({
    "src/parts/textiles/tortoise.js"() {
      "use strict";
      var { register } = require_registry();
      var X = require_tex();
      register({
        kind: "textile",
        name: "tortoise",
        aliases: ["tortoiseshell"],
        describe: "Tortoiseshell: faceted dark-brown blotches in two tones over an amber ground, the horn-rim spectacle acetate.",
        params: { color2: "blotch colour (default: the cloth pulled toward chocolate)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { face: { eyewear: { type: "horn-rim", frame: "cloth-tan", pattern: "tortoise" } } },
        unitHH: 0.12,
        pattern(a) {
          const { id, size: s, scale, angle } = a, c2 = X.contrast(a, { onLight: "cloth-chocolate", onDark: "cloth-tan", k: 0.7 });
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const dark = [
            [[0.04, 0.12], [0.3, 0.02], [0.46, 0.22], [0.31, 0.42], [0.07, 0.34]],
            [[0.56, 0.06], [0.82, 0.1], [0.95, 0.3], [0.72, 0.44], [0.52, 0.3]],
            [[0.12, 0.58], [0.4, 0.5], [0.52, 0.74], [0.34, 0.95], [0.08, 0.82]],
            [[0.64, 0.6], [0.9, 0.54], [0.98, 0.8], [0.76, 0.98], [0.6, 0.82]]
          ];
          const mid = [[[0.34, 0.44], [0.5, 0.42], [0.54, 0.55], [0.4, 0.6]], [[0.86, 0.38], [0.97, 0.4], [0.96, 0.52], [0.86, 0.5]], [[0, 0.42], [0.1, 0.4], [0.12, 0.52], [0.02, 0.54]]];
          let body = "";
          for (const b of dark) body += `<path d="${X.poly(b, s)}" fill="${c2}" opacity="0.8"/>`;
          for (const b of mid) body += `<path d="${X.poly(b, s)}" fill="${c2}" opacity="0.38"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
    }
  });

  // src/parts/textiles/weaves.js
  var require_weaves = __commonJS({
    "src/parts/textiles/weaves.js"() {
      "use strict";
      var { register } = require_registry();
      var X = require_tex();
      register({
        kind: "textile",
        name: "herringbone",
        describe: "Herringbone: short bars that zig and zag into chevrons, the tweed weave.",
        params: { color2: "bar colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-khaki", pattern: { type: "herringbone", color2: "cloth-brown" } } } },
        unitHH: 0.11,
        // one chevron ≈ an inch across (it was 0.34: three-inch chevrons, giant at line-up size)
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const bars = [];
          for (const oy of [0, 0.5]) {
            bars.push(X.poly([[0, oy], [0.2, oy], [0.7, oy + 0.5], [0.5, oy + 0.5]], s));
            bars.push(X.poly([[1, oy], [0.8, oy], [0.3, oy + 0.5], [0.5, oy + 0.5]], s));
          }
          return X.wrap(id, s, `<path d="${bars.join("")}" fill="${c2}"/>`, angle);
        }
      });
      register({
        kind: "textile",
        name: "denim",
        aliases: ["twill"],
        describe: "Denim: fine diagonal twill, the warp showing as close parallel lines.",
        params: { color2: "warp colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-faded-denim", pattern: { type: "denim", color2: "cloth-denim" } } } },
        unitHH: 0.26,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const body = `<path d="${X.bands(s, s / 4, s * 0.12)}" fill="${c2}" opacity="0.5"/><path d="${X.bands(s, s / 4, s * 0.04)}" fill="${c2}" opacity="0.2" transform="translate(${X.n(s / 8)} 0)"/>`;
          return X.wrap(id, s, body, angle);
        }
      });
      register({
        kind: "textile",
        name: "corduroy",
        aliases: ["cords"],
        describe: "Corduroy: close vertical wales, a dark ridge and a soft shadow each side.",
        params: { color2: "wale colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-tobacco", pattern: { type: "corduroy", color2: "cloth-brown" } } } },
        unitHH: 0.18,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          let body = "";
          for (const x of [0.04, 0.54]) {
            body += `<path d="${X.rect(x, 0, 0.42, 1, s)}" fill="${c2}" opacity="0.2"/>`;
            body += `<path d="${X.rect(x + 0.1, 0, 0.22, 1, s)}" fill="${c2}" opacity="0.6"/>`;
          }
          return X.wrap(id, s, body, angle);
        }
      });
      register({
        kind: "textile",
        name: "rib",
        aliases: ["ribbed", "knit-rib"],
        describe: "Rib knit: fine vertical ribs (shadowed purl channels between raised knit columns), the jumper and cuff.",
        params: { color2: "channel colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { base: { type: "tee", color: "cloth-black", pattern: { type: "rib", color2: "cloth-charcoal" } } } },
        unitHH: 0.055,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const channel = X.rect(0.62, 0, 0.26, 1, s);
          const hint = X.rect(0.08, 0, 0.08, 1, s);
          return X.wrap(id, s, `<path d="${channel}" fill="${c2}" opacity="0.55"/><path d="${hint}" fill="${c2}" opacity="0.18"/>`, angle);
        }
      });
      register({
        kind: "textile",
        name: "tweed",
        describe: "Tweed: deterministic flecks of two strengths, the mottled country cloth.",
        params: { color2: "fleck colour (default: the material's deep tone)", scale: "repeat size multiplier", angle: "rotation in degrees" },
        example: { outfit: { bottom: { type: "trousers", color: "cloth-olive", pattern: { type: "tweed", color2: "cloth-ochre" } } } },
        unitHH: 0.3,
        pattern({ id, c2, size: s, scale, angle }) {
          if (X.tiny(s, scale)) return X.tint(id, c2, s, angle);
          const rnd = X.prng(1968);
          const light = [], dark = [];
          for (let i = 0; i < 64; i++) {
            const w = 0.04 + 0.07 * rnd(), h = 0.02 + 0.03 * rnd();
            const x = 0.02 + (0.96 - w) * rnd(), y = 0.02 + (0.96 - h) * rnd();
            (rnd() < 0.5 ? light : dark).push(X.rect(x, y, w, h, s));
          }
          return X.wrap(id, s, `<path d="${light.join("")}" fill="${c2}" opacity="0.35"/><path d="${dark.join("")}" fill="${c2}" opacity="0.7"/>`, angle);
        }
      });
    }
  });

  // src/parts/tops/knitwear.js
  var require_knitwear = __commonJS({
    "src/parts/tops/knitwear.js"() {
      "use strict";
      var { register } = require_registry();
      var REG = require_registry();
      var S = require_shared();
      var { sleeves, torsoFolds } = require_tee();
      register({
        kind: "top",
        name: "turtleneck",
        describe: "Slim ribbed turtleneck (Alfie): high rolled neck up the throat, long sleeves with rib cuffs, fine vertical rib.",
        params: { color: "fabric token", tucked: "true|false", sleeves: "long|short", pattern: "textile name (default: the rib textile when present)" },
        example: { outfit: { base: { type: "turtleneck", color: "cloth-black" } } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-black", o.kind || "knit");
          const tucked = !!o.tucked;
          const hem = tucked ? R.y.waist + 0.25 * hh : R.y.hip + 0.1 * hh;
          const neckH = 0.3;
          const b = S.bodice(ctx, { ease: tucked ? 0.015 : !ctx.under ? 0.045 : 0.022, waistEase: 0.012, neckline: "turtle", neckH, hem, hemDrop: 0.015 });
          const lines = torsoFolds(ctx, b, { hemFolds: !tucked, waist: tucked });
          const hasRib = !!REG.get("textile", "rib");
          const pattern = o.pattern || (hasRib && ctx.lodAtLeast("mid") ? "rib" : void 0);
          if (ctx.lodAtLeast("mid")) {
            const c = R.centerAt(R.y.neckBase), wt = R.w.neck * 1.28, ny = R.y.neckBase - neckH * hh;
            lines.push({ d: G.brush([[c - wt, ny + 0.1 * hh], [c, ny + 0.135 * hh], [c + wt, ny + 0.1 * hh]], [2e-3 * hh, 0.02 * hh, 2e-3 * hh]), fill: "deep", o: 0.7 });
            lines.push({ d: G.brush([[c - wt * 1.05, R.y.chin - 0.01 * hh], [c, R.y.chin + 0.09 * hh], [c + wt * 1.05, R.y.chin - 0.01 * hh]], [2e-3 * hh, 0.07 * hh, 2e-3 * hh]), fill: "deep", o: 0.75 });
            lines.push({ d: G.brush([[c - wt * 0.95, R.y.neckBase - 0.02 * hh], [c, R.y.neckBase + 0.04 * hh], [c + wt * 0.95, R.y.neckBase - 0.02 * hh]], [2e-3 * hh, 0.016 * hh, 2e-3 * hh]), fill: "shade", o: 0.6 });
            if (!pattern) lines.push(...S.ribBody(ctx, R.w.chest * 1.05, R.y.neckBase - neckH * hh, hem, { spacing: ctx.lodAtLeast("hi") ? 0.05 : 0.075 }));
            else lines.push(...S.ribBody(ctx, R.w.neck * 1.3, R.y.neckBase - neckH * hh, R.y.neckBase + 0.1 * hh, { spacing: 0.05 }));
          }
          if (!tucked) lines.push(...S.hemBand(ctx, b, 0.05));
          const L = o.sleeves === "short" ? 0.32 : 0.93;
          const out = [{ id: "turtleneck", yoke: true, z: tucked ? Z.tucked : Z.top, d: b.d, mat, pattern, lines, light: { form: 1 } }];
          out.push(...sleeves(ctx, mat, { to: L, ease: 0.02, pattern, prefix: "turtleneck", cuff: false }));
          if (L > 0.6) out.push(...S.cuffs(ctx, mat, { from: 0.93, to: 1, ease: 0.026, pattern, prefix: "turtleneck", button: false }));
          return out;
        }
      });
      register({
        kind: "top",
        name: "knit",
        describe: "Chunky crew-neck sweater: drop shoulders, thick rib neck, hem and cuffs, optional cable columns.",
        params: { color: "fabric token", sleeves: "long|rolled", cable: "true|false", pattern: "textile name" },
        example: { outfit: { base: { type: "knit", color: "cloth-rust" } } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-rust", o.kind || "knit");
          const hem = R.y.hip + 0.16 * hh;
          const b = S.bodice(ctx, { ease: 0.1, waistEase: 0.09, neckline: "crew", depth: 0.08, neckX: 0.03, drop: 0.045, hem, hemDrop: 0.01 });
          const lines = torsoFolds(ctx, b, { hemFolds: false });
          if (ctx.lodAtLeast("mid")) {
            lines.push(...require_tee().neckRib(ctx, b, 0.062, "deep").map((l) => ({ ...l, o: 0.55 })));
            lines.push(...S.hemBand(ctx, b, 0.095));
            if (o.cable !== false) for (const dx of [-0.34, -0.17, 0.17, 0.34]) {
              const pts = [0.05, 0.5, 1].map((f) => R.torsoPt(dx * R.w.chest / hh * hh * 1, R.y.chest - 0.2 * hh + f * (hem - R.y.chest - 0 * hh)));
              lines.push({ d: G.brush(pts, [4e-3 * hh, 0.022 * hh, 4e-3 * hh]), fill: "shade", o: 0.5 });
              lines.push({ d: G.brush(pts.map((p) => [p[0] - 0.02 * hh, p[1]]), [4e-3 * hh, 0.012 * hh, 4e-3 * hh]), fill: "light", o: 0.35 });
            }
          }
          const L = o.sleeves === "rolled" ? 0.62 : 0.9;
          return [
            { id: "knit", yoke: true, z: Z.top, d: b.d, mat, pattern: o.pattern, lines, light: { form: 1 } },
            ...sleeves(ctx, mat, { to: L, ease: 0.075, pattern: o.pattern, prefix: "knit", hemBand: 0.07, hemO: 0.55, hw: (u, base) => base * (1 + 0.1 * S.sstep(0.05, 0.4, u)) }),
            ...L > 0.8 ? S.cuffs(ctx, mat, { from: 0.9, to: 1, ease: 0.075, pattern: o.pattern, prefix: "knit", button: false }) : []
          ];
        }
      });
    }
  });

  // src/parts/tops/shirt.js
  var require_shirt = __commonJS({
    "src/parts/tops/shirt.js"() {
      "use strict";
      var { register } = require_registry();
      var S = require_shared();
      var { sleeves, torsoFolds, neckRib } = Object.assign({}, S, require_tee());
      function sleeveLen(o, dflt) {
        return o.sleeves === "short" ? 0.32 : o.sleeves === "rolled" ? 0.58 : o.sleeves === "long" ? 0.9 : dflt;
      }
      function collared(ctx, o, cfg) {
        var _a, _b, _c;
        const { R, G, Z, hh } = ctx;
        const mat = ctx.mat(o.color || cfg.color, o.kind || "cloth");
        const tucked = (_a = o.tucked) != null ? _a : cfg.tucked;
        const open = o.collar === "open";
        const hem = tucked ? R.y.waist + 0.25 * hh : R.y.hip + 0.2 * hh;
        const depth = open ? 0.5 : cfg.depth;
        const b = S.bodice(ctx, { ease: tucked ? 0.035 : 0.042, waistEase: cfg.fitted ? 0.02 : void 0, neckline: "v", neckX: 0, depth, hem, hemDrop: tucked ? 0 : 0.07 });
        const lines = torsoFolds(ctx, b, { hemFolds: !tucked, waist: tucked });
        const over = [];
        const nb = R.y.neckBase;
        const cd = open ? { len: 0.3, spread: 0.2, rise: 0.12, gap: 0.04, throat: depth } : cfg.collar;
        const col = cfg.collarFn ? cfg.collarFn(ctx, ctx.mat(o.collarColor || o.color || cfg.color, o.kind || "cloth"), o) : S.collarFlaps(ctx, mat, { ...cd, pattern: o.pattern, id: cfg.name + "-collar" });
        lines.push(...col.shadow);
        if (cfg.placket !== false) {
          const y0 = nb + (open ? depth : cfg.depth) * hh;
          lines.push(S.centreLine(ctx, y0, tucked ? R.y.waist + 0.15 * hh : hem - 0.05 * hh, { dx: 0, o: 0.55 }));
          const n = (_b = cfg.buttons) != null ? _b : 6, gap = (_c = cfg.btnGap) != null ? _c : 0.36;
          const ys = [];
          for (let i = 0; i < n; i++) {
            const Y = y0 + (i === 0 ? 0.06 : 0.06 + i * gap) * hh;
            if (Y < (tucked ? R.y.waist + 0.15 * hh : hem - 0.1 * hh)) ys.push(Y);
          }
          over.push(...S.buttons(ctx, ys));
        }
        const L = sleeveLen(o, cfg.sleeves);
        const out = [{ id: cfg.name, yoke: true, z: tucked ? Z.tucked : Z.top, d: b.d, mat, pattern: o.pattern, lines, over, light: { form: 1 } }, ...col.pieces];
        const cuffed = L > 0.8 && cfg.cuffs;
        out.push(...sleeves(ctx, mat, {
          to: cuffed ? 0.9 : L,
          ease: L > 0.6 ? 0.04 : 0.045,
          pattern: o.pattern,
          prefix: cfg.name,
          hw: L > 0.6 ? (u, base) => base * (1 + 0.06 * S.sstep(0.3, 0.88, u)) : void 0,
          cuff: !cuffed,
          hemBand: cfg.hemBand,
          flare: L < 0.4 ? 0.04 : o.sleeves === "rolled" ? 0.1 : 0
        }));
        if (cuffed) out.push(...S.cuffs(ctx, mat, { from: 0.9, to: 1, ease: 0.052, pattern: o.pattern, prefix: cfg.name }));
        return out;
      }
      register({
        kind: "top",
        name: "shirt",
        describe: "Dress shirt: pointed collar, button placket, cuffs; tucked by default. collar: open for a loosened throat.",
        params: { color: "fabric token", collar: "point|open", sleeves: "long|short|rolled", tucked: "true (default)|false", pattern: "textile name" },
        example: { outfit: { base: { type: "shirt", color: "cloth-white" } } },
        draw: (ctx, o) => collared(ctx, o, { name: "shirt", color: "cloth-white", tucked: true, depth: 0.16, sleeves: 0.9, cuffs: true, buttons: 6, collar: { len: 0.28, spread: 0.14, rise: 0.13, gap: 0.03, throat: 0.07 } })
      });
      register({
        kind: "top",
        name: "polo",
        describe: "Knit polo: soft flat collar, two-button placket, rib-trimmed short sleeves; worn untucked.",
        params: { color: "fabric token", sleeves: "short|long", tucked: "true|false", pattern: "textile name" },
        example: { outfit: { base: { type: "polo", color: "cloth-sky" } } },
        draw: (ctx, o) => collared(ctx, o, { name: "polo", color: "cloth-sky", tucked: false, depth: 0.3, sleeves: 0.32, cuffs: false, buttons: 2, btnGap: 0.16, hemBand: 0.05, collar: { len: 0.2, spread: 0.1, rise: 0.14, gap: 0.05, throat: 0.12 } })
      });
      function peterPan(ctx, mat, o, b) {
        const { R, G, hh } = ctx, mid = ctx.lodAtLeast("mid");
        const np = G.resample(b.neckPts, 44, 0.5), cx = b.neckMid[0], c0 = [cx, R.y.neckBase - 0.05 * hh];
        const wmax = 0.15 * hh, gap = 0.075 * hh;
        const pieces = [], shadow = [];
        const sub = (a, b2) => [a[0] - b2[0], a[1] - b2[1]], unit = (v) => {
          const l = Math.hypot(v[0], v[1]) || 1;
          return [v[0] / l, v[1] / l];
        };
        const half = Math.floor(np.length / 2);
        [["L", np.slice(0, half)], ["R", np.slice(half).reverse()]].forEach(([s, all]) => {
          const arr = all.filter((p) => Math.abs(p[0] - cx) > gap);
          if (arr.length < 4) return;
          const n = arr.length, inner = [], outer = [], norms = [];
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1), tan2 = unit(sub(arr[Math.min(n - 1, i + 1)], arr[Math.max(0, i - 1)]));
            let nm2 = [-tan2[1], tan2[0]];
            if (nm2[0] * (arr[i][0] - c0[0]) + nm2[1] * (arr[i][1] - c0[1]) < 0) nm2 = [-nm2[0], -nm2[1]];
            const w2 = wmax * (0.28 + 0.72 * Math.sin(Math.min(1, t / 0.82) * Math.PI / 2));
            norms.push([nm2, w2, tan2]);
            inner.push([arr[i][0] - nm2[0] * 0.012 * hh, arr[i][1] - nm2[1] * 0.012 * hh]);
            outer.push([arr[i][0] + nm2[0] * w2, arr[i][1] + nm2[1] * w2]);
          }
          const [nm, w, tan] = norms[n - 1], ci = [(inner[n - 1][0] + outer[n - 1][0]) / 2, (inner[n - 1][1] + outer[n - 1][1]) / 2], r = Math.hypot(outer[n - 1][0] - inner[n - 1][0], outer[n - 1][1] - inner[n - 1][1]) / 2;
          const tip = [1, 2, 3, 4].map((j) => {
            const th = j * Math.PI / 5, cs = Math.cos(th), sn = Math.sin(th);
            return [ci[0] - nm[0] * r * cs + tan[0] * r * sn, ci[1] - nm[1] * r * cs + tan[1] * r * sn];
          });
          const d = G.smooth([...inner, ...tip, ...outer.slice().reverse()], true, 0.5);
          const lines = mid ? [{ d: G.brush(inner.slice(0, n - 1), [4e-3 * hh, 0.014 * hh, 0.014 * hh, 4e-3 * hh]), fill: "deep", o: 0.35 }] : [];
          pieces.push({ id: `blouse-collar-${s}`, z: 31.8, d, mat, lines, light: { form: 0.5 } });
          shadow.push({ d: G.translate(d, 6e-3 * hh * (s === "L" ? 1 : -1), 0.02 * hh), fill: "deep", o: 0.5 });
        });
        return { pieces, shadow };
      }
      register({
        kind: "top",
        name: "blouse",
        describe: "60s blouse with a Peter Pan collar (collarColor for a contrast collar); close-fitted, long or short sleeves; length: crop for a cropped top.",
        params: { color: "fabric token", collarColor: "fabric token", sleeves: "long|short|rolled", tucked: "true|false", length: "crop|normal", pattern: "textile name" },
        example: { outfit: { base: { type: "blouse", color: "cloth-cream", collarColor: "cloth-white" } } },
        draw(ctx, o) {
          const { R, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-cream", o.kind || "cloth");
          const crop = o.length === "crop", tucked = !!o.tucked && !crop;
          const hem = crop ? R.y.waist - 0.02 * hh : tucked ? R.y.waist + 0.25 * hh : R.y.hip + 0.1 * hh;
          const b = S.bodice(ctx, { ease: 0.03, waistEase: 0.015, neckline: "scoop", depth: 0.2, neckX: 0.02, hem, hemDrop: crop ? 0 : 0.02 });
          const col = peterPan(ctx, ctx.mat(o.collarColor || o.color || "cloth-white", o.kind || "cloth"), o, b);
          const lines = torsoFolds(ctx, b, { hemFolds: !tucked && !crop, waist: tucked || crop });
          lines.push(...col.shadow);
          const L = o.sleeves === "short" ? 0.32 : o.sleeves === "rolled" ? 0.58 : 0.92;
          return [
            { id: "blouse", yoke: true, z: tucked ? Z.tucked : Z.top, d: b.d, mat, pattern: o.pattern, lines, light: { form: 1 } },
            ...col.pieces,
            ...sleeves(ctx, mat, { to: L, ease: 0.03, pattern: o.pattern, prefix: "blouse", hemBand: 0.03, flare: L < 0.4 ? 0.03 : 0 })
          ];
        }
      });
    }
  });

  // src/parts/tops/sleeveless.js
  var require_sleeveless = __commonJS({
    "src/parts/tops/sleeveless.js"() {
      "use strict";
      var { register } = require_registry();
      var S = require_shared();
      var { torsoFolds, neckRib } = require_tee();
      register({
        kind: "top",
        name: "shell",
        describe: "Sleeveless 60s shell: boat or scoop neck, wide straps, slight A-line; length: crop for a cropped version.",
        params: { color: "fabric token", neckline: "boat|scoop|crew|v", tucked: "true|false", length: "crop|normal", pattern: "textile name" },
        example: { outfit: { base: { type: "shell", color: "cloth-pink" } } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-pink", o.kind || "cloth");
          const crop = o.length === "crop", tucked = !!o.tucked && !crop;
          const hem = crop ? R.y.waist - 0.02 * hh : tucked ? R.y.waist + 0.25 * hh : R.y.hip + 0.1 * hh;
          const nl = o.neckline || "boat";
          const b = S.bodice(ctx, { ease: 0.03, waistEase: 0.02, flare: crop || tucked ? 0 : 0.03, neckline: nl, armhole: "cut", strap: nl === "boat" ? 0.82 : 0.62, hem, hemDrop: crop ? 0 : 0.02 });
          const lines = torsoFolds(ctx, b, { hemFolds: !tucked && !crop, waist: tucked || crop, armShadow: false });
          if (ctx.lodAtLeast("mid")) {
            lines.push(...neckRib(ctx, b, 0.02));
            for (const s of ["R", "L"]) {
              const P = b.pts[s];
              const pts = [P.strapTop, P.armA, P.armB, P.armpit].map((p) => [p[0], p[1]]);
              lines.push({ d: G.brush(pts, [0.012 * hh, 0.018 * hh, 0.018 * hh, 4e-3 * hh]), fill: "shade", o: 0.5 });
            }
            if (!crop) {
              for (const s of ["R", "L"]) {
                const k = R.sx(s);
                const a = R.torsoPt(k * R.w.chest * 0.5, R.y.chest + 0.15 * hh), c = R.torsoPt(k * R.w.waist * 0.4, R.y.waist - 0.02 * hh);
                lines.push({ d: G.brush([a, c], [2e-3 * hh, 0.014 * hh]), fill: "shade", o: 0.45 });
              }
            }
          }
          return [{ id: "shell", z: tucked ? Z.tucked : Z.top, d: b.d, mat, pattern: o.pattern, lines, light: { form: 1 } }];
        }
      });
      register({
        kind: "top",
        name: "tank",
        describe: "Ribbed tank / vest top: scoop neck, narrow straps, rib trim at the hem; slim, untucked or tucked.",
        params: { color: "fabric token", tucked: "true|false", pattern: "textile name" },
        example: { outfit: { base: { type: "tank", color: "cloth-white" } } },
        draw(ctx, o) {
          const { R, G, Z, hh } = ctx;
          const mat = ctx.mat(o.color || "cloth-white", o.kind || "knit");
          const tucked = !!o.tucked;
          const hem = tucked ? R.y.waist + 0.25 * hh : R.y.hip + 0.05 * hh;
          const arms = {};
          const armInner = (s, Y) => {
            const k = R.sx(s), lb = arms[s] || (arms[s] = ctx.body.limb("arm", s, { from: 0, to: 0.4, ease: 0 }));
            let best = 0, bd = Infinity;
            for (let u = 0; u <= 0.4; u += 0.01) {
              const d = Math.abs(lb.at(u)[1] - Y);
              if (d < bd) {
                bd = d;
                best = u;
              }
            }
            return k * (lb.at(best)[0] - k * lb.hw(best) - R.centerAt(Y)) + 0.03 * hh;
          };
          const b = S.bodice(ctx, { ease: 0.022, waistEase: 0.014, neckline: "scoop", depth: 0.3, neckX: 0.02, armhole: "cut", strap: 0.4, hem, hemDrop: 0.01, armInner });
          const lines = torsoFolds(ctx, b, { hemFolds: false, waist: tucked, armShadow: false });
          if (ctx.lodAtLeast("mid")) {
            lines.push(...neckRib(ctx, b, 0.03));
            lines.push(...S.ribBody(ctx, R.w.chest * 1, R.y.chest, hem, { spacing: 0.08, w: 6e-3 }));
            if (!tucked) lines.push(...S.hemBand(ctx, b, 0.04));
          }
          return [{ id: "tank", z: tucked ? Z.tucked : Z.top, d: b.d, mat, pattern: o.pattern, lines, light: { form: 1 } }];
        }
      });
    }
  });

  // src/parts/index.js
  var require_parts = __commonJS({
    "src/parts/index.js"() {
      require_lines();
      require_belts();
      require_standard();
      require_skirts();
      require_trousers_more();
      require_trousers();
      require_cat();
      require_dog();
      require_boiler_suit();
      require_dresses();
      require_overalls();
      require_basic();
      require_almond();
      require_brows_more();
      require_brows_straight();
      require_eyes_more();
      require_eyepatch();
      require_frames();
      require_beards();
      require_stubble();
      require_boots();
      require_oxfords();
      require_shoes();
      require_gloves();
      require_bobs();
      require_long();
      require_short();
      require_slick();
      require_volume();
      require_anchors();
      require_poses();
      require_relaxed();
      require_hats_main();
      require_hats_more();
      require_riot();
      require_ears_more();
      require_ears_normal();
      require_oval();
      require_shapes();
      require_earrings();
      require_necklace();
      require_wrist();
      require_legwear();
      require_looks();
      require_plaster();
      require_scar();
      require_spots();
      require_balaclava();
      require_bandana();
      require_blank();
      require_domino();
      require_gas_mask();
      require_stocking();
      require_surgical();
      require_apron();
      require_layers();
      require_waistcoat();
      require_pendant();
      require_scarf();
      require_tie();
      require_mouth_neutral();
      require_mouth_variants();
      require_nose_straight();
      require_nose_variants();
      require_leather();
      require_longcoats();
      require_military();
      require_tailored();
      require_armband();
      require_badges();
      require_carried();
      require_fx2();
      require_leg();
      require_militants();
      require_rifles();
      require_smoking();
      require_umbrella();
      require_checks();
      require_houndstooth();
      require_spots2();
      require_stripes();
      require_tortoise();
      require_weaves();
      require_knitwear();
      require_shirt();
      require_sleeveless();
      require_tee();
    }
  });

  // src/core/poses.js
  var require_poses2 = __commonJS({
    "src/core/poses.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var ARM_POSES = {
        down: "Hanging by the side, slight bend.",
        pocket: "Hand in the front trouser pocket, elbow out.",
        hip: "Hand on hip, akimbo.",
        cross: "Arms folded across the chest (set on both sides).",
        smoke: "Hand raised to the mouth (cigarette, pipe).",
        hold: "Forearm forward in front of the belly, holding something.",
        behind: "Hands clasped behind the back.",
        carry: "Straight arm carrying something heavy (briefcase, bag).",
        raise: "Forearm raised beside the head (peace sign, wave, toast).",
        lapel: "Hand gripping the jacket lapel at the chest."
      };
      var U1 = 1.42;
      var F1 = 1.18;
      function arm(pose, env) {
        const { k, sh, w, y, hh, widthAt, centerAt, pelvisShift, ik } = env;
        const U = U1 * hh, F = F1 * hh;
        const c = (Y) => centerAt(Y);
        const edge = (Y) => c(Y) + k * widthAt(Y);
        const out = (Y, d) => c(Y) + k * (widthAt(Y) + d * hh);
        const rel = (Y, x) => c(Y) + k * x * hh;
        const tilt = env.pelvisTilt || 0;
        const hipPt = (x, Y) => tilt ? G.rot([pelvisShift + x, Y], tilt, [pelvisShift, y.hip]) : [pelvisShift + x, Y];
        const pullTo = (a, b, max) => {
          const d = G.dist(a, b);
          return d > max ? G.add(a, G.mul(G.sub(b, a), max / d)) : b;
        };
        const bend = (wr, pref, L1 = U, L2 = F) => {
          const a = ik(sh, wr, L1, L2, 1), b = ik(sh, wr, L1, L2, -1);
          const m = G.mul(G.add(sh, wr), 0.5);
          const sc = (p) => (p[0] - m[0]) * pref[0] + (p[1] - m[1]) * pref[1];
          return sc(a) >= sc(b) ? a : b;
        };
        const reach = (wr, max) => pullTo(sh, wr, max);
        let elbow, wrist, handDir, z = 45, foreFront = false;
        switch (pose) {
          case "pocket": {
            wrist = hipPt(k * w.hip * 0.55, y.hip + 0.2 * hh);
            const ey = y.waist + 0.16 * hh;
            elbow = [Math.max(k * (out(ey, 0.2) - c(ey)), k * (sh[0] - c(ey)) + 0.1 * hh) * k + c(ey), ey];
            elbow = pullTo(sh, elbow, U * 0.99);
            wrist = pullTo(elbow, wrist, F * 0.98);
            handDir = G.norm(G.sub(wrist, elbow));
            break;
          }
          case "hip": {
            const wy = y.waist + 0.3 * hh;
            wrist = hipPt(k * (widthAt(wy) - 0.075 * hh), wy);
            wrist = reach(wrist, (U * 0.9 + F * 0.8) * 0.96);
            elbow = bend(wrist, [k, 0.1], U * 0.92, F * 0.84);
            handDir = G.norm([-k * 0.4, 0.92]);
            z = 45;
            foreFront = false;
            break;
          }
          case "cross": {
            const top = env.side === "R";
            const ey = y.chest + (top ? 0.78 : 0.98) * hh;
            const eW = widthAt(ey) / hh;
            const ex = rel(ey, Math.max(w.shoulder / hh - 0.35, Math.min(eW * 0.9, 0.86 + 0.15 * (eW - 0.95))));
            elbow = [ex, ey];
            const th = (top ? 17 : 11) * Math.PI / 180;
            wrist = [ex - k * F * Math.cos(th) * 0.97, ey - F * Math.sin(th)];
            elbow = pullTo(sh, elbow, U * 0.99);
            handDir = [-k * Math.cos(th), -Math.sin(th) * 1.1];
            z = top ? 55.5 : 55;
            foreFront = true;
            break;
          }
          case "smoke": {
            const wy = y.chin + 0.4 * hh;
            wrist = [c(wy) + k * 0.38 * hh, wy];
            const ex = c(y.chest + 0.5 * hh) + k * Math.min(widthAt(y.chest + 0.5 * hh) * 0.84, widthAt(y.chest + 0.5 * hh) - 0.1 * hh);
            const dx = ex - wrist[0];
            elbow = [ex, wrist[1] + Math.sqrt(Math.max(0.02, F * F * 0.92 - dx * dx))];
            elbow = pullTo(sh, elbow, U * 0.97);
            handDir = G.norm([-k * 0.42, -0.9]);
            z = 56;
            foreFront = true;
            break;
          }
          case "hold": {
            const ey = y.waist + 0.12 * hh;
            elbow = [out(ey, 0.1), ey];
            elbow = pullTo(sh, elbow, U * 0.97);
            wrist = [c(y.waist) + k * 0.47 * hh, y.waist - 0.2 * hh];
            wrist = pullTo(elbow, wrist, F * 0.8);
            handDir = G.norm([-k * 0.62, -0.5]);
            z = 50;
            foreFront = true;
            break;
          }
          case "behind": {
            const ey = y.waist + 0.08 * hh;
            elbow = [out(ey, 0.07), ey];
            elbow = pullTo(sh, elbow, U * 0.97);
            wrist = [c(y.hip) + k * 0.22 * hh, y.hip + 0.12 * hh];
            handDir = G.norm([-k, 0.3]);
            z = 18;
            break;
          }
          case "carry": {
            wrist = [out(y.hip, 0.2), sh[1] + (U1 + F1 - 0.06) * hh];
            wrist = reach(wrist, (U + F) * 0.995);
            elbow = bend(wrist, [k, 0]);
            handDir = [k * 0.03, 1];
            break;
          }
          case "raise": {
            wrist = [c(y.chin) + k * (w.shoulder * 0.5 + 0.42 * hh), y.chin + 0.4 * hh];
            const ex = wrist[0] + k * 0.52 * hh;
            elbow = [ex, wrist[1] + Math.sqrt(Math.max(0.02, F * F * 0.96 - Math.pow(ex - wrist[0], 2)))];
            elbow = pullTo(sh, elbow, U * 0.97);
            handDir = G.norm([-k * 0.12, -1]);
            z = 46;
            break;
          }
          case "lapel": {
            const ey = y.waist + 0.1 * hh;
            elbow = [out(ey, 0.1), ey];
            elbow = pullTo(sh, elbow, U * 0.98);
            wrist = [c(y.chest) + k * 0.36 * hh, y.chest + 0.32 * hh];
            wrist = pullTo(elbow, wrist, F * 0.85);
            handDir = G.norm([-k * 0.5, -0.85]);
            z = 50;
            foreFront = true;
            break;
          }
          default: {
            let ey = sh[1] + U * 0.985;
            const exK = k * Math.max(k * (sh[0] - c(ey)) + 0.02 * hh, widthAt(ey) + 0.1 * hh);
            elbow = [c(ey) + exK, ey];
            elbow = pullTo(sh, elbow, U);
            const wx = Math.max(k * (elbow[0] - c(ey)) + 0.025 * hh, widthAt(y.hip) + 0.1 * hh);
            wrist = [c(ey) + k * wx, elbow[1] + Math.sqrt(Math.max(0.01, F * F - Math.pow(wx - k * (elbow[0] - c(ey)), 2))) * 0.985];
            handDir = G.norm([k * 0.05, 1]);
          }
        }
        return { elbow, wrist, handDir, z, foreFront };
      }
      module.exports = { arm, ARM_POSES };
    }
  });

  // src/core/rig.js
  var require_rig = __commonJS({
    "src/core/rig.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var POSES = require_poses2();
      var U = 25;
      var sx = (side) => side === "R" ? -1 : 1;
      var SHAPES = {
        lean: { shoulder: 1, chest: 0.92, waist: 0.74, hip: 0.8, heads: 7.4, desc: "Average, slightly tapered. The neutral default." },
        rect: { shoulder: 1.14, chest: 1.13, waist: 1.12, hip: 1.06, heads: 7.6, desc: "Boxy, straight-sided: solid, immovable, old soldier." },
        // [1.08 1.06 1.00 0.97]
        invtri: { shoulder: 1.32, chest: 1.08, waist: 0.68, hip: 0.74, heads: 7.6, desc: "Wide shoulders, narrow hips: athletic, dangerous." },
        // [1.20 1.02 0.70 0.76]
        column: { shoulder: 0.78, chest: 0.7, waist: 0.64, hip: 0.67, heads: 7.2, desc: "Narrow and straight: wiry, young, shifty." },
        // [0.86 0.78 0.68 0.72]
        pear: { shoulder: 0.74, chest: 0.82, waist: 1, hip: 1.22, heads: 6.7, desc: "Narrow top, wide base: grounded, odd, comic." },
        // [0.84 0.86 0.90 1.06, 7.0 heads]
        oval: { shoulder: 0.97, chest: 1.08, waist: 1.4, hip: 1.3, heads: 6.7, desc: "Round belly: comfortable, greedy, jolly." },
        // [0.98 1.06 1.18 1.06, 7.0 heads]: the chest stays near the shoulder, or the coats' soft shoulder notches
        hourglass: { shoulder: 0.82, chest: 0.86, waist: 0.56, hip: 1.01, heads: 7.6, desc: "Balanced shoulders and hips, small waist: poised, glamorous." },
        // [0.88 0.88 0.62 0.94]
        lanky: { shoulder: 0.88, chest: 0.74, waist: 0.62, hip: 0.68, heads: 8.4, desc: "Long limbs, small head: awkward, scholarly, elegant." },
        // [0.92 0.80 0.66 0.72, 8.0 heads]
        slim: { shoulder: 0.76, chest: 0.74, waist: 0.56, hip: 0.84, heads: 7.8, desc: "Slender fashion-plate figure (fem default)." }
        // [0.84 0.80 0.62 0.84]: the hip stays, or slim drifts toward hourglass
      };
      var TURNOUT = { square: [17, 17], easy: [27, 33], wide: [30, 30] };
      var TOE_SHARE = 0.76;
      var FOOT_W = 0.38;
      var EASY = {
        pelvisShift: 0.12,
        // hh: the pelvis moves over the weight leg
        pelvisTilt: 0.07,
        // rad: and rises on that side
        shoulderTilt: 0.045,
        // rad: the shoulders counter-tilt (the weight-side shoulder drops)
        weightIn: 0.05,
        // hh: the weight ankle sits this far toward the weight side of the neck pit
        freeOut: 0.22,
        // hh: the free ankle sits this far outside the free hip joint (on a lean pelvis; less on wider hips)
        hipRef: 0.44,
        // hh: the lean figure's hip-joint offset, where freeOut applies in full
        kneeIn: 0.24,
        // hh: the free knee comes in toward the centre line (scaled by the hip-joint offset: less on a narrow pelvis)
        kneeDrop: 0.1
        // hh: and drops (the free shin is foreshortened: that foot is forward)
      };
      function ik(a, c, L1, L2, bendSign) {
        const d = Math.min(G.dist(a, c), L1 + L2 - 1e-6);
        const dir = G.norm(G.sub(c, a));
        const x = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
        const base = G.add(a, G.mul(dir, x));
        return G.add(base, G.mul(G.perp(dir), h * bendSign));
      }
      function rig(S) {
        var _a, _b;
        const H = S.heightIn * U;
        const shape = SHAPES[S.shape] || SHAPES.lean;
        const heads = S.heads || shape.heads;
        const hh = H / heads;
        const fem = S.figure === "fem";
        const B = S.build;
        const bm = S.body || {};
        const bw = Math.pow(B, 0.7);
        const crown = -H;
        const y = {
          crown,
          eye: crown + 0.5 * hh,
          chin: crown + hh,
          neckTop: crown + 0.86 * hh,
          neckBase: crown + (fem ? 1.24 : 1.2) * hh,
          shoulder: crown + (fem ? 1.47 : 1.44) * hh,
          chest: crown + (fem ? 1.98 : 2) * hh,
          waist: crown + (fem ? 2.72 : 2.86) * hh,
          hip: crown + (fem ? 3.22 : 3.3) * hh,
          crotch: crown + (fem ? 3.52 : 3.6) * hh
        };
        const stoop = Math.max(0, Math.min(1, +(S.pose || {}).stoop || 0));
        if (stoop) {
          const sk = stoop * 0.5 * hh;
          for (const n of ["crown", "eye", "chin", "neckTop"]) y[n] += 1.2 * sk;
          y.neckBase += sk;
          y.shoulder += sk;
          y.chest += 0.6 * sk;
          y.waist += 0.1 * sk;
        }
        y.ankle = -0.3 * hh;
        y.knee = y.crotch + (y.ankle - y.crotch) * 0.47;
        y.floor = 0;
        const femK = fem ? 0.9 : 1;
        const w = {
          neck: hh * (fem ? 0.155 : 0.2) * (bm.neck || 1) * Math.pow(B, 0.6),
          shoulder: hh * shape.shoulder * B * (bm.shoulders || 1) * (fem && !S.shape ? 0.9 : 1),
          chest: hh * shape.chest * B * (bm.chest || 1),
          waist: hh * shape.waist * B * (bm.waist || 1) + hh * 0.22 * (bm.belly || 0),
          hip: hh * shape.hip * B * (bm.hips || 1),
          head: 0.36 * (((_a = S.head) == null ? void 0 : _a.width) || 1) * (fem ? 0.95 : 1)
          // in head-space units
        };
        w.neckBase = w.neck * 1.18;
        const armK = (bm.arms || 1) * bw * femK;
        const legK = (bm.legs || 1) * bw * femK;
        const limbs = {
          arm: { top: 0.165 * hh * armK, bicep: 0.175 * hh * armK, elbow: 0.135 * hh * armK, forearm: 0.155 * hh * armK, wrist: 0.095 * hh * armK },
          leg: { thigh: Math.min(0.36 * hh * legK, w.hip * 0.55), knee: 0.165 * hh * legK, calf: 0.195 * hh * legK, ankle: 0.1 * hh * legK },
          hand: 0.75 * hh * (bm.hands || 1) * (fem ? 0.88 : 1),
          foot: 1 * hh * (bm.feet || 1) * (fem ? 0.86 : 1)
          // heel-to-toe length (the shoe's own length rides on it)
        };
        const P = S.pose || {};
        const stance = P.stance || "square";
        const ws = P.weight === "R" ? "R" : "L";
        const sw = sx(ws);
        const easy = stance === "easy";
        const pelvisShift = easy ? sw * EASY.pelvisShift * hh : 0;
        const pelvisTilt = easy ? -sw * EASY.pelvisTilt : 0;
        const shoulderTilt = easy ? sw * EASY.shoulderTilt : 0;
        const shoulderC = [pelvisShift * 0.35, y.shoulder];
        function centerAt(Y) {
          if (Y <= y.chest) return shoulderC[0];
          if (Y >= y.waist) return pelvisShift;
          return G.lerp(shoulderC[0], pelvisShift, (Y - y.chest) / (y.waist - y.chest));
        }
        function tiltAt(Y) {
          if (Y <= y.chest) return shoulderTilt;
          if (Y >= y.waist) return pelvisTilt;
          return G.lerp(shoulderTilt, pelvisTilt, (Y - y.chest) / (y.waist - y.chest));
        }
        const prof = [
          [y.neckBase, w.neckBase],
          [y.shoulder, w.shoulder * 0.9],
          [y.shoulder + 0.2 * hh, w.shoulder],
          [y.chest - 0.25 * hh, (w.shoulder + w.chest) / 2 * 0.97],
          [y.chest, w.chest],
          [y.waist, w.waist],
          [y.hip, w.hip],
          [y.crotch, w.hip * 0.99],
          [y.crotch + 2 * hh, w.hip * 1]
        ];
        function widthAt(Y) {
          if (Y <= prof[0][0]) return prof[0][1];
          for (let i = 0; i < prof.length - 1; i++) {
            const [y0, w0] = prof[i], [y1, w1] = prof[i + 1];
            if (Y <= y1) {
              const t = (Y - y0) / (y1 - y0);
              const s = t * t * (3 - 2 * t);
              return w0 + (w1 - w0) * s;
            }
          }
          return prof[prof.length - 1][1];
        }
        function torsoPt(x, Y) {
          const c = centerAt(Y), a = tiltAt(Y);
          const pivotY = Y <= y.chest ? y.shoulder : Y >= y.waist ? y.hip : Y;
          const p = [c + x, Y];
          return a ? G.rot(p, a, [c, pivotY]) : p;
        }
        const shoulderJ = {}, hipJ = {};
        for (const s of ["R", "L"]) {
          const k = sx(s);
          shoulderJ[s] = torsoPt(k * (w.shoulder - limbs.arm.top * 1.1), y.shoulder + 0.2 * hh);
          hipJ[s] = torsoPt(k * (w.hip - limbs.leg.thigh), y.hip + 0.1 * hh);
        }
        const legs = {};
        const bigLeg = bm.bigLeg || S.bigLeg || null;
        const L1 = y.knee - (y.hip + 0.1 * hh), L2 = y.ankle - y.knee;
        const neckPit = centerAt(y.neckBase);
        for (const s of ["R", "L"]) {
          const k = sx(s);
          const hip = hipJ[s];
          const weightLeg = easy && s === ws, free = easy && s !== ws;
          let ankle, knee;
          if (weightLeg) ankle = [neckPit + k * EASY.weightIn * hh, y.ankle];
          else if (free) {
            const spread = Math.max(0.3, Math.min(1, EASY.hipRef * hh / Math.max(1e-6, Math.abs(hip[0] - pelvisShift))));
            ankle = [hip[0] + k * EASY.freeOut * spread * hh, y.ankle];
          } else if (stance === "wide") ankle = [k * (w.hip + 0.35 * hh), y.ankle];
          else ankle = [k * (w.hip - limbs.leg.thigh) * 1.05, y.ankle];
          if (free) {
            const kneeK = Math.max(0.55, Math.min(1.25, Math.abs(hip[0] - pelvisShift) / (EASY.hipRef * hh)));
            const t = (y.knee - hip[1]) / (ankle[1] - hip[1]);
            knee = [G.lerp(hip[0], ankle[0], t) - k * EASY.kneeIn * kneeK * hh, y.knee + EASY.kneeDrop * hh];
          } else knee = ik(hip, ankle, L1, L2, k * 0.25);
          const big = bigLeg === s ? 2 : 1;
          const widths = {
            thigh: limbs.leg.thigh * (big > 1 ? 1.5 : 1),
            knee: limbs.leg.knee * big,
            calf: limbs.leg.calf * big,
            ankle: limbs.leg.ankle * (big > 1 ? 1.6 : 1)
          };
          const turnout = (TURNOUT[stance] || TURNOUT.square)[free ? 1 : 0] * Math.PI / 180;
          const footLen = limbs.foot * (big > 1 ? 1.4 : 1), footW = footLen * FOOT_W * (fem ? 0.94 : 1);
          const sn = Math.sin(turnout), cs = Math.cos(turnout);
          const reach = TOE_SHARE * footLen * sn + 0.5 * footW * cs, heelReach = (1 - TOE_SHARE) * footLen * sn + 0.5 * footW * cs;
          const toe = [ankle[0] + k * reach, 0], heel = [ankle[0] - k * heelReach, 0];
          legs[s] = {
            side: s,
            k,
            hip,
            knee,
            ankle,
            toe,
            heel,
            turnout,
            toeDir: [k * sn, cs],
            reach,
            heelReach,
            widths,
            big: big > 1,
            footLen,
            footW,
            weight: weightLeg,
            free
          };
        }
        const arms = {};
        const A = P.arms || {};
        for (const s of ["R", "L"]) {
          const k = sx(s);
          const want = A[s] || (S.hands === "pockets" ? "pocket" : "down");
          // a blend { a, b, t, as } puts the arm part-way from pose a to pose b (t 0..1), for animation frames; the parts and
          // props read it as pose `as` (default b), so a cigarette stays in the hand all the way up
          const blend = want && typeof want === "object" ? want : null;
          const pose = blend ? blend.as || blend.b : want;
          const sh = shoulderJ[s];
          const env = { k, sh, w, y, hh, limbs, widthAt, centerAt, pelvisShift, pelvisTilt, shoulderTilt, torsoPt, stance, weight: ws, side: s, ik };
          let t = POSES.arm(blend ? blend.b : pose, env);
          if (blend) {
            // blend the joint angles, not the points, so the arm swings through a natural arc (shortest way round)
            const ta = POSES.arm(blend.a, env), u = Math.max(0, Math.min(1, +blend.t || 0));
            const ang = (v) => Math.atan2(v[1], v[0]);
            const turn = (p, q) => { let d = q - p; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return p + d * u; };
            const mix = (p, q) => p + (q - p) * u;
            const ua = G.sub(ta.elbow, sh), ub = G.sub(t.elbow, sh);
            const fa = G.sub(ta.wrist, ta.elbow), fb = G.sub(t.wrist, t.elbow);
            const au = turn(ang(ua), ang(ub)), af = turn(ang(fa), ang(fb));
            const lu = mix(Math.hypot(ua[0], ua[1]), Math.hypot(ub[0], ub[1])), lf = mix(Math.hypot(fa[0], fa[1]), Math.hypot(fb[0], fb[1]));
            const el = [sh[0] + Math.cos(au) * lu, sh[1] + Math.sin(au) * lu];
            const wr = [el[0] + Math.cos(af) * lf, el[1] + Math.sin(af) * lf];
            const ha = ang(ta.handDir), hb = ang(t.handDir), ah = turn(ha, hb);
            const late = u >= (blend.flip == null ? 0.2 : blend.flip);
            t = {
              elbow: el,
              wrist: wr,
              handDir: [Math.cos(ah), Math.sin(ah)],
              z: late ? t.z == null ? 45 : t.z : ta.z == null ? 45 : ta.z,
              foreFront: late ? !!t.foreFront : !!ta.foreFront
            };
          }
          const { elbow, wrist, handDir, z = 45, foreFront = false } = t;
          const hand = G.add(wrist, G.mul(G.norm(handDir), limbs.hand * 0.5));
          arms[s] = { side: s, k, pose, shoulder: sh, elbow, wrist, hand, handDir: G.norm(handDir), z, foreFront, widths: { ...limbs.arm } };
        }
        const tilt = Math.max(-10, Math.min(10, P.head && P.head.tilt || 0)) * Math.PI / 180;
        const head = {
          cx: shoulderC[0] + (easy ? sw * 0.03 * hh : 0),
          cy: y.eye,
          k: hh * (((_b = S.head) == null ? void 0 : _b.size) || 1),
          tilt,
          yaw: Math.max(-0.45, Math.min(0.45, (P.head && P.head.yaw || 0) * Math.PI / 180)),
          pivot: [shoulderC[0], y.neckTop + 0.1 * hh],
          w: w.head
        };
        return {
          U,
          H,
          hh,
          heads,
          fem,
          build: B,
          shape: S.shape || "lean",
          y,
          w,
          limbs,
          stance,
          weight: ws,
          pelvisShift,
          pelvisTilt,
          shoulderTilt,
          centerAt,
          tiltAt,
          widthAt,
          torsoPt,
          neckPit,
          shoulderJ,
          hipJ,
          legs,
          arms,
          head,
          sx
        };
      }
      module.exports = { rig, SHAPES, TURNOUT, ARM_POSES: POSES.ARM_POSES, U, sx, ik };
    }
  });

  // src/core/compose.js
  var require_compose = __commonJS({
    "src/core/compose.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var C = require_color();
      var T = require_tokens();
      var REG = require_registry();
      var LV = require_light();
      var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      var op = (v) => String(Math.round(+v * 1e3) / 1e3);
      function colourFor(c, mat, fallback) {
        if (c == null) return fallback;
        if (mat && ["base", "light", "shade", "deep", "line", "rim", "blush", "lip"].includes(c)) return mat[c] || fallback;
        if (c === "ink") return T.INK;
        if (c === "paper") return T.PAPER;
        return T.tok(c) || c;
      }
      function compose(pieces, o) {
        var _a, _b, _c, _d, _e, _f;
        if (o.idBuffer) return composeIds(pieces, o);
        const { scale = 1, hh, scheme = T.SCHEMES.natural, prefix = "fig", silhouette = false } = o;
        const px = (n) => n / scale;
        const defs = [];
        const body = [];
        const used = /* @__PURE__ */ new Set();
        const uid = (name) => {
          const nm = String(name).replace(/[^a-zA-Z0-9_-]/g, "");
          let id = `${prefix}-${nm}`;
          let i = 2;
          while (used.has(id)) id = `${prefix}-${nm}-${i++}`;
          used.add(id);
          return id;
        };
        const F = `${prefix}-`;
        defs.push(
          `<filter id="${F}stip" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(T.STYLE.stipplePx * scale).toFixed(4)}" numOctaves="2" seed="7" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.7 0 0 0 -0.35" result="na"/><feComposite in="SourceAlpha" in2="na" operator="arithmetic" k1="0" k2="1" k3="1" k4="-0.5" result="sum"/><feComponentTransfer in="sum" result="th"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer><feComponentTransfer in="SourceGraphic" result="op"><feFuncA type="linear" slope="60"/></feComponentTransfer><feComposite in="op" in2="th" operator="in"/></filter>`
        );
        const sorted = pieces.map((p, i) => ({ ...p, _i: i })).filter((p) => p && (p.d || p.over || p.raw)).sort((a, b) => {
          var _a2, _b2;
          return ((_a2 = a.z) != null ? _a2 : 50) - ((_b2 = b.z) != null ? _b2 : 50) || a._i - b._i;
        });
        const idOf = {};
        for (const p of sorted) {
          p._id = uid(p.id || "piece");
          if (p.id) idOf[p.id] = p._id;
        }
        const LT = !silhouette && o.light ? o.light : null;
        const VR = LT ? LV.regions(LT, o.rig, sorted, scale, prefix) : null;
        if (VR) {
          if (LT.under) {
            const H = o.rig.H, y0 = -LT.under.at * H, y1 = y0 - Math.max(0.05, LT.under.reach) * H, dn = y0 + 0.15 * H;
            defs.push(`<linearGradient id="${F}ug" gradientUnits="userSpaceOnUse" x1="0" y1="${G.f(dn)}" x2="0" y2="${G.f(y1)}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${G.f(Math.min(0.9, (dn - y0) / (dn - y1)))}" stop-color="#fff"/><stop offset="${G.f(0.25 + 0.75 * Math.min(0.9, (dn - y0) / (dn - y1)) + 0)}" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${F}uf" maskUnits="userSpaceOnUse" x="${G.f(-3 * H)}" y="${G.f(-2 * H)}" width="${G.f(6 * H)}" height="${G.f(3 * H)}"><rect x="${G.f(-3 * H)}" y="${G.f(-2 * H)}" width="${G.f(6 * H)}" height="${G.f(3 * H)}" fill="url(#${F}ug)"/></mask>`);
          }
        }
        const texDone = /* @__PURE__ */ new Set();
        function texture(p, mat) {
          const spec = typeof p.pattern === "string" ? { type: p.pattern } : p.pattern;
          if (!spec || !spec.type) return null;
          const part = REG.get("textile", spec.type);
          if (!part) return null;
          const c1 = colourFor(spec.color, mat, mat.base), c2 = colourFor(spec.color2, mat, mat.deep);
          const key = `${spec.type}-${c1}-${c2}-${spec.scale || 1}-${spec.angle || 0}`.replace(/[^a-zA-Z0-9-]/g, "");
          const id = `${F}tx-${key}`;
          if (!texDone.has(id)) {
            texDone.add(id);
            defs.push(part.pattern({ id, c1, c2, mat, size: (spec.scale || 1) * hh * (part.unitHH || 0.1), scale, hh, angle: spec.angle || 0, spec }));
          }
          return `url(#${id})`;
        }
        for (const p of sorted) {
          const id = p._id;
          if (silhouette) {
            body.push(p.d && !G.hasNaN(p.d) ? `<path d="${p.d}" fill="${T.INK}"/>` : "");
            continue;
          }
          if (LT && LT.debug === "shadow" && (p.raw || !p.d || p.light === false || p.fill === "transparent" || p.fill === "none")) {
            body.push("");
            continue;
          }
          if (p.raw) {
            body.push(p.raw);
            continue;
          }
          if (!p.d && p.over) {
            body.push(renderOver(p.over, null));
            continue;
          }
          if (G.hasNaN(p.d)) {
            body.push(`<!-- skipped ${esc(p.id)}: NaN in path -->`);
            continue;
          }
          let mat = p.mat || (p.fill ? C.material(p.fill, "flat", scheme) : C.material("cloth-graphite", "cloth", scheme));
          if (typeof mat === "string") mat = C.material(mat, "cloth", scheme);
          if (LT) mat = LV.relight(mat, LT, scheme);
          const vr = VR && p.light !== false && mat.form > 0 ? VR.of(p) : null;
          const bb = G.bbox(p.d);
          const pad = Math.max(bb.w, bb.h) * 0.6 + 4;
          const region = `maskUnits="userSpaceOnUse" x="${G.f(bb.x - pad)}" y="${G.f(bb.y - pad)}" width="${G.f(bb.w + 2 * pad)}" height="${G.f(bb.h + 2 * pad)}"`;
          defs.push(`<path id="${id}-s" d="${p.d}"/><clipPath id="${id}-c"><use href="#${id}-s"/></clipPath>`);
          const L = p.light === false ? null : { ...p.light || {} };
          const lit = L && mat.form > 0;
          const out = [];
          let clipAttr = p.clip && idOf[p.clip] ? ` clip-path="url(#${idOf[p.clip]}-c)"` : "";
          const myCuts = (o.cuts || []).filter((c) => p.id && new RegExp(c.match).test(p.id));
          if (myCuts.length) {
            defs.push(`<mask id="${id}-cut" ${region}><rect x="${G.f(bb.x - pad)}" y="${G.f(bb.y - pad)}" width="${G.f(bb.w + 2 * pad)}" height="${G.f(bb.h + 2 * pad)}" fill="#fff"/>${myCuts.map((c) => `<path d="${c.d}" fill="#000"/>`).join("")}</mask>`);
            clipAttr += ` mask="url(#${id}-cut)"`;
          }
          if (LT && LT.debug === "shadow") {
            const sh = vr && vr.sh ? `<use href="#${id}-s" fill="#000" clip-path="url(#${vr.sh})"/>` : "";
            const fp = p.light && p.light.face ? (p.shade || []).filter((s) => {
              var _a2;
              return typeof s !== "string" && ((_a2 = s.o) != null ? _a2 : 1) >= 0.9;
            }).map((s) => `<path d="${s.d}" fill="#000"/>`).join("") : "";
            body.push(`<g${clipAttr}><use href="#${id}-s" fill="#fff"/><g clip-path="url(#${id}-c)">${sh}${fp}</g></g>`);
            continue;
          }
          out.push(`<g id="${id}-g" data-part="${esc(p.id || "")}"${clipAttr}${p.opacity != null ? ` opacity="${op(p.opacity)}"` : ""}>`);
          out.push(`<use href="#${id}-s" fill="${p.fill ? colourFor(p.fill, mat, mat.base) : mat.base}"/>`);
          out.push(`<g clip-path="url(#${id}-c)">`);
          for (const s of p.shade || []) out.push(shape(s, mat.shade, mat));
          if (lit && vr) {
            if (vr.sh) out.push(`<use href="#${id}-s" fill="${mat.shade}" clip-path="url(#${vr.sh})"/>`);
            if (vr.band && mat.bands && L.bands !== false && bb.w * scale > 10) out.push(`<g filter="url(#${F}stip)"><use href="#${id}-s" fill="${mat.shade}" fill-opacity="0.4" clip-path="url(#${vr.band})"/></g>`);
            for (const s of p.deep || []) out.push(shape(s, mat.deep, mat));
            for (const s of p.lit || []) out.push(shape(s, mat.light, mat));
            if (vr.edge && mat.edgeC && L.sheen !== false && bb.w * scale > 4) out.push(`<use href="#${id}-s" fill="${mat.edgeC}" opacity="${op(mat.edgeO)}" clip-path="url(#${vr.edge})"/>`);
            if (vr.under) out.push(`<use href="#${id}-s" fill="${LV.underColour(mat, LT)}" opacity="${op(Math.min(1, LT.under.strength))}" clip-path="url(#${vr.under})" mask="url(#${F}uf)"/>`);
          } else if (lit) {
            const form = ((_a = L.form) != null ? _a : 1) * mat.form;
            const dx = (_b = L.dx) != null ? _b : Math.min(T.STYLE.formShadow * bb.w, T.STYLE.formShadowMaxHH * hh) * form;
            const dy = (_d = L.dy) != null ? _d : dx * T.STYLE.formDy * ((_c = L.dyK) != null ? _c : 1);
            const shift = (x, y) => `<use href="#${id}-s" fill="#000" transform="translate(${G.f(x)} ${G.f(y)})"/>`;
            const mk = (name, white, black) => {
              defs.push(`<mask id="${id}-${name}" ${region}>${white}${black}</mask>`);
              return `url(#${id}-${name})`;
            };
            const W = (x = 0, y = 0) => `<use href="#${id}-s" fill="#fff"${x || y ? ` transform="translate(${G.f(x)} ${G.f(y)})"` : ""}/>`;
            if (dx > 0) {
              out.push(`<use href="#${id}-s" fill="${mat.shade}" mask="${mk("sh", W(), shift(-dx, -dy))}"/>`);
              if (mat.bands && L.bands !== false && bb.w * scale > 14) {
                const [b1, b2] = T.STYLE.bands.map((b) => Math.max(px(2.5), Math.min(b * bb.w, 0.14 * hh)) * form);
                const [a1, a2] = T.STYLE.bandAlpha;
                out.push(`<g filter="url(#${F}stip)">`);
                out.push(`<use href="#${id}-s" fill="${mat.shade}" fill-opacity="${a1}" mask="${mk("b1", W(-dx, -dy), shift(-dx - b1 - b2, -dy - (b1 + b2) * 0.35))}"/>`);
                out.push(`<use href="#${id}-s" fill="${mat.shade}" fill-opacity="${a2}" mask="${mk("b2", W(-dx, -dy), shift(-dx - b2, -dy - b2 * 0.35))}"/>`);
                out.push(`</g>`);
              }
            }
            for (const s of p.deep || []) out.push(shape(s, mat.deep, mat));
            for (const s of p.lit || []) out.push(shape(s, mat.light, mat));
            if (L.sheen !== false && mat.light) {
              const l = Math.max(px(1.2), Math.min(T.STYLE.lit * bb.w, 0.05 * hh)) * (mat.gloss ? 1.6 : 1);
              out.push(`<use href="#${id}-s" fill="${mat.light}" opacity="${op((_e = L.sheenO) != null ? _e : mat.gloss ? 0.85 : 0.5)}" mask="${mk("lt", W(), shift(l, l * 0.8))}"/>`);
            }
          } else {
            for (const s of p.deep || []) out.push(shape(s, mat.deep, mat));
            for (const s of p.lit || []) out.push(shape(s, mat.light, mat));
          }
          const tx = p.pattern ? texture(p, mat) : null;
          if (tx) {
            out.push(`<use href="#${id}-s" fill="${tx}"${p.patternOpacity != null ? ` opacity="${op(p.patternOpacity)}"` : ""}/>`);
            if (lit && vr && vr.sh) out.push(`<use href="#${id}-s" fill="${mat.deep}" opacity="0.35" clip-path="url(#${vr.sh})"/>`);
            else if (lit && defs.some((d) => d.includes(`id="${id}-sh"`))) out.push(`<use href="#${id}-s" fill="${mat.deep}" opacity="0.35" mask="url(#${id}-sh)"/>`);
          }
          for (const ln of p.lines || []) out.push(line(ln, mat));
          out.push(`</g>`);
          if (p.outline) {
            const ow = typeof p.outline === "object" ? p.outline : {};
            out.push(`<use href="#${id}-s" fill="none" stroke="${colourFor(ow.c || "line", mat, mat.line)}" stroke-width="${G.f((_f = ow.w) != null ? _f : px(1))}" stroke-linejoin="round"/>`);
          }
          if (p.over) out.push(renderOver(p.over, mat));
          out.push(`</g>`);
          body.push(out.join(""));
        }
        function shape(s, fill, mat) {
          if (typeof s === "string") return `<path d="${s}" fill="${fill}"/>`;
          const f = s.fill ? colourFor(s.fill, mat, fill) : fill;
          return `<path d="${s.d}" fill="${f}"${s.o != null ? ` ${s.stip ? "fill-opacity" : "opacity"}="${op(s.o)}"` : ""}${s.stip ? ` filter="url(#${F}stip)"` : ""}/>`;
        }
        function line(ln, mat) {
          var _a2;
          if (typeof ln === "string") ln = { d: ln };
          if (!ln.d || G.hasNaN(ln.d)) return "";
          if (ln.fill) return `<path d="${ln.d}" fill="${colourFor(ln.fill, mat, mat == null ? void 0 : mat.line)}"${ln.o != null ? ` ${ln.stip ? "fill-opacity" : "opacity"}="${op(ln.o)}"` : ""}${ln.stip ? ` filter="url(#${F}stip)"` : ""}/>`;
          const w = ln.px != null ? px(ln.px) : (_a2 = ln.w) != null ? _a2 : px(1.2);
          const dash = ln.dash ? ` stroke-dasharray="${ln.dash.map(G.f).join(" ")}"` : "";
          return `<path d="${ln.d}" fill="none" stroke="${colourFor(ln.c || "line", mat, (mat == null ? void 0 : mat.line) || T.INK)}" stroke-width="${G.f(Math.max(w, px(T.STYLE.minLinePx)))}" stroke-linecap="${ln.cap || "round"}" stroke-linejoin="round"${ln.o != null ? ` opacity="${op(ln.o)}"` : ""}${dash}/>`;
        }
        function renderOver(items, mat) {
          return (Array.isArray(items) ? items : [items]).map((it) => {
            if (typeof it === "string") return it;
            if (it.raw) return it.raw;
            if (it.stroke || it.c) return line({ ...it, c: it.stroke || it.c }, mat);
            return `<path d="${it.d}" fill="${colourFor(it.fill || "base", mat, T.INK)}"${it.o != null ? ` ${it.stip ? "fill-opacity" : "opacity"}="${op(it.o)}"` : ""}${it.stip ? ` filter="url(#${F}stip)"` : ""}/>`;
          }).join("");
        }
        if (VR) defs.push(...VR.defs);
        const spots = [];
        if (scheme.map && scheme.spotKeep && !silhouette) {
          sorted.forEach((p, i) => {
            if (!p.spot || !p.d && !p.over || p.raw) return;
            const above = sorted.slice(i + 1).filter((q) => q.d && !q.raw).map((q) => `<use href="#${q._id}-s" fill="#000"/>`).join("");
            const own = p.d ? `<use href="#${p._id}-s" fill="#fff"/>` : `<rect x="-100000" y="-100000" width="200000" height="200000" fill="#fff"/>`;
            defs.push(`<mask id="${p._id}-spot" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">${own}${above}</mask>`);
            spots.push(`<g mask="url(#${p._id}-spot)">${p.d ? body[i].replace(` id="${p._id}-g"`, "") : body[i]}</g>`);
          });
        }
        const inYoke = (p) => {
          var _a2, _b2;
          return !p.noYoke && (p.yoke || ((_a2 = p.z) != null ? _a2 : 50) >= 20 && ((_b2 = p.z) != null ? _b2 : 50) < 44.9);
        };
        let bodyStr = body.join("");
        if (o.yokes && o.yokes.length && !silhouette) {
          for (const y of o.yokes) {
            defs.push(`<clipPath id="${prefix}-yoke-${y.side}"><path d="${y.d}"/></clipPath>`);
            y.bb = G.bbox(y.d);
          }
          const entries = sorted.map((p, i) => {
            var _a2;
            return { z: (_a2 = p.z) != null ? _a2 : 50, i, s: body[i] };
          });
          const hit = (a, b) => a.x < b.x1 && a.x1 > b.x && a.y < b.y1 && a.y1 > b.y;
          sorted.forEach((p, i) => {
            if (!inYoke(p) || !p.d || p.raw) return;
            const bb = G.bbox(p.d);
            for (const y of o.yokes) if (hit(bb, y.bb)) entries.push({ z: y.z, i: i + 0.5, s: `<use href="#${p._id}-g" clip-path="url(#${prefix}-yoke-${y.side})"/>` });
          });
          entries.sort((a, b) => a.z - b.z || a.i - b.i);
          bodyStr = entries.map((e) => e.s).join("");
        }
        return { defs: defs.join(""), body: bodyStr, spots: spots.join("") };
      }
      function composeIds(pieces, o) {
        const { scale = 1, prefix = "fig" } = o;
        const minOp = o.idBuffer && o.idBuffer.minOpacity || 0;
        const px = (n) => n / scale;
        const defs = [], body = [], used = /* @__PURE__ */ new Set(), taken = /* @__PURE__ */ new Set(), legend = {};
        const uid = (name) => {
          const nm = String(name).replace(/[^a-zA-Z0-9_-]/g, "");
          let id = `${prefix}-${nm}`;
          let i = 2;
          while (used.has(id)) id = `${prefix}-${nm}-${i++}`;
          used.add(id);
          return id;
        };
        const sorted = pieces.map((p, i) => ({ ...p, _i: i })).filter((p) => p && (p.d || p.over || p.raw)).sort((a, b) => {
          var _a, _b;
          return ((_a = a.z) != null ? _a : 50) - ((_b = b.z) != null ? _b : 50) || a._i - b._i;
        });
        const idOf = {};
        for (const p of sorted) {
          p._id = uid(p.id || "piece");
          if (p.id) idOf[p.id] = p._id;
        }
        const fnv = (s) => {
          let h = 2166136261;
          for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
          }
          return h >>> 0;
        };
        const colourOf = (p) => {
          let h = fnv(`${p._kind || ""}/${p._id.slice(prefix.length + 1)}`);
          for (; ; ) {
            const c = "#" + [h % 32, (h >>> 5) % 32, (h >>> 10) % 32].map((v) => (4 + 8 * v).toString(16).padStart(2, "0")).join("");
            if (!taken.has(c)) {
              taken.add(c);
              return c;
            }
            h = Math.imul(h ^ h >>> 15, 2246822519) + 3266489917 >>> 0;
          }
        };
        const flatRaw = (s, col) => `<g fill="${col}">${String(s).replace(/\b(fill|stroke)="(?!none")[^"]*"/g, `$1="${col}"`).replace(/\s(?:fill-opacity|stroke-opacity|opacity|filter|mask)="[^"]*"/g, "")}</g>`;
        const fillAlpha = (f) => {
          if (typeof f !== "string") return 1;
          if (f === "transparent" || f === "none") return 0;
          const h = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(f);
          if (h) return parseInt(h[1], 16) / 255;
          const r = /^rgba\(.*,\s*([\d.]+)\s*\)$/i.exec(f);
          return r ? +r[1] : 1;
        };
        const alphaOf = (it) => (it.o == null ? 1 : +it.o) * fillAlpha(it.fill);
        const faint = (it) => {
          const a = alphaOf(it);
          return a <= 0 || a < minOp;
        };
        const strokeIds = (it, col) => {
          var _a;
          const w = it.px != null ? px(it.px) : (_a = it.w) != null ? _a : px(1.2);
          const dash = it.dash ? ` stroke-dasharray="${it.dash.map(G.f).join(" ")}"` : "";
          return `<path d="${it.d}" fill="none" stroke="${col}" stroke-width="${G.f(Math.max(w, px(T.STYLE.minLinePx)))}" stroke-linecap="${it.cap || "round"}" stroke-linejoin="round"${dash}/>`;
        };
        function overIds(items, col) {
          return (Array.isArray(items) ? items : [items]).map((it) => {
            if (typeof it === "string") return flatRaw(it, col);
            if (it.raw) return flatRaw(it.raw, col);
            if (!it.d || G.hasNaN(it.d) || faint(it)) return "";
            return (it.stroke || it.c) && !it.fill ? strokeIds(it, col) : `<path d="${it.d}" fill="${col}"/>`;
          }).join("");
        }
        function contentIds(p, col) {
          const out = [];
          for (const s of [...p.shade || [], ...p.deep || [], ...p.lit || []]) {
            const d = typeof s === "string" ? s : s && s.d;
            if (d && !G.hasNaN(d) && (typeof s === "string" || !faint(s))) out.push(`<path d="${d}" fill="${col}"/>`);
          }
          for (const ln of p.lines || []) {
            const it = typeof ln === "string" ? { d: ln, fill: "line" } : ln;
            if (!it || !it.d || G.hasNaN(it.d) || faint(it)) continue;
            out.push(it.fill ? `<path d="${it.d}" fill="${col}"/>` : strokeIds(it, col));
          }
          return out.length ? `<g clip-path="url(#${p._id}-c)">${out.join("")}</g>` : "";
        }
        const painted = [];
        const register = (p, col, extra) => {
          var _a, _b, _c, _d;
          legend[col] = { id: (_a = p.id) != null ? _a : null, kind: (_b = p._kind) != null ? _b : null, name: (_c = p._name) != null ? _c : null, z: (_d = p.z) != null ? _d : 50, uid: p._id, ...extra };
        };
        sorted.forEach((p, i) => {
          var _a;
          const id = p._id, baseA = p.d ? fillAlpha(p.fill) : 1, carrier = !!p.d && baseA === 0;
          const opacity = (p.opacity == null ? 1 : +p.opacity) * (carrier ? 1 : baseA);
          const extra = { ...opacity < 1 ? { opacity: Math.round(opacity * 1e3) / 1e3 } : {}, ...p.spot ? { spot: true } : {}, ...!p.d && !p.raw ? { overOnly: true } : {}, ...carrier ? { carrier: true } : {} };
          painted[i] = false;
          body.push("");
          if (((_a = p.z) != null ? _a : 50) < 0 || opacity < minOp || p.opacity != null && +p.opacity <= 0) return;
          if (p.raw) {
            const col2 = colourOf(p);
            body[i] = flatRaw(p.raw, col2);
            painted[i] = true;
            register(p, col2, extra);
            return;
          }
          if (!p.d) {
            const col2 = colourOf(p), s = overIds(p.over, col2);
            if (s) {
              body[i] = s;
              painted[i] = true;
              register(p, col2, extra);
            }
            return;
          }
          if (G.hasNaN(p.d)) return;
          const bb = G.bbox(p.d);
          const pad = Math.max(bb.w, bb.h) * 0.6 + 4;
          const region = `maskUnits="userSpaceOnUse" x="${G.f(bb.x - pad)}" y="${G.f(bb.y - pad)}" width="${G.f(bb.w + 2 * pad)}" height="${G.f(bb.h + 2 * pad)}"`;
          defs.push(`<path id="${id}-s" d="${p.d}"/><clipPath id="${id}-c"><use href="#${id}-s"/></clipPath>`);
          let clipAttr = p.clip && idOf[p.clip] ? ` clip-path="url(#${idOf[p.clip]}-c)"` : "";
          const myCuts = (o.cuts || []).filter((c) => p.id && new RegExp(c.match).test(p.id));
          if (myCuts.length) {
            defs.push(`<mask id="${id}-cut" ${region}><rect x="${G.f(bb.x - pad)}" y="${G.f(bb.y - pad)}" width="${G.f(bb.w + 2 * pad)}" height="${G.f(bb.h + 2 * pad)}" fill="#fff"/>${myCuts.map((c) => `<path d="${c.d}" fill="#000"/>`).join("")}</mask>`);
            clipAttr += ` mask="url(#${id}-cut)"`;
          }
          const col = colourOf(p);
          const inner = (carrier ? contentIds(p, col) : `<use href="#${id}-s" fill="${col}"/>`) + (p.over ? overIds(p.over, col) : "");
          if (!inner) return;
          body[i] = `<g id="${id}-g"${clipAttr}>${inner}</g>`;
          painted[i] = true;
          register(p, col, { ...extra, ...clipAttr.includes("clip-path") ? { clip: p.clip } : {}, ...myCuts.length ? { cut: true } : {} });
        });
        const inYoke = (p) => {
          var _a, _b;
          return !p.noYoke && (p.yoke || ((_a = p.z) != null ? _a : 50) >= 20 && ((_b = p.z) != null ? _b : 50) < 44.9);
        };
        let bodyStr = body.join("");
        if (o.yokes && o.yokes.length) {
          for (const y of o.yokes) {
            defs.push(`<clipPath id="${prefix}-yoke-${y.side}"><path d="${y.d}"/></clipPath>`);
            y.bb = G.bbox(y.d);
          }
          const entries = sorted.map((p, i) => {
            var _a;
            return { z: (_a = p.z) != null ? _a : 50, i, s: body[i] };
          });
          const hit = (a, b) => a.x < b.x1 && a.x1 > b.x && a.y < b.y1 && a.y1 > b.y;
          sorted.forEach((p, i) => {
            if (!painted[i] || !inYoke(p) || !p.d || p.raw) return;
            const bb = G.bbox(p.d);
            for (const y of o.yokes) if (hit(bb, y.bb)) entries.push({ z: y.z, i: i + 0.5, s: `<use href="#${p._id}-g" clip-path="url(#${prefix}-yoke-${y.side})"/>` });
          });
          entries.sort((a, b) => a.z - b.z || a.i - b.i);
          bodyStr = entries.map((e) => e.s).join("");
        }
        return { defs: defs.join(""), body: bodyStr, spots: "", legend };
      }
      function figureFilters(prefix, o) {
        const { scale = 1, scheme, outline, grain = true } = o;
        const out = [];
        const E = o.light && o.light.debug !== "shadow" ? LV.edgeFilter(prefix, o.light, o) : null;
        if (E && !grain) out.push(`<filter id="${prefix}-edge" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">${E.prims}<feMerge><feMergeNode in="SourceGraphic"/>${E.nodes.map((n) => `<feMergeNode in="${n}"/>`).join("")}</feMerge></filter>`);
        if (E && o.light.castShadow && o.ground !== false) out.push(`<filter id="${prefix}-flat" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feFlood flood-color="${o.light.shadow.color}" flood-opacity="0.3"/><feComposite in2="SourceAlpha" operator="in"/></filter>`);
        if (grain) out.push(
          `<filter id="${prefix}-grain" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${(T.STYLE.grainPx * scale).toFixed(4)}" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.08  0 0 0 0 0.07  0 0 0 0 0.05  0 0 0 ${T.STYLE.grainAlpha * 1.8} ${-T.STYLE.grainAlpha * 0.55}" result="g"/><feTurbulence type="fractalNoise" baseFrequency="${(T.STYLE.grainPx * 1.3 * scale).toFixed(4)}" numOctaves="1" seed="11" result="n2"/><feColorMatrix in="n2" type="matrix" values="0 0 0 0 0.98  0 0 0 0 0.96  0 0 0 0 0.9  0 0 0 ${T.STYLE.grainAlpha * 1.2} ${-T.STYLE.grainAlpha * 0.5}" result="g2"/><feMerge result="m"><feMergeNode in="g"/><feMergeNode in="g2"/></feMerge><feComposite in="m" in2="SourceAlpha" operator="in" result="gi"/>` + (E ? E.prims : "") + `<feMerge><feMergeNode in="SourceGraphic"/>${E ? E.nodes.map((n) => `<feMergeNode in="${n}"/>`).join("") : ""}<feMergeNode in="gi"/></feMerge></filter>`
        );
        if (scheme && scheme.map) {
          const stops = scheme.map.map(C.rgb);
          const tab = (i) => stops.map((s) => (s[i] / 255).toFixed(3)).join(" ");
          out.push(`<filter id="${prefix}-map" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".30 .58 .12 0 0  .30 .58 .12 0 0  .30 .58 .12 0 0  0 0 0 1 0"/><feComponentTransfer><feFuncR type="table" tableValues="${tab(0)}"/><feFuncG type="table" tableValues="${tab(1)}"/><feFuncB type="table" tableValues="${tab(2)}"/></feComponentTransfer></filter>`);
        }
        if (outline) {
          const w = (outline.px || 1.2) / scale;
          out.push(`<filter id="${prefix}-ol" x="-5%" y="-5%" width="110%" height="110%"><feMorphology in="SourceAlpha" operator="dilate" radius="${w.toFixed(3)}" result="d"/><feFlood flood-color="${outline.c || T.INK}"/><feComposite in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
        }
        return out.join("");
      }
      function decimalsFor(scale) {
        return Math.max(0, Math.ceil(Math.log10(8 * Math.max(1e-6, scale))));
      }
      function quantise(svg, dec) {
        if (dec == null || dec === false) return svg;
        const k = Math.pow(10, dec);
        const q = (m) => {
          const v = Math.round(parseFloat(m) * k) / k;
          return v === 0 ? "0" : String(v);
        };
        const nums = (s) => s.replace(/-?(?:\d+\.\d*|\.\d+|\d+)/g, q);
        return svg.replace(/ d="([^"]*)"/g, (m, d) => ` d="${nums(d)}"`).replace(/ transform="translate\(([^)]*)\)"/g, (m, t) => ` transform="translate(${nums(t)})"`);
      }
      module.exports = { compose, figureFilters, colourFor, quantise, decimalsFor };
    }
  });

  // src/core/api.js
  var require_api = __commonJS({
    "src/core/api.js"(exports, module) {
      "use strict";
      var G = require_geom();
      var T = require_tokens();
      var REG = require_registry();
      var { normalise, validate, hash } = require_spec();
      var { rig, SHAPES, ARM_POSES, U } = require_rig();
      var { makeCtx, mulberry } = require_context();
      var { compose, figureFilters, quantise, decimalsFor } = require_compose();
      var LV = require_light();
      var HAND_FOR_POSE = { down: "relaxed", pocket: "pocket", hip: "hip", cross: "tucked", smoke: "cigarette", hold: "hold", behind: "hidden", carry: "grip", raise: "peace", lapel: "lapel" };
      var SLOT_KIND = { legs: "legwear", bottom: "bottom", base: "top", dress: "dress", mid: "mid", outer: "outer", neck: "neckwear", waist: "belt", feet: "footwear", hands: "gloves" };
      var FALLBACK = { body: "standard", hands: "relaxed", head: "oval", ears: "normal", expression: "neutral", eyes: "almond", brows: "straight", nose: "straight", mouth: "neutral", hair: "short", top: "tee", bottom: "trousers", footwear: "oxfords" };
      var SLOT_ORDER = ["legs", "bottom", "base", "dress", "mid", "outer", "neck", "waist", "feet", "hands"];
      function pieceList(r) {
        return Array.isArray(r) ? r : r && r.pieces ? r.pieces : [];
      }
      function cover(O) {
        const has = (s) => !!(O[s] && O[s].type);
        const sleevedMid = has("mid") && /cardigan/.test(O.mid.type);
        const sleevedDress = has("dress") && (/boiler/.test(O.dress.type) || /gown/.test(O.dress.type) && (O.dress.sleeves || "long") !== "none");
        const mk = (torso, arms) => torso || arms ? { torso, arms } : null;
        const baseT = has("outer") ? "outer" : has("mid") || has("dress") ? "inner" : null;
        const dressT = has("outer") ? "outer" : has("mid") ? "inner" : null;
        return {
          base: mk(baseT, has("outer") || sleevedMid || sleevedDress ? "outer" : baseT && "inner"),
          dress: mk(dressT, has("outer") || sleevedMid ? "outer" : dressT && "inner"),
          mid: mk(has("outer") ? "outer" : null, has("outer") ? "outer" : null)
        };
      }
      var LOOK = {
        shapes: Object.keys(SHAPES),
        skins: Object.keys(T.SKIN),
        armPoses: Array.isArray(ARM_POSES) ? ARM_POSES : Object.keys(ARM_POSES),
        schemes: Object.keys(T.SCHEMES),
        parts: (k) => REG.list(k).flatMap((p) => [p.name, ...p.aliases || []]),
        isColour: (v) => !!T.tok(v) || /^#[0-9a-f]{3,8}$/i.test(v)
      };
      var safeId = (v) => String(v != null ? v : "").replace(/[^A-Za-z0-9_-]/g, "_");
      function build(spec, o = {}) {
        var _a, _b;
        const S = normalise(spec);
        const warnings = [], cuts = [];
        validate(spec, S, (m) => {
          if (!warnings.includes(m)) warnings.push(m);
        }, o, LOOK);
        const R = rig(S);
        const scale = (_a = o.scale) != null ? _a : o.height ? o.height / (R.H * 1.06) : 640 / R.H;
        const pxHead = R.hh * scale;
        const lod = ["hi", "mid", "lo"].includes(o.lod) ? o.lod : pxHead >= T.STYLE.lod.hi ? "hi" : pxHead >= T.STYLE.lod.mid ? "mid" : "lo";
        const schemeName = o.scheme || S.scheme || "natural";
        const scheme = T.SCHEMES[schemeName] || T.SCHEMES.natural;
        const light = LV.resolve(o.light, (m) => {
          if (!warnings.includes(m)) warnings.push(m);
        });
        const ctx = makeCtx(S, R, { scheme, lod, scale, warnings, cuts, light });
        const pieces = [];
        const run = (kind, name, opts) => {
          if (!name) return;
          let p = REG.get(kind, name);
          if (!p) {
            const fb = FALLBACK[kind] && REG.get(kind, FALLBACK[kind]);
            ctx.warn(`${kind} "${name}" not found${fb ? `, drew "${FALLBACK[kind]}" instead` : ""} (available: ${REG.list(kind).map((x) => x.name).join(", ") || "none yet"})`);
            if (!fb) return;
            p = fb;
          }
          ctx.rng = mulberry(hash(`${S.seed}:${kind}:${p.name}:${opts && (opts.side || opts.slot) || ""}`));
          try {
            const r = p.draw(ctx, opts || {});
            if (r && r.head) Object.assign(ctx.head, r.head);
            if (r && r.expr) for (const k of Object.keys(r.expr)) ctx.expr[k] = typeof r.expr[k] !== "object" || Array.isArray(r.expr[k]) ? r.expr[k] : { ...ctx.expr[k] || {}, ...r.expr[k] };
            const spot = opts && opts.spot === true;
            for (const pc of pieceList(r)) if (pc) pieces.push({ ...pc, ...spot && pc.spot !== false && (pc.d || pc.over) ? { spot: true } : {}, _kind: kind, _name: name });
          } catch (e) {
            ctx.warn(`${kind} "${name}" failed: ${e.message}`);
            if (o.strict) throw e;
          }
        };
        const F = S.face, Hh = S.hair, O = S.outfit || {};
        run("body", S.body.type || "standard", {});
        for (const side of ["R", "L"]) {
          const ho = S.pose.handOpts && (S.pose.handOpts[side] || S.pose.handOpts);
          const def = HAND_FOR_POSE[R.arms[side].pose] || "relaxed";
          let hand = S.pose.hands && S.pose.hands[side] || def;
          if (["pocket", "hidden"].includes(hand) && hand !== def) {
            ctx.warn(`pose.hands.${side} "${hand}" needs pose.arms.${side} "${hand === "pocket" ? "pocket" : "behind"}"; drew "${def}"`);
            hand = def;
          }
          run("hands", hand, { ...ho && typeof ho === "object" && !ho.R && !ho.L ? ho : ho && ho[side] ? ho[side] : {}, side });
        }
        const MK = F.mask && F.mask.type ? REG.get("mask", F.mask.type) : null;
        if (F.mask && F.mask.type && !MK) ctx.warn(`mask "${F.mask.type}" not found (available: ${REG.list("mask").map((x) => x.name).join(", ") || "none yet"})`);
        const covers = new Set(MK ? [].concat((typeof MK.covers === "function" ? MK.covers(F.mask, S) : MK.covers) || []) : []);
        const face = (kind, name, opts) => {
          if (!covers.has(kind)) run(kind, name, opts);
        };
        run("head", S.head.shape, S.head);
        face("ears", S.head.ears || "normal", S.head);
        run("expression", F.expression || "neutral", {});
        face("eyes", F.eyes, F);
        face("brows", F.brows, F);
        face("nose", F.nose, F);
        face("mouth", F.mouth, F);
        const ageLevel = (_b = F.ageLevel) != null ? _b : S.age >= 40 ? Math.min(3, Math.floor((S.age - 30) / 10)) : 0;
        if (ageLevel > 0) face("age", F.ageStyle || "lines", { level: ageLevel });
        for (const m of F.marks || []) face("mark", m.type, m);
        if (F.facialHair) face("facialHair", F.facialHair.type, F.facialHair);
        if (F.makeup) face("makeup", F.makeup.type || "classic", F.makeup);
        if (F.eyewear) face("eyewear", F.eyewear.type, F.eyewear);
        if (MK) run("mask", F.mask.type, F.mask);
        face("hair", Hh.style, Hh);
        if (Hh.hat) face("hat", Hh.hat.type, Hh.hat);
        const COVER = cover(O);
        for (const slot of SLOT_ORDER) if (O[slot]) {
          ctx.slot = slot;
          ctx.under = COVER[slot] || null;
          run(SLOT_KIND[slot], O[slot].type, { ...O[slot], slot });
        }
        ctx.slot = null;
        ctx.under = null;
        for (const sd of ["R", "L"]) if (pieces.some((pc) => pc._kind === "outer" && pc.id && pc.id.endsWith(`pocket-mouth-${sd}`))) {
          for (let i = pieces.length - 1; i >= 0; i--) if (["bottom", "dress"].includes(pieces[i]._kind) && pieces[i].id === `pocket-mouth-${sd}`) pieces.splice(i, 1);
        }
        const OVER = { top: ["mid", "outer"], mid: ["outer"], dress: ["outer"], bottom: ["outer"] };
        for (const kind of Object.keys(OVER)) for (const over of OVER[kind]) {
          const hem = ctx.hems[over];
          if (hem == null || kind === "top" && over === "mid" && !O.mid) continue;
          const ids = [];
          for (const pc of pieces) {
            if (pc._kind !== kind || !pc.id || !pc.d || /sleeve|cuff|arm|collar|neck/.test(pc.id)) continue;
            const b = G.bbox(pc.d);
            if (b.y1 > hem - 0.01 * R.hh && b.y1 < hem + 0.08 * R.hh) ids.push(pc.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
          }
          if (ids.length) cuts.push({ match: `^(${ids.join("|")})$`, d: G.poly([[-4 * R.hh, hem - 4e-3 * R.hh], [4 * R.hh, hem - 4e-3 * R.hh], [4 * R.hh, 2 * R.hh], [-4 * R.hh, 2 * R.hh]]) });
        }
        for (const j of S.jewellery || []) run("jewellery", j.type, j);
        for (const pr of S.props || []) run("prop", pr.type, pr);
        if (S.companion) run("companion", S.companion.type, S.companion);
        for (const sd of ["R", "L"]) {
          const A = R.arms[sd];
          if (!A.foreFront) continue;
          const re = new RegExp(`(^|-)${sd}-lower$|(^|-)hand-${sd}($|-)|-cuff-${sd}\\d*$|^cuff-${sd}-glove|^glove-hand-${sd}`);
          for (const pc of pieces) if (pc.id && pc.z != null && pc.z >= A.z - 0.2 && pc.z < A.z + 1 && re.test(pc.id)) pc.z += 1;
        }
        for (let i = pieces.length - 1; i >= 0; i--) {
          const pc = pieces[i];
          if (!pc.d) continue;
          let ok = !G.hasNaN(pc.d) && !/undefined|null/.test(pc.d);
          if (ok) {
            try {
              G.parse(pc.d);
            } catch (e) {
              ok = false;
            }
          }
          if (!ok) {
            ctx.warn(`${pc._kind || "piece"} "${pc._name || pc.id}" drew a malformed shape (${pc.id}); skipped it`);
            pieces.splice(i, 1);
          }
        }
        if (o.shadow !== false && !o.silhouette) {
          pieces.push({ id: "ground", z: -1, d: G.ellipse(R.pelvisShift * 0.5, -0.02 * R.hh, R.w.hip * 1.55 + 0.25 * R.hh, 0.1 * R.hh), fill: scheme.shadow || T.INK, light: false, opacity: 0.22 });
        }
        if (light && light.under && light.time === "night" && o.shadow !== false && !o.silhouette) {
          const gp = pieces.find((p) => p.id === "ground");
          if (gp) {
            gp.fill = light.under.color || light.keyColor;
            gp.opacity = 0.55;
            gp.pool = true;
            gp.d = G.ellipse(R.pelvisShift * 0.5, -0.02 * R.hh, R.w.hip * 1.9 + 0.5 * R.hh, 0.16 * R.hh);
          }
        }
        return { S, R, ctx, pieces, scale, lod, scheme, schemeName, warnings, cuts, light };
      }
      function yokeRegions(R) {
        const hh = R.hh, y = R.y, w = R.w;
        return ["R", "L"].map((s) => {
          const k = R.sx(s), A = R.arms[s];
          const P = (x, Y) => R.torsoPt(k * x, Y);
          const xin = Math.max(w.neckBase * 1.2, w.shoulder - 0.42 * hh);
          const pts = [
            P(xin, y.crown - 0.5 * hh),
            P(w.shoulder + 1.2 * hh, y.crown - 0.5 * hh),
            P(w.shoulder + 1.2 * hh, y.shoulder + 0.3 * hh),
            P(w.shoulder + 0.12 * hh, y.shoulder + 0.29 * hh),
            P(w.shoulder - 0.1 * hh, y.shoulder + 0.2 * hh),
            P(xin, y.shoulder + 0.12 * hh)
          ];
          return { side: s, z: A.z + 0.35, d: G.smooth(pts.map((p, i) => i < 3 ? [...p, true] : p), true, 0.4) };
        });
      }
      function render(spec, o = {}) {
        var _a, _b;
        const B = build(spec, o.idBuffer ? { ...o, shadow: false } : o);
        const { S, R, pieces, scale, lod, scheme, warnings, cuts } = B;
        const key = JSON.stringify([spec, scale, B.lod, B.schemeName, !!o.silhouette, o.outline || 0, o.grain !== false, o.shadow !== false, ...B.light ? [o.light] : []]);
        const prefix = o.prefix ? safeId(o.prefix) : `${safeId(S.id)}${o.suffix ? safeId(o.suffix) : ""}-${(hash(key) % 46656).toString(36).padStart(3, "0")}`;
        const ground = pieces.find((p) => p.id === "ground");
        const C = compose(pieces.filter((p) => p !== ground), { scale, hh: R.hh, scheme, prefix: o.idBuffer ? prefix + "-id" : prefix, silhouette: o.silhouette, cuts, yokes: yokeRegions(R), idBuffer: o.idBuffer, light: B.light, rig: R });
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of pieces) {
          if (!p.d || p.id === "ground") continue;
          const b = G.bbox(p.d);
          if (!isFinite(b.x)) continue;
          x0 = Math.min(x0, b.x);
          y0 = Math.min(y0, b.y);
          x1 = Math.max(x1, b.x1);
          y1 = Math.max(y1, b.y1);
        }
        if (!isFinite(x0)) {
          x0 = -R.hh;
          x1 = R.hh;
          y0 = -R.H;
          y1 = 0;
        }
        const pad = (_a = o.pad) != null ? _a : 0.25 * R.hh;
        x0 -= pad;
        x1 += pad;
        y0 -= pad;
        y1 = Math.max(y1, 0) + pad * 0.6;
        if (ground && ground.pool) {
          const gb = G.bbox(ground.d);
          x0 = Math.min(x0, gb.x);
          x1 = Math.max(x1, gb.x1);
          y1 = Math.max(y1, gb.y1 + pad * 0.2);
        }
        const castFit = B.light && B.light.castShadow && o.shadow !== false && !o.silhouette && o.fitShadow !== false ? shadowShear(B.light) * (R.H * 0.92) : 0;
        if (castFit > 0) x1 = Math.max(x1, castFit + R.w.hip);
        else if (castFit < 0) x0 = Math.min(x0, castFit - R.w.hip);
        if (o.idBuffer) {
          const vb2 = [x0, y0, x1 - x0, y1 - y0];
          const W2 = vb2[2] * scale, H2 = vb2[3] * scale;
          const inner2 = `<g class="b68-figure b68-ids" data-id="${escA(S.id)}"><defs>${C.defs}</defs>${C.body}</g>`;
          const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb2.map(G.f).join(" ")}" width="${G.f(W2)}" height="${G.f(H2)}" shape-rendering="crispEdges"><title>${esc(S.name || S.id)} (piece ids)</title>${inner2}</svg>`;
          return { svg: svg2, inner: inner2, width: W2, height: H2, viewBox: vb2, R, S, lod, scale, warnings, count: pieces.length, halfW: Math.max(-x0, x1), minY: y0, legend: C.legend };
        }
        const LT = o.silhouette ? null : B.light;
        const filt = figureFilters(prefix, { scale, scheme, outline: o.outline, grain: o.grain !== false && !o.silhouette, light: LT, hh: R.hh, ground: o.shadow !== false });
        const dec = o.precision === false ? null : (_b = o.precision) != null ? _b : decimalsFor(scale);
        if (dec != null) {
          C.body = quantise(C.body, dec);
          C.defs = quantise(C.defs, dec);
          C.spots = quantise(C.spots, dec);
          if (ground) ground.d = quantise(` d="${ground.d}"`, dec).slice(4, -1);
        }
        let g = C.body;
        if (LT) g = `<g id="${prefix}-fb">${g}</g>`;
        if (scheme.map && !o.silhouette) g = `<g filter="url(#${prefix}-map)">${g}</g>${C.spots}`;
        if (o.grain !== false && !o.silhouette) g = `<g filter="url(#${prefix}-grain)">${g}</g>`;
        else if (LT) g = `<g filter="url(#${prefix}-edge)">${g}</g>`;
        if (LT && LT.castShadow && o.shadow !== false) {
          const shear = shadowShear(LT), flat = 0.07;
          g = `<use href="#${prefix}-fb" transform="matrix(1 0 ${G.f(-shear)} ${flat} 0 0)" filter="url(#${prefix}-flat)"/>` + g;
        }
        if (o.outline) g = `<g filter="url(#${prefix}-ol)">${g}</g>`;
        if (ground && ground.pool) {
          const gb = G.bbox(ground.d), cx = (gb.x + gb.x1) / 2, cy = (gb.y + gb.y1) / 2;
          g = `<defs><radialGradient id="${prefix}-pool" gradientUnits="userSpaceOnUse" cx="${G.f(cx)}" cy="${G.f(cy)}" r="${G.f(gb.w / 2)}" gradientTransform="translate(${G.f(cx)} ${G.f(cy)}) scale(1 ${G.f(gb.h / gb.w)}) translate(${G.f(-cx)} ${G.f(-cy)})"><stop offset="0" stop-color="${ground.fill}" stop-opacity="${ground.opacity}"/><stop offset="0.55" stop-color="${ground.fill}" stop-opacity="${G.f(ground.opacity * 0.6)}"/><stop offset="1" stop-color="${ground.fill}" stop-opacity="0"/></radialGradient></defs><path d="${ground.d}" fill="url(#${prefix}-pool)"/>` + g;
        } else if (ground) g = `<path d="${ground.d}" fill="${ground.fill}" opacity="${ground.opacity}"/>` + g;
        const inner = `<g class="b68-figure" data-id="${escA(S.id)}"><defs>${filt}${C.defs}</defs>${g}</g>`;
        const vb = [x0, y0, x1 - x0, y1 - y0];
        const W = vb[2] * scale, H = vb[3] * scale;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(G.f).join(" ")}" width="${G.f(W)}" height="${G.f(H)}"><title>${esc(S.name || S.id)}</title>${inner}</svg>`;
        return { svg, inner, width: W, height: H, viewBox: vb, R, S, lod, scale, warnings, count: pieces.length, halfW: Math.max(-x0, x1), minY: y0 };
      }
      function shadowShear(L) {
        const up = Math.max(0.2, -L.dir[1] + 0.35);
        return Math.max(-1.2, Math.min(1.2, -L.dir[0] / up * 0.6));
      }
      var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      var escA = (s) => esc(s).replace(/"/g, "&quot;");
      function portrait(spec, opts = {}) {
        const S0 = normalise(spec);
        const R0 = rig(S0);
        const W = opts.width || 540, H = opts.height || 600;
        let hairTop = R0.y.crown;
        try {
          for (const pc of build(spec, { lod: "hi", shadow: false }).pieces) if ((pc._kind === "hair" || pc._kind === "hat") && pc.d) hairTop = Math.min(hairTop, G.bbox(pc.d).y);
        } catch (e) {
        }
        const top = Math.min(R0.y.crown - R0.hh * 0.5, hairTop - R0.hh * 0.22), bottom = R0.y.chin + R0.hh * 1.75;
        const s = H / (bottom - top);
        const r = render(spec, { ...opts, scale: s, suffix: opts.suffix || "-p", shadow: false, lod: opts.lod || "hi" });
        const ink = T.INK, paper = T.PAPER;
        const halo = T.tok(opts.halo || S0.halo || "signal-500") || "#e0691e";
        const pid = safeId(S0.id || "p") + safeId(opts.suffix || "-p") + "-frame-" + (hash(JSON.stringify([spec, opts])) % 46656).toString(36);
        const cx = r.R.head.cx;
        const hy = (r.R.head.cy - top) * s;
        let bg = `<rect width="${W}" height="${H}" fill="${opts.ground || "#dcd4c2"}"/>`;
        if (opts.chart !== false) {
          for (let inch = Math.floor(-bottom / U); inch <= Math.ceil(-top / U); inch++) {
            const y = (-inch * U - top) * s;
            bg += `<line x1="0" x2="${W}" y1="${G.f(y)}" y2="${G.f(y)}" stroke="#8e8880" stroke-width="${inch % 12 === 0 ? 1.6 : inch % 2 ? 0.5 : 0.9}" opacity="${inch % 2 ? 0.45 : 0.85}"/>`;
            if (inch % 2 === 0) {
              const t = `${Math.floor(inch / 12)}'${inch % 12}"`;
              bg += `<text x="8" y="${G.f(y - 4)}" font-family="Space Mono, monospace" font-size="12" fill="#55504a">${t}</text><text x="${W - 8}" y="${G.f(y - 4)}" text-anchor="end" font-family="Space Mono, monospace" font-size="12" fill="#55504a">${t}</text>`;
            }
          }
        }
        if (opts.halo !== false) {
          const R1 = R0.hh * 0.98 * s;
          for (let i = 9; i >= 1; i--) bg += `<circle cx="${W / 2}" cy="${G.f(hy)}" r="${G.f(R1 + i * 16)}" fill="none" stroke="${halo}" stroke-width="1.6" opacity="${G.f(0.75 - i * 0.07)}"/>`;
          bg += `<circle cx="${W / 2}" cy="${G.f(hy)}" r="${G.f(R1)}" fill="${halo}"/>`;
        }
        let plate = "";
        if (opts.plate !== false && (S0.plate || S0.code)) {
          const pw = 220, ph = S0.plate && S0.code ? 44 : 30, px = (W - pw) / 2, py = H - ph - 14;
          plate = `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${ink}" stroke="#8e8880" stroke-width="1.5"/>`;
          if (S0.plate) plate += `<text x="${W / 2}" y="${py + 15}" text-anchor="middle" font-family="Space Mono, monospace" font-size="9" letter-spacing="2.4" fill="#c9c3b8">${esc(S0.plate.toUpperCase())}</text>`;
          if (S0.code) plate += `<text x="${W / 2}" y="${py + ph - 10}" text-anchor="middle" font-family="Space Mono, monospace" font-weight="700" font-size="15" letter-spacing="1.2" fill="${paper}">${esc(S0.code)}</text>`;
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><title>${esc(S0.name || "")}</title><defs><clipPath id="${pid}"><rect width="${W}" height="${H}"/></clipPath></defs><g clip-path="url(#${pid})">${bg}<g transform="translate(${G.f(W / 2 - cx * s)} ${G.f(-top * s)}) scale(${G.f(s * 1e4) / 1e4})">${r.inner}</g>${plate}</g></svg>`;
        return { svg, width: W, height: H, warnings: r.warnings, lod: r.lod };
      }
      function lineup(specs, opts = {}) {
        var _a;
        specs = [].concat(specs || []);
        if (!specs.length) return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"></svg>`, width: 1, height: 1, warnings: ["lineup: no figures given"] };
        const tallest = Math.max(...specs.map((s) => normalise(s).heightIn));
        const topIn = opts.topIn || Math.max(82, Math.ceil((tallest + 6) / 2) * 2);
        const outH = opts.height || 640;
        const scale = opts.scale || outH / (topIn * U + 60);
        const rendered = specs.map((s, i) => render(s, { ...opts, scale, suffix: (opts.suffix || "") + "-l" + i, pad: 0, fitShadow: false }));
        const gap = (_a = opts.gap) != null ? _a : 5 * U;
        const side = opts.chart ? Math.max(5 * U, 52 / scale) : 1 * U;
        let x = side;
        const groups = [], centres = [];
        for (const r of rendered) {
          const sh = r.R.w.hip * 1.55 + 0.25 * r.R.hh + Math.abs(r.R.pelvisShift) * 0.5;
          const left = Math.max(-r.viewBox[0], 6 * U, sh), right = Math.max(r.viewBox[0] + r.viewBox[2], 6 * U, sh);
          x += left;
          groups.push(`<g transform="translate(${G.f(x)} 0)">${r.inner}</g>`);
          centres.push(x);
          x += right + gap;
        }
        const Wd = x - gap + side;
        const minY = -topIn * U - Math.max(20, 18 / scale);
        let chart = "";
        if (opts.chart) {
          chart += `<rect x="0" y="${G.f(minY)}" width="${G.f(Wd)}" height="${G.f(-minY + 1.5 * U)}" fill="${opts.ground || "#e8e2d4"}"/>`;
          for (let inch = 0; inch <= topIn; inch++) {
            const y = -inch * U, major = inch % 12 === 0;
            chart += `<line x1="0" x2="${G.f(Wd)}" y1="${y}" y2="${y}" stroke="#8e8880" stroke-width="${G.f((major ? 1.6 : inch % 2 ? 0.45 : 0.8) / scale)}" opacity="${inch % 2 ? 0.45 : 0.85}"/>`;
            if (inch % 2 === 0 && inch >= 36) {
              const t = `${Math.floor(inch / 12)}'${inch % 12}"`, fs = 11 / scale;
              chart += `<text x="${G.f(6 / scale)}" y="${G.f(y - 3 / scale)}" font-family="Space Mono, monospace" font-weight="${major ? 700 : 400}" font-size="${G.f(fs)}" fill="#55504a">${t}</text><text x="${G.f(Wd - 6 / scale)}" y="${G.f(y - 3 / scale)}" text-anchor="end" font-family="Space Mono, monospace" font-weight="${major ? 700 : 400}" font-size="${G.f(fs)}" fill="#55504a">${t}</text>`;
            }
          }
        }
        const vb = [0, minY, Wd, -minY + 1.5 * U];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(G.f).join(" ")}" width="${G.f(vb[2] * scale)}" height="${G.f(vb[3] * scale)}">${chart}${groups.join("")}</svg>`;
        const positions = rendered.map((r, i) => ({ id: r.S.id, x: centres[i] / Wd }));
        return { svg, width: vb[2] * scale, height: vb[3] * scale, scale, positions, warnings: rendered.flatMap((r) => r.warnings.map((w) => `${r.S.id}: ${w}`)) };
      }
      function catalog() {
        return REG.catalog();
      }
      function options() {
        const out = { shapes: Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v.desc])), armPoses: ARM_POSES, schemes: Object.keys(T.SCHEMES), skins: Object.keys(T.SKIN), cloth: Object.keys(T.CLOTH) };
        for (const k of Object.keys(REG.KINDS)) out[k] = REG.list(k).map((p) => p.name);
        return out;
      }
      module.exports = { build, render, portrait, lineup, catalog, options, normalise, rig, HAND_FOR_POSE, SLOT_KIND };
    }
  });

  // src/core/raster.js
  var require_raster = __commonJS({
    "src/core/raster.js"(exports, module) {
      "use strict";
      var { hash } = require_spec();
      var CACHE = /* @__PURE__ */ new Map();
      function svgFor(api, spec, o) {
        const { mode = "figure", pixelRatio, type, quality, fontCSS, cache, ...opts } = o;
        if (mode === "portrait") return api.portrait(spec, opts);
        if (mode === "lineup") return api.lineup([].concat(spec), opts);
        return api.render(spec, opts);
      }
      function rasterize(api, spec, o = {}) {
        if (typeof document === "undefined" || typeof Image === "undefined") return Promise.reject(new Error("rasterize() needs a browser canvas; in Node use tools/export.js"));
        const ratio = Math.max(1, o.pixelRatio || typeof window !== "undefined" && window.devicePixelRatio || 1);
        const key = hash(JSON.stringify([spec, { ...o, fontCSS: o.fontCSS ? hash(o.fontCSS) : 0 }, ratio]));
        if (o.cache !== false && CACHE.has(key)) return CACHE.get(key);
        const job = new Promise((resolve, reject) => {
          const r = svgFor(api, spec, o);
          let svg = r.svg;
          if (o.fontCSS) svg = svg.replace(/(<svg\b[^>]*>)/, `$1<style>${o.fontCSS.replace(/</g, "\\3c ")}</style>`);
          const w = Math.ceil(r.width), h = Math.ceil(r.height);
          const src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
          const img = new Image();
          img.onload = () => {
            var _a;
            try {
              const cv = document.createElement("canvas");
              cv.width = Math.round(w * ratio);
              cv.height = Math.round(h * ratio);
              cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
              URL.revokeObjectURL(src);
              const type = o.type || "image/webp";
              cv.toBlob((blob) => {
                if (!blob) return reject(new Error("rasterize(): the canvas could not be encoded"));
                resolve({ url: URL.createObjectURL(blob), blob, width: w, height: h, pixelRatio: ratio, type: blob.type, warnings: r.warnings || [] });
              }, type, (_a = o.quality) != null ? _a : 0.92);
            } catch (e) {
              URL.revokeObjectURL(src);
              reject(e);
            }
          };
          img.onerror = () => {
            URL.revokeObjectURL(src);
            reject(new Error("rasterize(): the SVG failed to load as an image"));
          };
          img.src = src;
        });
        if (o.cache !== false) {
          CACHE.set(key, job);
          job.catch(() => CACHE.delete(key));
        }
        return job;
      }
      function clearRasterCache() {
        for (const p of CACHE.values()) p.then((r) => URL.revokeObjectURL(r.url)).catch(() => {
        });
        CACHE.clear();
      }
      module.exports = { rasterize, clearRasterCache };
    }
  });

  // src/index.js
  var require_index = __commonJS({
    "src/index.js"(exports, module) {
      require_parts();
      var api = require_api();
      var T = require_tokens();
      var REG = require_registry();
      var G = require_geom();
      var C = require_color();
      var raster = require_raster();
      module.exports = {
        ...api,
        tokens: T,
        registry: REG,
        geom: G,
        color: C,
        U: 25,
        version: "3.0.0",
        // light v2 + face v2 the default; light v1 retired (Wave 2, signed off 22/10/2026)
        rasterize: (spec, o) => raster.rasterize(api, spec, o),
        // browser only: render once to a bitmap (ROADMAP §4.1)
        clearRasterCache: raster.clearRasterCache
      };
    }
  });
  return require_index();
})();

if (typeof module !== "undefined" && module.exports) module.exports = B68Figure;
