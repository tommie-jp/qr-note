// ノート 1 件の描画材料を API で運ぶ形にする (docs/123 §1-3)。
//
// 本文の Markdown は端末が描く。サーバに残るのは**端末では作れないもの**だけ:
//
//   回路図   … TeX (WASM) の描画と circuit_svgs のキャッシュ。1 枚 1〜3 秒
//   表・健康 … ```matrix / ```health は他のノートを DB で引いて集計する
//   添付量   … オフラインの印の吹き出しに出す量 (添付の大きさは DB にある)
//
// 回路図だけ口を分けた (/circuits)。描き上がるまで待つので、表や添付量を
// その巻き添えで遅らせない。端末は回路図の約束を CircuitDiagram に渡し、
// 図の場所にだけ「準備中」を出す (サーバ描画の頃と同じ見え方)。
//
// **ログイン済みの口からしか呼ばない。** 表と健康は非公開ノートの一覧と
// 体重・体温が並ぶので、公開ビューへは渡さない (docs/77 §6・docs/83 §8)
import 'server-only'
import { planCircuits } from '@/lib/circuit/cache'
import type { CircuitResult } from '@/lib/circuit/types'
import { buildHealthCharts, type HealthResult } from '@/lib/health/healthData'
import { buildMatrices, type MatrixResult } from '@/lib/matrix/matrixData'
import { pinAttachmentBytes } from '@/lib/offline/pinSize'

// Map は JSON にならないので [鍵, 値] の組の配列で運ぶ
export interface NoteRenderPayload {
  matrices: [string, MatrixResult][]
  health: [string, HealthResult][]
  attachmentBytes: number
}

export interface NoteCircuitsPayload {
  circuits: [string, CircuitResult][]
}

// bytesOnly … 表・健康のフェンスを持たないノート。オフラインの印の吹き出しに
// 出す添付量だけを返す (表と健康は DB を引く集計なので、要らなければ撃たない)
export async function loadNoteRender(
  memo: string,
  { bytesOnly = false }: { bytesOnly?: boolean } = {},
): Promise<NoteRenderPayload> {
  if (bytesOnly) {
    return { matrices: [], health: [], attachmentBytes: await pinAttachmentBytes(memo) }
  }
  const [matrices, health, attachmentBytes] = await Promise.all([
    buildMatrices(memo),
    buildHealthCharts(memo),
    pinAttachmentBytes(memo),
  ])
  return {
    matrices: [...matrices.entries()],
    health: [...health.entries()],
    attachmentBytes,
  }
}

// 回路図を全部描き終えてから返す。planCircuits の約束は reject しない
// (失敗は結果に畳まれる) ので、Promise.all で 1 枚の失敗が全体を落とすことはない
export async function loadNoteCircuits(memo: string): Promise<NoteCircuitsPayload> {
  const planned = planCircuits(memo)
  const circuits = await Promise.all(
    [...planned.entries()].map(
      async ([key, pending]): Promise<[string, CircuitResult]> => [key, await pending],
    ),
  )
  return { circuits }
}
