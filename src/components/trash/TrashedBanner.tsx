import Link from "next/link";

interface TrashedBannerProps {
  itemNo: string;
  restoreAction: (formData: FormData) => void | Promise<void>;
}

// ゴミ箱にあるノートを /item で開いたときの帯 (docs/12-ゴミ箱計画.md §5)。
// シールが貼られたままの部品が出てくることはあるので notFound にはせず、
// 本文は見せたうえで状態を知らせ、その場で戻せるようにする。
//
// 編集して保存しても deletedAt は触らない (upsert が触らない) ため、
// 検索へ戻すにはこのボタンを押す必要がある = 復元は明示的な操作だけ。
export function TrashedBanner({ itemNo, restoreAction }: TrashedBannerProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-yellow-50 px-3 py-2 text-yellow-800">
      <p className="flex-1">
        このノートはゴミ箱にあります (検索には出ません)。
      </p>
      <Link
        href="/trash"
        transitionTypes={["nav-forward"]}
        className="text-yellow-900 underline"
      >
        ゴミ箱
      </Link>
      <form action={restoreAction}>
        <input type="hidden" name="itemNo" value={itemNo} />
        <button
          type="submit"
          className="inline-flex min-h-9 items-center rounded border border-yellow-300 bg-white px-3 font-medium text-yellow-900 transition-colors hover:bg-yellow-100 active:bg-yellow-200"
        >
          復元
        </button>
      </form>
    </div>
  );
}
