import type { Metadata, Viewport } from "next";
import {
  isProductionEnv,
  LOCAL_THEME_COLOR,
  PROD_THEME_COLOR,
} from "@/lib/appEnv";
import {
  siteBaseUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  siteTitle,
} from "@/lib/site";

// root layout の metadata / viewport (layout.tsx が re-export する)。
//
// 静的な metadata / viewport オブジェクトではなく関数で出す。静的オブジェクトは
// モジュール読み込み時に一度だけ評価されるため、prerender されるルートができた
// 瞬間にビルド時 (APP_ENV なし = 非本番) の値が焼き付く。いまは layout が
// currentUser() 経由で cookies() を呼ぶので全ルートが動的だが、それは APP_ENV とは
// 無関係な事情であり、目印の正しさをその偶然に預けたくない
export function generateMetadata(): Metadata {
  const title = siteTitle();

  return {
    // OG 画像 (app/opengraph-image.png) の URL を絶対 URL に組み立てる起点
    // (docs/89-OGP計画.md §3)。**自前ホスティングでは明示が要る** — Next は
    // 起点を推測できず、相対のまま出すと og:image がどのクローラーからも
    // 引けない。
    //
    // デモは**デモ .env の QR_BASE_URL** (=https://qr-demo.tommie.jp) で
    // デモ自身の origin になる。compose.demo.yaml が焼いているのは DEMO_MODE
    // だけで、これは .env 側の設定 — 書き忘れると og:image が本番を指す
    // (シールの QR が本番を指すのと同じ症状。compose.demo.yaml の冒頭に
    // デモ .env の要件として挙げてある)。
    //
    // new URL() を直に呼ばず siteBaseUrl() を通すのが要点。ここは root layout
    // なので、投げると**全ページが 500** になり、ログイン画面すら開けなくなる
    metadataBase: siteBaseUrl(),
    // template にするのが要点。子ページが title を出すと root の title は
    // まるごと上書きされ、非本番の [LOCAL] ごと消える (実際 /docs/* がそうだった)。
    // template なら子は見出しだけ書けばよく、サイト名と目印は必ずここが付ける
    title: { default: title, template: `%s - ${title}` },
    description: SITE_DESCRIPTION,
    // SNS に貼ったときのカード (docs/89-OGP計画.md §3)。
    //
    // **og:title を明示するのが要点。** 省略すると Next はページの title を
    // 流用するが、未ログインで `/` を開いたクローラーが見るのは proxy.ts が
    // rewrite した案内ページなので、カードの見出しが「ログインが必要です」に
    // 化ける。ここで固定すれば、どのページを共有してもサイト名で出る。
    //
    // 画像は app/opengraph-image.png が規約で配る (og:image と寸法のタグは
    // Next が生成する)。ImageResponse (next/og) での動的生成にしないのは、
    // satori を積むと本番 (vps2) の乏しいメモリを食うため
    openGraph: {
      title,
      description: SITE_DESCRIPTION,
      siteName: SITE_NAME,
      type: "website",
      locale: "ja_JP",
    },
    // 指定しないと X は小さい (正方形の) カードに落とす。1200x630 の絵を
    // 用意した以上、横長で出させる
    twitter: { card: "summary_large_image" },
  };
}

// maximumScale / userScalable はあえて指定しない。ピンチズームを潰すと
// 型番など細かい文字を拡大できなくなるうえ、iOS Safari は無視する
export function generateViewport(): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    // standalone のステータスバー帯の色。ブラウザの URL バーが無い分、
    // 非本番だと気づけるかはこの帯とヘッダの色にかかっている
    themeColor: isProductionEnv() ? PROD_THEME_COLOR : LOCAL_THEME_COLOR,
    colorScheme: "light",
  };
}
