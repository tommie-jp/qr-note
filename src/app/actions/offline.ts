'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { readItemNo } from '@/lib/actionForm'
import { renderCircuits } from '@/lib/circuit/cache'
import { getItem } from '@/lib/items/read'
import { setItemOfflinePin } from '@/lib/items/flags'
import { parseBackUrl, parseSelectedItemNos } from '@/lib/items/itemSelection'
import { requireUserOutsideDemo } from './_guards'
import { revalidateItem } from './_revalidate'

// --- オフラインの印 (docs/65-オフライン対応計画.md §7) ---

const DEMO_OFFLINE_MESSAGE = 'デモモードではオフライン保存は使えません'

// ノートを「オフラインで常に使う」対象にする / やめる。
//
// 公開トグルと同じく**望む状態** (pin=1 / 0) を送る形にする。裏返す形だと
// 二重送信で意図と逆に倒れる。
//
// 印を立てるときに**回路図を描いておく**のがこの口の要点。同期
// (syncItems.ts) は出来上がっている図を配るだけで描かないので、ここで
// 描かないと「印を付けたのに圏外で図だけ出ない」になる。ノートを一度でも
// 開いていれば ItemView が描き済みだが、それに頼ると「開かずに印だけ付けた」
// 経路が漏れる。
//
// 描画の失敗でトグルを止めない。TeX のエラーは本文側の問題で、印を付ける
// 操作とは別の話 (図はオンラインで開けばエラーとして見える)。
export async function setItemOfflinePinAction(formData: FormData): Promise<void> {
  // デモでは同期の口ごと閉じてある (api/sync/items) ので、印を立てても何も
  // 起きない。**旗の欠落に頼らず口も閉じる** — UI で出さないことと、叩けない
  // ことは別の話 (setItemPublicAction と同じ流儀)。共有アカウントのデモで
  // 誰かが印を立てると、他の人の画面にもその帯が出てしまう
  await requireUserOutsideDemo(DEMO_OFFLINE_MESSAGE)
  const itemNo = readItemNo(formData)
  // '1' だけを印ありと読む。判らない値は印なしへ倒す (通信量を使わない側へ)
  const pinned = formData.get('pin') === '1'
  await setItemOfflinePin(itemNo, pinned)

  if (pinned) {
    const item = await getItem(itemNo)
    if (item !== null) {
      try {
        await renderCircuits(item.memo)
      } catch (error) {
        console.warn(`オフライン用の回路図を描けませんでした (${itemNo})`, error)
      }
    }
  }

  revalidateItem(itemNo)
}

// 検索結果で選択したノートにまとめて印を立てる (docs/65 §7)。
// 一括タグ・ゴミ箱と同じフォームから formAction で分岐して呼ばれる。
//
// **立てるだけで、外す口はここに作らない。** 一括で外せると、全選択して
// 押した瞬間に端末の持ち出しが丸ごと消える — 消えたことは圏外へ出るまで
// 判らない。外すのは 1 件ずつ (ノート画面のトグル) で足りる。
//
// 回路図は 1 件ずつと同じく**ここで描いておく** (§7-2)。選んだ数だけ TeX が
// 走るので遅くなりうるが、描かずに印だけ立てると「圏外で図だけ出ない」が
// 選んだ件数ぶん一度に生まれる。描画の失敗で操作は止めない。
export async function setItemsOfflinePinAction(formData: FormData): Promise<void> {
  // 単体のトグルと同じ理由でデモを塞ぐ (旗の欠落に頼らない)
  await requireUserOutsideDemo(DEMO_OFFLINE_MESSAGE)
  const itemNos = parseSelectedItemNos(formData)
  const back = parseBackUrl(formData)

  for (const itemNo of itemNos) {
    await setItemOfflinePin(itemNo, true)
    const item = await getItem(itemNo)
    if (item === null) {
      continue
    }
    try {
      await renderCircuits(item.memo)
    } catch (error) {
      console.warn(`オフライン用の回路図を描けませんでした (${itemNo})`, error)
    }
  }

  if (itemNos.length > 0) {
    // 一覧も描き直す。印は一覧に出ないが、**次の同期で持ち出す対象が
    // 変わった**ので、キャッシュされた古い応答を残さない
    revalidatePath('/')
  }

  redirect(back)
}
