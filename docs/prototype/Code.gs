/**
 * 練習・勉強会ボード（Google Apps Script）
 *
 * - 公開Webページで「この日のこの時間に◯◯したい！」を募集・参加できる
 * - 成立人数に達したらLINEグループに自動通知
 * - Googleのサーバー上で動くので、PCを閉じていても動き続ける
 *
 * 秘密情報（LINEのトークン）は「スクリプト プロパティ」に保存し、コードやシートには書かない。
 */

const TZ = 'Asia/Tokyo';

const SHEETS = {
  events: {
    name: 'events',
    headers: ['id', 'theme', 'title', 'date', 'start', 'end', 'style', 'place',
      'minPeople', 'capacity', 'note', 'hostName', 'hostToken', 'status',
      'formedNotified', 'createdAt'],
  },
  members: {
    name: 'members',
    headers: ['eventId', 'name', 'token', 'joinedAt'],
  },
  // 個別通知用：Botと友だちになって「登録 ニックネーム」と送った人
  lineUsers: {
    name: 'lineUsers',
    headers: ['name', 'userId', 'registeredAt'],
  },
};

const THEMES = ['面談練習（ロープレ）', 'もくもく勉強会', '相談会', '雑談会', 'その他'];
const STYLES = ['オンライン', '対面', 'どちらでも'];
const STATUS = { open: '募集中', formed: '成立', cancelled: '中止' };

// 「settings」シートで on / off を切り替えられる項目
const SETTING_DEFAULTS = [
  ['FORMED_TO', 'auto', '成立・取消・中止の通知先：auto（無料枠に余裕があればグループ、少なければ参加者だけ）／group／members（参加者だけ）／off'],
  ['NOTIFY_NEW', 'off', '新しい募集をBotがグループに通知する（1回＝グループ人数分の通数。ふだんはページの「LINEで知らせる」ボタンで無料告知）'],
  ['NOTIFY_JOIN', 'off', '成立前の参加をBotがグループに通知する（通数を多く使います）'],
  ['REMIND', 'off', '成立した会の当日朝8時に、参加者へリマインドする（installReminder の実行が必要）'],
  ['GROUP_RESERVE', '20', 'グループ通知のあとに最低限残しておく通数（auto判定用）'],
];

/* ========== Webページ ========== */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('練習・勉強会ボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getInitialData() {
  return { themes: THEMES, styles: STYLES, today: today_(), url: url_(), events: listEvents() };
}

function listEvents() {
  const today = today_();
  const members = rows_('members');
  return rows_('events')
    .filter(e => e.date >= today && e.status !== STATUS.cancelled)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .map(e => publicEvent_(e, members.filter(m => m.eventId === e.id)));
}

function createEvent(form) {
  const ev = validateEvent_(form);
  return withLock_(() => {
    const id = Utilities.getUuid().slice(0, 8);
    const token = Utilities.getUuid();
    const now = nowStr_();
    sheet_('events').appendRow([id, ev.theme, ev.title, ev.date, ev.start, ev.end,
      ev.style, ev.place, ev.minPeople, ev.capacity, ev.note, ev.hostName, token,
      STATUS.open, '', now]);
    sheet_('members').appendRow([id, ev.hostName, token, now]);
    if (setting_('NOTIFY_NEW') === 'on') pushGroup_(msgNew_(ev));
    return { id: id, token: token, events: listEvents() };
  });
}

function joinEvent(id, name) {
  name = clean_(name, 20);
  if (!name) throw new Error('お名前（ニックネーム）を入力してください');
  return withLock_(() => {
    const ev = findEvent_(id);
    if (ev.status === STATUS.cancelled) throw new Error('この会は中止になりました');
    if (ev.date < today_()) throw new Error('すでに終わった会です');
    const ms = rows_('members').filter(m => m.eventId === ev.id);
    if (ms.some(m => m.name === name)) {
      throw new Error('同じ名前の方がすでに参加しています。名前を少し変えてください');
    }
    const cap = Number(ev.capacity) || 0;
    if (cap && ms.length >= cap) throw new Error('定員に達しています');

    const token = Utilities.getUuid();
    sheet_('members').appendRow([ev.id, name, token, nowStr_()]);
    const names = ms.map(m => m.name).concat(name);
    const min = Number(ev.minPeople);

    if (names.length >= min && ev.status !== STATUS.formed) {
      setCell_('events', ev._row, 'status', STATUS.formed);
      if (ev.formedNotified !== 'yes') {
        setCell_('events', ev._row, 'formedNotified', 'yes');
        notify_(names, msgFormed_(ev, names));
      }
    } else if (names.length < min && setting_('NOTIFY_JOIN') === 'on') {
      pushGroup_(msgJoin_(ev, names));
    }
    return { token: token, events: listEvents() };
  });
}

