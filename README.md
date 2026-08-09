# qr-search

部品に貼った QR コードシール(URL 埋め込み)を読み取り、
部品 ID から情報を表示・管理する Web アプリ。

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

## 構成

- Next.js 16 (App Router) + TypeScript + Tailwind CSS
- Prisma 7 + PostgreSQL 16
- Docker Compose(db / app / proxy)

## 開発

```bash
cp .env.example .env   # 値を設定
npm install            # postinstall で prisma generate が走る
docker compose up -d db
npx prisma migrate dev
npm run dev            # http://localhost:3000
```

## テスト

```bash
npm test
```

## 本番相当のローカル実行

```bash
./doStart.sh           # db 起動 → migrate → app 起動 → ヘルスチェック
./doStart.sh --build   # イメージを作り直してから起動
```

Caddy (HTTPS + Basic 認証) 込みで試す場合は:

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
./doDeploy.sh
```

lint/test → イメージビルド → docker save/load で転送 →
SSH トンネル経由で DB マイグレーション → app 再作成 → ヘルスチェック、
まで一括で行う。接続先などは `DEPLOY_REMOTE` 等の環境変数で上書きできる
(詳細はスクリプト冒頭のコメント参照)。

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

Basic 認証のパスワードファイル `/etc/nginx/.htpasswd-qr` は
リポジトリ管理外。再発行は vps2 で `sudo htpasswd -c /etc/nginx/.htpasswd-qr tommie`。

なお `Caddyfile` は同じ構成をローカルで再現するためのもので、本番では使わない。
**認証やアップロード制限を変えたら両方に反映すること。**

## ルーティング

| パス | 用途 |
| --- | --- |
| `/` | 一覧 + 検索(番号順 / 更新順) |
| `/item/:itemNo` | 部品表示 + メモ更新(QR の飛び先。未登録なら新規作成) |
| `/edit/:itemNo` | mode / memo / url の編集 |
| `/print/:itemNo` | QR コード印刷 |
| `/settings/passkeys` | パスキーの登録・削除 |
| `/manifest.webmanifest` | PWA の manifest(`src/app/manifest.ts` が生成) |

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
`src/lib/auth.ts` のコメント)。

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

**逆プロキシで manifest とアイコンの認証を外すこと。** ブラウザはこれらを
Authorization ヘッダなしで取得するため、サイト全体を Basic 認証下に置くと
401 になり「インストール可能」と判定されない。対象は
`/manifest.webmanifest` `/icon-*.png` `/apple-icon.png` の 3 種
(どれも秘密情報を含まない)。この Caddyfile には設定済み。

そのとき **ボディ上限 (`request_body` / `client_max_body_size`) は
認証側のブロックの内側に置かないこと**。認証除外パスがボディ無制限になり、
未認証で巨大なリクエストを投げ込めるようになる。

アイコンは `public/icon-*.png` と `src/app/apple-icon.png`。元絵の SVG は
生成スクリプトに直書きしてあり、意匠を変えるときだけ手で叩く
(ビルドでは走らない):

```bash
node scripts/genIcons.mjs
```
