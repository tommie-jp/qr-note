// catch で受けた値を画面・応答に出す 1 文にする (docs/93-リファクタリング計画.md §3-2)。
//
// throw されるのは Error とは限らない (文字列・DOMException 以外の値・
// ライブラリの独自オブジェクト)。Error ならその message を使い、そうでなければ
// 呼び出し側の決まり文句 (fallback) を出す。fallback を省くと値を String() した
// ものを出す — 「何が投げられたか」をそのまま見せたい開発者向けの表示用。
//
// message が空の Error もそのまま空文字を返す。空を決まり文句へ倒したい所
// (secret/ の message()) は条件が違うので、ここへは寄せていない
export function errorText(error: unknown, fallback?: string): string {
  if (error instanceof Error) {
    return error.message
  }
  return fallback ?? String(error)
}
