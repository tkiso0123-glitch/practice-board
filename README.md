# 練習・勉強会ボード

キャリコン講座の仲間（LINEグループ）で、面談練習・勉強会などを募集し、人数がそろったらLINEで知らせるアプリ。

- LINEの中で開くWebアプリ（LIFF）。参加者の登録は不要で、LINEで開くだけで本人確認できる
- 講座のLINEグループのメンバーだけが使える（設定で切り替え可）
- Cloudflare Workers＋D1で動く（無料枠・PCを閉じていても動く）
- 「手を挙げた」の告知は本人のLINEから送るので、Botの通数を使わない。Botの自動通知は「成立」など大事なものだけ

背景と要件：`docs/練習ボード_ClaudeCode引き継ぎ.md`　決定事項と進捗：`STATUS.md`
GAS試作版（参考）：`docs/prototype/`

## 構成

| 場所 | 内容 |
|---|---|
| `public/` | 画面（`index.html`＝ボード、`admin.html`＝管理） |
| `src/api.js` | 募集・参加・取消・中止、管理者API |
| `src/auth.js` | 本人確認（LINEのアクセストークンを確かめ、グループのメンバーか確認） |
| `src/notify.js` | 通知先の自動切り替え（auto）と文面 |
| `src/line.js` | LINE APIの呼び出し、Webhookの署名検証 |
| `src/webhook.js` | Botの招待・友だち追加・「一覧」コマンド |
| `src/cron.js` | 毎朝8時：当日のリマインド、古いデータの削除（初期値30日） |
| `migrations/` | データベースの定義 |

## 手元で動かす（開発）

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

ブラウザで `http://localhost:8787/?dev=u1:きそ` を開くと、LINEなしで「きそ」として試せる（`:friend` を付けるとBotの友だち扱い）。
管理画面は `http://localhost:8787/admin.html?dev=admin:管理者`。
LINEには実際には送らず、送ったはずの内容は `/api/dev/outbox` に記録される。

テスト（開発サーバーを起動したまま）：

```bash
npm test
```

## 本番のセットアップ（初回のみ・木曽さんと一緒に行う）

> LINEやCloudflareの画面の名前は変わることがあります。

### 1. LINE公式アカウントとMessaging API
試作版の `docs/prototype/セットアップ手順.md` の手順4と同じ。
- 「グループ・複数人トークへの参加を許可する」をオン
- 応答メッセージはオフ、Webhookはオン
- LINE Developersの Messaging APIチャネルで、**チャネルアクセストークン（長期）** と **チャネルシークレット** を控える
- **ベーシックID**（`@xxxx`）を控える

### 2. LINEログインチャネルとLIFF
1. LINE Developersで、**Messaging APIと同じプロバイダー**に「LINEログイン」チャネルを作る（同じプロバイダーでないとuserIdが一致しない）
2. チャネルの「リンクされたLINE公式アカウント」に、1の公式アカウントを設定
3. 「LIFF」タブで追加：サイズ Full、エンドポイントURL＝公開後のURL（例 `https://practice-board.xxxx.workers.dev/`）、Scope は `profile` と `openid`、友だち追加オプション＝On（Aggressive）
4. LIFFの設定で **shareTargetPicker** を有効にする
5. 控えるもの：**LIFF ID**、LINEログインチャネルの **チャネルID**、チャネル基本設定にある **あなたのユーザーID**（管理者用）

### 3. Cloudflare
```bash
npx wrangler login
```

```bash
npx wrangler d1 create practice-board
```
表示された `database_id` を `wrangler.jsonc` に書く。`vars` に LIFF_ID・LOGIN_CHANNEL_ID・BOT_BASIC_ID・ADMIN_USER_IDS（2-5のユーザーID）を書く。

秘密情報を登録する（値は聞かれたときに貼る。コードには書かない）：

```bash
npx wrangler secret put LINE_CHANNEL_TOKEN
```

```bash
npx wrangler secret put LINE_CHANNEL_SECRET
```

```bash
npx wrangler secret put SESSION_SECRET
```
（SESSION_SECRETは長いランダムな文字列。`openssl rand -base64 32` で作れる）

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

### 4. つなぐ
1. Messaging APIチャネルの Webhook URL に `https://（公開URL）/webhook` を設定し、「検証」→成功を確認
2. Botを講座のLINEグループに招待 → 「このグループに、練習・勉強会のお知らせを送ります📮」と返事が来れば登録完了
3. `https://liff.line.me/（LIFF ID）` をLINEで開いて動作確認。管理画面は右上の「管理」から

### 本番で `DEV_AUTH` は絶対に設定しない
設定すると、誰でも任意の人になりすませる。

## 運用メモ
- 通数：20人のグループに1回送ると20通。無料は月200通。管理画面で残りを確認できる
- グループのメンバー確認が無料アカウントで使えない場合は、管理画面で `REQUIRE_MEMBER` を off にする（LINEでログインした人なら誰でも使える状態になるので、URLはグループの外に貼らない）
- 通知先グループを変えるとき：管理画面で「通知先グループを解除」→ 新しいグループに招待
