"use client";

import { useFormStatus } from "react-dom";
import { NumberIcon } from "@/components/icons";
import { PressTip } from "@/components/item/row-actions/PressTip";
import { ACTION_LINK_CLASS } from "@/components/ui";

interface NumberAssignButtonProps {
  itemId: string;
  assignAction: (formData: FormData) => void | Promise<void>;
}

// 押している間だけ回るスピナー。useFormStatus は form の子孫でしか pending を
// 拾えないので分ける。大きさは常に同じにして、押しても行が動かないようにする
// (PendingLink の LinkSpinner と同じ形)
function AssignSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${ACTION_LINK_CLASS} disabled:opacity-60`}
    >
      <NumberIcon />
      番号
      <span
        aria-hidden
        className={`size-3 shrink-0 rounded-full border-2 border-current border-t-transparent transition-opacity ${
          pending ? "animate-spin opacity-100" : "opacity-0"
        }`}
      />
    </button>
  );
}

// 「番号を振る」(docs/111-短縮URL計画.md §6)。番号タグの無いノートにだけ出す。
//
// 押すと 1000 以上の空き番号を本文のタグ (#1234) にする。それで短縮 URL
// `/s/1234` と小さい印刷 QR が使えるようになり、番号は手書きして手で打てる。
// 確認は挟まない — タグなので編集で消せば元に戻る
export function NumberAssignButton({ itemId, assignAction }: NumberAssignButtonProps) {
  return (
    <form action={assignAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <PressTip label="4 桁の番号を振る。短い QR になり、番号を手で打って開ける">
        <AssignSubmit />
      </PressTip>
    </form>
  );
}
