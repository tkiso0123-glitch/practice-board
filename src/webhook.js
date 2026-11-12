/**
 * LINEからのWebhook。
 * 署名（X-Line-Signature）を必ず確かめる。トーク内容は保存しない。
 * 処理するのは：Botの招待（join）、友だち追加・ブロック、メンバーの退出、決まったコマンドだけ。
 */
import { getSettings, getUser, listUpcoming, setSetting, upsertUser } from './db.js';
import { botProfile, leaveGroup, reply, verifySignature } from './line.js';
import { appUrl, msg } from './notify.js';
import { nowISO } from './util.js';

export async function handleWebhook(req, env, ctx) {
  const raw = await req.text();
  if (!(await verifySignature(env.LINE_CHANNEL_SECRET, raw, req.headers.get('x-line-signature')))) {
    return new Response('invalid signature', { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('bad request', { status: 400 }); }
  // LINEへはすぐ200を返し、処理は裏で続ける
  ctx.waitUntil((async () => {
    for (const ev of body.events || []) {
      try { await handleEvent(env, ev); } catch (err) { console.error(err); }
    }
  })());
  return new Response('OK');
}

async function handleEvent(env, ev) {
  const src = ev.source || {};
  const s = await getSettings(env);

  // Botがグループに招待された
  if (ev.type === 'join' && src.type === 'group') {
    if (!s.GROUP_ID) {
      // 最初に招待されたグループだけを通知先にする（あとから乗っ取られないように）
      await setSetting(env, 'GROUP_ID', src.groupId);
      await reply(env, ev.replyToken,
        'このグループに、練習・勉強会のお知らせを送ります📮\n\n募集・参加はこちら\n' + appUrl(env) +
        '\n\n「一覧」と送ると、これからの予定をお返事します。');
    } else if (s.GROUP_ID !== src.groupId) {
      await reply(env, ev.replyToken, 'このBotは別のグループ専用のため、退出します。');
      await leaveGroup(env, src.groupId);
    }
    return;
  }

  // 友だち追加・ブロック（個別通知を送れるかどうか）
  if ((ev.type === 'follow' || ev.type === 'unfollow') && src.userId) {
    const prev = await getUser(env, src.userId);
    const isFriend = ev.type === 'follow';
    if (prev) {
      await env.DB.prepare('UPDATE users SET is_friend = ? WHERE user_id = ?').bind(isFriend ? 1 : 0, src.userId).run();
    } else if (isFriend) {
      const p = await botProfile(env, src.userId);
      await upsertUser(env, { userId: src.userId, displayName: (p && p.displayName) || '', isFriend: true, isMember: false, lastSeenAt: nowISO() });
    }
    return;
  }

  // グループから抜けた人は使えなくする
  if (ev.type === 'memberLeft' && src.groupId === s.GROUP_ID) {
    for (const m of (ev.left && ev.left.members) || []) {
      if (m.userId) await env.DB.prepare('UPDATE users SET is_member = 0 WHERE user_id = ?').bind(m.userId).run();
    }
    return;
  }

  // 決まったコマンドだけに返信する（返信は通数に数えない）
  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    if (src.type === 'group' && src.groupId !== s.GROUP_ID) return;
    if (src.type === 'room') return;
    const t = ev.message.text.trim();
    if (/^(一覧|いちらん|予定)$/.test(t)) {
      await reply(env, ev.replyToken, msg.list(env, await listUpcoming(env, null)));
    } else if (/^(ボード|URL|url|リンク)$/.test(t)) {
      await reply(env, ev.replyToken, '募集・参加はこちら\n' + appUrl(env));
    }
  }
}
