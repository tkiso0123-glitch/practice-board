# 練習・勉強会ボード　STATUS

更新：2026-11-18（Claude Code・セッション引き継ぎ時点）

背景と要件：`docs/練習ボード_ClaudeCode引き継ぎ.md`　会話にしか残っていなかった経緯：`CONTEXT.md`　本番の手順の詳細：`README.md`

## いまどこか（ひとことで）
MVPは実装済み。本番セットアップの**手順1（Cloudflare APIトークンの作成）を木曽さんが作業中**。トークンができたら、Claudeが安全な入力フォームを出して登録し、公開まで進める。

## 進捗（できたものと置き場所）
- ソース：GitHub `tkiso0123-glitch/practice-board`（非公開）
  - `main`：MVP一式と、11/17朝までの STATUS.md
  - ブランチ `claude/blissful-albattani-c7t1vj`：`main` に加えて、この STATUS.md の更新と `CONTEXT.md`（**mainには未取り込み**。新しいセッションは、まずこのブランチを取り込む）
- [x] MVP実装（手元の開発環境で自動テスト6件が通過）：一覧・募集・参加・取消・中止／成立・人数割れ・中止の自動通知（auto切り替え）／Webhook（署名検証・招待・友だち追加・一覧コマンド）／参加・募集後の「グループに知らせる」（shareTargetPicker）／管理画面／毎朝のリマインドと古いデータの削除
- [x] Cloudflareアカウント作成済み（アカウントIDは `wrangler.jsonc` の `account_id` に設定済み）
- [x] LINE公式アカウント作成済み：名前「キャリコン試験対策Bot」、ベーシックID `@366dohie`（`wrangler.jsonc` に設定済み）、チャットはオフ、Messaging API 有効（Messaging APIのChannel ID：2012582219）
- [x] クラウド環境「practice-board」を作成：`api.cloudflare.com` への接続を許可済み
- [x] LINEグループにBotを招待することについて、グループの了解を得た（2026-11-17 木曽さんより）
- [x] 公開の準備を確認（2026-11-17）：クラウド環境から `api.cloudflare.com` に届く（認証情報がないという応答が返る）。`npx wrangler deploy --dry-run` が通る（wrangler 4.149.0）
- [ ] Cloudflare APIトークンの作成と登録（作業中）
- [ ] D1の作成、マイグレーション、公開（`wrangler.jsonc` の `database_id` は仮の値 `00000000-…` のまま）
- [ ] 秘密情報の登録、Webhookの接続、LINEログインチャネルとLIFFの作成（`wrangler.jsonc` の `LIFF_ID`・`LOGIN_CHANNEL_ID`・`ADMIN_USER_IDS` は空のまま）
- [ ] 未検証：実際のLINE・Cloudflare上での動作（LIFFログイン、shareTargetPicker、グループのメンバー確認API、毎朝の定時処理）

## 決定事項
| 論点 | 決定 | 理由 |
|---|---|---|
| 本人確認・入り口（5-1） | **LIFF＋LINEログイン** | 登録なしで本人確認でき、個別通知の紐づけも自動になる。グループのメンバーかどうかをAPIで確かめれば、利用をクラスの人に限定できる見込み |
| 動かす場所（5-3） | **Cloudflare Workers＋D1** | 無料で常時動く。LINE署名を検証できる。決まった時刻の処理（リマインド）も無料。Supabase無料版は使われないと休止し、Firebase Functionsは従量課金プランが必要なため見送り |
| 費用 | **完全無料**（LINEは月200通の無料枠） | 成立通知は auto（無料枠に余裕があればグループ、少なければ参加者だけ）を引き継ぐ |
| 手挙げの告知 | shareTargetPicker（本人名義・通数ゼロ）。使えないときは line.me/R/share | 通数の節約 |
| Web Push | MVPでは見送り | iPhoneでの制約が大きい |
| 修了後の利用 | **未定** → 試験までを前提に作る。終わった会は一定期間（案：30日）後に自動削除し、延長はあとから設定で変えられるようにする | 個人情報を最小限にする |
| 汎用性 | **1グループ専用**。ただし、複数グループに広げる妨げにならない書き方にする | シンプルさ優先 |
| Cloudflareへの公開方法 | クラウドのセッションから、**APIトークン**で公開する（トークンは `request_credential` のフォームで登録） | クラウドのセッションではブラウザでの `wrangler login` が使えない見込みのため。トークンをチャットに貼らずに済む |
| 秘密情報（LINEのトークン・シークレット、SESSION_SECRET）の登録 | **木曽さんがCloudflareの画面に直接入力**する | 値をチャットにもClaudeにも渡さないため |
| Bot招待 | グループの了解を得た（2026-11-17） | グループの発言がWebhookでBotに届くようになるため、事前に了解をとった |

