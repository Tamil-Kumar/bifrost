// Bifrost's app icon at every size the builds need, from the logo: assets/icons/source/bifrost-logo.png, the
// ice-dragon tile on a white background (1024×1024).
//
//     node tools/make-icons.mjs
//
// The tile is cut out along a shape fitted to its own outline — a rounded square with superellipse corners —
// so its edges are smooth at every size, and the tile's own colors are carried a few pixels past its edge
// first, so no white from the background fringes it. Writes assets/icons/icon-{16..1024}.png (the tile
// fills 15/16 of the square, like other app icons) and icon.ico (one PNG frame per size, 16 to 256, with the
// in-between sizes Windows uses on scaled displays). Small sizes are sharpened a little. Needs sharp.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); } catch { sharp = require('/opt/npm-tools/node_modules/sharp'); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'icons');
const SOURCE = path.join(OUT, 'source', 'bifrost-logo.png');

// ------------------------------------------------------------------------------- the picture and its tile
const { data: src, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const lum = (i) => (src[i * C] + src[i * C + 1] + src[i * C + 2]) / 3;

// Background: everything light reachable from the picture's edges (the white, and the tile's soft shadow).
// The tile is the rest (its white dragon included: the dark tile surrounds it).
const bg = new Uint8Array(W * H);
{
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  const push = (i) => { if (!bg[i] && lum(i) >= 150) { bg[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (head < tail) {
    const i = queue[head++], x = i % W, y = (i - x) / W;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
}
let left = W, right = 0, top = H, bottom = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!bg[y * W + x]) { left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1); }
if (right - left < W / 3 || bottom - top < H / 3) throw new Error('no tile found in ' + SOURCE);

// Points on the outline near each corner, as (dx, dy) from that corner's two straight edges.
const pts = [];
const band = Math.round((right - left) * 0.4);
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !bg[y * W + x];
for (let k = 0; k < band; k++) {
  for (const [y, fromTop] of [[top + k, true], [bottom - 1 - k, false]]) {
    let a = left; while (a < right && !inside(a, y)) a++;
    let b = right - 1; while (b >= left && !inside(b, y)) b--;
    const dy = fromTop ? y + 0.5 - top : bottom - (y + 0.5);
    pts.push([a - left, dy], [right - (b + 1), dy]);
  }
  for (const [x, fromLeft] of [[left + k, true], [right - 1 - k, false]]) {
    let a = top; while (a < bottom && !inside(x, a)) a++;
    let b = bottom - 1; while (b >= top && !inside(x, b)) b--;
    const dx = fromLeft ? x + 0.5 - left : right - (x + 0.5);
    pts.push([dx, a - top], [dx, bottom - (b + 1)]);
  }
}
// The corner: ((R - dx) / R)^n + ((R - dy) / R)^n = 1, fitted to those points (coarse, then fine).
function fitErr(R, n) {
  let err = 0, used = 0, off = 0;
  for (const [dx, dy] of pts) {
    if (dx < R && dy < R) { const f = Math.pow((R - dx) / R, n) + Math.pow((R - dy) / R, n) - 1; err += f * f; used++; }
    // (Points on the straight edges past the corner must sit on the edge.)
    else if ((dx >= R && dy > 1.5) || (dy >= R && dx > 1.5)) off++;
  }
  return used < 20 ? Infinity : err / used + off / pts.length;
}
let best = { err: Infinity, R: 0, n: 0 };
for (let R = Math.round(band * 0.3); R <= band; R += 4) for (let n = 2; n <= 6; n += 0.1) { const err = fitErr(R, n); if (err < best.err) best = { err, R, n }; }
const coarse = { ...best };
for (let R = coarse.R - 4; R <= coarse.R + 4; R++) for (let n = coarse.n - 0.1; n <= coarse.n + 0.1; n += 0.01) { const err = fitErr(R, n); if (err < best.err) best = { err, R, n }; }

// ----------------------------------------------------------------------------------------------- the shape
// The outline as an SVG path in a box of the given size, inset by `inset` (in the picture's pixels) so the
// cut falls just inside the picture's own soft edge.
function outline(size, inset = 1) {
  const s = size / (right - left);
  const L = inset * s, T = inset * s, Rt = size - inset * s, B = size * (bottom - top) / (right - left) - inset * s;
  const R = (best.R - inset) * s, e = 2 / best.n, steps = 48;
  const corner = (cx, cy, sx, sy) => {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI / 2;
      out.push([cx + sx * (R - R * Math.pow(Math.cos(t), e)), cy + sy * (R - R * Math.pow(Math.sin(t), e))]);
    }
    return out;
  };
  const tl = corner(L, T, 1, 1);                                   // from the left edge round to the top edge
  const tr = corner(Rt, T, -1, 1).reverse();                       // from the top edge round to the right edge
  const br = corner(Rt, B, -1, -1);                                // from the right edge round to the bottom edge
  const bl = corner(L, B, 1, -1).reverse();                        // from the bottom edge round to the left edge
  const all = [...tl, ...tr, ...br, ...bl];
  return 'M ' + all.map(([x, y]) => x.toFixed(3) + ' ' + y.toFixed(3)).join(' L ') + ' Z';
}

// The tile's colors carried outward past its edge, so resampling and the cut's soft edge only ever mix
// tile colors.
const rgb = Buffer.from(src);
{
  const filled = new Uint8Array(W * H);
  // Start from pixels at least two inside the outline.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let ok = true;
    for (let j = -2; j <= 2 && ok; j++) for (let i = -2; i <= 2 && ok; i++) if (!inside(x + i, y + j)) ok = false;
    if (ok) filled[y * W + x] = 1;
  }
  for (let pass = 0; pass < 8; pass++) {
    const add = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const k of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1]) if (filled[k]) { r += rgb[k * C]; g += rgb[k * C + 1]; b += rgb[k * C + 2]; n++; }
      if (n) add.push([i, r / n, g / n, b / n]);
    }
    for (const [i, r, g, b] of add) { rgb[i * C] = Math.round(r); rgb[i * C + 1] = Math.round(g); rgb[i * C + 2] = Math.round(b); filled[i] = 1; }
  }
}

