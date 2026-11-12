import { $, api, boot, el, errText, friendUrl, shareToLine, toast } from './common.js';

let themes = [], defaultMin = {}, events = [], filter = 'すべて', today = '', appUrl = '', busy = false;

/* ---- 表示 ---- */

const WD = '日月火水木金土';
function dayLabel(d) {
  const dt = new Date(d + 'T00:00:00');
  const s = `${dt.getMonth() + 1}月${dt.getDate()}日(${WD[dt.getDay()]})`;
  return d === today ? '今日 ' + s : s;
}
const timeText = e => `${e.start}〜${e.end || ''}`;
const restOf = e => Math.max(0, e.minPeople - e.members.length);

function shareText(e) {
  const state = e.status === 'formed' ? '成立しています（参加まだ間に合います）' : `あと${restOf(e)}名で成立`;
  return `📣【${e.theme}】${e.title || ''}\n${dayLabel(e.date)} ${timeText(e)}／${e.style}\n` +
    `参加：${e.members.join('、')}\n${state}\n参加はこちら👇\n${appUrl}`;
}

function renderChips() {
  const box = $('chips');
  box.textContent = '';
  ['すべて', ...themes].forEach(t => {
    box.append(el('button', { class: 'chip' + (filter === t ? ' on' : ''), onclick: () => { filter = t; render(); } }, t));
  });
}

function render() {
  renderChips();
  const list = $('list');
  list.textContent = '';
  const shown = events.filter(e => filter === 'すべて' || e.theme === filter);
  if (!shown.length) {
    list.append(el('div', { class: 'empty' }, 'いまは募集がありません。', el('br'), '「＋ 募集する」から気軽にどうぞ。'));
    return;
  }
  let lastDay = '';
  for (const e of shown) {
    if (e.date !== lastDay) { list.append(el('div', { class: 'day' }, dayLabel(e.date))); lastDay = e.date; }
    list.append(card(e));
  }
}

function card(e) {
  const formed = e.status === 'formed';
  const full = !!(e.capacity && e.members.length >= e.capacity);
  const actions = el('div', { class: 'actions' });

  if (!e.joined) {
    actions.append(el('button', { class: 'primary', disabled: full || busy, onclick: () => act(e, 'join') }, full ? '満員です' : '✋ 参加する'));
  } else if (!e.isHost) {
    actions.append(el('button', { class: 'ghost', disabled: busy, onclick: ev => confirmThen(ev.currentTarget, '本当に取り消す？', () => act(e, 'leave')) }, '参加を取り消す'));
  }
  actions.append(el('button', { class: 'lineBtn', onclick: () => shareToLine(shareText(e)) }, 'LINEで知らせる'));
  if (e.isHost) {
    actions.append(el('button', { class: 'danger', disabled: busy, onclick: ev => confirmThen(ev.currentTarget, '本当に中止する？', () => act(e, 'cancel')) }, '中止する'));
  }

  return el('div', { class: 'card' + (formed ? ' formed' : '') },
    el('div', { class: 'tags' },
      el('span', { class: 'tag' }, e.theme),
      el('span', { class: 'tag ' + (formed ? 'ok' : 'wait') }, formed ? '成立！' : `あと${restOf(e)}名で成立`),
      e.joined ? el('span', { class: 'tag' }, e.isHost ? 'あなたが募集' : '参加中') : null),
    el('div', { class: 'title' }, e.title || e.theme),
    el('div', { class: 'meta' }, timeText(e) + '／' + e.style + (e.place ? `（${e.place}）` : '')),
    e.note ? el('div', { class: 'note' }, e.note) : null,
    el('div', { class: 'members' },
      `参加：${e.members.join('、')}（${e.members.length}名${e.capacity ? '／定員' + e.capacity + '名' : ''}）`),
    actions);
}

function confirmThen(btn, label, fn) {
  if (btn.dataset.armed) { fn(); return; }
  const orig = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = orig; } }, 3000);
}