## 未決・木曽さんが決めること／やること
- 【決める】講座の修了後も使い続けるか（データの保存期間に関わる。今は30日で自動削除）
- 【やる】LINE Developers の「チャネル基本設定」で **Channel secret を再発行**する（11/12にスクリーンショットで共有されたため）。新しい値はチャットに貼らない
- 【確認】2026-11-17にチャットに32桁の値が貼られた。Channel secret かどうかは木曽さんに未確認。Channel secret なら、登録の前にもう一度再発行する（`CONTEXT.md` 参照。値そのものはどのファイルにも書いていない）

## 次にやること（順番つき）
1. 【木曽さん】Cloudflare APIトークンを作る ← **今ここ**
   - https://dash.cloudflare.com/profile/api-tokens → Create Token → テンプレート「Edit Cloudflare Workers」
   - Permissions に Account／D1／Edit を足す。Account Resources は自分のアカウント。Zone Resources を求められたら「All zones」
   - トークンは一度しか表示されないので、フォームに貼り終えるまで画面を閉じない
2. 【Claude】木曽さんから「作った」と連絡が来たら、`request_credential`（host: `api.cloudflare.com`）で安全な入力フォームを出し、トークンを登録してもらう
3. 【Claude】`npm install` → `npx wrangler d1 create practice-board` → `database_id` を `wrangler.jsonc` に反映 → `npm run db:migrate:remote` → `npm run deploy` → 公開URLを伝える
4. 【木曽さん】Cloudflareの画面（Workers → practice-board → Settings → Variables and Secrets）で秘密情報を登録：`LINE_CHANNEL_TOKEN`（チャネルアクセストークン・長期）、`LINE_CHANNEL_SECRET`（再発行後の値）、`SESSION_SECRET`（ランダムな長い文字列。作り方はそのときにClaudeが案内）
5. 【木曽さん】LINE Developers の Webhook URL に `https://（公開URL）/webhook` を入れて保存・検証、「Webhookの利用」をオン
6. 【木曽さん＋Claude】LINEログインチャネル（Messaging APIと同じプロバイダー）とLIFFを作成 → LIFF ID・チャネルID・木曽さんのユーザーIDを `wrangler.jsonc` の `LIFF_ID`・`LOGIN_CHANNEL_ID`・`ADMIN_USER_IDS` に反映して再公開（README「本番のセットアップ」2）
7. 【木曽さん＋Claude】Botをグループに招待 → 木曽さんと少人数でテスト → 全体に公開
8. 【Claude】公開できたら、ブランチを `main` に取り込む方法を木曽さんに確認する（プルリクエストは依頼があったときだけ作る）

## 注意点
- **新しいセッションはクラウド環境「practice-board」で始める**。Default 環境は `api.cloudflare.com` に届かない
- クラウドのコンテナは毎回新しくなる。`node_modules` は残らないので、最初に `npm install` をする
- wrangler をトークンで動かすには、環境変数 `CLOUDFLARE_API_TOKEN` が必要になる見込み。本物の値は渡さず、形式だけ合わせた仮の値を入れる（通信の途中で、登録したトークンに差し替わる仕組み）。**まだ試していない**。登録直後は反映に1分ほどかかることがある
- 秘密でない設定（LIFF_ID など）は `wrangler.jsonc` の `vars` に書く。Cloudflareの画面で足した通常の変数は、次の公開で消える見込み（Secret として登録したものは残る）
- 手順4の秘密情報は、手順3の公開が済んでからでないと登録できない（登録先のWorkerがまだないため）。公開直後は秘密情報がないので、Webhookやログインは動かなくて正常
- 本番で `DEV_AUTH` は絶対に設定しない（設定すると、誰でも任意の人になりすませる）
- 秘密情報（トークン、シークレット）はチャットに貼らない。貼ってしまった値は作り直す
- LINE・Cloudflareの画面の名前は、Claudeの記憶で書いている。変わっている可能性がある

## 試してダメだったこと
- このセッション（2026-11-17）では、失敗した試行はない
- 検討して見送った案（Claudeのアーティファクト、GAS試作版、Supabase、Firebase）は、上の決定事項と `docs/練習ボード_ClaudeCode引き継ぎ.md` の4章を参照

## 実装前に確認する予定だったこと（公式ドキュメントでは未確認）
- グループのメンバーかどうかを確かめるAPI（`GET /v2/bot/group/{groupId}/member/{userId}`）が、認証済みでない無料アカウントでも使えるか。使えない場合は、管理画面で `REQUIRE_MEMBER` を off にする（README「運用メモ」）
- shareTargetPicker の利用条件と、LIFFで有効にする設定
- LINEの料金と通数の数え方、Cloudflare Workers／D1の無料枠（最新の値）
