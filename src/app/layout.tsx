import type { Metadata, Viewport } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import pkg from "../../package.json";
import { ClientLogCapture } from "@/components/ClientLogCapture";
import { DebugConsole } from "@/components/DebugConsole";
import { DebugConsoleButton } from "@/components/DebugConsoleButton";
import { DemoBanner } from "@/components/DemoBanner";
import { HeaderMenu } from "@/components/HeaderMenu";
import { HeaderQrButton } from "@/components/HeaderQrButton";
import { BottomBarProvider } from "@/components/BottomBarContext";
import { HistoryNav } from "@/components/HistoryNav";
import { PageBottomBar } from "@/components/PageBottomBar";
import { LoginButton } from "@/components/LoginButton";
import { LogoutButton } from "@/components/LogoutButton";
import {
  GithubIcon,
  HistoryIcon,
  ImportIcon,
  InfoIcon,
  KeyIcon,
  LockIcon,
  LogIcon,
} from "@/components/MenuIcons";
import { OfflineSync } from "@/components/OfflineSync";
import { PasskeyLoginButton } from "@/components/PasskeyLoginButton";
import { RecordTagSearch } from "@/components/RecordTagSearch";
import { TextSizeMenuItem } from "@/components/TextSizeMenuItem";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import { NOTE_FONT_SCALE_INIT_SCRIPT } from "@/lib/noteFontScale";
import {
  isDemoMode,
  isProductionEnv,
  LOCAL_THEME_COLOR,
  PROD_THEME_COLOR,
} from "@/lib/appEnv";
import { PASSKEY_SETTINGS_PATH } from "@/lib/authPaths";
import { SECRET_SETTINGS_PATH } from "@/lib/secrets";
import { currentUser } from "@/lib/session";
import { qrBaseUrl, SITE_DESCRIPTION, SITE_NAME, siteTitle } from "@/lib/site";
import "./globals.css";

