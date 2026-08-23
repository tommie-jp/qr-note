# ノート git 履歴計画 (コミット・履歴・差分・復元)

ノート本文の履歴を git で持ち、GUI から扱えるようにする。この計画の範囲は
個人利用で完結する 4 つ:

1. **コミット** — いまの本文に説明を付けて版として残す (明示操作)
2. **履歴** — ノートごとのコミット一覧
3. **差分** — 版と版の間で何が変わったかの表示 (未コミット差分も)
4. **復元** — 過去の版の本文へ戻す

ブランチ・プルリクエスト・マージ・共同編集は範囲外 (§8)。ただし将来そこへ
進めるように、履歴の持ち方だけは git 本物にしておく — 独自のリビジョン
テーブルにすると、ブランチ相当を全部自作することになる。

## 1. 方針: DB が正本・作業コピー、git は履歴専用

このアプリの確立した型「正本はメモ本文 (items.memo)、他は派生キャッシュ」
([items.ts](../src/lib/items.ts) の `derivedFromMemo`) は動かさない。
git は **items.memo のコミット済みスナップショットの置き場**であって、
正本ではない。

- 保存 (編集画面の更新・チェック操作・一括タグ) は今までどおり DB だけを書く。
  **保存経路に git は挟まない** — 保存が git の失敗に巻き込まれてはいけない。
- 「コミット」したときだけ、その時点の items.memo をリポジトリへ書いてコミットする。
- 未コミット差分 = items.memo と HEAD のファイル内容の比較。
  つまり **DB が git の作業ツリー相当**という見立て。

この分担なら全文検索 (PGroonga)・部分暗号化・画像・自動保存はすべて無風で済む。

### 履歴に暗号文・バイナリが入らないこと

シークレットは本文に `![ラベル](/api/secrets/<UUID>)` の**参照**で入る
(docs/51-部分暗号化計画.md §3)。画像・音声も同じく `/api/images/<name>` の
参照で、実体は DB 側にある。したがって本文をそのままコミットしても、
git 履歴に残るのは参照文字列だけ — 暗号文が書き換え不能な履歴に刻まれる
問題も、画像でリポジトリが肥大する問題も、最初から起きない。

## 2. リポジトリの形

- **インスタンス全体で 1 リポジトリ・非 bare**。ノートは `notes/<itemNo>.md`。
  シングルユーザーなので分割する理由がなく、非 bare なら「ファイルを書いて
  add + commit」だけで済む (bare + plumbing での tree 操作が丸ごと消える)。
- itemNo は `[0-9A-Za-z_-]{1,20}` ([validation.ts](../src/lib/validation.ts))
  なので、そのままファイル名にできる。パス区切りも `..` も先頭 `-` も
  混ざらないことをこの書式が保証する (git へ渡すパスは
  [notePath.ts](../src/lib/git/notePath.ts) だけが作る)。
- 置き場は `QR_GIT_DIR`、未設定なら `<cwd>/data/git-notes`。
  開発は `data/` が gitignore 済みなのでそのまま使える。本番はコンテナ内
  `/app/data/git-notes` に named volume を当てる (§7)。
  **注意: 開発時の置き場は qr-search リポジトリの作業ツリーの中**なので、
  リポジトリ判定は「`<dir>/.git` がある」で見る。`rev-parse` 系で判定すると
  外側の qr-search リポジトリに当たってしまい、ノートのコミットが
  アプリのリポジトリへ混ざる。
- git 操作は [notesRepo.ts](../src/lib/git/notesRepo.ts) がプロセス内キューで
  直列化する。アプリは単一コンテナ・単一プロセスなのでこれで足りる
  (多重起動は範囲外)。
- author は固定 (`qr-search <qr-search@localhost>`)。シングルユーザーなので
  帰属を分ける相手がいない。複数ユーザー化するときにアプリのユーザー情報を
  入れる (§8)。

### ライブラリは simple-git + git CLI

