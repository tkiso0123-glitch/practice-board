/** 毎朝8時（日本時間）：当日のリマインドと、古いデータの削除 */
import { getParticipants, getSettings } from './db.js';
import { multicast } from './line.js';
import { msg } from './notify.js';
import { toInt, todayJST } from './util.js';

export async function runDaily(env) {
  const s = await getSettings(env);

  if (s.REMIND === 'on') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM events WHERE date = ? AND status = 'formed' AND hidden = 0`).bind(todayJST()).all();
    for (const e of results) {
      const ps = await getParticipants(env, e.id);
      await multicast(env, ps.filter(p => p.isFriend).map(p => p.userId), msg.remind(env, e, ps.map(p => p.name)));
    }
  }

  // 終わってから RETENTION_DAYS 日たった会は、参加者の記録ごと消す
  const cutoff = todayJST(-toInt(env.RETENTION_DAYS, 30));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM participants WHERE event_id IN (SELECT id FROM events WHERE date < ?)').bind(cutoff),
    env.DB.prepare('DELETE FROM events WHERE date < ?').bind(cutoff),
  ]);
  // 長く使われていない利用者の記録も消す（友だちの人は通知のために残す）
  await env.DB.prepare(
    `DELETE FROM users WHERE is_friend = 0 AND (last_seen_at IS NULL OR last_seen_at < ?)
       AND user_id NOT IN (SELECT user_id FROM participants)`)
    .bind(new Date(Date.now() - toInt(env.RETENTION_DAYS, 30) * 86400e3).toISOString()).run();
}
