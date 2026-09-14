// 持ち出した回路図を MarkdownView に渡せる形にする
// (docs/65-オフライン対応計画.md §8)。
//
// 型は葉の circuit/types.ts から借りる。**circuit/cache.ts から値を import しては
// いけない** — あちらは prisma と node:child_process を引き込むサーバ専用の
// module で、クライアントの束に混ざると編集画面ごと 500 になる (thumbnail.ts が
// sharp を漏らした件と同じ落とし穴)。

import type { CircuitMap } from '@/lib/circuit/types'
import { circuitKey } from '@/lib/markdown/fenceLanguages'
import type { OfflineCircuit } from './item'

// 描けなかった図はそもそも運ばれてこない (syncItems.ts は成功した SVG しか
// 積まない)。**エラーを作って詰めない**のが要点 — 圏外で「描画に失敗しました」と
// 出すと、原因が本文にあるように見えてしまう。まだ描かれていない図は
// マップに無い = コードブロックとして出る、で正しい (MarkdownView の既定)。
export function offlineCircuitMap(circuits: readonly OfflineCircuit[]): CircuitMap {
  // 鍵は言語つき (MarkdownView が同じ形で引く)
  return new Map(
    circuits.map(({ source, lang, svg }) => [circuitKey(lang, source), { svg }]),
  )
}
