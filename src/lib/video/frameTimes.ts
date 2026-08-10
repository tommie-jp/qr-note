// 動くサムネ用に動画のどこからコマを抜くかを決める
// (docs/72-動画アニメサムネ計画.md §Phase2)。
//
// videoPoster.ts (DOM を触る側) から切り出した純関数。<video> の実体が無いと
// 動かない部分と、時刻の決め方そのものを分けておくと、後者だけをテストできる
// (lib/progress を uploadImageXhr から分けているのと同じ流儀)。

// 先頭コマの位置 (秒)。
//
// 0 秒ちょうどにしないのは、冒頭がフェードイン・黒コマのことがあるため
// (13-kick-work の POSTER_SEEK_SEC と同じ考え方)。静止 poster もここから
// 描くので、シークが 1 回で済むという実利もある。
export const FIRST_FRAME_SEC = 0.1

// これより短い動画では動くサムネを作らない (秒)。
//
// 1 秒に満たないと、どこから抜いてもほぼ同じ絵が並ぶだけで、静止サムネとの
// 違いが出ない。作るだけ転送量と生成時間の無駄になる。
export const MIN_ANIM_DURATION_SEC = 1

// 末尾コマの位置 (尺に対する割合)。
//
// 終端ちょうどを狙わないのは、最終フレームがデコードできない動画があり、
// 端末によってはシークが返ってこないため。手前に寄せておけば必ず絵がある。
const LAST_FRAME_RATIO = 0.98

// 動画全体を等間隔に割ったコマの時刻 (秒) を返す。作らないときは空配列。
//
// **冒頭を連写するのではなく全体から抜く**のが要点。13-kick-work の切り抜きは
// 「冒頭 3 秒を 8fps で連写」だが、あちらは ffmpeg で連続デコードできる配信の
// 切り抜きだった。こちらはブラウザのシークでコマを取るので、枚数がそのまま
// コストになる。同じ枚数を使うなら、全体に散らしたほうが「何が写っているか」が
// 伝わる (手元の記録は冒頭が支度の時間であることが多い)。
export function frameTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration < MIN_ANIM_DURATION_SEC) {
    return []
  }
  if (count < 2) {
    return []
  }
  const last = duration * LAST_FRAME_RATIO
  if (last <= FIRST_FRAME_SEC) {
    return []
  }
  const step = (last - FIRST_FRAME_SEC) / (count - 1)
  return Array.from({ length: count }, (_, i) => FIRST_FRAME_SEC + i * step)
}
