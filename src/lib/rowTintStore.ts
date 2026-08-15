// 選択行の色の読み書き (docs/88-選択行の色計画.md)。
//
// 色の定義そのものは rowTint.ts (クライアントからも import される)。
// こちらは DB に触るので**サーバ専用** — 分けているのは、メニューの部品が
// 色の一覧を import しただけで prisma がクライアント側へ混ざるのを防ぐため
// (thumbnail.ts で sharp を漏らしたのと同じ罠)。

import {
  DEFAULT_ROW_TINT_ID,
  parseRowTintId,
  ROW_TINT_SETTING_KEY,
  type RowTintId,
} from './rowTint'
import { readUserSetting, writeUserSetting } from './userSettingStore'

// **未ログインをそのまま受ける。** layout はどのページでも描かれ、公開ノートや
// ログイン画面では user が null になる。呼ぶ側で毎回 null を分岐させると、
// 分岐を書き忘れた場所だけ落ちる
export async function loadRowTintId(
  userName: string | null,
): Promise<RowTintId> {
  if (userName === null) {
    return DEFAULT_ROW_TINT_ID
  }
  return parseRowTintId(await readUserSetting(userName, ROW_TINT_SETTING_KEY))
}

export async function saveRowTintId(
  userName: string,
  id: RowTintId,
): Promise<void> {
  await writeUserSetting(userName, ROW_TINT_SETTING_KEY, id)
}
