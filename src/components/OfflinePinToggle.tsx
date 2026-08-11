import { STATE_TOGGLE_CLASS } from "@/components/ui";

interface OfflinePinToggleProps {
  itemNo: string;
  pinned: boolean;
  // 印を付けたときに端末へ落とす量の目安 (バイト)。0 なら添付が無い
  attachmentBytes: number;
  setPinAction: (formData: FormData) => void | Promise<void>;
}

// 「オフラインで常に使う」印 (docs/65-オフライン対応計画.md §7)。
// 公開トグルと並べて見出し行に畳んだ (docs/75-ノート上部圧縮計画.md §2)。
//
// 印を付けるのは通信量と端末の保存容量を払う判断なので、**落とす量を押す前に
// 出す**のがこのトグルの役目。帯をやめた分、量の置き場所は tooltip になった
// (docs/75 §3) — 画面には出ないので、量が要る人はホバー (PC) で読む。
//
// 公開トグルと違い、これは事故っても取り返しがつく (外せば消える) ので、
// 確認は挟まず色も控えめにする。印は青 — 公開の緑 (外から見える) と紛れさせない。
//
// ラベルは両状態とも「オフライン」で、違いはアイコンと色だけ。見出し行の
// 横幅がそれ以上伸ばせないため。色だけの区別にならないよう、絵 (📴/📥) を
// 変え、読み上げには aria-pressed で状態を渡す。
export function OfflinePinToggle({
  itemNo,
  pinned,
  attachmentBytes,
  setPinAction,
}: OfflinePinToggleProps) {
  const colorClass = pinned
    ? "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100"
    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100";

  // 押すと何が起きるかを書く (ボタンの文字は状態なので、動作はこちらに残る)。
  // 添付が無いノートでは括弧ごと出さない — 「（添付 0 B）」は読む値打ちがない
  const hint = pinned
    ? "保存をやめる（端末から消す）"
    : `オフラインで使う${
        attachmentBytes > 0 ? `（添付 ${formatBytes(attachmentBytes)}）` : ""
      }`;

  return (
    <form action={setPinAction} title={hint}>
      <input type="hidden" name="itemNo" value={itemNo} />
      <input type="hidden" name="pin" value={pinned ? "0" : "1"} />
      <button
        type="submit"
        aria-pressed={pinned}
        className={`${STATE_TOGGLE_CLASS} ${colorClass}`}
      >
        <span aria-hidden>{pinned ? "📥" : "📴"}</span>オフライン
      </button>
    </form>
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
