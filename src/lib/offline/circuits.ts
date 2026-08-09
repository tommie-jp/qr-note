// 持ち出した回路図を MarkdownView に渡せる形にする
// (docs/65-オフライン対応計画.md §8)。
//
// 型だけを circuitCache から借りる。**値を import してはいけない** — あちらは
// prisma と node:child_process を引き込むサーバ専用の module で、クライアントの
// 束に混ざると編集画面ごと 500 になる (thumbnail.ts が sharp を漏らした件と
// 同じ落とし穴)。`import type` はコンパイルで消えるので安全。

import type { CircuitMap } from '@/lib/circuitCache'
import type { OfflineCircuit } from './item'

// 描けなかった図はそもそも運ばれてこない (syncItems.ts は成功した SVG しか
// 積まない)。**エラーを作って詰めない**のが要点 — 圏外で「描画に失敗しました」と
// 出すと、原因が本文にあるように見えてしまう。まだ描かれていない図は
// マップに無い = コードブロックとして出る、で正しい (MarkdownView の既定)。
export function offlineCircuitMap(circuits: readonly OfflineCircuit[]): CircuitMap {
  return new Map(circuits.map(({ source, svg }) => [source, { svg }]))
}
