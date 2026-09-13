import type { MetadataRoute } from "next";
import {
  isProductionEnv,
  LOCAL_BACKGROUND_COLOR,
  LOCAL_THEME_COLOR,
  PROD_BACKGROUND_COLOR,
  PROD_THEME_COLOR,
} from "@/lib/appEnv";
import { SITE_DESCRIPTION, SITE_NAME, siteTitle } from "@/lib/site";

// PWA の manifest。/manifest.webmanifest で配信される。
//
// 注意: ブラウザは manifest とアイコンを **Authorization ヘッダなし** で取得するため、
// 逆プロキシ側でこれらのパスだけ Basic 認証を外さないと 401 になり、
// 「インストール可能」と判定されない。本番 (vps2 の nginx) とローカル (Caddyfile) の
// 両方に除外設定が要る。詳細は 41-QR-search/docs/05-PWA計画.md
//
// Service Worker は置かない。Chrome のインストール条件は manifest + アイコンで足り、
// このアプリは検索も表示も編集もサーバ必須でオフラインに出来ることがほぼないため。
// ローカルをホーム画面に入れている場合、standalone には URL バーが無く、
// 本番と見分ける手がかりが名前・スプラッシュ・ステータスバーの帯しかない。
// ブラウザ (layout.tsx・app/metadata.ts・chrome/AppHeader.tsx) と同じ塗り分けを
// ここにも入れる (src/lib/appEnv.ts)
export default function manifest(): MetadataRoute.Manifest {
  const isProd = isProductionEnv();

  return {
    // id を省くと start_url が既定の識別子になり、後で start_url を変えたときに
    // 「別アプリ」と見なされて二重インストールになる
    id: "/",
    name: siteTitle(),
    // ランチャーのラベル。12 文字を超えると省略され、付けた目印ごと消えるため
    // [LOCAL] を冠さず短い別名にする
    short_name: isProd ? SITE_NAME : "LOCAL QR",
    description: SITE_DESCRIPTION,
    lang: "ja",
    start_url: "/",
    // scope 内の URL は Android の WebAPK が intent filter で捕まえる。
    // QR シールの /item/:itemNo を拾わせたいのでルートに広げる
    scope: "/",
    display: "standalone",
    // body の背景 (起動時スプラッシュに出る)
    background_color: isProd ? PROD_BACKGROUND_COLOR : LOCAL_BACKGROUND_COLOR,
    // ヘッダの色。app/metadata.ts の viewport.themeColor と揃える
    theme_color: isProd ? PROD_THEME_COLOR : LOCAL_THEME_COLOR,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // ランチャーが好きな形に切り抜く版。any と兼用にすると、切り抜きに耐える
      // 余白の分だけ通常表示で絵が小さくなるので、別ファイルに分ける
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
