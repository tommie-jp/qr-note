"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ヘッダーのハンバーガーメニュー (docs/11-アプリ的UIUX計画.md §6)。
//
// ログイン中は右側に 6 項目 (QR / GitHub / ユーザー名 / ログ / パスキー /
// ログアウト) が並び、iPhone の幅では**1 文字ずつ縦に折り返れて崩れていた**。
// 項目は今後も増える側なので、畳める入れ物にする。
//
// **画面幅で出し分けない。** 「狭いときだけメニュー」にするとコードパスが
// 2 本になり、片方だけ壊れる (当初の崩れもデスクトップでは見えなかった)。
// 全幅で同じ形にして、壊れ方を 1 通りに保つ。
//
// **開いた項目は画面の下端から出す (ボトムシート)。** 以前は開閉ボタンの
// 直下に垂れるドロップダウンだったが、これは PC の作法で、このアプリの
// 主戦場であるスマホでは「上端のボタンを押す → さらに上に出た項目を押す」と
// なり、片手持ちの親指が 2 回とも届かない。下から出せば、開いた後の選択が
// 親指の届く範囲で完結する。開閉ボタン自体を下へ移す案もあるが、それは
// ヘッダーの構成ごと変える話なので別途 (§6 参照)。
//
// 中身は children で受け取る。こうすると HeaderMenu 自身はログイン状態を
// 知らずに済み、layout.tsx (Server Component) が項目を組み立てられる
// (LogoutButton などのクライアント側の部品もそのまま入れられる)。
//
// bgClass はヘッダーの帯と同じ地色。帯は 1 行に収めるため横スクロールする
// ようになり (layout.tsx)、この開閉ボタンだけが sticky で貼り付いて残る。
// 下をサイト名や版が潜っていくので、同じ色で塞がないと文字が透ける。
// 色を自前で持たず受け取るのは、帯と 2 か所に書き分けないため
export function HeaderMenu({
  children,
  bgClass,
}: {
  children: React.ReactNode;
  bgClass: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // 開いている間だけの後始末をまとめて持つ。閉じたら (= 依存が false に
  // なったら) cleanup が走り、すべて元へ戻る
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        // 閉じたら開閉ボタンへ戻す。キーボードで辿っている人が
        // 行き場を失わないようにする
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // 背面のスクロールを止める。暗くした背景が指で動くと「触れないのに
    // 動く」矛盾になるうえ、シートの中を弾いたつもりが後ろが流れる
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // シートへフォーカスを移す。**portal で body の末尾に描くので、
    // 移さないとタブ順がヘッダー → 本文 → シートになり、開いた直後に
    // Tab を押しても項目へ入れない** (ヘッダーの中に描いていた頃は
    // DOM の並びがそのままタブ順だったので、これは要らなかった)。
    // 項目の外に出た後まで閉じ込める処理 (focus trap) は持たない —
    // Escape と外側タップで出られるので、行き止まりにはならない
    sheetRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    // flex にしておくこと。block のままだとボタンは行ボックスに乗るため、
    // 下の負マージンが高さに効かず帯が縮まない。
    //
    // sticky left-0 … 帯 (layout.tsx の器) が横スクロール容器なので、その中で
    // 左端に貼り付く。**器の側に左パディングを置かないこと** — 静止位置が
    // left:0 とずれ、スクロールを始めた瞬間にボタンだけカクッと飛ぶ。
    // z-index は付けない: 位置指定要素なので、位置指定でない兄弟 (サイト名・
    // 版・目印) より後に描かれる。ボタン自身の z-40 の意味は下のコメント参照。
    //
    // 地色はこの外側 div に置く。高さがちょうど帯 1 本ぶん (= ボタンの
    // margin box。下の -mb-3 ではみ出した分は含まない) なので、潜ってくる
    // 文字を過不足なく隠せる。ボタン側に置くと rounded の角から文字が覗く
    <div className={`sticky left-0 flex ${bgClass}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="メニュー"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        // relative z-40 で外側タップ用の覆い (z-10) より上に出す。
        // 下に居ると ✕ を押しても覆いがタップを横取りし、この onClick が
        // 動かない。結果的に閉じはする (覆いが閉じる) が、押した物と
        // 動いた物が食い違う状態になり、開閉が二重に走る余地も残る
        // -mb-3 … 44px のタップ目標は保ったまま、帯の高さへの寄与だけ 32px に
        // 減らす。はみ出しは下向きだけにすること。上へ伸ばすと standalone で
        // ステータスバーに潜り込む
        // text-lg … サイト名と同じ文字サイズにして、下の 1cap (= 大文字の高さ)
        // がサイト名の Q と同じ寸法を指すようにする
        // pl-[max(0.75rem,…)] … 帯の器から外した左の safe-area をここで見る。
        // 下限は器の 1rem より詰めた 0.75rem — 線が画面左端から 12px の位置に
        // 来る。**当たり判定は x=0 から始まる**ので、端に指が触れれば当たる。
        // pr-1 … 右は 4px まで詰める。器の gap-1.5 と合わせて、線とアプリ
        // アイコンの隙間は 10px (以前は px-2 + gap-2 で 16px)。
        // **幅を 44px へ広げない。** 広げると線の右に死に幅ができ、アプリ
        // アイコンが逆に遠のく。左端に接しているぶん、幅 35px でも以前
        // (16px 内側から始まる 35px) より当てやすい
        className="relative z-40 -mb-3 inline-flex min-h-11 items-center rounded lg:mb-0 lg:min-h-0 pl-[max(0.75rem,env(safe-area-inset-left))] pr-1 text-lg text-gray-500 transition-colors hover:text-gray-900 active:bg-gray-100"
      >
        {/* アイコンは inline SVG で持つ。この 2 本のためにライブラリを
            足さない (currentColor なので文字色にそのまま追従する)。

            viewBox は線のインク (stroke 2 + 丸キャップの張り出しを含む) に
            ぴったり合わせる。余白を残すと、ヘッダーのベースライン揃えで
            「svg の下端 = ベースライン」に載せたとき線だけ浮いて見える。
            h-[1cap] で 3 本線の全高が大文字 Q と同じになり、下の線が
            ベースラインに載る */}
        <svg
          aria-hidden
          viewBox="3 6 18 12"
          className="h-[1cap] w-auto"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          {isOpen ? (
            <path d="M7 7l10 10M17 7L7 17" />
          ) : (
            <path d="M4 7h16M4 12h16M4 17h16" />
          )}
        </svg>
      </button>

      {isOpen &&
        // **覆いもシートも body へ portal するのが要点。** ヘッダーには
        // backdrop-blur が掛かっており、backdrop-filter を持つ要素は
        // position:fixed の包含ブロックになる。ヘッダーの中に置くと
        // inset-0 や bottom-0 が「画面全体」ではなく「ヘッダーの矩形」を
        // 指し、覆いは本文まで届かず、シートは画面の下端に貼れない。
        // 実際それで、メニューを開いたまま本文のリンクを押せてしまい、
        // 閉じずに画面が遷移した
        createPortal(
          <>
            {/* 外側タップで閉じる覆い。document のリスナーではなく実体のある
                要素にするのは、iOS Safari で body へのタップが拾えないことが
                あるため。

                暗転させるのはシートの作法で、「後ろは今触れない」を目で
                伝えるため。ただし **z-10 = ヘッダー (z-20) より下** に置くので、
                暗くなるのは本文だけでヘッダーの帯は明るいまま残る。これは
                妥協ではなく必要な制約: ヘッダーは z-20 で積み重ね文脈を作るため、
                その中にある開閉ボタンの z-40 は「ヘッダーの中での 40」でしかなく、
                覆いをヘッダーより上に出すと ✕ が覆いの下に潜って上のコメントの
                食い違いが起きる。画面全体を暗くするより ✕ が正しく効くほうを取る */}
            <div
              className="fixed inset-0 z-10 bg-black/40"
              onClick={() => setIsOpen(false)}
              aria-hidden
            />
            {/* 項目を押したら閉じる。個々の項目に閉じる処理を配らず、
                バブリングを 1 か所で受けることで、項目が増えても閉じ忘れない。

                **例外は「自前の UI 状態を持つ項目」** (HeaderQrButton の
                オーバーレイ、PasskeyLoginButton の進行中・エラー表示)。
                閉じるとその部品ごと unmount され、開いたはずのものや
                出したはずのエラーが道連れに消える。該当する部品は自分の
                onClick で stopPropagation してメニューを開いたままにする。

                mx-auto max-w-2xl … 本文の器 (main) と同じ幅に収める。
                全幅に伸ばすと PC で画面を横切る帯になり、間延びして見える。
                main が広がる landscape-phone では、ここも 4xl へ揃える
                (docs/31 §12-4)。
                pb-… は自前で持つ。画面の下端に貼り付くので、ホームバーに
                潜らないよう safe-area の分を空ける (main の pb-safe は
                fixed には効かない)。

                max-h + overflow-y-auto … スマホ横持ちでは視界の高さが
                300px 台まで減り、項目全部は入らない (docs/31 §12)。上限を
                切ってシートの中をスクロールさせる。上に残す隙間は
                「ヘッダーの帯の高さ」(pt-safe = max(0.25rem, inset-top) +
                中身 ≒ 2.5rem)。シート (z-40) はヘッダー (z-20) より上に
                描かれるため、帯に被せると ✕ ボタンが押せなくなる —
                実際 240px の横画面で ✕ へのタップをシートが横取りした。
                overscroll-contain … スクロールが端に達したとき背面へ
                伝播させない (背面は overflow:hidden で止めているが、iOS は
                チェーンでラバーバンドが動くことがある)。
                [&>*]:shrink-0 … 縦に積んだ項目は縮ませない。テキストサイズ
                (docs/61) を上げると長い項目が 2 行になるが、既定の
                flex-shrink:1 のままだと入れ物が高さを 1 行ぶんに詰め、
                あふれた 2 行目が次の項目に重なって描かれる (つまみに
                shrink-0 が付いているのと同じ理由) */}
            <div
              ref={sheetRef}
              role="menu"
              tabIndex={-1}
              onClick={() => setIsOpen(false)}
              className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[calc(100dvh-max(0.25rem,env(safe-area-inset-top))-2.5rem)] max-w-2xl flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-t-2xl border border-gray-300 bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.15)] motion-safe:animate-sheet-up landscape-phone:max-w-4xl [&>*]:shrink-0"
            >
              {/* つまみ。掴んで動かせるわけではないが、この形が
                  「下から出た一時的なシート」の合図として通じている */}
              <span
                aria-hidden
                className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-gray-300"
              />
              {children}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
