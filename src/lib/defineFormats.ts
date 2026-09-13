// 形式 (拡張子) の一覧と、正規表現に埋める選択肢を 1 回で作る
// (audioFormats.ts・videoFormats.ts・textFormats.ts が使う)。
//
// list は受け取った配列そのもの。`as const` で渡せば要素がリテラル型のまま
// 残るので、`(typeof list)[number]` で形式名の型を作れる。
//
// alternation は "mp3|m4a|wav|webm" のような文字列で、保存名の正規表現
// (uploads/names.ts の uuidNamePattern) に埋める。拡張子は英数字だけなので
// 正規表現のエスケープは要らない (増やすときもその範囲に収めること)
export function defineFormats<const T extends readonly string[]>(
  list: T,
): { readonly list: T; readonly alternation: string } {
  return { list, alternation: list.join('|') }
}
