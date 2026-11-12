/* 画面共通：ログイン・API呼び出し・LINEで知らせる */
/* global liff */

const KEY = 'pb_session';
let cfg = null;
let token = null;
let liffOk = false;

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* 使えない環境 */ } },
};

export const $ = id => document.getElementById(id);

export function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach(c => { if (c != null && c !== false) n.append(c); });
  return n;
}

let toastTimer;
export function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/** 起動：設定を読み、LINEでログインしてセッションを作る。{ me, cfg } を返す */
export async function boot() {
  cfg = await fetch('/api/config').then(r => r.json());
  const dev = new URLSearchParams(location.search).get('dev');

  if (!(cfg.devAuth && dev)) {
    if (!cfg.liffId) throw new Error('LIFF_ID が設定されていません（管理者向け）');
    await liff.init({ liffId: cfg.liffId });
    liffOk = true;
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return new Promise(() => {}); // LINEのログイン画面へ移動する
    }
  }
  return { me: await newSession(dev), cfg };
}

async function newSession(dev) {
  let body;
  if (cfg.devAuth && dev) {
    const [id, name, friend] = dev.split(':');
    body = { devUser: { id, name: name || id, friend: friend === 'friend' } };
  } else {
    body = { accessToken: liff.getAccessToken() };
  }
  const res = await fetch('/api/session', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && liffOk && !store.get('pb_relogin')) {
    // LINEのトークンが古い：一度だけログインし直す
    store.set('pb_relogin', '1');
    liff.logout();
    liff.login({ redirectUri: location.href });
    return new Promise(() => {});
  }
  store.set('pb_relogin', null);
  if (!res.ok) throw new Error(data.error || '読み込めませんでした');
  token = data.token;
  store.set(KEY, token);
  return data.me;
}

/** APIを呼ぶ。セッション切れなら作り直して1回だけやり直す */
export async function api(path, { method = 'GET', body } = {}, retry = true) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token || store.get(KEY) || '') },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && retry) {
    await newSession(new URLSearchParams(location.search).get('dev'));
    return api(path, { method, body }, false);
  }
  if (!res.ok) throw new Error(data.error || 'エラーが起きました');
  return data;
}

/**
 * LINEで知らせる。LINEの中なら「送り先を選ぶ画面」（本人の名前で送られ、Botの通数は使わない）、
 * 使えないときは LINEの共有URL を開く。
 */
export async function shareToLine(text) {
  if (liffOk && liff.isApiAvailable('shareTargetPicker')) {
    try {
      const r = await liff.shareTargetPicker([{ type: 'text', text }], { isMultiple: false });
      return r ? 'sent' : 'cancelled';
    } catch (err) {
      console.warn(err); // 下の方法で開き直す
    }
  }
  const url = 'https://line.me/R/share?text=' + encodeURIComponent(text);
  if (liffOk) liff.openWindow({ url, external: false });
  else window.open(url, '_blank', 'noopener');
  return 'opened';
}

export function friendUrl(basicId) {
  return 'https://line.me/R/ti/p/' + encodeURIComponent(basicId.startsWith('@') ? basicId : '@' + basicId);
}

export function errText(e) {
  return String((e && e.message) || e);
}
