# OGP 対応計画

X (Twitter) に URL を貼ったとき、サムネ付きのカードを出す。
デモ (qr-demo.tommie.jp) を X で紹介する予定があり、裸の URL では
「何のリンクか」が伝わらないため。

## 1. 方針

| § | 変更対象 | 守るもの / 得るもの |
| --- | --- | --- |
| §2 | `src/app/opengraph-image.png` (新規) | カードのサムネ |
| §3 | `layout.tsx` の generateMetadata | og:\* / twitter:card / metadataBase |
| §4 | `src/lib/publicPaths.ts` | クローラーが画像を認証なしで取れること |
| §5 | `src/app/robots.ts` | デモのカード生成と guest 保護の両立 |

本番とデモは**同一イメージ**なので、アプリ側の変更は 1 回で両方に効く。

OGP は検索順位とは無関係で、効くのは「共有されたときの見た目」だけ。
X 以外 (LINE・Discord・Slack・iMessage) のリンクプレビューにも同じタグが使われる。

## 2. OG 画像 — 静的 PNG

`src/app/opengraph-image.png` (1200x630)。Next.js の file convention により
`og:image` と寸法のタグが自動で出る。alt は `opengraph-image.alt.txt` を対で置く。

**`ImageResponse` (next/og) での動的生成にはしない。** satori を積むと
本番 (vps2: RAM 2GB・空き 750MB) のメモリを食う。カードの絵は
ノートの内容に依らず一定なので、動的である必要がない。

画像は icon.svg + サイト名 + 説明文を sharp で合成して作った (使い捨て
スクリプト。成果物の PNG だけをコミットする)。日本語は Noto Sans CJK JP。

配信 URL は `/opengraph-image.png?<contenthash>` になる。
パスにハッシュが**入らない**ことは Next の実装で確認済み — 接尾辞が付くのは
親パスにルートグループ `(foo)` や並行ルート `@foo` があるときだけで
(`lib/metadata/get-metadata-route.js` の `getMetadataRouteSuffix`)、
`app/` 直下の親パスは `/` なので該当しない。

## 3. metadata — og:title は明示する

`generateMetadata()` に `metadataBase` / `openGraph` / `twitter` を足す。

**`openGraph.title` を明示するのが要点。** 省略すると Next はページの title を
流用するが、未ログインで `/` を開いたクローラーが見るのは proxy.ts が rewrite した
案内ページなので、カードの見出しが「ログインが必要です」に化ける。
実際 dev で確認すると `<title>` は「ログインが必要です - QR Note」のままだが、
明示した og:title は「QR Note」で出る。

`metadataBase` は site.ts の `siteBaseUrl()` を使う。og:image を絶対 URL へ
組み立てる起点で、「このサイトはどの URL で見えているか」を答える点で
QR シールと同じ問いなので、env を増やさない。

**`new URL()` を直に呼ばないこと。** `QR_BASE_URL` が壊れていると
(scheme 忘れなど) `new URL()` は投げる。ここは root layout の
`generateMetadata` なので、投げれば**全ページが 500** になり、直しに行くための
ログイン画面すら開けなくなる。`siteBaseUrl()` は `qrStickerHost()` が元から
持っていた「既定へ倒して警告」の守りを共有する形にした。

デモはデモ **.env** の `QR_BASE_URL=https://qr-demo.tommie.jp` でデモ自身の
origin になる。compose.demo.yaml が焼いているのは `DEMO_MODE` だけなので、
.env に書き忘れると og:image が本番を指す (シールの QR が本番を指すのと同じ
症状。compose.demo.yaml の冒頭にデモ .env の要件として挙がっている)。

**開発中は metadataBase が効かない。** Next は `NODE_ENV === 'development'` の
とき社会的画像の URL を必ず `localhost:PORT` へ倒す
(`lib/metadata/resolvers/resolve-url.js` の `getSocialImageMetadataBaseFallback`)。
dev で `og:image` が localhost なのは正常で、絶対 URL の確認は本番デプロイ後に行う。

`twitter.card` は `summary_large_image`。指定しないと X は小さい正方形の
カードに落とすので、1200x630 を用意した意味が無くなる。

## 4. publicPaths — 画像を開ける

`CRAWLER_PATHS` に `/opengraph-image.png` を足す (robots.txt と同じ節)。

**閉じたままだと症状が分かりにくい。** メタタグは出るのに画像の取得だけが
案内 HTML に化けるので、カードは「出るが画像が無い」形になり、原因が見えない。

判定は pathname だけを見る (proxy.ts が `request.nextUrl.pathname` を渡す) ので、
`?<contenthash>` が付いていても完全一致でよい。

## 5. robots — デモはカード生成クローラーだけ通す

docs/39 §3 でデモを全 UA disallow にした理由は
「guest が上げた内容を巻き込んでインデックスされる事故を防ぐ」。
この懸念は今も有効なので、**全面 allow には戻さない。**

インデックスとカード生成は別物である。Twitterbot が `/` を取得しても
X の検索にページが載るわけではなく、カードに出るのは root layout の og メタ
(サイト名・説明・画像) だけ。つまり両立できる:

```text
User-Agent: Twitterbot
Allow: /

User-Agent: facebookexternalhit
Allow: /

User-Agent: *
Disallow: /
```

**並び順に意味がある。** RFC 9309 ではクローラーは自分に最も特化した UA
グループ**だけ**に従うので、Twitterbot は自分の allow を見て、検索エンジンは
末尾の `*` に落ちる。包括的な規則は最後に置くこと。

`facebookexternalhit` は Facebook のカード生成で、LINE もこの UA を名乗る。
Discord・iMessage はそもそも robots.txt を見ないので書かなくてよい。

X に貼ると被リンクができるので、Google が「URL だけ」を検索結果に出すことは
あり得る (crawl は禁止なので説明文なし)。guest の中身は crawl されないままなので、
元の懸念は守られる。

## 6. 検証

1. ローカル (dev): og/twitter タグが出る・og:title が案内ページの title に
   引きずられない・画像が認証なしで 200 + image/png で取れる
2. デプロイ後、本番とデモの両方で:

   ```bash
   curl -sA Twitterbot https://qr.tommie.jp/ | grep -E 'og:|twitter:'
   curl -sA Twitterbot -o /dev/null -w '%{http_code} %{content_type}\n' \
     https://qr.tommie.jp/opengraph-image.png
   curl -s https://qr-demo.tommie.jp/robots.txt
   ```

   og:image が `https://…` の絶対 URL になっていることをここで確かめる (§3)。
3. X の投稿作成画面に URL を貼ってプレビューを見る
   (Card Validator はプレビュー表示が廃止済み)

**X はカードを数日キャッシュする。** 画像を後から差し替えても反映が遅れるので、
全部揃ってから初投稿する。

## 7. やらないこと

- 公開ノート (`/item/<no>`) のノート別 og:title / サムネ。
  需要が出たら別途 (self-guarded な口なので画像の扱いに一考が要る)
- デモ専用の description 差し替え。分岐が増える割に効果が薄い。
  カードの見出しは `siteTitle()` 経由で「[DEMO] QR Note」になるので、
  「試せる環境」であることはそれで伝わる
