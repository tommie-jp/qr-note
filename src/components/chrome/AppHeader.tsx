import type { ComponentProps } from "react";
import Link from "next/link";
import pkg from "../../../package.json";
import { AppHeaderMenu } from "@/components/chrome/AppHeaderMenu";
import { HistoryNav } from "@/components/chrome/HistoryNav";
import { PaneModeButton } from "@/components/panes/PaneModeButton";
import type { PaneMode } from "@/lib/prefs/paneMode";
import type { RowTintId } from "@/lib/prefs/rowTint";
import { SITE_NAME } from "@/lib/site";

interface AppHeaderProps {
  // ログイン中のユーザー名。未ログインは null
  user: string | null;
  isProd: boolean;
  isDemo: boolean;
  paneMode: PaneMode;
  // setPaneModeAction。サーバアクションは layout から受ける
  // ('@/app/actions' をここで読むと DB の層まで巻き込む。RecordAccess と同じ)
  paneModeAction: ComponentProps<typeof PaneModeButton>["action"];
  rowTintId: RowTintId;
  // ヘッダの QR が指すサイトの URL と、その QR 画像 (data URL)
  siteUrl: string;
  siteQrDataUrl: string;
}

// 全ページ共通のヘッダーの帯 (docs/11-アプリ的UIUX計画.md §5・§6)。
// サーバコンポーネントで、判断に要る値 (ログイン・環境・構成) はすべて
// root layout が読んで props で降ろす。
//
// ヘッダの帯はログインしていなくても出す (docs/18-ログイン計画.md)。
// 未ログインならユーザー名の代わりにログインボタンを置く。
// 中身を守るのは proxy.ts と requireUser() の役目で、この帯ではない。
export function AppHeader({
  user,
  isProd,
  isDemo,
  paneMode,
  paneModeAction,
  rowTintId,
  siteUrl,
  siteQrDataUrl,
}: AppHeaderProps) {
  // ヘッダーの帯の地色。ハンバーガーボタンにも同じ色を渡す — 帯は横スクロール
  // するようになり、貼り付いたままのボタンの下を文字が潜るので、ボタン側にも
  // 同じ地色が要る。2 か所に書き分けると片方だけ変えた日に文字が透ける
  const headerBgClass = isProd ? "bg-white/95" : "bg-pink-100/95";

  return (
    // 深くスクロールしても検索・ホームに戻れるよう貼り付ける (docs/11 §5)。
    // pt-safe … standalone はステータスバーの下に潜り込む (viewport-fit=cover)。
    // ブラウザで開いているときは inset が 0 で従来と同じ余白になる。
    // 本文はほぼ白いカードで覆われるため、body の色より常時見えている
    // この帯の色のほうが「本番ではない」ことに気づく主な手がかりになる
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
        <AppHeaderMenu
          bgClass={headerBgClass}
          user={user}
          isDemo={isDemo}
          rowTintId={rowTintId}
          siteUrl={siteUrl}
          siteQrDataUrl={siteQrDataUrl}
        />
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
                どの幅でも出す (PaneModeButton の注) */}
            <PaneModeButton mode={paneMode} action={paneModeAction} />
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
  );
}
