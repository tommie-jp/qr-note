// 回路図の SVG 文字列を <img src> に渡す data URL にする (docs/122 §10-2)。
//
// base64 にしないのは、SSR の HTML と Flight payload の両方に載る重さを
// 増やさないため (base64 は 4/3 倍)。逃がすのは URL として壊れる文字だけ:
//   # %      … 断片 (#) と符号 (%) の始まりに読まれる
//   < > "    … src 属性の中での見た目の崩れを避ける (React も " は逃がすが揃える)
//   \r \n \t … URL の解析で黙って捨てられ、<text> の中身が詰まる
// 日本語などの非 ASCII はそのまま (文書は UTF-8 で、ブラウザが符号化する)。
// 素の空白も残す — data URL の本文では捨てられない
const UNSAFE = /[#%<>"\r\n\t]/g

const escape = (c: string): string =>
  `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${svg.replace(UNSAFE, escape)}`
}
