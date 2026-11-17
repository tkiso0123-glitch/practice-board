# 練習・勉強会ボード　STATUS

更新：2026-11-17（Claude Code）

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

## 実装前に公式ドキュメントで確認すること
- グループのメンバーかどうかを確かめるAPI（`GET /v2/bot/group/{groupId}/member/{userId}`）が、認証済みでない無料アカウントでも使えるか
- shareTargetPicker の利用条件と、LIFFで有効にする設定
- LINEの料金と通数の数え方、Cloudflare Workers／D1の無料枠（最新の値）

## 未決・依頼事項
- 【木曽さん】LINEグループにBotを招待することについて、グループの了解をとる
- 【木曽さん】LINE Developers の「チャネル基本設定」で **Channel secret を再発行**する（11/12にスクリーンショットで共有されたため）。新しい値はチャットに貼らない

## 進捗
- [x] ソースの保存場所：GitHub `tkiso0123-glitch/practice-board`（非公開）
- [x] MVP実装（手元の開発環境で自動テスト6件が通過）：一覧・募集・参加・取消・中止／成立・人数割れ・中止の自動通知（auto切り替え）／Webhook（署名検証・招待・友だち追加・一覧コマンド）／参加・募集後の「グループに知らせる」（shareTargetPicker）／管理画面／毎朝のリマインドと古いデータの削除
- [ ] 未検証：実際のLINE・Cloudflare上での動作（LIFFログイン、shareTargetPicker、グループのメンバー確認API、毎朝の定時処理）
- [x] Cloudflareアカウント作成済み（アカウントIDは wrangler.jsonc の account_id に設定済み）
- [x] LINE公式アカウント作成済み：名前「キャリコン試験対策Bot」、ベーシックID `@366dohie`（wrangler.jsonc に設定済み）、チャットはオフ、Messaging API 有効（Messaging APIのChannel ID：2012582219）
- [x] クラウド環境「practice-board」を作成：api.cloudflare.com への接続を許可

## 次にやること（本番セットアップの続き）
1. 【木曽さん】Cloudflare APIトークンを作る：https://dash.cloudflare.com/profile/api-tokens → Create Token → テンプレート「Edit Cloudflare Workers」＋ Permissions に Account／D1／Edit を追加 → 作成
2. 【Claude】`request_credential`（host: api.cloudflare.com）で安全な入力フォームを出し、トークンを登録してもらう（チャットには貼らせない）
3. 【Claude】`wrangler d1 create practice-board` → database_id を wrangler.jsonc に反映 → `npm run db:migrate:remote` → `npm run deploy` → 公開URLを伝える
4. 【木曽さん】Cloudflareの画面（Workers → practice-board → Settings → Variables and Secrets）で秘密情報を登録：LINE_CHANNEL_TOKEN（長期トークン）、LINE_CHANNEL_SECRET（再発行後の値）、SESSION_SECRET（ランダムな長い文字列）
5. 【木曽さん】LINE Developers の Webhook URL に `https://（公開URL）/webhook` を入れて保存・検証、「Webhookの利用」をオン
6. 【木曽さん＋Claude】LINEログインチャネル（同じプロバイダー）とLIFFを作成 → LIFF_ID・LOGIN_CHANNEL_ID・ADMIN_USER_IDS を wrangler.jsonc に反映して再公開（README「本番のセットアップ」2）
7. Botをグループに招待（グループの了解をとってから）→ 木曽さんと少人数でテスト → 全体に公開

- [ ] 本番セットアップ（README「本番のセットアップ」）→ 木曽さんと少人数でテスト → 全体に公開