function leaveEvent(id, token) {
  return withLock_(() => {
    const ev = findEvent_(id);
    const ms = rows_('members').filter(m => m.eventId === ev.id);
    const me = ms.find(m => m.token === String(token));
    if (!me) throw new Error('参加したときと同じ端末・ブラウザから操作してください');
    if (me.token === ev.hostToken) {
      throw new Error('主催者は参加を取り消せません。やめる場合は「中止する」を押してください');
    }
    sheet_('members').deleteRow(me._row);
    const rest = ms.filter(m => m !== me).map(m => m.name);
    if (ev.status === STATUS.formed && rest.length < Number(ev.minPeople)) {
      setCell_('events', ev._row, 'status', STATUS.open);
      if (ev.formedNotified === 'yes') {
        setCell_('events', ev._row, 'formedNotified', ''); // 再成立したらまた通知する
        notifyMembersFirst_(rest, msgUnformed_(ev, rest));
      }
    }
    return { events: listEvents() };
  });
}

function cancelEvent(id, token) {
  return withLock_(() => {
    const ev = findEvent_(id);
    if (String(token) !== ev.hostToken) throw new Error('募集した端末・ブラウザからのみ中止できます');
    setCell_('events', ev._row, 'status', STATUS.cancelled);
    // 成立済みなら参加者に、募集をBotで告知していたならグループに知らせる
    const names = rows_('members').filter(m => m.eventId === ev.id).map(m => m.name);
    if (ev.formedNotified === 'yes') notifyMembersFirst_(names, msgCancel_(ev));
    else if (setting_('NOTIFY_NEW') === 'on') pushGroup_(msgCancel_(ev));
    return { events: listEvents() };
  });
}

/* ========== LINE Webhook（Botがグループに入ったとき・「一覧」と書かれたとき） ========== */

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    (body.events || []).forEach(handleLineEvent_);
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('OK');
}

function handleLineEvent_(ev) {
  const src = ev.source || {};
  const props = PropertiesService.getScriptProperties();
  const groupId = props.getProperty('LINE_GROUP_ID');

  if (ev.type === 'join' && src.type === 'group') {
    if (!groupId) {
      // 最初に招待されたグループだけを通知先として登録する（あとから乗っ取られないように）
      props.setProperty('LINE_GROUP_ID', src.groupId);
      replyLine_(ev.replyToken,
        'このグループに、練習・勉強会のお知らせを送ります📮\n\n募集・参加はこちら\n' + url_() +
        '\n\n「一覧」と送ると、これからの予定をお返事します。');
    }
    return;
  }

  if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
    if (src.type === 'group' && src.groupId !== groupId) return;
    const t = ev.message.text.trim();
    const reg = t.match(/^登録[\s　:：]*(.+)$/);
    if (reg && src.userId) {
      replyLine_(ev.replyToken, registerUser_(src.userId, reg[1]));
    } else if (/^登録解除$/.test(t) && src.userId) {
      replyLine_(ev.replyToken, unregisterUser_(src.userId));
    } else if (/^(一覧|いちらん|予定)$/.test(t)) {
      replyLine_(ev.replyToken, msgList_(listEvents()));
    } else if (/^(ボード|URL|url|リンク)$/.test(t)) {
      replyLine_(ev.replyToken, '募集・参加はこちら\n' + url_());
    }
  }
}

/* ========== 当日朝のリマインド（任意） ========== */

function remindToday() {
  if (setting_('REMIND') !== 'on') return;
  const list = listEvents().filter(e => e.date === today_() && e.status === STATUS.formed);
  // 参加者だけに送る（グループ全体には送らない）
  list.forEach(e => {
    multicast_(userIdsFor_(e.members),
      '☀️ 今日はこちらの会です\n' + label_(e) + '\n' + when_(e) + '／' + where_(e) +
      '\n参加：' + e.members.join('、') + '\n\n' + url_());
  });
}

/** 一度だけ実行：毎朝8時台にremindTodayを動かすトリガーを作る */
function installReminder() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'remindToday')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('remindToday').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
}

/* ========== 初期設定・テスト用 ========== */

