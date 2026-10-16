// The kit's grain is an feTurbulence filter over the whole figure: fractal noise the browser computes again, per device pixel,
// every time the figure repaints, and a figure that moves repaints on every cut. This bakes it once, at build time, into a small
// seamless tile (the spec's own turbulence, with its stitching, so the tile repeats without a seam) and swaps the primitive
// for <feImage> + <feTile>, which the browser only copies. The colour matrix after it is turned to read the tile's grey where it
// read the noise. The look is the same: the tile is sampled where the iPad's pixels would have sampled the noise.
//
//   const { bakeNoise } = require("./noise.js");
//   svg = bakeNoise(svg, { upp, at, box })   // lib.fig works these out from where the figure is shown
"use strict";
const zlib = require("zlib");

// ---------- feTurbulence, as the SVG specification writes it (Perlin's reference), with stitching ----------
const BSize = 0x100, BM = 0xff, PerlinN = 0x1000;
const RAND_m = 2147483647, RAND_a = 16807, RAND_q = 127773, RAND_r = 2836;
function setupSeed(seed) { if (seed <= 0) seed = -(seed % (RAND_m - 1)) + 1; if (seed > RAND_m - 1) seed = RAND_m - 1; return seed; }
function rnd(seed) { let r = RAND_a * (seed % RAND_q) - RAND_r * Math.floor(seed / RAND_q); if (r <= 0) r += RAND_m; return r; }
function lattice(seed) {
  const sel = new Int32Array(BSize + BSize + 2);
  const grad = [0, 1, 2, 3].map(() => Array.from({ length: BSize + BSize + 2 }, () => [0, 0]));
  seed = setupSeed(Math.round(seed));
  let i, j, k;
  for (k = 0; k < 4; k++) {
    for (i = 0; i < BSize; i++) {
      sel[i] = i;
      for (j = 0; j < 2; j++) grad[k][i][j] = (((seed = rnd(seed)) % (BSize + BSize)) - BSize) / BSize;
      const s = Math.sqrt(grad[k][i][0] * grad[k][i][0] + grad[k][i][1] * grad[k][i][1]);
      grad[k][i][0] /= s; grad[k][i][1] /= s;
    }
  }
  while (--i) { k = sel[i]; sel[i] = sel[j = (seed = rnd(seed)) % BSize]; sel[j] = k; }
  for (i = 0; i < BSize + 2; i++) { sel[BSize + i] = sel[i]; for (k = 0; k < 4; k++) for (j = 0; j < 2; j++) grad[k][BSize + i][j] = grad[k][i][j]; }
  return { sel, grad };
}
const sCurve = (t) => t * t * (3 - 2 * t), lerp = (t, a, b) => a + t * (b - a);
function noise2(L, ch, vx, vy, st) {
  // the lattice points are wrapped before they are masked, as the browsers do it (the specification's listing masks first,
  // which leaves the wrap without effect and the tile with a seam)
  let t = vx + PerlinN, bx0 = Math.floor(t), bx1 = bx0 + 1; const rx0 = t - Math.floor(t), rx1 = rx0 - 1;
  t = vy + PerlinN; let by0 = Math.floor(t), by1 = by0 + 1; const ry0 = t - Math.floor(t), ry1 = ry0 - 1;
  if (st) {
    if (bx0 >= st.wrapX) bx0 -= st.width; if (bx1 >= st.wrapX) bx1 -= st.width;
    if (by0 >= st.wrapY) by0 -= st.height; if (by1 >= st.wrapY) by1 -= st.height;
  }
  bx0 &= BM; bx1 &= BM; by0 &= BM; by1 &= BM;
  const i = L.sel[bx0], j = L.sel[bx1];
  const b00 = L.sel[i + by0], b10 = L.sel[j + by0], b01 = L.sel[i + by1], b11 = L.sel[j + by1];
  const sx = sCurve(rx0), sy = sCurve(ry0), g = L.grad[ch];
  let q = g[b00], u = rx0 * q[0] + ry0 * q[1]; q = g[b10]; let v = rx1 * q[0] + ry0 * q[1]; const a = lerp(sx, u, v);
  q = g[b01]; u = rx0 * q[0] + ry1 * q[1]; q = g[b11]; v = rx1 * q[0] + ry1 * q[1]; const b = lerp(sx, u, v);
  return lerp(sy, a, b);
}
/** fractalNoise at (x, y) for channel ch (0 red .. 3 alpha), stitched to the tile [0, tile) x [0, tile): 0..1 like the browser's */
function fractal(L, ch, x, y, freq, octaves, tile) {
  let fx = freq, fy = freq;
  const lo = Math.floor(tile * fx) / tile, hi = Math.ceil(tile * fx) / tile;
  fx = fy = fx / lo < hi / fx ? lo : hi;
  const st = { width: Math.floor(tile * fx + 0.5), height: Math.floor(tile * fy + 0.5) };
  st.wrapX = Math.floor(0 * fx + PerlinN + st.width); st.wrapY = Math.floor(0 * fy + PerlinN + st.height);
  let sum = 0, vx = x * fx, vy = y * fy, ratio = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(L, ch, vx, vy, st) / ratio;
    vx *= 2; vy *= 2; ratio *= 2;
    st.width *= 2; st.wrapX = 2 * st.wrapX - PerlinN; st.height *= 2; st.wrapY = 2 * st.wrapY - PerlinN;
  }
  return Math.min(1, Math.max(0, (sum + 1) / 2));
}

