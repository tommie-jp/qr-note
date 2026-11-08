// 日の一覧から予定の本文を少しだけ書き換えて保存する (docs/126 §1-8・§1-13)。
// 「済み」(予定の行の done=、setEventDone) と、題名のインライン編集
// (先頭の見出し、setEventTitle)、時刻のパネル (予定の行の start= end=、setEventTime)。
//
// 本文は控え (noteCache) から読む。控えが古くて 409 になったら、1 度だけ
// 取り直してやり直す — 押した人に「読み直す」をさせるほどの操作ではない
import { isItemDto } from "@/lib/api/itemDto";
import { noteWritten } from "@/lib/client/invalidate";
import { noteCache } from "@/lib/client/noteStore";
import { formatBase } from "@/lib/editor/saveBase";
import { setEventDone, setEventTime, setEventTitle } from "../event/eventMemo";
import { jstToday } from "../event/monthLayout";
import { invalidateCalendar } from "./calendarStore";
import { putMemo } from "./saveMemo";

// 失敗したら利用者に見せる文を返す。保存できたら null
export function saveEventDone(itemId: string, done: boolean): Promise<string | null> {
  return saveEventEdit(itemId, (memo) => setEventDone(memo, done ? jstToday() : null));
}

export function saveEventTitle(itemId: string, title: string): Promise<string | null> {
  return saveEventEdit(itemId, (memo) => setEventTitle(memo, title));
}

// start が null なら終日にする
export function saveEventTime(itemId: string, start: string | null, end: string | null): Promise<string | null> {
  return saveEventEdit(itemId, (memo) => setEventTime(memo, start, end));
}

// edit は本文を受けて書き換えた本文を返す。変わらなければ保存しない
async function saveEventEdit(itemId: string, edit: (memo: string) => string): Promise<string | null> {
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
    const memo = edit(item.memo);
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
