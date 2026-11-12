import { createSession, requireUser } from './auth.js';
import { DEFAULT_MIN, SETTINGS, STATUS, STYLES, THEMES } from './constants.js';
import { getEvent, getParticipants, getSettings, listUpcoming, setSetting } from './db.js';
import { devOutbox, groupSize, pushGroup, remainingQuota } from './line.js';
import { appUrl, msg, notifyFormed, notifyGroupIf, notifyParticipants } from './notify.js';
import { HttpError, clean, json, newId, nowISO, toInt, todayJST } from './util.js';

export async function handleApi(req, env, ctx, url) {
  try {
    const route = url.pathname.replace(/^\/api/, '');
    const method = req.method;
    const body = method === 'POST' ? await req.json().catch(() => ({})) : {};

    // ---- ログイン不要 ----
    if (route === '/config' && method === 'GET') {
      return json({ liffId: env.LIFF_ID || '', devAuth: env.DEV_AUTH === '1', botBasicId: env.BOT_BASIC_ID || '' });
    }
    if (route === '/session' && method === 'POST') {
      return json(await createSession(env, body));
    }

    // ---- ここから先はログインが必要 ----
    const me = await requireUser(env, req);

    if (route === '/init' && method === 'GET') {
      return json({
        themes: THEMES, styles: STYLES, defaultMin: DEFAULT_MIN, today: todayJST(), appUrl: appUrl(env),
        me: { name: me.name, isFriend: me.isFriend, isAdmin: me.isAdmin },
        events: await listUpcoming(env, me.userId),
      });
    }
    if (route === '/events' && method === 'GET') return json({ events: await listUpcoming(env, me.userId) });
    if (route === '/events' && method === 'POST') return json(await createEvent(env, me, body));

    let m = route.match(/^\/events\/([\w-]+)\/(join|leave|cancel)$/);
    if (m && method === 'POST') {
      const fn = { join: joinEvent, leave: leaveEvent, cancel: cancelEvent }[m[2]];
      await fn(env, me, m[1]);
      return json({ events: await listUpcoming(env, me.userId) });
    }

    // ---- 管理者 ----
    if (route.startsWith('/admin/')) {
      if (!me.isAdmin) throw new HttpError(403, '管理者だけが使えます');
      return json(await handleAdmin(env, me, route, method, body));
    }

    // ---- 開発用：送ったはずのLINEメッセージを見る ----
    if (route === '/dev/outbox' && env.DEV_AUTH === '1') return json({ outbox: devOutbox });

    throw new HttpError(404, '見つかりません');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'エラーが起きました。少し待ってからもう一度お試しください' }, 500);
  }
}

/* ---- 募集・参加 ---- */

function validate(f) {
  const theme = THEMES.includes(f.theme) ? f.theme : '';
  if (!theme) throw new HttpError(400, 'テーマを選んでください');
  const title = clean(f.title, 40);
  if (theme === 'その他' && !title) throw new HttpError(400, '「その他」の場合はタイトルを入れてください');

  const date = String(f.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, '日付を入れてください');
  if (date < todayJST()) throw new HttpError(400, '過去の日付は選べません');
  if (date > todayJST(366)) throw new HttpError(400, '1年以内の日付にしてください');

  const start = String(f.start || '');
  if (!/^\d{2}:\d{2}$/.test(start)) throw new HttpError(400, '開始時刻を入れてください');
  const end = String(f.end || '');
  if (end && (!/^\d{2}:\d{2}$/.test(end) || end <= start)) throw new HttpError(400, '終了時刻は開始より後にしてください');

  const minPeople = toInt(f.minPeople, DEFAULT_MIN[theme] || 2);
  if (minPeople < 2 || minPeople > 20) throw new HttpError(400, '成立人数は2〜20名で入れてください');
  const capacity = toInt(f.capacity, 0);
  if (capacity < 0 || capacity > 50) throw new HttpError(400, '定員は50名までにしてください');
  if (capacity && capacity < minPeople) throw new HttpError(400, '定員は成立人数以上にしてください');

  return {
    theme, title, date, start, end,
    style: STYLES.includes(f.style) ? f.style : STYLES[0],
    place: clean(f.place, 60), min_people: minPeople, capacity, note: clean(f.note, 300),
  };
}

