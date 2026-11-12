import { $, api, boot, el, errText, toast } from './common.js';

const STATUS_LABEL = { open: '募集中', formed: '成立', cancelled: '中止' };

async function load() {
  const d = await api('/admin/overview');

  const st = $('status');
  st.textContent = '';
  st.append(
    el('div', {}, '通知先グループ：', d.groupRegistered ? '登録済み' : '未登録（Botをグループに招待してください）'),
    el('div', {}, `今月の残り通数：${d.quota}　／　グループの人数：${d.groupSize}`),
    el('div', {}, `利用者：${d.users.total}人（うちBotの友だち ${d.users.friends}人・グループのメンバー確認済み ${d.users.members}人）`),
    el('div', { class: 'actions' },
      el('button', { class: 'ghost', onclick: () => run(() => api('/admin/test-push', { method: 'POST' }), 'テストを送りました') },
        `テスト送信（${d.groupSize}通使います）`),
      d.groupRegistered ? el('button', { class: 'danger', onclick: ev => confirmThen(ev.currentTarget, '本当に解除する？',
        () => run(() => api('/admin/reset-group', { method: 'POST' }), '解除しました。新しいグループに招待し直してください')) },
      '通知先グループを解除') : null));

  const box = $('settings');
  box.textContent = '';
  for (const s of d.settings) {
    const input = s.options
      ? el('select', {}, ...s.options.map(o => el('option', { value: o, selected: o === s.value }, o)))
      : el('input', { type: 'number', min: '0', value: s.value });
    input.addEventListener('change', () => run(() => api('/admin/settings', { method: 'POST', body: { key: s.key, value: input.value } }), '保存しました'));
    box.append(el('label', {}, s.key), input, el('div', { class: 'hint' }, s.help));
  }

  const list = $('events');
  list.textContent = '';
  if (!d.events.length) list.append(el('div', { class: 'empty' }, '会はありません'));
  for (const e of d.events) {
    list.append(el('div', { class: 'card' },
      el('div', { class: 'tags' },
        el('span', { class: 'tag' }, e.theme),
        el('span', { class: 'tag' + (e.status === 'formed' ? ' ok' : '') }, STATUS_LABEL[e.status] || e.status),
        e.hidden ? el('span', { class: 'tag off' }, '非表示') : null),
      el('div', { class: 'title' }, `${e.date} ${e.start}　${e.title || e.theme}`),
      e.note ? el('div', { class: 'note' }, e.note) : null,
      el('table', {}, ...e.participants.map(p => el('tr', {},
        el('td', {}, p.name + (p.name === e.hostName ? '（主催）' : '')),
        el('td', {}, p.name === e.hostName ? '' : el('button', { class: 'ghost', onclick: ev => confirmThen(ev.currentTarget, '外す？',
          () => run(() => api(`/admin/events/${e.id}/remove`, { method: 'POST', body: { userId: p.userId } }), '外しました')) }, '外す'))))),
      el('div', { class: 'actions' },
        el('button', { class: 'ghost', onclick: () => run(() => api(`/admin/events/${e.id}/${e.hidden ? 'show' : 'hide'}`, { method: 'POST' }), '変更しました') },
          e.hidden ? '表示に戻す' : '非表示にする'),
        el('button', { class: 'danger', onclick: ev => confirmThen(ev.currentTarget, '本当に削除する？',
          () => run(() => api(`/admin/events/${e.id}/delete`, { method: 'POST' }), '削除しました')) }, '削除する'))));
  }
}

function confirmThen(btn, label, fn) {
  if (btn.dataset.armed) { fn(); return; }
  const orig = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = orig; } }, 3000);
}

async function run(fn, done) {
  try { await fn(); toast(done); await load(); } catch (err) { toast(errText(err)); }
}

(async () => {
  try {
    await boot();
    const q = location.search;
    if (q) $('back').href = '/' + q;
    await load();
    $('loading').hidden = true;
    $('app').hidden = false;
  } catch (err) {
    $('loading').textContent = errText(err);
  }
})();