// 静的な metadata / viewport オブジェクトではなく関数で出す。静的オブジェクトは
// モジュール読み込み時に一度だけ評価されるため、prerender されるルートができた
// 瞬間にビルド時 (APP_ENV なし = 非本番) の値が焼き付く。いまは layout が
// currentUser() 経由で cookies() を呼ぶので全ルートが動的だが、それは APP_ENV とは
// 無関係な事情であり、目印の正しさをその偶然に預けたくない
export function generateMetadata(): Metadata {
  const title = siteTitle();

  return {
    // template にするのが要点。子ページが title を出すと root の title は
    // まるごと上書きされ、非本番の [LOCAL] ごと消える (実際 /docs/* がそうだった)。
    // template なら子は見出しだけ書けばよく、サイト名と目印は必ずここが付ける
    title: { default: title, template: `%s - ${title}` },
    description: SITE_DESCRIPTION,
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

const GITHUB_URL = "https://github.com/tommie-jp/qr-search";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // qrBaseUrl() 経由で読むこと。process.env.QR_BASE_URL を `??` で直読みすると
  // `.env` に `QR_BASE_URL=` と空で書いたとき空文字が素通しし、ヘッダの QR が
  // 空 URL になる (site.ts が `||` で既定へ倒しているのはこのため)
  const siteUrl = qrBaseUrl();
  const siteQrDataUrl = await QRCode.toDataURL(siteUrl, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
  });

  // ヘッダの帯はログインしていなくても出す (docs/18-ログイン計画.md)。
  // 未ログインならユーザー名の代わりにログインボタンを置く。
  // 中身を守るのは proxy.ts と requireUser() の役目で、この帯ではない。
  //
  // ログイン手段 (パスワード / パスキー) によらず必ずセッションを持つので
  // (docs/18 §11)、ログイン中なら常にログアウトを出してよい
  const user = await currentUser();

  // 非本番は画面全体をピンクに塗る。Tailwind はソース中のクラス名を文字列として
  // 探すため、`bg-${color}-50` のような組み立てをすると CSS が生成されない。
  // 完全なクラス名を両方書いて選ぶこと
  const isProd = isProductionEnv();

  // デモインスタンスの目印 (docs/38-デモモード計画.md §6)。バナー・バッジ・
  // 設定系リンクの出し分けに使う。デモは本番相当で立てるので isProd とは独立
  const isDemo = isDemoMode();

  return (
    // suppressHydrationWarning … 下のインラインスクリプトが hydration より前に
    // この html へ style (--note-font-scale) を書き足すため。付けないと React が
    // 差分を「不整合」と見なし、境界ごと描き直して倍率が失われる
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* 本文の文字サイズを初回描画の前に当てる (docs/61-テキストサイズ計画.md)。
            useEffect で当てると等倍の本文が一度見えてから大きくなるので、
            HTML の解析中に同期で走らせる (Next の
            docs/01-app/02-guides/preventing-flash-before-hydration.md と同じ手) */}
        <script
          dangerouslySetInnerHTML={{ __html: NOTE_FONT_SCALE_INIT_SCRIPT }}
        />
      </head>
      <body
        className={`min-h-full text-gray-900 ${isProd ? "bg-gray-50" : "bg-pink-50"}`}
      >
        {/* 下部バー (PageBottomBar) と、その中へ編集ボタンを portal する側
            (MemoEditorInner) をつなぐ context。両方を内側に含めるため body 直下で包む */}
        <BottomBarProvider>
        {/* 深くスクロールしても検索・ホームに戻れるよう貼り付ける (docs/11 §5)。
            pt-safe … standalone はステータスバーの下に潜り込む (viewport-fit=cover)。
            ブラウザで開いているときは inset が 0 で従来と同じ余白になる。
            本文はほぼ白いカードで覆われるため、body の色より常時見えている
            この帯の色のほうが「本番ではない」ことに気づく主な手がかりになる */}
        <header
          className={`sticky top-0 z-20 border-b backdrop-blur print:hidden ${
            isProd ? "border-gray-200 bg-white/95" : "border-pink-300 bg-pink-100/95"
          }`}
        >
          {/* 帯は低く抑える。ボタン側が min-h-11 (44px) を負のマージンで
              はみ出させているので、見た目 40px でもタップ目標は 44px を保つ */}
          {/* items-baseline … サイト名 (text-lg)・バージョン (text-xs)・
              ユーザー名 (text-base) と文字の大きさが揃わないので、中央揃えでは
              下端がバラバラに見える。全員の文字のベースラインを 1 本に載せる */}
          {/* landscape-phone:max-w-4xl … スマホ横持ちでは 672px の器の外に
              遊びの余白ができるだけなので、上限を緩めて全幅を使う
              (main・下部バーと揃える。docs/31 §12-4) */}
          {/* flex-wrap … テキストサイズを上げると帯の中身 (サイト名・版・
              目印・ユーザー名) が 1 行に収まらなくなる (docs/61 §1)。
              折り返さないと画面ごと横スクロールになるので、帯が 2 行に
              なるほうを取る — 縦に伸びるのは見えるが、横スクロールは
              「なぜか右にずれる」形で気づきにくい */}
          <div className="mx-auto flex max-w-2xl flex-wrap items-baseline gap-2 px-safe pt-safe landscape-phone:max-w-4xl">
            {/* 項目はハンバーガーメニューへ畳む (docs/11-アプリ的UIUX計画.md §6)。
                横に並べていたときは iPhone の幅で 1 文字ずつ折り返れて崩れた。
                左端に置くのは、片手持ちの親指が届く側だから */}
            <HeaderMenu>
              <HeaderQrButton
                qrDataUrl={siteQrDataUrl}
                url={siteUrl}
                variant="menu"
              />
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={HEADER_MENU_ITEM_CLASS}
              >
                <GithubIcon />
                GitHub
              </a>
              {/* 外部 API のクレジット/帰属表示 (docs/46-クレジット表記計画.md)。
                  Yahoo! は表示が義務。誰に対しても出してよい情報なので、
                  ログイン状態・デモに依らず (!isDemo の内側に入れない) 常に出す */}
              <Link href="/about" className={HEADER_MENU_ITEM_CLASS}>
                <InfoIcon />
                クレジット
              </Link>
              {/* 本文の文字サイズ (docs/61-テキストサイズ計画.md)。
                  ログイン状態やデモに依らず出す — 読みやすさの設定であって、
                  ノートを持っているかとは関係がない (公開ノートにも効く) */}
              <TextSizeMenuItem />
              {user ? (
                <>
                  {/* デモでは設定系の導線を出さない (docs/38-デモモード計画.md §4)。
                      ログ・パスキー・インポートはいずれもページ/API 側でも
                      塞いでいるが、押せない物を見せない */}
                  {!isDemo && (
                    <>
                      {/* サーバログ (docs/21)。未ログインではリンク自体を出さない —
                          見えても 401 だが、押せない物を見せない */}
                      <Link href="/logs" className={HEADER_MENU_ITEM_CLASS}>
                        <LogIcon />
                        ログ
                      </Link>
                    </>
                  )}
                  {/* その場で見る側のログ (docs/30-ブラウザログ計画.md §2)。
                      /logs は事後に読むもので、network まで見たいときは
                      端末の上に DevTools 相当を出すしかない。デモでも自分の
                      セッション内で完結するので残す (docs/38 §8) */}
                  <DebugConsoleButton />
                  {!isDemo && (
                    <>
                      {/* パスキーの管理 (docs/29-パスキー計画.md §8)。
                          ここが登録への唯一の導線なので、ログイン中は常に出す */}
                      <Link
                        href={PASSKEY_SETTINGS_PATH}
                        className={HEADER_MENU_ITEM_CLASS}
                      >
                        <KeyIcon />
                        パスキー
                      </Link>
                      {/* シークレット (部分暗号化) の鍵 (docs/51-部分暗号化計画.md §6)。
                          解錠はノートを開いたときにも促されるが、初回設定と
                          復旧キーの入口はここだけ */}
                      <Link
                        href={SECRET_SETTINGS_PATH}
                        className={HEADER_MENU_ITEM_CLASS}
                      >
                        <LockIcon />
                        シークレット
                      </Link>
                      {/* ノートの持ち出しと取り込み (docs/28-エクスポート計画.md
                          §7)。全件エクスポートと、ZIP / Evernote (.enex) の
                          取り込みを 1 画面にまとめてある — 書き出す場所と戻す
                          場所が同じなら、往復の説明も 1 か所で済む。
                          たまにしか使わないのでメニューの奥でよいが、導線が
                          ここしか無いので出しておく */}
                      <Link
                        href="/settings/import"
                        className={HEADER_MENU_ITEM_CLASS}
                      >
                        <ImportIcon />
                        インポート / エクスポート
                      </Link>
                      {/* 既存ノートの git 履歴への取り込み (docs/57-ノートgit
                          履歴計画.md §6)。ほぼ一度きりの操作だが、導線が
                          ここしか無いので出しておく (インポートと同じ判断) */}
                      <Link
                        href="/settings/history"
                        className={HEADER_MENU_ITEM_CLASS}
                      >
                        <HistoryIcon />
                        履歴取り込み
                      </Link>
                    </>
                  )}
                  <LogoutButton variant="menu" />
                </>
              ) : (
                <>
                  <PasskeyLoginButton variant="menu" />
                  <LoginButton variant="menu" label="パスワードでログイン" />
                </>
              )}
            </HeaderMenu>
            {/* アイコンもホームリンクに含める。押せる的が広がるうえ、
                アイコンとサイト名が別々の当たり判定に割れるのを避ける。
                /icon.svg は app/icon.svg が規約で配信するもの (PNG より
                拡大に強い)。alt は空 — 隣の文字が同じことを言っている */}
            <Link
              href="/"
              className="inline-flex items-baseline gap-1.5 text-lg font-bold"
            >
              {/* h-[1cap] … アイコンの高さをサイト名の大文字 (Q) と同じにする。
                  items-baseline で img の下端 (= 置換要素のベースライン) が
                  文字のベースラインに載り、上端が Q の頭と揃う */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" className="h-[1cap] w-auto rounded-[2px]" />
              {SITE_NAME}
            </Link>
            <span className="text-xs text-gray-400">v{pkg.version}</span>
            {/* 戻る/進む (◀ ▶)。下部バーの左端から、サイト名・バージョンの右へ
                戻した (docs/11 §5-2)。ヘッダーは全ページで同じ位置にあり、
                編集帯やスロットの並びと場所を取り合わない */}
            <HistoryNav />
            {/* 色には数日で慣れて見えなくなるので、文字でも書く */}
            {!isProd && (
              <span
                className="rounded bg-pink-600 px-1.5 py-0.5 text-xs font-bold text-white"
                title="ローカル環境。ここでの更新は本番 (qr.tommie.jp) に反映されない"
              >
                LOCAL
              </span>
            )}
            {/* デモの目印 (docs/38-デモモード計画.md §6)。本番相当で立てるので
                LOCAL とは別に出る。バナーと対で「消えるデータ」を伝える */}
            {isDemo && (
              <span
                className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white"
                title="デモ環境。保存したデータは定期的に削除される"
              >
                DEMO
              </span>
            )}
            {/* ユーザー名だけはメニューの外に残す — 「誰で入っているか」は
                一目で確かめたい情報で、押す物でもないため */}
            {user && (
              <span
                className="ml-auto max-w-24 truncate text-gray-500"
                title={`${user} でログイン中`}
              >
                {user}
              </span>
            )}
          </div>
        </header>
        {/* デモの常時バナー (docs/38-デモモード計画.md §6)。ヘッダ直後に置く。
            ログイン案内 (docs/39 §4) は env をここで読んで props で降ろす
            (site.ts と同じ流儀。process.env は NEXT_PUBLIC_ 以外クライアントへ
            渡らないため)。未設定 (空文字) なら案内行は出ない */}
        {isDemo && <DemoBanner loginHint={process.env.DEMO_LOGIN_HINT || null} />}
        {/* 遷移アニメーションは各ページの <PageTransition> が持つ
            (layout の要素は unmount されず enter/exit が起きないため) */}
        {/* max-w-2xl はメモの本文が読める行長に収めるための上限。
            landscape-phone では 4xl (896px) へ緩める — スマホ横持ちは縦が
            窮屈な代わりに横が余っており、行長より「スクロール量が減る」ほうが
            効く。カードの一覧も 2 カラム入る。none にしないのは、PC の縦に
            低いウィンドウ (横 1200px 級) も landscape-phone に該当し、
            そこで行が伸びすぎるのを止めるため (docs/31 §12-4) */}
        <main className="mx-auto max-w-2xl px-safe pt-6 pb-safe landscape-phone:max-w-4xl">
          {children}
        </main>
        {/* 下部バー。中身はノート編集中の編集ボタン (portal) だけで、差し込む
            側がいなければ自身を描かない。戻る/進むはヘッダーへ移した */}
        <PageBottomBar isProd={isProd} />
        {/* どちらも何も描かない (docs/30-ブラウザログ計画.md)。
            転送はログイン中だけ仕掛ける — 受け口は 401 を返すので、
            未ログインで拾っても運べず、無駄な要求になる。
            eruda は逆に未ログインでも要る。「ログインできない不具合」の
            手掛かりはブラウザ側にしか無く、そのとき転送は使えない。
            デモでは /logs を閉じる (docs/38 §4) ので転送も仕掛けない
            (受け口も 403 を返す) */}
        {user && !isDemo && <ClientLogCapture />}
        {/* タグを押した検索を履歴に残す。何も描かない。タグのリンクは一覧・
            画像タイル・詳細ページ・メモ本文の 4 か所にあるので、配って回らず
            ここで一括して受ける (docs/59-検索候補計画.md §2)。
            未ログインでは一覧も詳細も出ないので仕掛けない */}
        {user && <RecordTagSearch />}
        {/* オフライン用の持ち出し (docs/65-オフライン対応計画.md)。何も描かない。
            ログイン中だけ仕掛ける — 同期の口は 401 を返すので、未ログインで
            拾っても運べない (ClientLogCapture と同じ判断)。デモでも仕掛けない:
            消えるデータを端末へ溜める意味が無く、共有アカウントなので
            他人のノートが端末に残る (docs/38-デモモード計画.md §4) */}
        {user && !isDemo && <OfflineSync version={pkg.version} />}
        <DebugConsole />
        </BottomBarProvider>
      </body>
    </html>
  );
}
