// 一覧に出たノートの本文を、手すきの時間に先に解析しておく (docs/123 §11-4)。
//
// 端末で描くようになって、ノートを開く重さの大半は本文の解析になった
// (CPU の遅い端末ほど効く)。一覧が届いたら上から順に、1 回の手すきに 1 件ずつ
// 解析して木を覚える (markdownTree.ts)。押したときは覚えた木から描くだけになる。
//
// 打鍵や描画を邪魔しないよう、手すきが無ければ待つ。Safari は
// requestIdleCallback を持たないので setTimeout に倒す
import 'client-only'
import { warmNoteBody } from '@/components/markdown/NoteBody'

// 先に解析するのは上から何件まで。見えている所と、その少し先
export const WARM_NOTE_LIMIT = 10
const FALLBACK_DELAY_MS = 80

const warmed = new Set<string>()

type Cancel = () => void

function whenIdle(run: () => void): Cancel {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(run, FALLBACK_DELAY_MS)
  return () => window.clearTimeout(id)
}

export function warmNotes(memos: readonly string[]): Cancel {
  const queue = memos.slice(0, WARM_NOTE_LIMIT).filter((memo) => !warmed.has(memo))
  let cancel: Cancel = () => {}
  const step = () => {
    const memo = queue.shift()
    if (memo === undefined) {
      return
    }
    try {
      warmNoteBody(memo)
      warmed.add(memo)
    } catch (error) {
      // 先読みの失敗は開いたときにもう一度起きて、そこで画面に出る
      console.warn('ノートの先読みに失敗しました', error)
    }
    cancel = whenIdle(step)
  }
  cancel = whenIdle(step)
  return () => cancel()
}