/** 最初に一度だけ実行：シートを作り、設定の初期値を入れる */
function setup() {
  sheet_('events');
  sheet_('members');
  sheet_('lineUsers');
  settingsSheet_();
  console.log('準備できました。次は「デプロイ」→「新しいデプロイ」でウェブアプリとして公開してください。');
}

/** LINEに試しに1通送る（通数を1×グループ人数ぶん使います） */
function testPush() {
  pushGroup_('🔧 接続テストです。このメッセージが届いていれば設定完了です。\n' + url_());
}

/** 設定状況を確認する（ログに出ます） */
function checkSetup() {
  const p = PropertiesService.getScriptProperties();
  console.log('LINE_CHANNEL_TOKEN: ' + (p.getProperty('LINE_CHANNEL_TOKEN') ? '設定済み' : '未設定'));
  console.log('LINE_GROUP_ID: ' + (p.getProperty('LINE_GROUP_ID') || '未登録（Botをグループに招待してください）'));
  console.log('ページURL: ' + url_());
  console.log('今月の残り通数: ' + remainingQuota_() + '／グループ人数: ' + groupSize_());
  console.log('個別通知の登録者: ' + rows_('lineUsers').map(u => u.name).join('、'));
  SETTING_DEFAULTS.forEach(s => console.log(s[0] + ': ' + setting_(s[0])));
}

/* ========== LINE送信 ========== */

/**
 * 成立・取消・中止の通知。settingsの FORMED_TO で送り先を決める。
 *  - group   : グループへ（1回＝グループ人数分の通数）
 *  - members : 個別登録している参加者だけへ（1回＝登録者数ぶん）
 *  - auto    : 無料枠に余裕があればグループ、少なくなったら参加者だけ
 */
function notify_(names, text) {
  const mode = setting_('FORMED_TO') || 'auto';
  if (mode === 'off') return;
  const ids = userIdsFor_(names);

  if (mode === 'group') {
    if (!pushGroup_(text)) multicast_(ids, text);
    return;
  }
  if (mode === 'members') {
    if (!multicast_(ids, text)) pushGroup_(text);
    return;
  }
  // auto
  const reserve = int_(setting_('GROUP_RESERVE'), 20);
  if (remainingQuota_() - groupSize_() >= reserve) {
    if (pushGroup_(text)) return;
  }
  if (!multicast_(ids, text)) pushGroup_(text);
}

/** 取消・中止など参加者だけに関係するお知らせ：登録済みの参加者がいればその人たちだけに送る */
function notifyMembersFirst_(names, text) {
  if (setting_('FORMED_TO') === 'off') return;
  if (!multicast_(userIdsFor_(names), text)) notify_(names, text);
}

/** グループに送る。今月の残り通数が足りないときは送らずに false を返す */
function pushGroup_(text) {
  const to = PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID');
  if (!to) {
    console.warn('通知先グループが未登録のため送信しませんでした: ' + text);
    return false;
  }
  if (remainingQuota_() < groupSize_()) {
    console.warn('今月の残り通数が足りないため、グループ送信をとりやめました: ' + text);
    return false;
  }
  return lineFetch_('post', '/v2/bot/message/push',
    { to: to, messages: [{ type: 'text', text: text.slice(0, 4900) }] }).code === 200;
}

/** 個別登録している人だけに送る（通数は人数分） */
function multicast_(userIds, text) {
  if (!userIds.length) return false;
  if (remainingQuota_() < userIds.length) {
    console.warn('今月の残り通数が足りないため、個別送信をとりやめました: ' + text);
    return false;
  }
  return lineFetch_('post', '/v2/bot/message/multicast',
    { to: userIds.slice(0, 500), messages: [{ type: 'text', text: text.slice(0, 4900) }] }).code === 200;
}

/** 返信（Reply API）は通数にカウントされない */
function replyLine_(replyToken, text) {
  if (!replyToken) return;
  lineFetch_('post', '/v2/bot/message/reply',
    { replyToken: replyToken, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
}

/** 今月あと何通送れるか（上限なしのプランなら Infinity） */
function remainingQuota_() {
  const q = lineFetch_('get', '/v2/bot/message/quota');
  const used = lineFetch_('get', '/v2/bot/message/quota/consumption');
  if (q.code !== 200 || used.code !== 200) return 0;
  if (q.json.type !== 'limited') return Infinity;
  return Number(q.json.value) - Number(used.json.totalUsage || 0);
}

/** グループの人数（6時間キャッシュ）。取れないときは多めに見積もる */
function groupSize_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('groupSize');
  if (hit) return Number(hit);
  const gid = PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID');
  if (!gid) return 0;
  const r = lineFetch_('get', '/v2/bot/group/' + encodeURIComponent(gid) + '/members/count');
  const n = r.code === 200 ? Number(r.json.count) : 30;
  cache.put('groupSize', String(n), 21600);
  return n;
}

function lineFetch_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!token) {
    console.warn('LINE_CHANNEL_TOKEN が未設定です');
    return { code: 0, json: {} };
  }
  const opt = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  };
  if (body) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch('https://api.line.me' + path, opt);
  const code = res.getResponseCode();
  let json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* 空レスポンス */ }
  if (code !== 200) console.error('LINE API ' + path + ' ' + code + ': ' + res.getContentText());
  return { code: code, json: json };
}

