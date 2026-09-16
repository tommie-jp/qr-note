# E2E (Playwright)

画面を実際に通すスモーク (docs/93-リファクタリング計画.md §7-4)。流し方は
リポジトリ直下の README の「テスト」。ここは書くときの罠をまとめる。
元になった知見は `.claude/skills/verify/SKILL.md`。

## 置き場所

| ファイル | 役目 |
| --- | --- |
| `env.ts` | 接続先・資格情報・`AUTH_FILE`・番号の頭 `zze2e`・専用 DB の門番 (config も読む葉) |
| `helpers.ts` | spec が使う `test` / `expect` と、下の罠を避ける道具 |
| `notes.ts` | E2E のノートをゴミ箱 → 永久削除で片付ける手順 |
| `webauthn.ts` | 仮想認証器 (CDP WebAuthn) を 1 本のセッションでページに付ける |
| `imageBytes.ts` | PNG / WebP のヘッダ読み・multipart の欄の取り出し・下敷き用の PNG 作り |
| `auth.setup.ts` / `auth.teardown.ts` | ログインして cookie を保存 / セッションを破棄 |
| `*.spec.ts` | スモーク本体。`secrets.spec.ts` だけは専用 DB でしか走らない (下) |

spec は `@playwright/test` ではなく `./helpers` から `test` と `expect` を
import する (dev オーバーレイ退けと検索履歴の遮断が全ページに掛かる)。

## 罠

- **`localhost` で開く。** `127.0.0.1` は proxy が localhost へ 307 で送り直し、
  cookie の持ち主が食い違う
- **Basic ヘッダだけではログインにならない。** 資格情報を見るのは `/login` だけで、
  401 の挑戦に答えるとセッション cookie が付く。setup は `httpCredentials` で
  答え、cookie を `e2e/.auth/` に保存する。teardown がセッションを消す
- **dev オーバーレイ (`<nextjs-portal>`) が左下のクリックを奪う。** fixture が
  init script で隠す (ハードナビゲーションでも消えないよう addStyleTag にしない)
- **ハイドレーションを sleep で待たない。** 検索画面では `searchFor` が打鍵で
  `?q=` が変わるまで打ち直す。ほかの画面では `expectHydrated` で React が
  要素に props を結び付けたのを確かめる。`window.confirm` を挟むボタン
  (永久削除) はハイドレート前に押すと確認なしで送信される
- **Suspense の結果は、届いても hidden の器でしばらく待つ。** `toContainText` は
  隠れた文字でも通るが、role の locator は隠れた行を数えない。行を数える前に
  `toBeVisible` で差し替えを待つ (「もう無い」と取り違えて落ちた)
- **一覧の行は見出しのリンクを押す。** 行全体に `::after` の当たり判定を広げて
  いる (stretched link) ので、`#番号` のリンクは膜の下で押せない
- **行のゴミ箱ボタンはホバー中だけ押せる** (`pointer-events-none`)。行を hover
  してから押す
- **dirty なエディタで reload / goto しない。** beforeunload の確認を Playwright が
  既定で dismiss し、離脱が取り消される。消したいときは `clearEditor`
- **ファイルは `<input type=file>` へ直接入れる** (`injectFiles`)。chooser を待つ
  形と混ぜると change が 2 回届く
- **タッチは `hasTouch` の別コンテキストで** (`newTouchPage`)。既定のコンテキストでは
  touch イベントが出ない
- 初回コンパイルが遅いので、テストの上限は 120 秒・直列 1 worker にしてある

## お絵かき (`draw.spec.ts`)

お絵かき画面を 1 枚のページで順に通す (docs/96 §3-3)。前の段の絵に次の段が
描き足すので直列で、単独の段だけを流すと前提が揃わない。

- **画像は横取りする。** `/api/images` への送信は route で偽の封筒
  (`{ success, data: { url }, error }`) を返し、下敷きの画像も route で配る。
  書き出しは送信本文の WebP / PNG ヘッダから寸法と形式を読む
- **canvas には名前が無い** (fabric が作る要素)。`canvas.lower-canvas`
  (描いた絵) と `canvas.upper-canvas` (操作を受ける面) を構造で取る
- **画素は同じ実行の中の前後比較だけ。** 黄金ファイルは持たない。
  ハッシュは 2 回続けて同じになるまで待って取る (塗り・モザイク・元に戻すは
  非同期に描き上がる)
- **比べる基準は描き直しが落ち着いてから取る。** 道具を替えると選択が外れて
  描き直され、選択中とは画素がわずかにずれる
- **履歴は 150ms まとめてから積む。** その間に次の操作をすると 2 つが 1 手に
  合わさり、元に戻すが 2 手ぶん戻る。移動のように積んだ証拠が見えない操作の
  後は待つ
- **JSON から描き直すと縁の数画素がずれる** (文字・消しゴムの重なり)。
  重ねた絵の「元に戻すで戻る」は、階調の差が小さい画素を数えない比較で見る
