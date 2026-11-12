/**
 * 手元の開発サーバー（npm run dev、DEV_AUTH=1）に対して、主な流れを確かめる。
 * 実行：別のターミナルで `npm run dev` → `npm test`
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

const BASE = process.env.BASE || 'http://localhost:8787';
const SECRET = 'dev-channel-secret';
const run = Date.now().toString(36);

async function session(id, name, friend = false) {
  const r = await fetch(BASE + '/api/session', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ devUser: { id: id === 'admin' ? id : id + run, name, friend } }),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d.token;
}

async function call(token, path, method = 'GET', body) {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}

async function webhook(events, secret = SECRET) {
  const body = JSON.stringify({ events });
  const sig = createHmac('sha256', secret).update(body).digest('base64');
  return fetch(BASE + '/webhook', { method: 'POST', headers: { 'x-line-signature': sig }, body });
}

const outbox = async t => (await call(t, '/dev/outbox')).data.outbox;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tomorrow = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10);

test('署名が正しくないWebhookは拒否する', async () => {
  const r = await webhook([], 'wrong-secret');
  assert.equal(r.status, 401);
  const r2 = await fetch(BASE + '/webhook', { method: 'POST', body: '{}' });
  assert.equal(r2.status, 401);
});

test('ログインしていないとAPIを使えない', async () => {
  const r = await call('bogus.token', '/events');
  assert.equal(r.status, 401);
});

test('募集 → 参加 → 成立通知 → 取消で人数割れ → 再成立 → 中止', async () => {
  const admin = await session('admin', '管理者');
  // 最初に招待されたグループを通知先に登録（すでに登録済みなら変わらない）
  const a = await call(admin, '/admin/reset-group', 'POST');
  assert.equal(a.status, 200);
  await webhook([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'G' + run } }]);
  await sleep(300);
  const ov = await call(admin, '/admin/overview');
  assert.equal(ov.data.groupRegistered, true);
  await call(admin, '/admin/settings', 'POST', { key: 'FORMED_TO', value: 'auto' });

  const host = await session('host', 'きそ', true);
  const u2 = await session('u2', 'たなか', true);
  const u3 = await session('u3', 'すずき', false);
  const u4 = await session('u4', 'さとう', false);

  // 入力チェック
  const bad = await call(host, '/events', 'POST', { theme: 'その他', date: tomorrow, start: '19:00' });
  assert.equal(bad.status, 400);

  const c = await call(host, '/events', 'POST', {
    theme: '面談練習（ロープレ）', date: tomorrow, start: '19:00', end: '20:00', style: 'オンライン', minPeople: 3, capacity: 3,
  });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const id = c.data.id;
  let ev = c.data.events.find(e => e.id === id);
  assert.equal(ev.isHost, true);
  assert.deepEqual(ev.members, ['きそ']);
  assert.ok(!('hostUserId' in ev) && !JSON.stringify(c.data).includes('dev-host'), 'userIdを画面に返さない');

  assert.equal((await call(u2, `/events/${id}/join`, 'POST')).status, 200);
  assert.equal((await call(u2, `/events/${id}/join`, 'POST')).status, 400, '二重参加はできない');

  const before = (await outbox(admin)).length;
  const j3 = await call(u3, `/events/${id}/join`, 'POST');
  ev = j3.data.events.find(e => e.id === id);
  assert.equal(ev.status, 'formed');
  let sent = (await outbox(admin)).slice(before);
  assert.equal(sent.length, 1, '成立通知は1回だけ');
  assert.equal(sent[0].kind, 'group', '無料枠に余裕があればグループへ');
  assert.match(sent[0].text, /成立しました/);

  assert.equal((await call(u4, `/events/${id}/join`, 'POST')).status, 400, '定員を超えて参加できない');
  assert.equal((await call(host, `/events/${id}/leave`, 'POST')).status, 400, '主催者は取消ではなく中止');

  // 取消で人数割れ → 友だち追加している参加者だけに知らせる
  const b2 = (await outbox(admin)).length;
  const l3 = await call(u3, `/events/${id}/leave`, 'POST');
  assert.equal(l3.data.events.find(e => e.id === id).status, 'open');
  sent = (await outbox(admin)).slice(b2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'multicast');
  assert.equal(sent[0].to.length, 2, '友だちの2人（きそ・たなか）だけ');

  // 再成立でまた通知
  const b3 = (await outbox(admin)).length;
  await call(u4, `/events/${id}/join`, 'POST');
  sent = (await outbox(admin)).slice(b3);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /成立しました/);

  // 主催者以外は中止できない。主催者は中止できる
  assert.equal((await call(u2, `/events/${id}/cancel`, 'POST')).status, 403);
  const b4 = (await outbox(admin)).length;
  const cc = await call(host, `/events/${id}/cancel`, 'POST');
  assert.equal(cc.status, 200);
  assert.ok(!cc.data.events.some(e => e.id === id), '中止した会は一覧から消える');
  sent = (await outbox(admin)).slice(b4);
  assert.equal(sent[0].kind, 'multicast');
  assert.match(sent[0].text, /中止/);
});

test('無料枠が少ないときは、グループではなく参加者だけに送る（auto）', async () => {
  const admin = await session('admin', '管理者');
  // 残り200通・グループ20人：200-20 < 190 になるよう、残しておく通数を大きくする
  await call(admin, '/admin/settings', 'POST', { key: 'GROUP_RESERVE', value: '190' });
  try {
    const h = await session('h2', 'やまだ', true);
    const x = await session('x2', 'いとう', true);
    const c = await call(h, '/events', 'POST', { theme: 'もくもく勉強会', date: tomorrow, start: '10:00', minPeople: 2 });
    const before = (await outbox(admin)).length;
    await call(x, `/events/${c.data.id}/join`, 'POST');
    const sent = (await outbox(admin)).slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'multicast');
  } finally {
    await call(admin, '/admin/settings', 'POST', { key: 'GROUP_RESERVE', value: '20' });
  }
});

test('管理者：非表示・参加者を外す・設定の値チェック。一般の人は使えない', async () => {
  const admin = await session('admin', '管理者');
  const h = await session('h3', 'もり', false);
  const x = await session('x3', 'はやし', false);
  assert.equal((await call(h, '/admin/overview')).status, 403);

  const c = await call(h, '/events', 'POST', { theme: '雑談会', date: tomorrow, start: '21:00', minPeople: 4 });
  const id = c.data.id;
  await call(x, `/events/${id}/join`, 'POST');
  const ov = await call(admin, '/admin/overview');
  const e = ov.data.events.find(v => v.id === id);
  const target = e.participants.find(p => p.name === 'はやし');
  assert.equal((await call(admin, `/admin/events/${id}/remove`, 'POST', { userId: target.userId })).status, 200);
  assert.deepEqual((await call(h, '/events')).data.events.find(v => v.id === id).members, ['もり']);

  await call(admin, `/admin/events/${id}/hide`, 'POST');
  assert.ok(!(await call(h, '/events')).data.events.some(v => v.id === id));
  assert.equal((await call(x, `/events/${id}/join`, 'POST')).status, 404, '非表示の会には参加できない');

  assert.equal((await call(admin, '/admin/settings', 'POST', { key: 'FORMED_TO', value: 'everyone' })).status, 400);
  assert.equal((await call(admin, '/admin/settings', 'POST', { key: 'GROUP_ID', value: 'x' })).status, 400);
  await call(admin, `/admin/events/${id}/delete`, 'POST');
});

test('グループで「一覧」と送ると返信する／別のグループからは退出する', async () => {
  const admin = await session('admin', '管理者');
  const ov = await call(admin, '/admin/overview');
  assert.equal(ov.data.groupRegistered, true);
  const before = (await outbox(admin)).length;
  await webhook([{ type: 'join', replyToken: 'r2', source: { type: 'group', groupId: 'OTHER' + run } }]);
  await webhook([{ type: 'message', replyToken: 'r3', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: '一覧' } }]);
  await sleep(300);
  const sent = (await outbox(admin)).slice(before);
  assert.match(sent[0].text, /別のグループ専用/);
  assert.match(sent[1].text, /これからの予定|募集中の会はありません/);
});
