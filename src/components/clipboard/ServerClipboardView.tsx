import { ClipboardDownIcon, ClipboardUpIcon } from "@/components/icons";
import { HEADER_MENU_ITEM_CLASS, HEADER_MENU_ROW_CLASS } from "@/components/ui";
import { agoLabel, type ClipboardSlotMeta, slotLabel } from "@/lib/clipboard/slot";

// ハンバーガーメニューの「サーバへコピー」「サーバからペースト」の表示部
// (docs/114-サーバクリップボード計画.md §3)。
//
// 状態は持たない。持ち主は ServerClipboardMenuItems (+ useServerClipboard) で、
// 状態ごとの描画をここで固定する。jsdom が無いので、押す流れの確認は
// lib/clipboard/serverClipboard.test.ts と E2E に任せ、描き分けだけをここで見る。

export type ServerClipboardBusy = "send" | "receive" | "clear" | null;

export interface ServerClipboardNotice {
  readonly tone: "ok" | "error";
  readonly text: string;
}

export interface ServerClipboardViewProps {
  // undefined … 読み込み中。null … 枠が無い (または期限切れ)
  readonly slot: ClipboardSlotMeta | null | undefined;
  readonly loadFailed: boolean;
  readonly busy: ServerClipboardBusy;
  readonly notice: ServerClipboardNotice | null;
  // 「3 分前」を数える基準。枠を読んだ時刻を渡す (描画のたびに new Date() しない)
  readonly now: Date;
  readonly onSend: () => void;
  readonly onReceive: () => void;
  readonly onClear: () => void;
}

// 押せる行 (HEADER_MENU_ITEM_CLASS) の押せない見た目。hover の灰色を殺さないと、
// 押せないのに反応が返って押し損ねたように見える
const ROW_DISABLED_CLASS =
  "disabled:opacity-60 disabled:hover:bg-transparent disabled:active:bg-transparent";

const DESCRIPTION =
  "どちらも 10 分で消えます。送るときはクリップボードの読み取りを許可してください";

export function ServerClipboardView({
  slot,
  loadFailed,
  busy,
  notice,
  now,
  onSend,
  onReceive,
  onClear,
}: ServerClipboardViewProps) {
  const hasSlot = slot !== undefined && slot !== null;

  return (
    <div
      // 行の中を押してもメニューを閉じない。結果 (✓ 送りました) を見せる場所が
      // この行の下なので、閉じると見えない (PhotoMetaMenuItem と同じ)
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={onSend}
        disabled={busy !== null}
        className={`${HEADER_MENU_ITEM_CLASS} ${ROW_DISABLED_CLASS}`}
      >
        <ClipboardUpIcon />
        {busy === "send" ? "送っています…" : "サーバへコピー"}
      </button>
      <button
        type="button"
        onClick={onReceive}
        disabled={busy !== null || !hasSlot}
        className={`${HEADER_MENU_ITEM_CLASS} ${ROW_DISABLED_CLASS} justify-between`}
      >
        <span className="flex items-center gap-2">
          <ClipboardDownIcon />
          {busy === "receive" ? "コピーしています…" : "サーバからペースト"}
        </span>
        <span className="shrink-0 text-xs font-normal text-gray-500">
          {slotSummary(slot, loadFailed, now)}
        </span>
      </button>
      <div className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between gap-y-0 py-0`}>
        <span className="min-w-0 flex-1 pb-1 text-xs font-normal text-gray-500">
          {DESCRIPTION}
        </span>
        {hasSlot && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy !== null}
            className="min-h-8 shrink-0 px-2 text-sm font-medium text-red-700 disabled:opacity-60"
          >
            消す
          </button>
        )}
      </div>
      {loadFailed && (
        <span role="alert" className="block px-3 pb-1 text-sm font-normal text-red-700">
          サーバの状態を読めませんでした
        </span>
      )}
      {notice && (
        <span
          role={notice.tone === "error" ? "alert" : "status"}
          className={`block px-3 pb-1 text-sm font-normal ${
            notice.tone === "error" ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {notice.text}
        </span>
      )}
    </div>
  );
}

// ペースト行の右に出す、いま入っているものの予告。押す前に何が来るか分かる
function slotSummary(
  slot: ClipboardSlotMeta | null | undefined,
  loadFailed: boolean,
  now: Date,
): string {
  if (loadFailed) {
    return "—";
  }
  if (slot === undefined) {
    return "確認中…";
  }
  if (slot === null) {
    return "なし";
  }
  return `${slotLabel(slot)}・${agoLabel(slot.updatedAt, now)}`;
}
