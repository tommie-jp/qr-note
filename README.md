# QR Note

部品に貼った QR コードシール (URL 埋め込み) を読み取り、そのノートを
開く Web アプリ。ノートは Markdown で、電子工作向けの記法 (回路図・
実体配線図・計器の画面・数式) と、学習向けの記法 (問題・答え隠し・
学習状況の表) を持つ。1 人〜少人数で使う前提で、スマホ (PWA) を主戦場にしている。

## デモ

**<https://qr-demo.tommie.jp>** — ログイン **demo / demo**

QR シールで電子部品を管理する様子を実際に触れます。タグ検索・特性表・
数式 / 回路図 / 図表の記法・シール印刷まで一通り試せます。使い方はデモ内の
最初のノート (`#1`) にまとめてあります。

> ⚠️ データは**毎時 0 分にすべてリセット**されます。個人情報や不適切な
> ファイルはアップロードしないでください。

<!-- markdownlint-disable MD013 MD033 -->
<p>
  <img src="docs/assets/hero-search.png" width="230" alt="タグ検索と特性表">
  <img src="docs/assets/hero-circuit.png" width="230" alt="回路図 (CircuiTikZ)">
  <img src="docs/assets/hero-print.png" width="230" alt="QR シール印刷">
</p>
<!-- markdownlint-enable MD013 MD033 -->

### スマホで試す

下の QR コードをスマホで読むと、デモの部品ノート (2SC1815) が開きます。
「貼った QR から部品情報を開く」というこのアプリの核をそのまま体験できます。

<!-- markdownlint-disable MD013 MD033 -->
<img src="docs/assets/qr-item2.png" width="150" alt="qr-demo.tommie.jp/item/2 を開く QR コード">
<!-- markdownlint-enable MD013 MD033 -->

## 主な機能

| 分野 | できること | 計画書 |
| --- | --- | --- |
| ノート | Markdown 本文、タグ `#tag`、プロパティ `hFE=208`、画像・動画・音声の添付、ページ分け、タスクリスト | [docs/メモ記法.md](docs/メモ記法.md) |
| 検索 | 全文検索 (PGroonga)。AND / OR / NOT・括弧・タグ・`is:todo`、番号順 / 更新順 / タイトル順 | [docs/05-全文検索の使い方.md](docs/05-全文検索の使い方.md) |
| 電子工作の記法 | CircuiTikZ と YAML の回路図、ブレッドボード・ユニバーサル基板の実体配線図、VNA・オシロ・スペアナ・ロジアナの画面、x-y グラフ、銅張り基板の寸法図 | [docs/91](docs/91-回路YAMLフェンス計画.md)・[97](docs/97-実体配線図フェンス計画.md)・[103](docs/103-計器の画面と寸法図フェンス計画.md) |
| 学習の記法 | 数式 (KaTeX)、mermaid、問題 (quiz)、答え隠し、学習状況の表 (matrix)、日々の記録のグラフ (health)、単語の読み上げ | [docs/58](docs/58-CBT問題集計画.md)・[77](docs/77-進捗マトリックス計画.md)・[83](docs/83-健康管理フェンス計画.md) |
| スキャン | QR・JAN・ISBN の読み取り。JAN は Yahoo!ショッピング、ISBN は openBD・NDL・楽天ブックスから書誌と書影を引く | [docs/09](docs/09-スキャン計画.md)・[13](docs/13-書誌自動取得計画.md)・[14](docs/14-JAN商品情報取得計画.md) |
| 画像 | OCR (端末内で実行)、お絵かき、画像の類似検索、回転、動画のアニメサムネ | [docs/24](docs/24-画像OCR計画.md)・[25](docs/25-画像検索計画.md)・[34](docs/34-お絵かき計画.md) |
| 秘密 | ノートの一部をパスキー (PRF) で暗号化するシークレット | [docs/51-部分暗号化計画.md](docs/51-部分暗号化計画.md) |
| 履歴 | ノートの本文を git で版管理。差分の閲覧と復元 | [docs/57-ノートgit履歴計画.md](docs/57-ノートgit履歴計画.md) |
| 持ち出し | ZIP で全件エクスポート / インポート、Evernote (.enex) の取り込み | [docs/28-エクスポート計画.md](docs/28-エクスポート計画.md) |
| 公開 | ノート単位の公開 (ログイン不要で閲覧)、OGP カード、QR シール印刷 | [docs/22-ノート公開計画.md](docs/22-ノート公開計画.md)・[89](docs/89-OGP計画.md) |
| PWA | ホーム画面への追加、圏外での検索・閲覧 | [docs/65-オフライン対応計画.md](docs/65-オフライン対応計画.md) |
| 運用 | サーバログの閲覧、管理者向けのサーバー情報とヘルスチェック | [docs/21](docs/21-ログ表示計画.md)・[109](docs/109-サーバー情報計画.md) |

