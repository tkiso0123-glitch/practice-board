export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const JST = 9 * 60 * 60 * 1000;

/** 日本時間の今日（YYYY-MM-DD）。days で前後にずらせる */
export function todayJST(days = 0) {
  return new Date(Date.now() + JST + days * 86400000).toISOString().slice(0, 10);
}

export function nowISO() {
  return new Date().toISOString();
}

/** 制御文字を除き、前後の空白を取り、長さをそろえる */
export function clean(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

export function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

export function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

/* ---- 署名まわり ---- */

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}

/** 長さが違っても安全に比べる */
export function safeEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}
