/**
 * お知らせの送り先を決めて送る。
 *  - group   : グループへ（1回＝グループ人数分の通数）
 *  - members : 参加者のうち、Botを友だち追加している人だけへ（1回＝その人数分）
 *  - auto    : 無料枠に余裕があればグループ、少なくなったら参加者だけ
 */
import { getSettings } from './db.js';
import { groupSize, multicast, pushGroup, remainingQuota } from './line.js';
import { toInt } from './util.js';

const friendIds = ps => ps.filter(p => p.isFriend).map(p => p.userId);

/** 成立のお知らせ（みんなに知らせたいもの） */
export async function notifyFormed(env, participants, text) {
  const s = await getSettings(env);
  const mode = s.FORMED_TO;
  if (mode === 'off') return 'off';
  const ids = friendIds(participants);

  if (mode === 'group') {
    if (await pushGroup(env, s.GROUP_ID, text)) return 'group';
    return (await multicast(env, ids, text)) ? 'members' : 'none';
  }
  if (mode === 'members') {
    if (await multicast(env, ids, text)) return 'members';
    return (await pushGroup(env, s.GROUP_ID, text)) ? 'group' : 'none';
  }
  // auto
  const reserve = toInt(s.GROUP_RESERVE, 20);
  if (s.GROUP_ID && (await remainingQuota(env)) - (await groupSize(env, s.GROUP_ID)) >= reserve) {
    if (await pushGroup(env, s.GROUP_ID, text)) return 'group';
  }
  if (await multicast(env, ids, text)) return 'members';
  return (await pushGroup(env, s.GROUP_ID, text)) ? 'group' : 'none';
}

/** 取消で人数割れ・中止など、参加者に関係するお知らせ：まず参加者だけに送る */
export async function notifyParticipants(env, participants, text) {
  const s = await getSettings(env);
  if (s.FORMED_TO === 'off') return 'off';
  if (await multicast(env, friendIds(participants), text)) return 'members';
  return notifyFormed(env, participants, text);
}

/** グループへの任意のお知らせ（NOTIFY_JOIN／NOTIFY_NEW がオンのとき） */
export async function notifyGroupIf(env, key, text) {
  const s = await getSettings(env);
  if (s[key] !== 'on') return false;
  return pushGroup(env, s.GROUP_ID, text);
}

/* ---- 文面 ---- */

export const appUrl = env => (env.LIFF_ID ? `https://liff.line.me/${env.LIFF_ID}` : (env.APP_URL || ''));

const WD = '日月火水木金土';
export function when(e) {
  const d = new Date(e.date + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[d.getUTCDay()]}) ${e.start}〜${e.end || ''}`;
}
const label = e => `【${e.theme}】${e.title || ''}`;
const where = e => e.style + (e.place ? `（${e.place}）` : '');
const minOf = e => Number(e.min_people ?? e.minPeople);

export const msg = {
  formed: (env, e, names) =>
    `🙌 成立しました！\n${label(e)}\n${when(e)}／${where(e)}\n参加：${names.join('、')}（${names.length}名）\n\n詳細はこちら\n${appUrl(env)}`,
  unformed: (env, e, names) =>
    `⚠️ 参加の取り消しがあり、成立人数を下回りました\n${label(e)}\n${when(e)}\nあと${minOf(e) - names.length}名で再成立します\n\n${appUrl(env)}`,
  cancelled: (env, e) =>
    `🙏 次の会は中止になりました\n${label(e)}\n${when(e)}`,
  joined: (env, e, names) =>
    `✋ ${names[names.length - 1]}さんが参加しました\n${label(e)}\n${when(e)}\nあと${minOf(e) - names.length}名で成立\n\n${appUrl(env)}`,
  created: (env, e, hostName) =>
    `📣 新しい募集\n${label(e)}\n${when(e)}／${where(e)}\n主催：${hostName}　あと${minOf(e) - 1}名で成立\n\n参加はこちら\n${appUrl(env)}`,
  remind: (env, e, names) =>
    `☀️ 今日はこちらの会です\n${label(e)}\n${when(e)}／${where(e)}\n参加：${names.join('、')}\n\n${appUrl(env)}`,
  list: (env, events) => {
    if (!events.length) return `いまは募集中の会はありません。\n募集はこちらから\n${appUrl(env)}`;
    const lines = events.slice(0, 10).map(e => {
      const st = e.status === 'formed' ? '成立' : `あと${Math.max(0, e.minPeople - e.members.length)}名`;
      return `・${when(e)} ${label(e)}［${st}］`;
    });
    if (events.length > 10) lines.push(`ほか${events.length - 10}件`);
    return `📅 これからの予定\n${lines.join('\n')}\n\n${appUrl(env)}`;
  },
};