async function createEvent(env, me, form) {
  const e = validate(form || {});
  const id = newId();
  const now = nowISO();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO events (id, theme, title, date, start, end, style, place, min_people, capacity, note, host_user_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, e.theme, e.title, e.date, e.start, e.end, e.style, e.place, e.min_people, e.capacity, e.note, me.userId, STATUS.open, now),
    env.DB.prepare('INSERT INTO participants (event_id, user_id, joined_at) VALUES (?, ?, ?)').bind(id, me.userId, now),
  ]);
  await notifyGroupIf(env, 'NOTIFY_NEW', msg.created(env, e, me.name));
  return { id, events: await listUpcoming(env, me.userId) };
}

function assertActive(ev) {
  if (!ev || ev.hidden) throw new HttpError(404, 'この会が見つかりません。画面を更新してください');
  if (ev.status === STATUS.cancelled) throw new HttpError(400, 'この会は中止になりました');
  if (ev.date < todayJST()) throw new HttpError(400, 'すでに終わった会です');
}

async function joinEvent(env, me, id) {
  const ev = await getEvent(env, id);
  assertActive(ev);
  // 定員の確認と追加を1つの文で行い、同時に押されても定員を超えないようにする
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO participants (event_id, user_id, joined_at)
     SELECT ?1, ?2, ?3 WHERE ?4 = 0 OR (SELECT COUNT(*) FROM participants WHERE event_id = ?1) < ?4`)
    .bind(ev.id, me.userId, nowISO(), ev.capacity).run();
  if (!r.meta.changes) {
    const ps = await getParticipants(env, ev.id);
    if (ps.some(p => p.userId === me.userId)) throw new HttpError(400, 'すでに参加しています');
    throw new HttpError(400, '定員に達しています');
  }
  await afterChange(env, ev, 'join');
}

async function leaveEvent(env, me, id) {
  const ev = await getEvent(env, id);
  assertActive(ev);
  if (ev.host_user_id === me.userId) throw new HttpError(400, '主催者は参加を取り消せません。やめる場合は「中止する」を押してください');
  const r = await env.DB.prepare('DELETE FROM participants WHERE event_id = ? AND user_id = ?').bind(ev.id, me.userId).run();
  if (!r.meta.changes) throw new HttpError(400, '参加していません');
  await afterChange(env, ev, 'leave');
}

async function cancelEvent(env, me, id) {
  const ev = await getEvent(env, id);
  assertActive(ev);
  if (ev.host_user_id !== me.userId && !me.isAdmin) throw new HttpError(403, '募集した人だけが中止できます');
  await env.DB.prepare('UPDATE events SET status = ? WHERE id = ?').bind(STATUS.cancelled, ev.id).run();
  const ps = await getParticipants(env, ev.id);
  if (ev.formed_notified_at) await notifyParticipants(env, ps, msg.cancelled(env, ev));
  else await notifyGroupIf(env, 'NOTIFY_NEW', msg.cancelled(env, ev));
}

/**
 * 参加・取消のあとで、成立／人数割れを判定して知らせる。
 * 「成立済みにする」更新は条件つきなので、同時に参加が来ても成立通知は1回だけ。
 */
async function afterChange(env, ev, kind) {
  const ps = await getParticipants(env, ev.id);
  const names = ps.map(p => p.name);
  const min = ev.min_people;

  if (ps.length >= min) {
    const r = await env.DB.prepare(
      `UPDATE events SET status = ?, formed_notified_at = ? WHERE id = ? AND formed_notified_at IS NULL AND status != ?`)
      .bind(STATUS.formed, nowISO(), ev.id, STATUS.cancelled).run();
    if (r.meta.changes) await notifyFormed(env, ps, msg.formed(env, ev, names));
  } else {
    const r = await env.DB.prepare(
      `UPDATE events SET status = ?, formed_notified_at = NULL WHERE id = ? AND status = ?`)
      .bind(STATUS.open, ev.id, STATUS.formed).run();
    if (r.meta.changes && ev.formed_notified_at) {
      await notifyParticipants(env, ps, msg.unformed(env, ev, names));
    } else if (kind === 'join') {
      await notifyGroupIf(env, 'NOTIFY_JOIN', msg.joined(env, ev, names));
    }
  }
}

/* ---- 管理者 ---- */

async function handleAdmin(env, me, route, method, body) {
  if (route === '/admin/overview' && method === 'GET') {
    const s = await getSettings(env);
    const [quota, size, users] = await Promise.all([
      remainingQuota(env),
      s.GROUP_ID ? groupSize(env, s.GROUP_ID) : 0,
      env.DB.prepare('SELECT COUNT(*) AS n, SUM(is_friend) AS friends, SUM(is_member) AS members FROM users').first(),
    ]);
    const events = await listUpcoming(env, null, { includeHidden: true, includeCancelled: true });
    for (const e of events) {
      e.participants = (await getParticipants(env, e.id)).map(p => ({ userId: p.userId, name: p.name }));
    }
    return {
      settings: SETTINGS.map(([key, , options, help]) => ({ key, value: s[key], options, help })),
      groupRegistered: !!s.GROUP_ID,
      quota: quota === Infinity ? '上限なし' : quota,
      groupSize: size,
      users: { total: users.n || 0, friends: users.friends || 0, members: users.members || 0 },
      events,
    };
  }

  if (route === '/admin/settings' && method === 'POST') {
    const def = SETTINGS.find(x => x[0] === body.key);
    if (!def) throw new HttpError(400, 'この設定は変えられません');
    let value = String(body.value ?? '').trim().toLowerCase();
    if (def[2] && !def[2].includes(value)) throw new HttpError(400, '選べる値：' + def[2].join('／'));
    if (!def[2]) value = String(Math.max(0, toInt(value, toInt(def[1], 0))));
    await setSetting(env, def[0], value);
    return { ok: true };
  }

  if (route === '/admin/reset-group' && method === 'POST') {
    await setSetting(env, 'GROUP_ID', '');
    return { ok: true };
  }

  if (route === '/admin/test-push' && method === 'POST') {
    const s = await getSettings(env);
    const ok = await pushGroup(env, s.GROUP_ID, '🔧 接続テストです。このメッセージが届いていれば設定完了です。\n' + appUrl(env));
    if (!ok) throw new HttpError(400, '送れませんでした（グループ未登録、または残り通数不足）');
    return { ok: true };
  }

  let m = route.match(/^\/admin\/events\/([\w-]+)\/(hide|show|delete)$/);
  if (m && method === 'POST') {
    const ev = await getEvent(env, m[1]);
    if (!ev) throw new HttpError(404, '見つかりません');
    if (m[2] === 'delete') {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM participants WHERE event_id = ?').bind(ev.id),
        env.DB.prepare('DELETE FROM events WHERE id = ?').bind(ev.id),
      ]);
    } else {
      await env.DB.prepare('UPDATE events SET hidden = ? WHERE id = ?').bind(m[2] === 'hide' ? 1 : 0, ev.id).run();
    }
    return { ok: true };
  }

  m = route.match(/^\/admin\/events\/([\w-]+)\/remove$/);
  if (m && method === 'POST') {
    const ev = await getEvent(env, m[1]);
    if (!ev) throw new HttpError(404, '見つかりません');
    if (ev.host_user_id === body.userId) throw new HttpError(400, '主催者は外せません。会ごと非表示か削除にしてください');
    await env.DB.prepare('DELETE FROM participants WHERE event_id = ? AND user_id = ?').bind(ev.id, String(body.userId)).run();
    if (ev.status !== STATUS.cancelled) await afterChange(env, ev, 'leave');
    return { ok: true };
  }

  throw new HttpError(404, '見つかりません');
}

