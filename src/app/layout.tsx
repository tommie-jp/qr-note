import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import pkg from "../../package.json";
import { BootTimingReport } from "@/components/BootTimingReport";
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
import { RowTintMenuItem } from "@/components/RowTintMenuItem";
import { OfflineSync } from "@/components/OfflineSync";
import { PaneModeButton } from "@/components/PaneModeButton";
import { PasskeyLoginButton } from "@/components/PasskeyLoginButton";
import { RecordTagSearch } from "@/components/RecordTagSearch";
import { TextSizeMenuItem } from "@/components/TextSizeMenuItem";
import { HEADER_MENU_ITEM_CLASS } from "@/components/ui";
import { setPaneModeAction } from "@/app/actions";
import { NOTE_FONT_SCALE_INIT_SCRIPT } from "@/lib/noteFontScale";
import { PANE_MODE_COOKIE, parsePaneMode } from "@/lib/paneMode";
import { rowTintVars } from "@/lib/rowTint";
import { loadRowTintId } from "@/lib/rowTintStore";
import { PANE_SIZE_INIT_SCRIPT } from "@/lib/paneSize";
import {
  isDemoMode,
  isProductionEnv,
  LOCAL_THEME_COLOR,
  PROD_THEME_COLOR,
} from "@/lib/appEnv";
import { PASSKEY_SETTINGS_PATH } from "@/lib/authPaths";
import { SECRET_SETTINGS_PATH } from "@/lib/secrets";
import { currentUser } from "@/lib/session";
import {
  qrBaseUrl,
  siteBaseUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
  siteTitle,
} from "@/lib/site";
import "./globals.css";

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

  // ヘッダーの帯の地色。ハンバーガーボタンにも同じ色を渡す — 帯は横スクロール
  // するようになり、貼り付いたままのボタンの下を文字が潜るので、ボタン側にも
  // 同じ地色が要る。2 か所に書き分けると片方だけ変えた日に文字が透ける
  const headerBgClass = isProd ? "bg-white/95" : "bg-pink-100/95";

  // デモインスタンスの目印 (docs/38-デモモード計画.md §6)。バナー・バッジ・
  // 設定系リンクの出し分けに使う。デモは本番相当で立てるので isProd とは独立
  const isDemo = isDemoMode();

  return (
    // suppressHydrationWarning … 下のインラインスクリプトが hydration より前に
    // この html へ style (--note-font-scale) を書き足すため。付けないと React が
    // 差分を「不整合」と見なし、境界ごと描き直して倍率が失われる
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
        {/* 本文の文字サイズを初回描画の前に当てる (docs/61-テキストサイズ計画.md)。
            useEffect で当てると等倍の本文が一度見えてから大きくなるので、
            HTML の解析中に同期で走らせる (Next の
            docs/01-app/02-guides/preventing-flash-before-hydration.md と同じ手) */}
        <script
          dangerouslySetInnerHTML={{ __html: NOTE_FONT_SCALE_INIT_SCRIPT }}
        />
        {/* 検索 3 ペインの境界を動かした人の寸法 (docs/86 §4-2)。文字サイズと
            同じ理由で解析中に当てる — useEffect だと既定の寸法でひととおり
            組まれた後にペインだけ動く。保存が無ければ何も書かない */}
        <script
          dangerouslySetInnerHTML={{ __html: PANE_SIZE_INIT_SCRIPT }}
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
          className={`sticky top-0 z-20 border-b backdrop-blur print:hidden ${headerBgClass} ${
            isProd ? "border-gray-200" : "border-pink-300"
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
          {/* **帯は必ず 1 行。収まらない分は帯の中だけ横へ送る** (docs/11 §6-5)。
              以前は flex-wrap で 2 行にしていた (docs/61 §1)。「横スクロールは
              なぜか右にずれる形で気づきにくい」という理由だったが、それは
              **ページごと**横にずれる場合の話で、ここで動くのは帯の中身だけ。
              LOCAL の目印やテキストサイズ拡大のたびに帯が 2 行へ伸び、本文が
              下へ押し出されるほうが目に付く。
              overscroll-x-contain … 端まで送った勢いがブラウザの「戻る」に
              化けないようにする (ItemTags と同じ)。
              [scrollbar-width:none] … **ここだけは隠す。** ItemTags は
              「隠すと PC で『まだ右にある』合図が消える」として細く出しているが、
              この器のスクロール窓は下の pb-3 のぶん帯より 12px 低く、古典的な
              スクロールバー (PC) は**帯の外・本文の上**に浮いて描かれる。
              置き場所の無いバーを出すくらいなら出さないほうを取る (右端で
              文字が切れていること自体が合図になる)。
              [&>*]:shrink-0 … 縮めずに溢れさせる。既定のままだと文字が潰れて
              そもそもスクロールが要らない形に詰められてしまう。
              pb-3 -mb-3 … **overflow-x を指定すると overflow-y は visible から
              auto に計算される。** 下へはみ出している物 (ハンバーガーの -mb-3、
              HistoryNav の -my-1.5) がそのままだとスクロール可能領域になり、
              帯に縦スクロールバーが出る。pb-3 で内側へ入れて、同じ幅の -mb-3 で
              帯の高さを元に戻す (見た目の高さは従来どおり)。
              左パディングが無いのは、ハンバーガーが sticky left-0 で貼り付く
              ため — 器に左余白が残ると、スクロール開始の瞬間にボタンだけ
              その幅ぶん左へ飛ぶ。左の safe-area はボタン自身が padding で持つ */}
          {/* **帯は画面いっぱいに使う** (docs/86 §4-4)。器を max-w-2xl で
              中央に寄せていた頃は、3 ペインにするとハンバーガーもユーザー名も
              画面の真ん中あたりに集まり、左のフォルダーペインとも右のノートとも
              揃わなかった。左の物 (メニュー・ロゴ・戻る進む) は左端へ、
              右の物 (ペイン構成・ユーザー名) は右端へ置く */}
          <div className="flex items-baseline gap-1.5 overflow-x-auto overscroll-x-contain pt-safe pr-safe pb-3 -mb-3 [scrollbar-width:none] lg:pb-1 lg:mb-0 [&>*]:shrink-0">
            {/* 項目はハンバーガーメニューへ畳む (docs/11-アプリ的UIUX計画.md §6)。
                横に並べていたときは iPhone の幅で 1 文字ずつ折り返れて崩れた。
                左端に置くのは、片手持ちの親指が届く側だから。帯が横へ動いても
                ここだけは貼り付いたまま残る (sticky) */}
            <HeaderMenu bgClass={headerBgClass}>
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
                      {/* 検索結果で選択中の行の色 (docs/88-選択行の色計画.md)。
                          テキストサイズのすぐ下に置く — どちらも「どう見えるか」
                          の設定で、探す場所は同じであってほしい。
                          **ログイン中の非デモだけ**: 保存先が user_settings なので
                          未ログインでは保存する相手がおらず、デモは共有アカウント
                          なので 1 人が変えると同時に見ている全員の色が変わる */}
                      <RowTintMenuItem value={rowTintId} />
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
            {/* 右端の一群。ml-auto がここまでの左寄せと切り離す */}
            {user && (
              <span className="ml-auto flex items-center gap-1.5">
                {/* 検索画面のペイン構成 (docs/86 §4-4)。ヘッダーに置くのは、
                    どのペインにも属さない「画面全体の畳み方」だから。
                    lg 未満では出さない (PaneModeButton の中で畳む) */}
                <PaneModeButton mode={paneMode} action={setPaneModeAction} />
                {/* ユーザー名だけはメニューの外に残す — 「誰で入っているか」は
                    一目で確かめたい情報で、押す物でもないため */}
                <span
                  className="max-w-24 truncate text-gray-500"
                  title={`${user} でログイン中`}
                >
                  {user}
                </span>
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
        {/* pt-2 … ヘッダーと本文の間はこれだけ。24px 空けていたのをやめた
            (docs/75-ノート上部圧縮計画.md §5)。スマホの 1 画面に入る本文を
            増やすのが目的で、ここは全ページに効く */}
        <main className="mx-auto max-w-2xl px-safe pt-2 pb-safe landscape-phone:max-w-4xl">
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
        {/* 起動にかかった時間の内訳を /logs へ送る (src/lib/bootTiming.ts)。
            何も描かない。「デプロイ直後の起動だけ数十秒白い」の切り分け用で、
            原因が判ったら消してよい。仕掛ける条件は ClientLogCapture と同じ
            (転送の受け口が同じなので、ログイン中・デモ以外) */}
        {user && !isDemo && <BootTimingReport version={pkg.version} />}
        <DebugConsole />
        </BottomBarProvider>
      </body>
    </html>
  );
}
