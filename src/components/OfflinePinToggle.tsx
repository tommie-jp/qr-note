interface OfflinePinToggleProps {
  itemNo: string;
  pinned: boolean;
  // 印を付けたときに端末へ落とす量の目安 (バイト)。0 なら添付が無い
  attachmentBytes: number;
  setPinAction: (formData: FormData) => void | Promise<void>;
}

// 「オフラインで常に使う」印 (docs/65-オフライン対応計画.md §7)。
//
// **落とす量を先に出す**のがこの帯の役目。印を付けるのは通信量と端末の
// 保存容量を払う判断で、押した後に判っても遅い。公開トグルが「押す前に
// いまの状態を文で書く」のと同じ理由 — 押した結果が読み取れるようにする。
//
// 公開トグルと違い、これは事故っても取り返しがつく (外せば消える) ので、
// 色は控えめにする。印は青 — 公開の緑 (外から見える) と紛れさせない。
export function OfflinePinToggle({
  itemNo,
  pinned,
  attachmentBytes,
  setPinAction,
}: OfflinePinToggleProps) {
  const boxClass = pinned
    ? "border-blue-300 bg-blue-50 text-blue-900"
    : "border-gray-200 bg-gray-50 text-gray-600";

  const buttonClass = pinned
    ? "border-blue-300 bg-white text-blue-900 hover:bg-blue-100 active:bg-blue-200"
    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-2 ${boxClass}`}
    >
      <p className="flex-1">
        {pinned ? (
          <>
            <span aria-hidden>📥 </span>
            <span className="font-medium">オフラインで使う</span> —
            添付の原寸・回路図・シークレットまで端末に保存します。
          </>
        ) : (
          // 印なしは既定の状態なので説明を添えない (PublicToggle の非公開側と
          // 同じ判断)。付けたときに何が起きるかはボタンの脇の量で伝わる
          <>
            <span aria-hidden>📴 </span>
            <span className="font-medium">オフライン保存なし</span>
          </>
        )}
        {attachmentBytes > 0 && (
          <span className="text-sm opacity-70">（添付 {formatBytes(attachmentBytes)}）</span>
        )}
      </p>
      <form action={setPinAction}>
        <input type="hidden" name="itemNo" value={itemNo} />
        <input type="hidden" name="pin" value={pinned ? "0" : "1"} />
        <button
          type="submit"
          className={`inline-flex min-h-9 items-center rounded border px-3 font-medium transition-colors ${buttonClass}`}
        >
          {pinned ? "保存をやめる" : "オフラインで使う"}
        </button>
      </form>
    </div>
  );
}

// 通信量として読める桁だけ出す (小数 1 桁)。**1KB = 1024 で数える** —
// 端末の保存容量の話なので、回線の 1000 進法ではなくこちらが素直
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}
