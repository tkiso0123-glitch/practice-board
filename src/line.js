/**
 * LINE Messaging API／LINEログインの呼び出し。
 *
 * 通数の数え方：push／multicast は宛先の人数分。reply（返信）は数えない。
 * 開発用（DEV_AUTH=1 かつ LINE_CHANNEL_TOKEN 未設定）のときは実際には送らず、devOutbox に記録する。
 */
import { b64urlDecode, hmacSha256, safeEqual } from './util.js';

const API = 'https://api.line.me';
export const devOutbox = [];

function dryRun(env) {
  return !env.LINE_CHANNEL_TOKEN && env.DEV_AUTH === '1';
}

async function botFetch(env, method, path, body) {
  if (!env.LINE_CHANNEL_TOKEN) {
    console.warn('LINE_CHANNEL_TOKEN が未設定のため送信しません: ' + path);
    return { code: 0, json: {} };
  }
  const init = { method, headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_TOKEN } };
  if (body) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, init);
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text || '{}'); } catch { /* 空 */ }
  if (!res.ok && res.status !== 404) console.error(`LINE API ${path} ${res.status}: ${text}`);
  return { code: res.status, json };
}

const textMsg = text => [{ type: 'text', text: String(text).slice(0, 4900) }];

/* ---- 送信 ---- */

/** グループに送る。残り通数が足りないときは送らずに false */
export async function pushGroup(env, groupId, text) {
  if (!groupId) { console.warn('通知先グループが未登録のため送信しませんでした'); return false; }
  if (await remainingQuota(env) < await groupSize(env, groupId)) {
    console.warn('今月の残り通数が足りないため、グループ送信をとりやめました');
    return false;
  }
  if (dryRun(env)) { devOutbox.push({ kind: 'group', to: groupId, text }); return true; }
  return (await botFetch(env, 'POST', '/v2/bot/message/push', { to: groupId, messages: textMsg(text) })).code === 200;
}

/** 決まった人たちだけに送る（友だち追加している人だけ届く）。通数は人数分 */
export async function multicast(env, userIds, text) {
  if (!userIds.length) return false;
  if (await remainingQuota(env) < userIds.length) {
    console.warn('今月の残り通数が足りないため、個別送信をとりやめました');
    return false;
  }
  if (dryRun(env)) { devOutbox.push({ kind: 'multicast', to: userIds, text }); return true; }
  return (await botFetch(env, 'POST', '/v2/bot/message/multicast', { to: userIds.slice(0, 500), messages: textMsg(text) })).code === 200;
}

/** 返信（通数に数えない） */
export async function reply(env, replyToken, text) {
  if (!replyToken) return;
  if (dryRun(env)) { devOutbox.push({ kind: 'reply', text }); return; }
  await botFetch(env, 'POST', '/v2/bot/message/reply', { replyToken, messages: textMsg(text) });
}

export async function leaveGroup(env, groupId) {
  if (dryRun(env)) return;
  await botFetch(env, 'POST', `/v2/bot/group/${encodeURIComponent(groupId)}/leave`);
}

/* ---- 通数・グループ ---- */

/** 今月あと何通送れるか（上限なしのプランなら Infinity。取れないときは 0 として送らない） */
export async function remainingQuota(env) {
  if (dryRun(env)) return Number(env.DEV_QUOTA ?? 200);
  const [q, used] = await Promise.all([
    botFetch(env, 'GET', '/v2/bot/message/quota'),
    botFetch(env, 'GET', '/v2/bot/message/quota/consumption'),
  ]);
  if (q.code !== 200 || used.code !== 200) return 0;
  if (q.json.type !== 'limited') return Infinity;
  return Number(q.json.value) - Number(used.json.totalUsage || 0);
}

/** グループの人数。取れないときは多めに見積もる */
export async function groupSize(env, groupId) {
  if (dryRun(env)) return Number(env.DEV_GROUP_SIZE ?? 20);
  if (!groupId) return 0;
  const r = await botFetch(env, 'GET', `/v2/bot/group/${encodeURIComponent(groupId)}/members/count`);
  return r.code === 200 ? Number(r.json.count) : 30;
}

/** そのユーザーがグループのメンバーか（true／false。確認できなかったときは null） */
export async function isGroupMember(env, groupId, userId) {
  const r = await botFetch(env, 'GET', `/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`);
  if (r.code === 200) return true;
  if (r.code === 404) return false;
  return null;
}

/** Botの友だちのプロフィール（follow のときに表示名を知るため。通数は使わない） */
export async function botProfile(env, userId) {
  const r = await botFetch(env, 'GET', `/v2/bot/profile/${encodeURIComponent(userId)}`);
  return r.code === 200 ? r.json : null;
}

/* ---- LINEログイン（LIFF）のアクセストークン ---- */

/**
 * LIFFのアクセストークンを確かめ、本人のプロフィールと友だち状態を返す。
 * 自分たちのLINEログインチャネル向けに発行されたトークンでなければ拒否する。
 */
export async function verifyLiffAccessToken(env, accessToken) {
  const v = await fetch(`${API}/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`);
  if (!v.ok) return null;
  const vj = await v.json();
  if (String(vj.client_id) !== String(env.LOGIN_CHANNEL_ID) || !(Number(vj.expires_in) > 0)) return null;

  const auth = { headers: { Authorization: 'Bearer ' + accessToken } };
  const [p, f] = await Promise.all([fetch(`${API}/v2/profile`, auth), fetch(`${API}/friendship/v1/status`, auth)]);
  if (!p.ok) return null;
  const pj = await p.json();
  const fj = f.ok ? await f.json() : {};
  return { userId: pj.userId, displayName: pj.displayName || '', isFriend: !!fj.friendFlag };
}

/* ---- Webhook の署名検証 ---- */

export async function verifySignature(secret, rawBody, signatureHeader) {
  if (!secret || !signatureHeader) return false;
  let given;
  try { given = b64urlDecode(signatureHeader); } catch { return false; }
  const expected = await hmacSha256(secret, rawBody);
  return safeEqual(expected, given);
}
