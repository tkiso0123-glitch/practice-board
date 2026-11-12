import { SETTING_DEFAULTS, STATUS } from './constants.js';
import { todayJST } from './util.js';

/* ---- 設定 ---- */

export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = { ...SETTING_DEFAULTS, GROUP_ID: '' };
  for (const r of results) s[r.key] = r.value;
  return s;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value)).run();
}

/* ---- 会 ---- */

export async function getEvent(env, id) {
  return env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(String(id)).first();
}

/** 参加者を（参加順に）表示名つきで返す */
export async function getParticipants(env, eventId) {
  const { results } = await env.DB.prepare(
    `SELECT p.user_id, u.display_name, u.is_friend FROM participants p
     LEFT JOIN users u ON u.user_id = p.user_id
     WHERE p.event_id = ? ORDER BY p.joined_at, p.rowid`).bind(eventId).all();
  return results.map(r => ({ userId: r.user_id, name: r.display_name || '（名前なし）', isFriend: !!r.is_friend }));
}

/**
 * これからの会を、参加者つきで返す。
 * viewerId を渡すと「自分が参加中か／主催者か」を付ける（userId 自体は画面に返さない）
 */
export async function listUpcoming(env, viewerId, { includeHidden = false, includeCancelled = false } = {}) {
  const where = ['date >= ?'];
  if (!includeHidden) where.push('hidden = 0');
  if (!includeCancelled) where.push(`status != '${STATUS.cancelled}'`);
  const today = todayJST();
  const [{ results: evs }, { results: ps }] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY date, start, created_at`).bind(today),
    env.DB.prepare(
      `SELECT p.event_id, p.user_id, u.display_name FROM participants p
       JOIN events e ON e.id = p.event_id
       LEFT JOIN users u ON u.user_id = p.user_id
       WHERE e.date >= ? ORDER BY p.joined_at, p.rowid`).bind(today),
  ]);
  const byEvent = {};
  for (const p of ps) (byEvent[p.event_id] ||= []).push(p);
  return evs.map(e => toPublic(e, byEvent[e.id] || [], viewerId));
}

export function toPublic(e, ps, viewerId) {
  return {
    id: e.id, theme: e.theme, title: e.title, date: e.date, start: e.start, end: e.end,
    style: e.style, place: e.place, minPeople: e.min_people, capacity: e.capacity, note: e.note,
    status: e.status, hidden: !!e.hidden,
    hostName: (ps.find(p => p.user_id === e.host_user_id) || {}).display_name || '',
    members: ps.map(p => p.display_name || '（名前なし）'),
    joined: !!viewerId && ps.some(p => p.user_id === viewerId),
    isHost: !!viewerId && e.host_user_id === viewerId,
  };
}

/* ---- ユーザー ---- */

export async function upsertUser(env, u) {
  await env.DB.prepare(
    `INSERT INTO users (user_id, display_name, is_friend, is_member, member_checked_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(user_id) DO UPDATE SET
       display_name = ?2, is_friend = ?3, is_member = ?4, member_checked_at = ?5, last_seen_at = ?6`)
    .bind(u.userId, u.displayName, u.isFriend ? 1 : 0, u.isMember ? 1 : 0, u.memberCheckedAt || null, u.lastSeenAt || null)
    .run();
}

export async function getUser(env, userId) {
  return env.DB.prepare('SELECT * FROM users WHERE user_id = ?').bind(userId).first();
}