- **2 本指は `TouchEvent` を直に投げる** (`newTouchPage` の中で)。
  `page.touchscreen` は 1 点の tap しか出せない
- 挿入はカーソルの位置に入る。開き直した直後のカーソルは本文の先頭

## ローカル DB を汚さない

- dev サーバは本物のノートが入った DB を使う。**作るノートは番号 `zze2e` 始まり
  だけ**。`notes.ts` の片付けはその頭の番号しか受け付けず、永久削除の確認も文面に
  番号が入っているときだけ受け入れる。「ゴミ箱を空にする」は使わない
- 途中で落ちても `afterAll` が同じ手順で消す (次の回の `beforeAll` も残りを消す)
- 検索結果を開く・Enter で検索すると検索履歴 (`search_queries`) に記録される。
  fixture が書き込みをサーバへ届けず、いまのリストを返して済ませる
- 永久削除はノートの git 履歴に墓石コミットを刻む。dev では `QR_GIT_DIR` 未設定なら
  作業ツリーの `data/git-notes/` (git 管理外) に入る

## シークレット (`secrets.spec.ts`) — 専用 DB + 仮想認証器

パスキー登録 → 暗号化の設定 (復旧キー) → 解錠 → 断片の書き込み・復号・入れ子の
画像 → 平文がサーバへ出ていないこと、までを通す
(docs/96-シークレット・お絵かきのテスト計画.md §4-3)。

- **手元の `qr` では走らせない。** 鍵束 (`secret_keyring`) は 1 行しか持てず、
  断片には消す口が無い (docs/51 §11 の GC は未実装)。`scripts/e2eDb.sh` が
  compose の db に `qr_e2e` を作って migration を当てる。`playwright.config.ts` は
  `E2E_DATABASE_URL` を dev サーバの `DATABASE_URL` に渡し、ノートの git 履歴の
  置き場 (`QR_GIT_DIR`) も一時ディレクトリへ向ける
- spec は `E2E_DATABASE_URL` が無い・URL として読めない・DB 名が `qr` のとき、
  理由付きで丸ごと skip する (`env.ts` の `secretsDbProblem`)。
  `npm run test:e2e` (全部) にも `secrets` プロジェクトは含まれるが、この skip で
  何もしない
- **毎回作り直す。** 鍵束が残った DB でもう一度流すと「設定する」が 409 で
  断られ、前の回の仮想認証器 (閉じた時点で消える) でしか開けない鍵束だけが
  残る。最初のテストが「鍵束もパスキーも空」を確かめて、そうでなければ
  作り直し方を添えて落ちる

```bash
scripts/e2eDb.sh create
E2E_DATABASE_URL="$(scripts/e2eDb.sh url)" E2E_START_SERVER=1 npm run test:e2e:secrets
scripts/e2eDb.sh drop
```

### 仮想認証器の罠

- **CDP セッションは 1 本。** `WebAuthn.enable` → `addVirtualAuthenticator`
  (`transport: 'usb'`・`hasResidentKey`・`hasUserVerification`・
  `isUserVerified`・`hasPrf`) → `setAutomaticPresenceSimulation` を同じ
  セッションで続け、閉じない。張り直すと UV が外れて `NotAllowedError` になる
  (`webauthn.ts`)。`page.reload()` や `goto` では消えないが、**別のページ・
  コンテキストには付いてこない**ので、spec は `beforeAll` で開いた 1 枚を
  `afterAll` まで使い回す (`page` フィクスチャは使わない)
- `transport` は `'usb'`。`'internal'` は 1 環境に 1 つしか持てない。usb だと
  `authenticatorAttachment` が `cross-platform` になるが、PRF が返るので QR 委譲の
  文言 (`lib/secret/prf.ts`) には落ちない
- **PRF は登録時に `prf` を要求した credential にしか返らない** (docs/96 §4-3 の
  実測)。`register-options` が要求するようになったので、spec 側で細工は要らない
- **パスキーの検証は origin の完全一致。** `.env` の `WEBAUTHN_ORIGIN` は手元の
  dev の口 (3000 など) を指すので、config が Playwright の立てる口 (`BASE_URL`)
  に揃えて渡す。無いと登録が「登録できませんでした」で止まる
- **通知・失敗の文言は `main` の中で探す。** dev では `console.error` の内容が
  エラーオーバーレイ (`<nextjs-portal>`) の shadow DOM にも出て、同じ文字が
  2 か所になる (fixture は隠すだけで、locator の解決は隠れていても数える)
- 復旧キー・平文は `console.log` しない (dev はブラウザのログを `/logs` へ
  転送する)。復旧キーの「違うキー」は**先頭**の 1 文字を変えて作る — 末尾は
  下位ビットが詰め物で、変えても同じ鍵に戻ることがある
- 画像は `injectFiles` でダイアログの `input[type=file]` へ直接入れる。canvas で
  描き直されるので、1x1 の PNG でよい (webp の断片になる)