/* ========== 個別通知の登録（Botに「登録 ニックネーム」と送る） ========== */

function registerUser_(userId, rawName) {
  const name = clean_(rawName, 20);
  if (!name) return '「登録 ニックネーム」の形で送ってください。';
  return withLock_(() => {
    const users = rows_('lineUsers');
    const other = users.find(u => u.name === name && u.userId !== userId);
    if (other) return '「' + name + '」は別の方が登録しています。少し違う名前で登録してください。';
    const mine = users.find(u => u.userId === userId);
    if (mine) {
      setCell_('lineUsers', mine._row, 'name', name);
    } else {
      sheet_('lineUsers').appendRow([name, userId, nowStr_()]);
    }
    return '「' + name + '」で登録しました✅\n' +
      'ページで同じ名前で参加すると、成立などのお知らせがこのBotから個別に届くことがあります。\n' +
      '※Botを友だち追加していないと届きません。\nやめるときは「登録解除」と送ってください。';
  });
}

function unregisterUser_(userId) {
  return withLock_(() => {
    const mine = rows_('lineUsers').find(u => u.userId === userId);
    if (!mine) return '登録はありませんでした。';
    sheet_('lineUsers').deleteRow(mine._row);
    return '登録を解除しました。';
  });
}

function userIdsFor_(names) {
  const map = {};
  rows_('lineUsers').forEach(u => { map[u.name] = u.userId; });
  return names.map(n => map[n]).filter(Boolean);
}

/* ========== メッセージ文面 ========== */

function label_(e) {
  return '【' + e.theme + '】' + (e.title || '');
}

function timeRange_(e) {
  return e.start + '〜' + (e.end || '');
}

function when_(e) {
  const d = new Date(e.date + 'T00:00:00+09:00');
  const w = '日月火水木金土'[Number(Utilities.formatDate(d, TZ, 'u')) % 7];
  return Utilities.formatDate(d, TZ, 'M/d') + '(' + w + ') ' + timeRange_(e);
}

function where_(e) {
  return e.style + (e.place ? '（' + e.place + '）' : '');
}

function msgFormed_(e, names) {
  return '🙌 成立しました！\n' + label_(e) + '\n' + when_(e) + '／' + where_(e) +
    '\n参加：' + names.join('、') + '（' + names.length + '名）' +
    '\n\n詳細・参加はこちら\n' + url_();
}

function msgNew_(e) {
  const rest = Number(e.minPeople) - 1;
  return '📣 新しい募集\n' + label_(e) + '\n' + when_(e) + '／' + where_(e) +
    '\n主催：' + e.hostName + '　あと' + rest + '名で成立' +
    '\n\n参加はこちら\n' + url_();
}

function msgJoin_(e, names) {
  const rest = Number(e.minPeople) - names.length;
  return '✋ ' + names[names.length - 1] + 'さんが参加しました\n' + label_(e) + '\n' + when_(e) +
    '\nあと' + rest + '名で成立\n\n' + url_();
}

function msgUnformed_(e, names) {
  const rest = Number(e.minPeople) - names.length;
  return '⚠️ 参加の取り消しがあり、成立人数を下回りました\n' + label_(e) + '\n' + when_(e) +
    '\nあと' + rest + '名で再成立します\n\n' + url_();
}

function msgCancel_(e) {
  return '🙏 次の会は中止になりました\n' + label_(e) + '\n' + when_(e);
}

function msgList_(events) {
  if (!events.length) return 'いまは募集中の会はありません。\n募集はこちらから\n' + url_();
  const lines = events.slice(0, 10).map(e => {
    const state = e.status === STATUS.formed ? '成立' : 'あと' + Math.max(0, e.minPeople - e.members.length) + '名';
    return '・' + when_(e) + ' ' + label_(e) + '［' + state + '］';
  });
  if (events.length > 10) lines.push('ほか' + (events.length - 10) + '件');
  return '📅 これからの予定\n' + lines.join('\n') + '\n\n' + url_();
}