## 構成

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- Prisma 7 + PostgreSQL 18 + PGroonga (全文検索)
- Docker Compose (`db` / `app`。ローカルで HTTPS を試すときだけ `proxy` = Caddy)

### 本番とデモ (vps2)

本番 (`qr.tommie.jp`) とデモ (`qr-demo.tommie.jp`) は同じ VPS (vps2) に
別々の Compose スタックとして並ぶ。置き場のディレクトリと DB は分けてあり、
共有するのはホストの nginx と私設レジストリだけ。イメージは同じ物を使う。

```mermaid
flowchart LR
  user["ブラウザ / PWA<br>(QR シールから開く)"]

  subgraph vps2["vps2"]
    nginx["nginx + certbot<br>(TLS・ボディ上限・レート制限)"]

    subgraph prod["本番スタック ~/qr-search"]
      app["app<br>Next.js<br>127.0.0.1:3000"]
      db[("db<br>PostgreSQL 18 + PGroonga<br>127.0.0.1:5432")]
      git[("git-notes volume<br>ノートの git 履歴")]
    end

    subgraph demo["デモスタック ~/qr-demo"]
      dapp["app (DEMO_MODE)<br>127.0.0.1:3100"]
      ddb[("db: qr (公開中) / qr_seed (種)<br>127.0.0.1:5433")]
      timer["systemd timer<br>毎時 qr_seed から作り直す"]
    end

    reg[("私設レジストリ<br>registry:2<br>127.0.0.1:5000")]
  end

  ext["外部 API<br>Yahoo!ショッピング・楽天ブックス"]

  user -- "HTTPS qr.tommie.jp" --> nginx
  user -- "HTTPS qr-demo.tommie.jp" --> nginx
  nginx --> app
  nginx --> dapp
  app --> db
  app --> git
  app --> ext
  dapp --> ddb
  timer -.-> ddb
  reg -. "docker pull" .-> app
  reg -. "docker pull" .-> dapp
```

- **認証はアプリが行う。** nginx は認証せず、TLS とボディ上限と
  ログイン口のレート制限だけを受け持つ (「ログイン」の節)
- **公開するポートは nginx の 80 / 443 だけ。** app・db・レジストリは
  どれも `127.0.0.1` にしか口を開けていない
- **永続データは 2 つ。** ノートと画像・添付は DB に、ノートの git 履歴は
  `git-notes` volume に入る。バックアップも 2 本で揃える
  (`doDumpDB-from-vps2.sh` と `doDumpGit-from-vps2.sh`)
- デモの資源は `compose.demo.yaml` で絞ってある (app 1GB・db 512MB)。
  設定は [docs/39-デモ公開計画.md](docs/39-デモ公開計画.md)

### 配布の流れ

イメージは手元でビルドし、vps2 ではビルドしない。`./doDeploy.sh` が
次の順に流す (詳しくは「デプロイ」の節)。

```mermaid
flowchart LR
  subgraph local["手元 (WSL)"]
    check["lint・typecheck・test"]
    build["docker buildx"]
  end

  subgraph vps2["vps2"]
    reg[("私設レジストリ")]
    db[("db")]
    app["app"]
  end

  build -- "push (SSH トンネル・差分の層だけ)" --> reg
  check -- "全部通ったら版タグを公開" --> reg
  local -- "prisma migrate (SSH トンネル)" --> db
  reg -- "pull して app を作り直す" --> app
```

## 文書

