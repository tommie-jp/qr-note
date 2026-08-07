// 検索結果の学習進捗 (docs/60-学習進捗計画.md §2)。
//
// 「チェック完了 3 / 9 (33%)」— 分母は同じ検索でチェックを持つノート、
// 分子はそのうち全部チェックしたノート。数え方は items.ts の
// countTaskProgress が持ち、ここは描くだけ。
//
// 帯は aria-hidden にする。すぐ隣の文が同じ内容を数字で言っているので、
// role="progressbar" を足すと読み上げが二度同じことを言う
// (NotesImporter の帯は数字を伴わないので、あちらは progressbar のままでよい)。
export function TaskProgress({ done, total }: { done: number; total: number }) {
  // 母数 0 は「チェックを使っていない検索」。0/0 (NaN%) を出すより何も出さない
  if (total <= 0) {
    return null;
  }
  // 切り捨て。四捨五入だと、残り 1 件でも 100% と出てしまう
  const percent = Math.floor((done / total) * 100);

  return (
    <p className="flex items-center gap-2 text-sm text-gray-600">
      <span className="shrink-0">
        チェック完了 {done} / {total} ({percent}%)
      </span>
      <span
        aria-hidden
        className="h-1.5 w-full max-w-40 overflow-hidden rounded bg-gray-200"
      >
        <span
          className="block h-full rounded bg-green-600"
          style={{ width: `${percent}%` }}
        />
      </span>
    </p>
  );
}
