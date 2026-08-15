// 利用者ごとの小さな設定の読み書き (docs/88-選択行の色計画.md)。
//
// **userName で仕切るのが要点**。呼び出し側 (layout / route) はセッションから
// 取った名前を渡す — リクエストの本文で名乗らせない (searchQueryStore.ts と
// 同じ流儀)。
//
// **意味づけは持たない。** 値は文字列で出し入れするだけで、既定値も妥当性も
// 設定ごとの module (rowTint.ts など) が決める。ここに設定名を並べ始めると、
// 設定を 1 つ足すたびに 2 か所を直すことになる。
//
// **サーバ専用。** prisma を掴むので、クライアント部品から import しないこと

import { prisma } from './db'

export async function readUserSetting(
  userName: string,
  key: string,
): Promise<string | null> {
  const row = await prisma.userSetting.findUnique({
    where: { userName_key: { userName, key } },
    select: { value: true },
  })
  return row?.value ?? null
}

// 上書きしかない (履歴を残さない)。同じ人の同じ key は主キーで 1 行に
// 制限されているので、2 台から同時に押しても片方の値が残るだけで壊れない
export async function writeUserSetting(
  userName: string,
  key: string,
  value: string,
): Promise<void> {
  await prisma.userSetting.upsert({
    where: { userName_key: { userName, key } },
    create: { userName, key, value },
    update: { value },
  })
}