- [docs/README.md](docs/README.md) — 計画書・調査メモの索引 (番号順) と、
  文書参照の検査 (`node scripts/checkDocLinks.mjs`) の使い方
- [docs/93-リファクタリング計画.md](docs/93-リファクタリング計画.md) —
  挙動を変えずに構造を整える全体計画
- [docs/メモ記法.md](docs/メモ記法.md)・[docs/05-全文検索の使い方.md](docs/05-全文検索の使い方.md) —
  アプリ内のヘルプ (`/docs/memo`・`/docs/search`) がそのまま読み込む
- [e2e/README.md](e2e/README.md) — E2E の書き方と罠

計画書は「何を・なぜ・どう決めたか」を残す場所で、コードのコメントから
`docs/<番号>` で参照する。文書とコードは同じコミットで直す
(参照切れは `scripts/checkDocLinks.mjs` が CI で検査する)。

## 開発

```bash
cp .env.example .env   # 値を設定 (各変数の説明は .env.example のコメント)
npm install            # postinstall で prisma generate が走る
npm run db:up          # docker compose up -d db (PostgreSQL 18 + PGroonga)
npm run db:migrate     # prisma migrate dev
npm run dev            # http://localhost:3000
```

`npm run dev` と `npm run build` は先に `scripts/assets.mjs` (OCR モデル等の
複製) と第三者ライセンス一覧の生成を走らせる。

`src/lib` を import するスクリプトを `tsx` で直接走らせるときは
`npx tsx --conditions=react-server scripts/xxx.ts` のように条件を付ける
(サーバ専用 module が `import 'server-only'` を持ち、付けないと import 時に throw する)。

### 環境変数

正本は [.env.example](.env.example) のコメント。要点だけ表にする。

