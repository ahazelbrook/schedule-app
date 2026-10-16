// The kit's grain and stipple are feTurbulence filters: fractal noise the browser computes again, per device pixel, every time
// a figure repaints, and a figure that moves repaints on every cut. This bakes each noise once, at build time, into a small
// seamless tile (the spec's own turbulence, with its stitching, so the tile repeats without a seam) and swaps the primitive
// for <feImage> + <feTile>, which the browser only copies. The colour matrix after it is turned to read the tile's grey where it
// read the noise's alpha. The look is the same: the tile is sampled where the iPad's pixels would have sampled the noise.
//
//   const { bakeNoise } = require("./noise.js");
//   svg = bakeNoise(svg, { upp })        // upp: kit units per device pixel where the figure is shown (lib.fig works it out)
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

// ---------- a greyscale PNG ----------
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function greyPng(N, px) {
  const raw = Buffer.alloc(N * (N + 1));
  for (let y = 0; y < N; y++) { raw[y * (N + 1)] = 0; for (let x = 0; x < N; x++) raw[y * (N + 1) + 1 + x] = px(x, y); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 0; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const TILE = 128;                                   // tile side in pixels; in kit units it is TILE * upp
const cache = new Map();
/** the tile for one noise: channel ch of fractalNoise(freq, octaves, seed) sampled every upp units; { href, size } */
function tile(freq, octaves, seed, ch, upp) {
  const key = [freq, octaves, seed, ch, upp].join("|");
  if (cache.has(key)) return cache.get(key);
  const L = lattice(seed), size = TILE * upp;
  const href = greyPng(TILE, (x, y) => Math.round(255 * fractal(L, ch, x * upp, y * upp, freq, octaves, size)));
  const t = { href, size };
  cache.set(key, t);
  return t;
}

/** every feTurbulence in a kit figure's filters becomes a baked tile; the matrix that read its alpha reads the tile's grey */
function bakeNoise(svg, o = {}) {
  const upp = o.upp > 0 ? o.upp : 2;
  return svg.replace(/<feTurbulence\s+type="fractalNoise"\s+baseFrequency="([\d.]+)"\s+numOctaves="(\d+)"\s+seed="(\d+)"\s+result="([^"]+)"\s*\/>(\s*<feColorMatrix\s+in="\4"\s+type="matrix"\s+values=")([^"]+)(")/g,
    (all, freq, oct, seed, res, mPre, values, mPost) => {
      const v = values.trim().split(/\s+/).map(Number);
      if (v.length !== 20) return all;
      // the alpha row (the only one the kit varies): a weight on the alpha input moves to the red input
      let ch = 0;
      if (v[18] !== 0 && v[15] === 0) { v[15] = v[18]; v[18] = 0; ch = 3; }
      const t = tile(Number(freq), Number(oct), Number(seed), ch, upp);
      const f = (n) => String(+n.toFixed(6));
      return `<feImage href="${t.href}" x="0" y="0" width="${f(t.size)}" height="${f(t.size)}" preserveAspectRatio="none" result="${res}-tile"/><feTile in="${res}-tile" result="${res}"/>` +
        mPre + v.map((n) => String(+n.toFixed(6))).join(" ") + mPost;
    });
}

module.exports = { bakeNoise, fractal, lattice, tile, TILE };
