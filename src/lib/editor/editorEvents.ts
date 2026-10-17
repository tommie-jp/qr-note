// 編集フォームの中だけで使う DOM イベント (docs/87-編集競合対策計画.md §3-3)。
//
// 競合バナーは MemoEditor が持つが、揃え直したいもの (UnsavedGuard の比較基準)
// はフォームの別の所に居る。context を増やして親子を結び直すより、
// **フォームを土俵にした DOM イベント**のほうが結線が浅く済む — どちらも
// 同じ form の子孫であることが唯一の前提。
// (かつては /edit の url / mode を揃える ADOPT_SERVER_EVENT もあったが、
// url 列の廃止 (docs/110) で要らなくなった)

// 本文をサーバ値へ揃え直した。UnsavedGuard が「保存済みの内容」を取り直す
export const MEMO_BASELINE_EVENT = 'qr:memo-baseline'
