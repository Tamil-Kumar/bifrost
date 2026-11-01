'use strict';
// Position keys: each bookmark's place in its folder as a string that sorts between its neighbors' (the way
// Chrome and Figma do it), so two computers moving and adding bookmarks in one folder at once keep both
// changes. keyBetween(a, b) is a key after a and before b (null: the start or end). Keys are an "integer"
// part (its first character says how long it is: a0..az, b00..bzz, …) that grows slowly as you add at the
// end or the start, then a fraction for anything put in between. Follows the fractional-indexing scheme
// (David Greenspan's, as in rocicorp/fractional-indexing).

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = 'a0';
const SMALLEST = 'A' + '0'.repeat(26);

function midpoint(a, b) {
  if (b != null) {
    let n = 0;
    while ((a[n] || '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b != null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

function intLength(head) {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  throw new Error('bad position key ' + head);
}
const intPart = (key) => { const n = intLength(key[0]); if (n > key.length) throw new Error('bad position key ' + key); return key.slice(0, n); };

function valid(key) {
  if (typeof key !== 'string' || !key || key === SMALLEST) return false;
  try { const i = intPart(key); const f = key.slice(i.length); return !f.endsWith('0') && [...key.slice(1)].every((c) => DIGITS.includes(c)); } catch { return false; }
}

function increment(x) {
  const head = x[0], digs = x.slice(1).split('');
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) digs[i] = '0'; else { digs[i] = DIGITS[d]; carry = false; }
  }
  if (!carry) return head + digs.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > 'a') digs.push('0'); else digs.pop();
  return h + digs.join('');
}

function decrement(x) {
  const head = x[0], digs = x.slice(1).split('');
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = DIGITS[DIGITS.length - 1]; else { digs[i] = DIGITS[d]; borrow = false; }
  }
  if (!borrow) return head + digs.join('');
  if (head === 'a') return 'Z' + DIGITS[DIGITS.length - 1];
  if (head === 'A') return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < 'Z') digs.push(DIGITS[DIGITS.length - 1]); else digs.pop();
  return h + digs.join('');
}

// A key after a and before b (either may be null). a must sort before b.
function keyBetween(a, b) {
  if (a != null && !valid(a)) a = null;
  if (b != null && !valid(b)) b = null;
  if (a != null && b != null && a >= b) throw new Error(`position keys out of order: ${a} >= ${b}`);
  if (a == null) {
    if (b == null) return ZERO;
    const ib = intPart(b), fb = b.slice(ib.length);
    if (ib === SMALLEST) return ib + midpoint('', fb);
    if (ib < b) return ib;
    const d = decrement(ib);
    if (d == null) throw new Error('cannot go before ' + b);
    return d;
  }
  if (b == null) {
    const ia = intPart(a), fa = a.slice(ia.length);
    const i = increment(ia);
    return i == null ? ia + midpoint(fa, null) : i;
  }
  const ia = intPart(a), fa = a.slice(ia.length), ib = intPart(b), fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = increment(ia);
  if (i == null) throw new Error('cannot go after ' + a);
  return i < b ? i : ia + midpoint(fa, null);
}

// n keys in a row after a (for filling a folder).
function keysAfter(a, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(a = keyBetween(a, null));
  return out;
}

module.exports = { keyBetween, keysAfter, valid };