// ------------------------------------------------------------------------------------------------- output
const FILL = 15 / 16;   // of the square, as the tile
// At the smallest sizes the dragon is shown bigger in its tile (the tile's empty edge cropped away), so it
// still reads as a dragon at 16 pixels.
const ZOOM = (size) => (size <= 24 ? 1.22 : size <= 32 ? 1.12 : 1);
async function iconAt(size) {
  // Work at 4× for the small sizes (then shrink: crisper than shrinking the full picture once).
  const work = size < 256 ? Math.min(1024, size * 4) : size;
  const tile = Math.round(work * FILL), pad = Math.round((work - tile) / 2);
  const tileH = Math.round(tile * (bottom - top) / (right - left));
  // The part of the picture shown: all of the tile, or its middle for the smallest sizes (the dragon sits a
  // little above the middle).
  const z = ZOOM(size), cw = Math.round((right - left) / z), ch = Math.round((bottom - top) / z);
  const cx = Math.round(left + ((right - left) - cw) / 2), cy = Math.round(top + ((bottom - top) - ch) / 2 - (z > 1 ? (bottom - top) * 0.015 : 0));
  const art = await sharp(rgb, { raw: { width: W, height: H, channels: C } })
    .extract({ left: cx, top: cy, width: cw, height: ch })
    .resize(tile, tileH, { kernel: 'lanczos3' }).png().toBuffer();
  const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tileH}"><path d="${outline(tile)}" fill="#fff"/></svg>`))
    .ensureAlpha().extractChannel(3).toBuffer();
  const cut = await sharp(art).joinChannel(mask).png().toBuffer();   // (art has no alpha of its own)
  let img = sharp({ create: { width: work, height: work, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: cut, left: pad, top: pad + Math.round((tile - tileH) / 2) }]);
  if (work !== size) img = sharp(await img.png().toBuffer()).resize(size, size, { kernel: 'lanczos3' });
  if (size <= 64) img = sharp(await img.png().toBuffer()).sharpen({ sigma: size <= 32 ? 0.6 : 0.5, m1: 0.6, m2: 2 });
  return img.png({ compressionLevel: 9 }).toBuffer();
}

function ico(frames) {
  // ICONDIR, one ICONDIRENTRY per frame, then the PNGs.
  const head = Buffer.alloc(6 + 16 * frames.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach(({ size, png }, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames.map((f) => f.png)]);
}

fs.mkdirSync(OUT, { recursive: true });
const frames = [];
for (const size of [16, 20, 24, 32, 40, 48, 64, 75, 128, 256, 512, 1024]) {
  const png = await iconAt(size);
  if (![20, 40].includes(size)) fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
  if (size <= 256 && size !== 75) frames.push({ size, png });
}
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(frames));
try { fs.rmSync(path.join(OUT, 'icon.svg')); } catch { /* already gone */ }
console.log(`tile ${right - left}×${bottom - top} at ${left},${top}; corners R=${best.R} n=${best.n.toFixed(2)}; icons written to ${OUT}`);
