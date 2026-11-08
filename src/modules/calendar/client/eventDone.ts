// 予定の「済み」を切り替えて保存する (docs/126 §1-8)。本文の予定の行の
// done= だけを書き換える (setEventDone)。
//
// 本文は控え (noteCache) から読む。控えが古くて 409 になったら、1 度だけ
// 取り直してやり直す — 押した人に「読み直す」をさせるほどの操作ではない
import { isItemDto } from "@/lib/api/itemDto";
import { noteWritten } from "@/lib/client/invalidate";
import { noteCache } from "@/lib/client/noteStore";
import { formatBase } from "@/lib/editor/saveBase";
import { setEventDone } from "../event/eventMemo";
import { jstToday } from "../event/monthLayout";
import { invalidateCalendar } from "./calendarStore";
import { putMemo } from "./saveMemo";

// 失敗したら利用者に見せる文を返す。保存できたら null
export async function saveEventDone(itemId: string, done: boolean): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let item;
    try {
      ({ item } = await noteCache.load(itemId, { force: attempt > 0 }));
    } catch (error) {
      return `ノートを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (item === null) {
      return "このノートは見つかりません";
    }
    const memo = setEventDone(item.memo, done ? jstToday() : null);
    if (memo === item.memo) {
      return null;
    }
    const result = await putMemo(itemId, memo, formatBase(item.updatedAt));
    if (result.kind === "saved") {
      noteWritten(itemId, isItemDto(result.dto) ? result.dto : undefined);
      invalidateCalendar();
      return null;
    }
    if (!result.reload) {
      return result.message;
    }
  }
  return "別の画面でこのノートが書き換えられています。もう一度押してください。";
}