/** 参加・募集のあとに「グループに知らせる」を出す（本人のLINEから送るので通数はかからない） */
function offerShare(e, lead) {
  const bar = $('shareBar');
  bar.textContent = '';
  bar.append(lead, el('br'),
    el('div', { class: 'actions' },
      el('button', { class: 'lineBtn', onclick: async () => { await shareToLine(shareText(e)); bar.hidden = true; } }, 'グループに知らせる'),
      el('button', { class: 'ghost', onclick: () => { bar.hidden = true; } }, 'あとで')));
  bar.hidden = false;
  bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---- 操作 ---- */

async function run(fn) {
  if (busy) return;
  busy = true;
  render();
  try { await fn(); } catch (err) { toast(errText(err)); } finally { busy = false; render(); }
}

function act(e, kind) {
  run(async () => {
    const r = await api(`/events/${e.id}/${kind}`, { method: 'POST' });
    events = r.events;
    const now = events.find(x => x.id === e.id);
    if (kind === 'join') {
      if (now && now.status === 'formed') { toast('参加しました！成立です🙌'); offerShare(now, '成立しました🙌 グループにも知らせますか？'); }
      else { toast('参加しました'); if (now) offerShare(now, '参加しました！手を挙げたことをグループに知らせますか？'); }
    } else {
      toast(kind === 'leave' ? '参加を取り消しました' : '中止にしました');
    }
  });
}

function submit() {
  const form = {
    theme: $('fTheme').value, title: $('fTitle').value, date: $('fDate').value,
    start: $('fStart').value, end: $('fEnd').value, style: $('fStyle').value,
    place: $('fPlace').value, minPeople: $('fMin').value, capacity: $('fCap').value, note: $('fNote').value,
  };
  run(async () => {
    const r = await api('/events', { method: 'POST', body: form });
    events = r.events;
    ['fTitle', 'fNote', 'fPlace', 'fCap', 'fEnd'].forEach(id => { $(id).value = ''; });
    $('form').classList.remove('open');
    $('openForm').textContent = '＋ 募集する';
    filter = 'すべて';
    toast('募集しました！');
    const mine = events.find(x => x.id === r.id);
    if (mine) offerShare(mine, '募集しました！グループに知らせて、仲間を集めましょう。');
  });
}

async function reload(quiet) {
  try {
    events = (await api('/events')).events;
    render();
    if (!quiet) toast('更新しました');
  } catch (err) { if (!quiet) toast(errText(err)); }
}

/* ---- 起動 ---- */

function setupForm(styles) {
  $('fTheme').append(...themes.map(t => el('option', { value: t }, t)));
  $('fStyle').append(...styles.map(s => el('option', { value: s }, s)));
  $('fDate').min = today;
  $('fDate').value = today;
  $('fMin').value = defaultMin[themes[0]] || 2;
  $('fTheme').addEventListener('change', () => { $('fMin').value = defaultMin[$('fTheme').value] || 2; });
  $('openForm').addEventListener('click', () => {
    const open = $('form').classList.toggle('open');
    $('openForm').textContent = open ? '閉じる' : '＋ 募集する';
  });
  $('submit').addEventListener('click', submit);
  $('reload').addEventListener('click', () => reload(false));
}

(async () => {
  try {
    const { cfg } = await boot();
    const d = await api('/init');
    themes = d.themes; defaultMin = d.defaultMin; today = d.today; events = d.events; appUrl = d.appUrl || location.origin;
    $('me').textContent = d.me.name + ' さん';
    $('adminLink').hidden = !d.me.isAdmin;
    if (!d.me.isFriend && cfg.botBasicId) {
      $('friendLink').href = friendUrl(cfg.botBasicId);
      $('friendNotice').hidden = false;
    }
    setupForm(d.styles);
    render();
    $('loading').hidden = true;
    $('app').hidden = false;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(true); });
  } catch (err) {
    $('loading').textContent = errText(err);
  }
})();
