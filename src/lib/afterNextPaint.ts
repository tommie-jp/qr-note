// 次の描画が画面に出た後で fn を呼ぶ。戻り値を呼ぶと取り消す。
//
// requestAnimationFrame は描画の直前に走るので、その中から setTimeout で
// 1 手番送ると描画の後になる。描画の直後の effect で getComputedStyle や
// scrollHeight を読むと、ブラウザはスタイル・レイアウトを前倒しで強制し、
// 最初の 1 枚が遅れる (docs/122 §10-2、AutoLoadMore で 16ms)。描画の後なら
// 計算は済んでいて、読むのはほぼ只になる。
//
// 裏のタブでは rAF が止まるので、表に戻るまで呼ばれない。急ぎでない
// 下ごしらえ (スクロールの監視の取り付けなど) にだけ使う
export function afterNextPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0)
  })
  return () => {
    cancelAnimationFrame(frame)
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}
