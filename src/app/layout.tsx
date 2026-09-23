import { cookies } from "next/headers";
import QRCode from "qrcode";
import { BottomBarProvider } from "@/components/bottombar/BottomBarContext";
import { AppHeader } from "@/components/chrome/AppHeader";
import { AppSideEffects } from "@/components/chrome/AppSideEffects";
import { PreHydrationScripts } from "@/components/chrome/PreHydrationScripts";
import { DemoBanner } from "@/components/chrome/DemoBanner";
import { PageBottomBar } from "@/components/bottombar/PageBottomBar";
import { setPaneModeAction } from "@/app/actions";
import { PANE_MODE_COOKIE, parsePaneMode } from "@/lib/prefs/paneMode";
import { rowTintVars } from "@/lib/prefs/rowTint";
import { loadRowTintId } from "@/lib/prefs/rowTintStore";
import { demoLoginHintEnv, isDemoMode, isProductionEnv } from "@/lib/appEnv";
import { currentUser } from "@/lib/auth/session";
import { qrBaseUrl } from "@/lib/site";
import { CONTENT_WIDTH_CLASS } from "@/components/ui";
import "./globals.css";

// metadata / viewport の組み立てと、関数で出す理由は metadata.ts
export { generateMetadata, generateViewport } from "./metadata";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // qrBaseUrl() 経由で読むこと。生の QR_BASE_URL (appEnv.ts の qrBaseUrlEnv) を `??` で受けると
  // `.env` に `QR_BASE_URL=` と空で書いたとき空文字が素通しし、ヘッダの QR が
  // 空 URL になる (site.ts が `||` で既定へ倒しているのはこのため)
  const siteUrl = qrBaseUrl();
  const siteQrDataUrl = await QRCode.toDataURL(siteUrl, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
  });

  // ヘッダーの出し分け (AppHeader) と、ログイン中だけ仕掛ける裏方
  // (AppSideEffects) に使う。帯そのものは未ログインでも出す
  const user = await currentUser();

  // 検索画面のペイン構成 (docs/86 §4-4)。ヘッダーはどのページにも出るので
  // ここで読む。cookies() は currentUser() が既に呼んでいるので、これで
  // ルートが動的になるわけではない
  const paneMode = parsePaneMode(
    (await cookies()).get(PANE_MODE_COOKIE)?.value,
  );

  // 検索結果で選択中の行の地色 (docs/88-選択行の色計画.md)。
  //
  // **サーバで読んでサーバが当てる。** 端末に置いた好み (文字サイズ・ペイン
  // 構成) と違い、これは DB にあるので初回描画前に走るインラインスクリプトでは
  // 読めない。逆に言えば html の style に直接書けるので、ちらつきは起きない。
  //
  // 未ログインなら既定 (DB を引かない)。1 クエリ増えるが、この layout は
  // 既に currentUser() でセッションを引いており、同じ 1 往復に収まる
  const rowTintId = await loadRowTintId(user);

  // 非本番は画面全体をピンクに塗る。Tailwind はソース中のクラス名を文字列として
  // 探すため、`bg-${color}-50` のような組み立てをすると CSS が生成されない。
  // 完全なクラス名を両方書いて選ぶこと
  const isProd = isProductionEnv();

  // デモインスタンスの目印 (docs/38-デモモード計画.md §6)。バナー・バッジ・
  // 設定系リンクの出し分けに使う。デモは本番相当で立てるので isProd とは独立
  const isDemo = isDemoMode();

  return (
    // suppressHydrationWarning … <head> のインラインスクリプト (PreHydrationScripts)
    // が hydration より前にこの html へ style (--note-font-scale) を書き足すため。
    // 付けないと React が差分を「不整合」と見なし、境界ごと描き直して倍率が失われる
    // style で CSS 変数を立てるのが要点 (docs/88 §2)。色ごとにクラスを
    // 用意すると、Tailwind はソース中の完全なクラス名しか拾わないので
    // 6 色 × 3 用途を全部書き並べることになる。変数なら使う側 (ItemRow /
    // ImageMasonry) の指定は 1 通りで済む。
    // 既定値は globals.css の :root が持つ — この layout の外で描かれる
    // 場面 (単体テスト) でも色が消えないようにするため
    <html
      lang="ja"
      className="h-full antialiased"
      style={rowTintVars(rowTintId) as React.CSSProperties}
      suppressHydrationWarning
    >
      <head>
        <PreHydrationScripts />
      </head>
      <body
        className={`min-h-full text-gray-900 ${isProd ? "bg-gray-50" : "bg-pink-50"}`}
      >
        {/* 下部バー (PageBottomBar) と、その中へ編集ボタンを portal する側
            (MemoEditorInner) をつなぐ context。両方を内側に含めるため body 直下で包む */}
        <BottomBarProvider>
          <AppHeader
            user={user}
            isProd={isProd}
            isDemo={isDemo}
            paneMode={paneMode}
            paneModeAction={setPaneModeAction}
            rowTintId={rowTintId}
            siteUrl={siteUrl}
            siteQrDataUrl={siteQrDataUrl}
          />
          {/* デモの常時バナー (docs/38-デモモード計画.md §6)。ヘッダ直後に置く。
              ログイン案内 (docs/39 §4) は env をここで読んで props で降ろす
              (site.ts と同じ流儀。process.env は NEXT_PUBLIC_ 以外クライアントへ
              渡らないため)。未設定 (空文字) なら案内行は出ない */}
          {isDemo && <DemoBanner loginHint={demoLoginHintEnv() || null} />}
          {/* 遷移アニメーションは各ページの <PageTransition> が持つ
              (layout の要素は unmount されず enter/exit が起きないため) */}
          {/* 幅は CONTENT_WIDTH_CLASS (いまは上限なし = ブラウザの幅いっぱい)。
              以前は max-w-2xl で読める行長に収めていた (docs/101 で改めた)。
              mx-auto は上限を戻した日の中央寄せのために残してある */}
          {/* pt-2 … ヘッダーと本文の間はこれだけ。24px 空けていたのをやめた
              (docs/75-ノート上部圧縮計画.md §5)。スマホの 1 画面に入る本文を
              増やすのが目的で、ここは全ページに効く */}
          <main className={`mx-auto px-safe pt-2 pb-safe ${CONTENT_WIDTH_CLASS}`}>
            {children}
          </main>
          {/* 下部バー。中身はノート編集中の編集ボタン (portal) だけで、差し込む
              側がいなければ自身を描かない。戻る/進むはヘッダーへ移した */}
          <PageBottomBar isProd={isProd} />
          <AppSideEffects user={user} isDemo={isDemo} />
        </BottomBarProvider>
      </body>
    </html>
  );
}
