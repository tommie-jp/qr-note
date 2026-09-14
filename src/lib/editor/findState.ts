// ノート内検索の帯が持つ値と、開くとき・飛ぶときの小さな計算
// (docs/76-ノート内検索計画.md、docs/93-リファクタリング計画.md §5-1)。
//
// 一致の数え方・置換の計画は components/editor/noteSearch.ts (EditorState を見る側)。
// ここは帯そのものの値と、DOM の寸法を受け取って余白を返すだけの純関数。

// 帯の値。閉じても捨てずに残す — 同じ語を続けて探すことが多い
export interface FindState {
  search: string
  replace: string
  caseSensitive: boolean
  showReplace: boolean
}

export const EMPTY_FIND: FindState = {
  search: '',
  replace: '',
  caseSensitive: false,
  showReplace: false,
}

// 検索語に引き継ぐ選択範囲の上限。長い範囲や複数行を入れても帯には収まらず、
// 消してから打ち直す手間が増えるだけ
export const FIND_SEED_MAX = 50

// 一致へ飛ぶときに、下部バーとソフトキーボードの上に空けておく余白 (px)。
// 帯の高さは実測 (置換行の有無で変わる) し、これは「その少し上」ぶん
export const FIND_SCROLL_GAP = 16

// 帯を開くときの検索語。選んでからボタンを押したなら、その語を初期値にする
// (短い 1 行のときだけ)。そうでなければ直前の語を残す (§2)
export function findSeed(selected: string, previous: string): string {
  return selected.length > 0 &&
    selected.length <= FIND_SEED_MAX &&
    !selected.includes('\n')
    ? selected
    : previous
}

// 帯とソフトキーボードのぶんだけ、一致の下に空ける余白 (§6)。
//
// iOS はキーボードでレイアウトの高さを変えない (visualViewport だけが縮む)。
// その差がキーボードの高さ。visualViewport が無い環境では 0 とみなす
export function findScrollMargin(
  barHeight: number,
  innerHeight: number,
  visualViewportHeight: number | null,
): number {
  const keyboard =
    visualViewportHeight === null
      ? 0
      : Math.max(0, innerHeight - visualViewportHeight)
  return barHeight + keyboard + FIND_SCROLL_GAP
}