git 操作は CLI ラッパーの simple-git で行う (shell を経由せず引数配列で
spawn するので、引数起因のインジェクションはない)。isomorphic-git (pure JS)
は魅力的だが、マージが diff3 ベースで衝突時は例外を投げるだけなので、
将来のマージ UI まで見ると CLI の方が伸びしろがある。ネイティブ束縛
(es-git 等) はビルド・イメージの複雑さに見合わない。実行イメージへの
git 追加は §7。

## 3. ライブラリ層 (src/lib/git/)

すべて Promise を返し、書き込み系は直列化キューを通る。

| 関数 | 中身 |
| ------ | ------ |
| `commitNote(itemNo, memo, message)` | 書いて add + commit。変化なしは null |
| `removeNotes(itemNos, message)` | 永久削除の墓石コミット (`git rm`) |
| `noteHistory(itemNo)` | そのノートのコミット一覧 (新しい順) |
| `noteAtCommit(itemNo, oid)` | その版の本文。その版に存在しなければ null。oid は 40 桁 hex だけ受ける |
| `noteAtHead(itemNo)` | HEAD の本文 (未コミット判定用)。未コミットのノートは null |
| `backfillNotes(notes, message)` | 既存全ノートを 1 コミットで取り込む (§6)。冪等 |

リポジトリは初回操作時に自動で `git init` + 空の初期コミットを作る
(HEAD が常に在ると分岐が減る)。

## 4. Server Actions ([actions.ts](../src/app/actions.ts))

- `commitNoteAction` — requireUser + デモ拒否。**DB のいまの本文**をコミット
  する (フォームから本文は受けない。編集画面は自動保存込みで DB が最新)。
  メッセージ未入力は `update <itemNo>`。
- `restoreNoteVersionAction` — requireUser + デモ拒否。その版の本文を
  `upsertMemo` で保存する。**必ず既存の保存経路を通す**のが要点 —
  tags / props / taskTodo の派生キャッシュを再計算させるため。git 側は
  触らない (復元 = 未コミットの変更が生じるだけ。気に入らなければ
  またコミットせずに直せる)。永久削除済みのノートも upsert なので蘇る。
  **追記 ([docs/87](./87-編集競合対策計画.md))**: 復元は「いま DB にある
  (未コミットかもしれない) 本文」を失う操作なので、直前に
  `checkpointBeforeOverwrite` で 1 版刻む。刻めなければ復元しない。
- `updateMemoAction` / `updateItemAction` — **追記 (docs/87)**。競合を見せた
  うえで利用者が「このまま上書き」を選んだ送信 (`checkpoint=1`) のときだけ、
  消える側の本文を `conflict <itemNo>` として 1 版刻む。保存のたびには
  刻まない (§8 の判断は変えていない)。刻めなければ上書きしない。
- `purgeItemsAction` / `emptyTrashAction` — 永久削除に墓石コミットを足す。
  `purgeItems` / `emptyTrash` の戻り値を件数から **実際に消えた itemNo の列**
  に変えて、それだけを `removeNotes` する。git の失敗は握りつぶさず
  ログには残すが、**DB の削除は巻き戻さない** (履歴の残骸は無害で、
  削除そのものを git の都合で失敗させない)。

デモモード (DEMO_MODE=1) では履歴機能を丸ごと閉じる。毎時再シードで
履歴が嘘になるうえ、ゲストの書き込みで履歴が溜まる一方になるため。
UI はリンクごと出さず、Server Action と履歴ページでも拒む
(setItemPublicAction と同じ二重防御)。

## 5. UI

- `/item/<itemNo>/history` — 履歴一覧。上部に未コミット差分 (あれば) と
  コミットフォーム (メッセージ入力 + コミットボタン)。各版は下の詳細へ。
  ノートが永久削除済みでも履歴があれば開ける (本文の回収口)。
