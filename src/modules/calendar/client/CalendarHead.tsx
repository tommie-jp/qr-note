"use client";

import { CalendarMenu } from "./CalendarMenu";
import { WeekdayHeader } from "./MonthGrid";

// カレンダー表示 (CalendarView) の見出し行と知らせ。CalendarView から分けた (docs/128 §3-3)

// 見出し行は詰める (32px の釦・16px の年月。docs/126 §1-23)
const NAV_BUTTON = "min-h-8 min-w-8 rounded px-2 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200";

interface CalendarNavProps {
  month: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onList: () => void;
}

// 見出し行の右の釦 (月送り・今日・一覧)
function CalendarNav({ month, onPrev, onNext, onToday, onList }: CalendarNavProps) {
  const [year, monthNumber] = month.split("-").map(Number);
  return (
    // 右の釦は 1 行の帯にして横に送る (折り返すとマス目が下へずれる)。
    // 設定のパネルは body へ portal するので、帯の overflow には切られない
    <div
      data-calendar-nav=""
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&>*]:shrink-0"
    >
      <button type="button" className={NAV_BUTTON} aria-label="前の月" onClick={onPrev}>
        ◀
      </button>
      <h2 className="min-w-28 text-center text-base leading-6" aria-live="polite">
        {year}年{monthNumber}月
      </h2>
      <button type="button" className={NAV_BUTTON} aria-label="次の月" onClick={onNext}>
        ▶
      </button>
      <button type="button" className={NAV_BUTTON} onClick={onToday}>
        今日
      </button>
      <span className="flex-1" />
      {/* 読み込み中の文字はここに出さない。見出し行が折り返してマス目がずれ、
          浮かせた一覧 (マスの位置で置いた) と食い違う。待ちはマス目を薄くして見せる */}
      <button type="button" className={`${NAV_BUTTON} border border-gray-300`} onClick={onList}>
        一覧
      </button>
    </div>
  );
}

// 見出し行 (設定・月送り・今日・一覧) と曜日の行
export function CalendarHead(props: CalendarNavProps) {
  return (
    // 見出し行と曜日の行は送る器の上端に貼り付ける (docs/126 §1-28)。
    // 器の左右の余白 (px-safe) ごと覆い、マス目が両脇から透けないようにする
    <div data-calendar-head="" className="sticky top-0 z-10 -mx-safe bg-white px-safe">
      <div className="flex items-center gap-1">
        {/* カレンダー専用の設定 (日付の大きさ・優先度の色。docs/126 §1-12)。
            ここは送らない (docs/126 §1-19) */}
        <CalendarMenu />
        <CalendarNav {...props} />
      </div>
      <div className="mt-1">
        <WeekdayHeader />
      </div>
    </div>
  );
}

// 読み込みの失敗・載せきれなかった予定の知らせ
export function CalendarNotices({
  error,
  omitted,
  onRetry,
}: {
  // 読み込めず、出せる予定も無いときだけ
  error: Error | null;
  // 載せきれなかった件数 (予定が届いていなければ 0)
  omitted: number;
  onRetry: () => void;
}) {
  return (
    <>
      {error !== null ? (
        <p role="alert" className="my-1 rounded bg-yellow-50 px-3 py-2 text-yellow-800">
          予定を読み込めませんでした: {error.message}{" "}
          <button type="button" className="underline" onClick={onRetry}>
            もう一度
          </button>
        </p>
      ) : null}
      {omitted > 0 ? (
        <p role="status" className="my-1 rounded bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          予定が多すぎるため {omitted} 件を表示していません。検索式で絞ってください。
        </p>
      ) : null}
    </>
  );
}