| 変数 | 必須 | 用途 |
| --- | --- | --- |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | 必須 | DB の接続 |
| `BASIC_AUTH_USER` / `BASIC_AUTH_HASH_B64` | 必須 | パスワードログイン |
| `QR_BASE_URL` | 必須 | 印刷する QR に埋め込む URL のベース |
| `APP_ENV` | 本番のみ | `production` 以外は画面がピンクになり `[LOCAL]` が付く (本番の誤操作防止) |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` | 任意 | パスキー。両方揃って初めて有効 |
| `ADMIN_USER` | 任意 | 「サーバー情報」を開ける管理者。未設定なら誰も管理者ではない |
| `DEMO_MODE` / `DEMO_LOGIN_HINT` | デモのみ | 隔離デモ用。本番・ローカルでは空にする |
| `YAHOO_SHOPPING_APP_ID` | 任意 | JAN から商品名を引く |
| `RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` | 任意 | ISBN から書影を引く |
| `RAKUTEN_APP_ORIGIN` | 任意 | 同上。3 つとも要る |
| `DB_PORT` / `APP_PORT` | 任意 | ホストへ開くポート (既定 5432 / 3000。デモは 5433 / 3100) |
| `QR_GIT_DIR` | 任意 | ノートの git 履歴の置き場 (既定 `data/git-notes`) |
| `SITE_ADDRESS` | ローカルのみ | Caddy (proxy プロファイル) のアドレス |

環境変数を足したとき・アップロードや取り込みの上限を変えたときは、3 か所が
揃っているかを検査する (`.env.example`・`compose.yaml` の app の `environment:`・
コードの `process.env`、および `Caddyfile`・`deploy/nginx/*.conf`・`src` の上限の定数)。
意図的なずれはスクリプト内の表に理由付きで書いてある:

```bash
node scripts/checkEnv.mjs
```

## テスト

```bash
npm test                # 単体テスト (DB 不要)
npm run test:coverage   # カバレッジ付きで流す
npm run coverage:merge  # 単体と E2E のカバレッジを合算する (e2e/README.md「カバレッジ」)
npm run lint
npm run typecheck
```

`test:coverage` は、1GB を圧縮して上限を確かめる 2 本 (`readZip.totalLimit*.test.ts`)
を外し、テストの既定の上限を 30 秒に伸ばして流す。計測下では fflate の deflate が
5 倍ほど遅くなり、CI では 60 秒を超えるため。2 本は `npm test` で走る。

DB を実際に叩く統合テスト (`src/lib/items/items.test.ts` と
`src/lib/secret/store.test.ts` の全体、`src/app/api/images/images.test.ts` の
DB 往復) は、`DATABASE_URL` と `RUN_DB_TESTS=1` が**両方**あるときだけ走り、
普段は skip になる。
vitest は `.env` を読まないので、`DATABASE_URL` もコマンドで渡す
(値は `.env` と同じ。`docker compose up -d db` と migrate を済ませた
ローカル DB に向ける):

```bash
RUN_DB_TESTS=1 DATABASE_URL=postgresql://qr:changeme@localhost:5432/qr npm test
```

テストが作るノートは番号 `zzft` 始まりで、後始末で消す。

push と PR のたびに GitHub Actions
([.github/workflows/ci.yml](.github/workflows/ci.yml)) が lint・typecheck・
test・`checkDocLinks.mjs`・`checkEnv.mjs`・`npm run build` と、PGroonga の
service container を立てた DB 統合テストと、空の DB に向けた E2E (シークレットの
spec も含む) を流す (配布はしない)。単体と E2E の行カバレッジの合算も表にして
ジョブのサマリに出す (数えるだけで、合否には使わない)。

### E2E (Playwright)

ブラウザで画面を通すスモーク (`e2e/`。罠と書き方は
[e2e/README.md](e2e/README.md))。dev サーバとローカル DB を使うので、
`docker compose up -d db` を済ませておく。ログインはテスト専用の資格情報で
行い、`.env` は書き換えずにシェルの env で上書きする (シェルの値が `.env` より
優先される):

```bash
npx playwright install chromium   # 初回だけ (ブラウザ本体を落とす)
HASH=$(node -e "const h = require('bcryptjs').hashSync('e2e-test-pass', 10);
  console.log(Buffer.from(h).toString('base64'))")
BASIC_AUTH_USER=e2e BASIC_AUTH_HASH_B64=$HASH npm run dev -- -p 3210

npm run test:e2e                  # 別の端末で
```

- dev サーバの起動も Playwright に任せるなら `E2E_START_SERVER=1 npm run test:e2e`
  (資格情報の上書きも設定が行う。3210 番が空いていること)
- 接続先は `E2E_BASE_URL` (既定 `http://localhost:3210`)。**`127.0.0.1` では
  開かない** (非本番のループバック IP は localhost へ 307 で送り直される)
- 資格情報を変えるときは `E2E_USER` / `E2E_PASSWORD` とサーバ側の `BASIC_AUTH_*` を揃える
- E2E が作るノートは id が `e2e0e2e0-` 始まり・見出しが `zze2e<n>` 始まりで、画面からゴミ箱 → 永久削除して片付ける。
  結果は `test-results/`・`playwright-report/` に出る (どちらも git 管理外)
- シークレット (パスキー登録 → 暗号化の設定 → 解錠 → 断片) の E2E は鍵束を作るので
  専用 DB でだけ流す: `scripts/e2eDb.sh create` →
  `E2E_DATABASE_URL="$(scripts/e2eDb.sh url)" E2E_START_SERVER=1 npm run test:e2e:secrets`
  → `scripts/e2eDb.sh drop` (毎回作り直す。詳細は [e2e/README.md](e2e/README.md))

## 本番相当のローカル実行

```bash
./doStart.sh             # イメージをビルド → db 起動 → migrate → app 起動 → ヘルスチェック
./doStart.sh --nobuild   # ビルドせず既存イメージのまま起動
```

`--nobuild` では版番号などビルド時に埋め込む値が古いままになる。

Caddy (HTTPS) 込みで試す場合は:

```bash
docker compose --profile proxy up -d
```

## バージョンアップ

```bash
./doVersion.sh [patch|minor|major]   # 省略時: patch
```

package.json の version を上げる(作業ツリーがクリーンなら
`chore: release vX.Y.Z` のコミットとタグまで作成)。
version は画面フッターにビルド時に埋め込まれる。

## デプロイ

```bash
./doDeploy.sh                   # 版を patch で上げて本番へ配る
./doDeploy.sh minor             # 上げ幅を指定 (patch|minor|major)
./doDeploy.sh --no-version-up   # 版を上げずに配る
./doDeploy.sh --demo            # デモ (qr-demo) へ配る。既定で版を上げない
./doDeploy.sh -h                # 詳しい説明 (スクリプト冒頭のコメント)
```

版上げ (`doVersion.sh`) → lint / typecheck / test とイメージビルド (buildx) を
並列に流し、ビルドしたイメージはその場で SSH トンネル越しに vps2 の私設
レジストリ (`registry:2`) へ push → 検査が全部通ったら版タグを付けて公開 →
vps2 でイメージ取得 → SSH トンネル経由で DB マイグレーション → app 再作成 →
ヘルスチェック、まで一括で行う。転送はレジストリのレイヤー差分なので、
中身の変わったレイヤーだけが送られる
([docs/41-デプロイ高速化.md](docs/41-デプロイ高速化.md)・
[docs/80-デプロイ再高速化計画.md](docs/80-デプロイ再高速化計画.md))。
レジストリは初回だけ `./deploy/setupRegistry.sh` で設置し、溜まった古い
イメージは `./deploy/registryGc.sh` で掃除する。接続先などは
`DEPLOY_REMOTE` 等の環境変数で上書きできる (詳細は `-h`)。
本番・デモの接続先の既定 (ディレクトリ・DB ポート・app ポート) と、`do*.sh` が共有する
ログ・ssh・ヘルスチェックの小道具は `scripts/lib/` にある。

- **`--no-version-up`** … 版を上げず、今の package.json の版で配る。
  レジストリに同じ版のイメージがあれば、ビルドも lint / test も飛ばして
  それを再利用する (本番とビット単位で同じイメージになる。手元の未コミット
  変更は含まれない)。`patch|minor|major` とは併用できない
- **`--demo`** … デモスタックへ配る。リモートの置き場 (`qr-demo`)・
  migrate 先 DB ポート (5433)・ヘルスチェック先 app ポート (3100) を
  まとめて切り替える (app ポートが 3000 のままだと本番を叩いて誤って成功と
  判定するため、環境変数を手で書かずこの旗を使う)。既定で版を上げないので、
  本番に配った直後に流せば同じ版が載る。デモだけ版を上げたいときは
  `patch|minor|major` を明示する。種 DB `qr_seed` にも migrate を当てる

```bash
./doDeploy.sh && ./doDeploy.sh --demo   # 本番 → デモを同じ版で
```

⚠️ **既定では `compose.yaml` は転送されない。** 送るのはイメージだけで、
`compose.yaml` と `.env` はサーバに配置済みであることが前提。
**`compose.yaml` を変えたときは `--send-compose.yml` を付ける**:

```bash
./doDeploy.sh --send-compose.yml          # patch + compose.yaml も送る
./doDeploy.sh minor --send-compose.yml    # 併用可 (順序は問わない)
```

内容が同じなら転送を省略し、違うときだけ送る(上書き前の内容は
リモートの `compose.yaml.bak` に残る)。

特に環境変数を足したときに嵌まる。値を渡す `environment:` の行は
`compose.yaml` にあるので、`.env` だけ直してもコンテナには何も届かず、
「設定したのに未設定と言われる」状態になる(実際に
[docs/29-パスキー計画.md](docs/29-パスキー計画.md) §12 で踏んだ)。
確認は `docker exec qr-search-app-1 printenv | grep <名前>`。

派生データ (見出し・タスク数・サムネ・回路図) を本番やデモの DB へ埋め直すときは
`doBackfill.sh` を使う。リモートにはソースが無いので、ローカルから SSH トンネル越しに叩く
(見出しとタスク数は `doDeploy.sh` が毎回流している。詳細は `-h`):

```bash
./doBackfill.sh circuits          # 本番へ
./doBackfill.sh thumbs --demo     # デモの live (qr) と種 (qr_seed) の両方へ
./doBackfill.sh titles --seed     # デモの種 (qr_seed) だけ
```

| タスク | 埋め直すもの | 流すとき |
| --- | --- | --- |
| `titles` | 見出し (タイトル順の並び) | 列を足した直後 (いまは doDeploy.sh が毎回流す) |
| `taskcounts` | タスクの数 (`is:todo` の検索) | 同上 |
| `thumbs` | 画像のサムネ | サムネの生成パラメータを変えた後 |
| `circuits` | 回路図の SVG | 回路図フェンスの描画器を上げた後 |
| `circuit-addresses` | 回路図フェンスの番地 (本文を書き換える) | `DRY_RUN=1` で対象を確かめてから |

### 運用スクリプト

どれもローカルから叩く (リモートにはソースが無い)。説明は各スクリプトの冒頭と `-h`。

| スクリプト | 用途 |
| --- | --- |
| `doStart.sh` | ローカルで本番相当 (docker compose) に起動 |
| `doVersion.sh` | 版を上げてタグを打つ |
| `doDeploy.sh` | 本番 / デモへ配る |
| `doDeployNginx.sh` | vps2 の nginx 設定を反映 |
| `doBackfill.sh` | 派生データの埋め直し |
| `doImportZip.sh` / `doImportEnex.sh` | ZIP / Evernote を本番へ直接取り込む |
| `doDumpDB-from-vps2.sh` / `doDumpGit-from-vps2.sh` | 本番のバックアップ (DB + git 履歴) |
| `doCopyDBfromVPS2.sh` | 本番の DB でローカルを上書き |
| `scripts/reseedDemo.sh` | デモを種 DB から作り直す (vps2 の systemd timer が毎時呼ぶ) |
| `scripts/doDemoSeedEdit.sh` | デモの種ノートを編集するセッション |
| `scripts/e2eDb.sh` | E2E 専用 DB の作成と削除 |
| `npm run backfill:git` / `backfill:embeddings` | git 履歴・画像の埋め込みをローカル DB へ |

## nginx 設定 (本番)

本番の前段は vps2 の nginx (+ certbot)。設定は
`deploy/nginx/qr.tommie.jp.conf` を**リポジトリ側を正**として管理する。

```bash
./doDeployNginx.sh --check   # 差分の確認のみ(サーバは変更しない)
./doDeployNginx.sh           # 転送 → nginx -t → reload → ヘルスチェック
```

サーバ上で直接編集しないこと。conf を編集 → **コミット** → `doDeployNginx.sh`
の一方向で反映する(未コミットのまま反映すると下記のドリフト検知が誤作動するため、
スクリプトが止める)。`nginx -t` かヘルスチェック(未認証で 401 になるか +
認証を外したパスが app まで到達するか)が失敗した場合は自動でバックアップに戻す。

例外は `certbot --nginx` を再実行したときで、この場合だけサーバ側の conf が
直接書き換わる(証明書の自動更新では conf は変更されない)。
`doDeployNginx.sh` はこれをドリフトとして検知して中断するので、
指示に従ってサーバ側の内容を取り込み直してからコミットする。

nginx は認証しない。パスワードの正本はアプリの `BASIC_AUTH_*` (`.env`) で、
変えるときは `npm run hash-password` で作り直して app を再作成する。

`Caddyfile` は同じ構成をローカルで再現するためのもので、本番では使わない。
**ボディ上限やレート制限を変えたら両方に反映すること** (`scripts/checkEnv.mjs` が
上限の大小関係を見張る)。

## 画面とルート

ノートの主キーは UUID v7 で、URL は `/item/<uuid>`
([docs/107-ノート主キー計画.md](docs/107-ノート主キー計画.md))。古い番号の
URL (`/item/1003`) は印刷済みの QR のために残してあり、`src/proxy.ts` が
308 で新しい URL へ送る。

| パス | 用途 |
| --- | --- |
| `/` | 一覧 + 検索。PC は一覧と詳細の 2 ペイン |
| `/new` | 「+」で空ノートを採番して `/edit` へ送る |
| `/item/:id` | ノートの表示 (QR の飛び先)。公開ノートはログイン不要 |
| `/item/:id/history` | ノートの git 履歴と差分 |
| `/edit/:id` | 本文・公開設定の編集 |
| `/print/:id` | QR コード印刷 |
| `/trash` | ゴミ箱 (復元と永久削除) |
| `/offline` | 圏外のとき Service Worker が出す殻 |
| `/logs` | サーバログ |
| `/settings/passkeys` | パスキーの登録・削除 |
| `/settings/secrets` | シークレットの鍵の設定と復旧キー |
| `/settings/import` | ZIP / Evernote の取り込みと全件エクスポート |
| `/settings/history` | 既存ノートの git 履歴への取り込み |
| `/settings/server` | サーバー情報とヘルスチェック (`ADMIN_USER` だけ) |
| `/docs/memo` / `/docs/search` | 記法と検索のヘルプ (ログイン不要) |
| `/about` | クレジットと第三者ライセンス (ログイン不要) |
| `/login` / `/login-required` | パスワードログインの口 / 未ログイン時の案内 |
| `/api/*` | 画像・添付・取り込み・パスキー・シークレット・検索候補などの JSON API |
| `/manifest.webmanifest` · `/sw.js` | PWA の manifest と Service Worker |
| `/.well-known/security.txt` | 脆弱性の連絡先 (RFC 9116) |

ログイン無しで開けるパスの正本は `src/lib/auth/publicPaths.ts`。

## ログイン

認証はエッジ (nginx / Caddy) ではなく**アプリが行う**
([docs/18-ログイン計画.md](docs/18-ログイン計画.md))。ログインしなくても
画面上部の帯は出て、中身だけがログインの内側にある。

手段は 2 つ([docs/29-パスキー計画.md](docs/29-パスキー計画.md)):

- **パスキー (WebAuthn)** … 普段のログイン。Face ID / Touch ID だけで入れる。
  設定は `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`
- **パスワード (Basic)** … パスキーの**登録**と、全端末のパスキーを失った
  ときの復旧。設定は `BASIC_AUTH_USER` / `BASIC_AUTH_HASH_B64`

パスキーは `/settings/passkeys` から登録する。開くにはログインが必要なので、
**初回はパスワードで入ってから登録する**。以後はパスキーで入ったまま
2 台目以降を追加できる。

`WEBAUTHN_*` が未設定ならパスキーの導線が出ないだけで、パスワードでは
今までどおり入れる。ローカルは `localhost` を使うこと
(WebAuthn の特例で HTTP でも動く。**`127.0.0.1` では動かない**)。

パスワードのハッシュは `npm run hash-password` で作る。生の bcrypt ハッシュを
`.env` に書くと `$` が変数展開されて壊れるため、base64 で持つ(理由は
`src/lib/auth/basicAuth.ts` のコメント)。

どちらの手段でログインしても**セッション Cookie が発行され**、以後の判定は
それだけで行う。`Authorization` ヘッダを見るのは `/login` の 1 か所だけで、
そうしないとログアウトが成立しない(ブラウザがヘッダを送り続けるため。
[docs/18 §11](docs/18-ログイン計画.md))。

**ログアウトは完全ではない**。ブラウザはパスワードを記憶したままなので、
同じ端末では入力なしで入り直せる。断ち切るにはブラウザを閉じる。

## PWA (ホーム画面へのインストール)

manifest・アイコンに加えて Service Worker (`public/sw.js`) を持つ。圏外では
`/offline` で検索と閲覧ができる (回路図とシークレット断片も含む)。
設計は [docs/65-オフライン対応計画.md](docs/65-オフライン対応計画.md)。
編集・新規作成は対象外 (サーバ必須)。

**manifest・アイコン・`sw.js`・`/offline` はログイン無しで取れる。** ブラウザは
これらを資格情報なしで取りに来るため、閉じると 401 になり「インストール可能」と
判定されない。一覧は `src/lib/auth/publicPaths.ts` が manifest から導出する
(アイコンを足したとき書き落とさないため)。どれも秘密を含まない。

逆プロキシで認証していた頃の名残で、**ボディ上限は認証の内側に置かない**。
認証除外パスがボディ無制限になり、未認証で巨大なリクエストを投げ込めるようになる。

アイコンは `public/icon-*.png` と `src/app/apple-icon.png`。元絵の SVG は
生成スクリプトに直書きしてあり、意匠を変えるときだけ手で叩く
(ビルドでは走らない):

```bash
node scripts/genIcons.mjs
```
