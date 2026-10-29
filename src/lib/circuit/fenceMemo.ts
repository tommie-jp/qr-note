// 本文から取り出した回路フェンスを覚えておく (docs/118 §1)。
//
// extractCircuitFences は描画とずれないよう本文全体を createNoteParser で
// 解析するので、回路フェンスを持つノート 1 件あたり 3〜5ms かかる。一覧
// (thumbs.ts) は表示する全件を、同期 (offline/syncItems.ts) は 583 件を
// 毎回解析していて、同期だけで 2 秒、その間 Node はほかの要求を一切
// 受け付けなかった (docs/118 §0-2)。本文が同じなら結果も同じなので、
// 2 回目からは覚えた結果を返す。
//
// **鍵は本文の sha1。** updatedAt を鍵にすると、本文を書き換えても更新日時を
// 触らない経路 (取り込み・直接の SQL・履歴からの復元) で古い結果を返し続ける。
// sha1 は本文 5.5MB 全部に掛けても 10ms 前後。
//
// 覚えるのはフェンスの言語と中身だけで、本文は持たない。正規表現で探す近道は
// 取らない (描画とずれる。markdown/extractFences.ts の冒頭)。
import { createHash } from 'node:crypto'
import { type CircuitFence, extractCircuitFences } from './fences'

// 覚える本文の数の上限。回路フェンスを持つノートは手元で 583 件
// (呼び出し側が hasNoCircuitFence で先に足切りする) なので、全部が収まり、
// ノートが増えても無制限には膨らまない値
export const FENCE_MEMO_LIMIT = 2000

type ParseFences = (memo: string) => CircuitFence[]

// 本文の鍵。DB の控え (fenceStore.ts の memo_circuit_fences) と同じ鍵を使う
export function memoHash(memo: string): string {
  return createHash('sha1').update(memo).digest('base64')
}

export function createFenceMemo(
  parse: ParseFences = extractCircuitFences,
  limit: number = FENCE_MEMO_LIMIT,
): (memo: string) => readonly CircuitFence[] {
  // Map は挿入順を保つので、先頭が「最も長く使われていない」本文になる
  const remembered = new Map<string, readonly CircuitFence[]>()

  return (memo) => {
    const key = memoHash(memo)
    const hit = remembered.get(key)
    if (hit !== undefined) {
      // 使ったものを末尾へ回す (捨てる順を「使われていない順」にする)
      remembered.delete(key)
      remembered.set(key, hit)
      return hit
    }
    // 呼び出し側が配列を書き換えると、次に同じ本文を引いた人まで壊れる
    const fences = Object.freeze(parse(memo))
    remembered.set(key, fences)
    if (remembered.size > limit) {
      const oldest = remembered.keys().next().value
      if (oldest !== undefined) {
        remembered.delete(oldest)
      }
    }
    return fences
  }
}

// プロセスで 1 つ。一覧と同期が同じ記憶を分け合う。
//
// **globalThis に置くのが要点。** Next は route handler (同期の口) とページ
// (検索) を別々に束ねるので、モジュールの変数のままだと記憶が 2 つになる。
// 本番では同期が 490 件を解析した直後の検索でも、回路図サムネに 1.4 秒
// かかっていた (docs/118 §0-5)。perfSwitch.ts・buffer.ts と同じ置き方
const globalForFenceMemo = globalThis as unknown as {
  qrNoteFenceMemo?: (memo: string) => readonly CircuitFence[]
}

export const circuitFencesOf = (globalForFenceMemo.qrNoteFenceMemo ??= createFenceMemo())