/* ========== 入力チェック ========== */

function validateEvent_(f) {
  f = f || {};
  const theme = THEMES.indexOf(f.theme) >= 0 ? f.theme : '';
  if (!theme) throw new Error('テーマを選んでください');
  const title = clean_(f.title, 40);
  if (theme === 'その他' && !title) throw new Error('「その他」の場合はタイトルを入れてください');

  const date = String(f.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付を入れてください');
  if (date < today_()) throw new Error('過去の日付は選べません');

  const start = String(f.start || '');
  if (!/^\d{2}:\d{2}$/.test(start)) throw new Error('開始時刻を入れてください');
  const end = String(f.end || '');
  if (end && (!/^\d{2}:\d{2}$/.test(end) || end <= start)) throw new Error('終了時刻は開始より後にしてください');

  const minPeople = int_(f.minPeople, 3);
  if (minPeople < 2 || minPeople > 20) throw new Error('成立人数は2〜20名で入れてください');
  const capacity = int_(f.capacity, 0);
  if (capacity && capacity < minPeople) throw new Error('定員は成立人数以上にしてください');

  const hostName = clean_(f.hostName, 20);
  if (!hostName) throw new Error('お名前（ニックネーム）を入れてください');

  return {
    theme: theme, title: title, date: date, start: start, end: end,
    style: STYLES.indexOf(f.style) >= 0 ? f.style : STYLES[0],
    place: clean_(f.place, 60), minPeople: minPeople, capacity: capacity,
    note: clean_(f.note, 300), hostName: hostName,
  };
}

function clean_(s, max) {
  // 先頭の = + - @ は数式として解釈されないよう取り除く
  return String(s == null ? '' : s).replace(/[\u0000-\u0009\u000B-\u001F]/g, '')
    .trim().replace(/^[=+\-@]+/, '').slice(0, max);
}

function int_(v, def) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

/* ========== シート操作 ========== */

function sheet_(key) {
  const def = SHEETS[key];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    // 日付や時刻が自動変換されないよう、すべて書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(key) {
  const sh = sheet_(key);
  const h = SHEETS[key].headers;
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, h.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    h.forEach((k, j) => { o[k] = norm_(k, r[j]); });
    return o;
  }).filter(o => o[h[0]] !== '');
}

function norm_(k, v) {
  if (v instanceof Date) {
    const f = k === 'date' ? 'yyyy-MM-dd' : (k === 'start' || k === 'end') ? 'HH:mm' : "yyyy-MM-dd'T'HH:mm:ss";
    return Utilities.formatDate(v, TZ, f);
  }
  return v === null || v === undefined ? '' : String(v);
}

function setCell_(key, row, col, value) {
  sheet_(key).getRange(row, SHEETS[key].headers.indexOf(col) + 1).setValue(value);
}

function findEvent_(id) {
  const ev = rows_('events').find(e => e.id === String(id));
  if (!ev) throw new Error('この会が見つかりません。ページを更新してください');
  return ev;
}

function publicEvent_(e, ms) {
  // hostToken・各参加者のtokenはページに返さない
  return {
    id: e.id, theme: e.theme, title: e.title, date: e.date, start: e.start, end: e.end,
    style: e.style, place: e.place, minPeople: Number(e.minPeople) || 2,
    capacity: Number(e.capacity) || 0, note: e.note, hostName: e.hostName,
    status: e.status, members: ms.map(m => m.name),
  };
}

function settingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('settings');
  if (!sh) {
    sh = ss.insertSheet('settings');
    sh.getRange(1, 1, 1, 3).setValues([['key', 'value（on / off）', '説明']]).setFontWeight('bold');
    sh.getRange(2, 1, SETTING_DEFAULTS.length, 3).setValues(SETTING_DEFAULTS);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, 3);
  }
  return sh;
}

function setting_(key) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('settings');
  const def = SETTING_DEFAULTS.find(s => s[0] === key);
  if (!sh) return def ? def[1] : '';
  const row = sh.getDataRange().getValues().find(r => r[0] === key);
  return String(row ? row[1] : (def ? def[1] : '')).trim().toLowerCase();
}

/* ========== その他 ========== */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('混み合っています。少し待ってからもう一度お試しください');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function nowStr_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function url_() {
  return PropertiesService.getScriptProperties().getProperty('APP_URL') ||
    ScriptApp.getService().getUrl() || '';
}