// ---------- a greyscale PNG, 1, 2, 4 or 8 bits a pixel ----------
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
/** px(x, y) -> 0 .. 2^bits - 1 */
function greyPng(N, px, bits = 8) {
  const per = 8 / bits, row = Math.ceil(N / per), raw = Buffer.alloc((row + 1) * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) raw[y * (row + 1) + 1 + Math.floor(x / per)] |= px(x, y) << (8 - bits * (1 + x % per));
  const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = bits; ih[9] = 0; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

// A tile is TILE device pixels a side, 16 grey levels spread over the range the noise actually takes (the colour matrix is
// given the range back), which is a third of the bytes of 8 bits at the same size and no difference anyone can see in a grain
// whose strongest speck is 0.2 alpha. The tiles are the reason a figure's file grows (fine noise does not compress): about
// 8 KB a figure now.
const TILE = 128, BITS = 4;
const cache = new Map();
/** the tile for one noise: channel ch of fractalNoise(freq, octaves, seed) sampled every upp units, n px a side;
 *  { href, size (kit units), lo, hi (the noise value grey 0 and grey 1 stand for) } */
function tile(freq, octaves, seed, ch, upp, n = TILE) {
  const key = [freq, octaves, seed, ch, upp, n].join("|");
  if (cache.has(key)) return cache.get(key);
  const L = lattice(seed), size = n * upp, v = new Float64Array(n * n);
  let lo = 1, hi = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = fractal(L, ch, x * upp, y * upp, freq, octaves, size); v[y * n + x] = a; if (a < lo) lo = a; if (a > hi) hi = a; }
  const top = (1 << BITS) - 1, span = Math.max(1e-6, hi - lo);
  const href = greyPng(n, (x, y) => Math.round((v[y * n + x] - lo) / span * top), BITS);
  const t = { href, size, lo, hi: lo + span };
  cache.set(key, t);
  return t;
}

/**
 * Bake the grain filter of a kit figure: every feTurbulence in a filter whose id matches `only` (default the figure's
 * "-grain") becomes a tile, an <feImage> placed at `at` (a point that lies inside the filtered group in every frame: the
 * figure's middle) and repeated by <feTile>. The tile has to sit inside the filter region, because a filter's intermediate
 * results exist only there: a tile outside it would repeat as nothing at all. That is also why the kit's stipple ("-stip",
 * a filter on each shading band, whose region is that band's box) keeps its feTurbulence: no single tile position lies inside
 * every band. The colour matrix after the noise reads the tile's grey, rescaled to the noise's range, where it read a channel.
 *   o: { upp: kit units per device pixel where the figure is shown, at: [x, y], box: [w, h] (the figure's size: a tile is
 *        never more than half of it), only: RegExp }
 */
function bakeNoise(svg, o = {}) {
  const upp = o.upp > 0 ? o.upp : 2, only = o.only || /-grain$/, at = o.at || [0, 0];
  const room = o.box ? Math.min(o.box[0], o.box[1]) / 2 : Infinity;
  const n = Math.max(16, Math.min(TILE, 1 << Math.floor(Math.log2(room / upp))));
  return svg.replace(/<filter\s+id="([^"]+)"[^>]*>[\s\S]*?<\/filter>/g, (filter, id) => {
    if (!only.test(id)) return filter;
    return filter.replace(/<feTurbulence\s+type="fractalNoise"\s+baseFrequency="([\d.]+)"\s+numOctaves="(\d+)"\s+seed="(\d+)"\s+result="([^"]+)"\s*\/>(\s*<feColorMatrix\s+in="\4"\s+type="matrix"\s+values=")([^"]+)(")/g,
      (all, freq, oct, seed, res, mPre, values, mPost) => {
        const v = values.trim().split(/\s+/).map(Number);
        if (v.length !== 20) return all;
        // the one input channel the matrix reads (the kit reads alpha for the grain); the tile gives it as grey in R, G and B
        const cols = [0, 1, 2, 3].filter((c) => [0, 5, 10, 15].some((r) => v[r + c] !== 0));
        if (cols.length !== 1) return all;
        const ch = cols[0];
        const t = tile(Number(freq), Number(oct), Number(seed), ch, upp, n);
        // every row: weight w on that channel -> weight w * (hi - lo) on red, offset + w * lo
        for (const r of [0, 5, 10, 15]) { const w = v[r + ch]; v[r + ch] = 0; v[r] = w * (t.hi - t.lo); v[r + 4] += w * t.lo; }
        const f = (x) => String(+x.toFixed(6));
        // the tile on the grid of its own size nearest the middle, so every frame and every figure part shares one phase
        const tx = Math.floor(at[0] / t.size) * t.size, ty = Math.floor(at[1] / t.size) * t.size;
        return `<feImage href="${t.href}" x="${f(tx)}" y="${f(ty)}" width="${f(t.size)}" height="${f(t.size)}" preserveAspectRatio="none" result="${res}-tile"/><feTile in="${res}-tile" result="${res}"/>` +
          mPre + v.map(f).join(" ") + mPost;
      });
  });
}

module.exports = { bakeNoise, fractal, lattice, tile, TILE };
