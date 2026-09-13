# E2E (Playwright)

画面を実際に通すスモーク (docs/93-リファクタリング計画.md §7-4)。流し方は
リポジトリ直下の README の「テスト」。ここは書くときの罠をまとめる。
元になった知見は `.claude/skills/verify/SKILL.md`。

## 置き場所

| ファイル | 役目 |
| --- | --- |
| `env.ts` | 接続先・資格情報・`AUTH_FILE`・番号の頭 `zze2e` (config も読む葉) |
| `helpers.ts` | spec が使う `test` / `expect` と、下の罠を避ける道具 |
| `notes.ts` | E2E のノートをゴミ箱 → 永久削除で片付ける手順 |
| `auth.setup.ts` / `auth.teardown.ts` | ログインして cookie を保存 / セッションを破棄 |
| `*.spec.ts` | スモーク本体 |

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

## ローカル DB を汚さない

- dev サーバは本物のノートが入った DB を使う。**作るノートは番号 `zze2e` 始まり
  だけ**。`notes.ts` の片付けはその頭の番号しか受け付けず、永久削除の確認も文面に
  番号が入っているときだけ受け入れる。「ゴミ箱を空にする」は使わない
- 途中で落ちても `afterAll` が同じ手順で消す (次の回の `beforeAll` も残りを消す)
- 検索結果を開く・Enter で検索すると検索履歴 (`search_queries`) に記録される。
  fixture が書き込みをサーバへ届けず、いまのリストを返して済ませる
- 永久削除はノートの git 履歴に墓石コミットを刻む。dev では `QR_GIT_DIR` 未設定なら
  作業ツリーの `data/git-notes/` (git 管理外) に入る