- `/item/<itemNo>/history/<oid>` — その版の差分 (親の版との比較) と
  「この版に復元」。復元は本文を上書きするので ConfirmSubmitButton で確認を挟む。
- 差分表示は **@codemirror/merge** の unifiedMergeView (読み取り専用)。
  既存エディタと同じ CodeMirror 6 系なので依存が素直に足せて、
  将来の 3-way マージ UI (衝突解決) も同じ部品で作れる。
- 入口は ItemView のヘッダー行に「履歴」リンク (デモでは出さない)。

認証: `/item/<itemNo>/history` は [publicPaths.ts](../src/lib/publicPaths.ts) の
完全一致判定に**当たらない**ので、proxy が未ログインを止める (/edit と同じ構図)。
公開ノートの読み手に履歴は見えない — 公開しているのは現在の本文だけで、
過去の版まで公開した覚えはないため、これが正しい既定。

## 6. バックフィル

既存の全ノート (ゴミ箱含む。復元できるものはすべて) を 1 コミットで取り込み、
履歴の起点を作る。実体は [noteHistoryBackfill.ts](../src/lib/noteHistoryBackfill.ts)
の `backfillAllNotes()` で、入口は 2 つ:

- **設定ページ /settings/history** (メニュー「履歴取り込み」) — 本番はビルド済み
  イメージ (standalone) に scripts/ が無いため、これが本番での実行経路。
- **`npm run backfill:git`** (scripts/backfillGitHistory.ts) — ローカル/自動化用。

per-note のコミットに分けて created_at を偽装することはしない — 取り込みは
取り込みであって、当時の編集履歴は存在しないものを在るように見せない。
冪等なので何度実行してもよい。

## 7. インフラ

- **Dockerfile (runner)**: `apt-get install git` と `/app/data/git-notes` の
  作成 + node 所有化。named volume は初回マウントでイメージ側ディレクトリの
  所有者を引き継ぐので、root のままだと USER node で書けない。
- **compose.yaml**: `git-notes` volume を app にマウント。
  **デプロイ時は compose.yaml の scp + `up -d` のやり直しが必要**
  (doDeploy.sh はイメージだけを運ぶ。RAKUTEN_APP_ID のときと同じ罠)。
- **バックアップ**: 「pg_dump だけでメモと画像が揃う」という設計
  (compose.yaml の volumes コメント) からの**唯一の逸脱**になる。
  穴を塞ぐため、DB ダンプ取得のスクリプトに `git bundle create` を足して
  履歴も単一ファイルで持ち帰る (bundle は整合したスナップショットで、
  `git clone <bundle>` で丸ごと復元できる)。
- デモスタック (compose.demo.yaml) には volume を足さない。機能ごと
  閉じているので書き込みは起きない。

## 8. やらないこと (将来の土台としてだけ意識する)

- **ブランチ・プルリクエスト・マージ** — 履歴が git 本物なので、必要になったら
  `git merge-tree` (merge-ort) でサーバ側マージ、@codemirror/merge の 3-way
  ビューで衝突解決 UI、と積み増せる。
- **複数ユーザー・共有** — author をアプリユーザーにする、共有 ACL を
  アプリ層で持つ、はそのとき。
- **リアルタイム共同編集** — git ではなく CRDT (Yjs) の領分。履歴層とは直交。
- **自動コミット** — 保存のたびに刻むと履歴がノイズになる。明示コミットで
  始めて、欲しくなったら「N 分ごとの自動チェックポイント」を別途考える。
  **例外を 1 つ足した ([docs/87](./87-編集競合対策計画.md) §4)**: 編集が競合し、
  利用者が上書きを選んだときだけ、消える側を `conflict <itemNo>` として刻む。
  稀 (競合時のみ)・意味のある版 (負けた側) なのでノイズにならない。
  「N 分ごと」は引き続きやらない。
- **clone の公開** — リポジトリはアプリの内部実装。直接触らせるときは
  Forgejo 等の forge に載せ替える方が筋が良い。
