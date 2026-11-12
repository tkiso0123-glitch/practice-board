export const THEMES = ['面談練習（ロープレ）', 'もくもく勉強会', '相談会', '雑談会', 'その他'];
export const STYLES = ['オンライン', '対面', 'どちらでも'];
export const DEFAULT_MIN = { '面談練習（ロープレ）': 3 };

export const STATUS = { open: 'open', formed: 'formed', cancelled: 'cancelled' };

/** 管理画面で切り替えられる設定：[key, 初期値, 選べる値, 説明] */
export const SETTINGS = [
  ['FORMED_TO', 'auto', ['auto', 'group', 'members', 'off'],
    '成立・取消・中止のお知らせの送り先。auto＝無料枠に余裕があればグループ、少なければ参加者だけ／group＝毎回グループ／members＝参加者だけ／off＝送らない'],
  ['NOTIFY_JOIN', 'off', ['on', 'off'],
    '成立前の参加を、そのつどBotがグループに知らせる（1回＝グループ人数分の通数）。ふだんは参加者本人が無料で告知します'],
  ['NOTIFY_NEW', 'off', ['on', 'off'],
    '新しい募集をBotがグループに知らせる（1回＝グループ人数分の通数）'],
  ['REMIND', 'off', ['on', 'off'],
    '成立した会の当日朝8時に、参加者へリマインドする（友だち追加している人だけ）'],
  ['GROUP_RESERVE', '20', null,
    'auto のとき、グループに送ったあとに最低限残しておく通数'],
  ['REQUIRE_MEMBER', 'on', ['on', 'off'],
    'on＝講座のLINEグループのメンバーだけが使える／off＝LINEでログインした人なら誰でも使える'],
];

export const SETTING_DEFAULTS = Object.fromEntries(SETTINGS.map(s => [s[0], s[1]]));
