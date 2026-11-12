/**
 * 本人確認。
 * 1) 画面（LIFF）が LINE のアクセストークンを POST /api/session に送る
 * 2) サーバーで LINE に問い合わせて本人を確かめ、講座グループのメンバーかも確かめる
 * 3) このアプリ用の短期セッション（12時間・署名つき）を返す。以後の操作はこれで行う
 */
import { getSettings, getUser, upsertUser } from './db.js';
import { isGroupMember, verifyLiffAccessToken } from './line.js';
import { HttpError, b64url, b64urlDecode, clean, hmacSha256, nowISO, safeEqual } from './util.js';

const SESSION_HOURS = 12;
const MEMBER_RECHECK_HOURS = 24;

export const isAdmin = (env, userId) =>
  String(env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);

function secret(env) {
  if (!env.SESSION_SECRET) throw new HttpError(500, 'SESSION_SECRET が設定されていません');
  return env.SESSION_SECRET;
}

async function sign(env, payload) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(await hmacSha256(secret(env), body));
  return body + '.' + sig;
}

async function verify(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  let given;
  try { given = b64urlDecode(sig); } catch { return null; }
  if (!safeEqual(await hmacSha256(secret(env), body), given)) return null;
  const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  return p.exp > Date.now() ? p : null;
}

/** POST /api/session */
export async function createSession(env, body) {
  let profile;
  if (env.DEV_AUTH === '1' && body.devUser) {
    // 開発用：LINEなしで任意のユーザーになれる（本番では DEV_AUTH を設定しない）
    profile = {
      userId: 'dev-' + clean(body.devUser.id, 20),
      displayName: clean(body.devUser.name, 20) || 'テスト',
      isFriend: !!body.devUser.friend,
      dev: true,
    };
  } else {
    profile = body.accessToken ? await verifyLiffAccessToken(env, String(body.accessToken)) : null;
    if (!profile) throw new HttpError(401, 'LINEでの確認ができませんでした。開き直してください');
  }

  const admin = isAdmin(env, profile.userId);
  const s = await getSettings(env);
  const prev = await getUser(env, profile.userId);
  let isMember = prev ? !!prev.is_member : false;
  let checkedAt = prev ? prev.member_checked_at : null;

  if (profile.dev) {
    isMember = true;
  } else if (s.GROUP_ID) {
    const fresh = isMember && checkedAt && Date.now() - Date.parse(checkedAt) < MEMBER_RECHECK_HOURS * 3600e3;
    if (!fresh) {
      const r = await isGroupMember(env, s.GROUP_ID, profile.userId);
      if (r !== null) { isMember = r; checkedAt = nowISO(); }
    }
  }

  await upsertUser(env, { ...profile, isMember, memberCheckedAt: checkedAt, lastSeenAt: nowISO() });

  if (s.REQUIRE_MEMBER === 'on' && !admin && !isMember) {
    throw new HttpError(403, s.GROUP_ID
      ? 'このボードは、講座のLINEグループのメンバーだけが使えます'
      : 'まだ準備中です（Botがグループに招待されていません）');
  }

  const token = await sign(env, { u: profile.userId, exp: Date.now() + SESSION_HOURS * 3600e3 });
  return { token, me: { name: profile.displayName, isFriend: profile.isFriend, isAdmin: admin } };
}

/** 各APIの先頭で呼ぶ。本人の情報を返す */
export async function requireUser(env, req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer (.+)$/);
  const p = m && await verify(env, m[1]);
  if (!p) throw new HttpError(401, 'ログインの期限が切れました。開き直してください');
  const u = await getUser(env, p.u);
  if (!u) throw new HttpError(401, 'ログインし直してください');
  const admin = isAdmin(env, u.user_id);
  const s = await getSettings(env);
  if (s.REQUIRE_MEMBER === 'on' && !admin && !u.is_member) {
    throw new HttpError(403, 'このボードは、講座のLINEグループのメンバーだけが使えます');
  }
  return { userId: u.user_id, name: u.display_name, isFriend: !!u.is_friend, isAdmin: admin, settings: s };
}
