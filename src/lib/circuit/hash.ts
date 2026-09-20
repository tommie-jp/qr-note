// 回路図 SVG キャッシュの主キーと、出力 SVG の検査 (docs/93-リファクタリング計画.md §2-2)。
//
// 描画の本体 (circuit/circuitikz.ts) から切り出した純粋関数だけを置く。あちらは
// node:child_process で TeX を起動するので、鍵を計算したいだけの読み手
// (circuit/thumbs.ts・offline/syncItems.ts) まで子プロセスの
// 起動部を抱え込まないようにする。**このファイルに child_process や prisma を
// 足さないこと** (node:crypto だけを使う)

import 'server-only'
import { createHash } from 'node:crypto'

// キャッシュキーに混ぜるレンダラの版。
// node-tikzjax の更新やプリアンブル (circuit/circuitikz.ts) の変更で出力が変わったら手で上げる
// (上げ忘れると古い SVG が返り続ける)
export const RENDERER_VERSION = 'tikzjax-1.0.5-2'

// 本文 + レンダラ版から決まる、キャッシュの主キー。
//
// **改行コードは揃えてから混ぜる** (docs/85-回路図表示待ち計画.md §6)。
// 同じ図の同じソースが、経路によって CRLF と LF の 2 通りで届く:
//   - 閲覧 … DB の本文そのまま (取り込んだファイルが CRLF ならそのまま残る)
//   - 編集のライブプレビュー … CodeMirror が読み書きする時点で LF に揃う
// TeX の出力は改行コードに依らず 1 バイトも変わらない (実測: 同じ SVG の
// md5 が一致) のに、混ぜると別の鍵になり同じ図を 2 度描いて 2 行溜める。
// いちばん高い処理を丸ごと二重に払っていた
export function circuitHash(source: string, version = RENDERER_VERSION): string {
  const normalized = source.replace(/\r\n?/g, '\n')
  return createHash('sha256').update(`${version}\n${normalized}`).digest('hex')
}

// 出力 SVG の検査は markdown/safeSvg.ts に移した。実体配線図 (breadboard /
// perfboard) はブラウザで描くので、`server-only` のこのファイルからは呼べない
// (docs/97)。**綴りは変えずに再輸出する** — 呼び手 (circuit/cache.ts・yaml.ts・
// circuitikz.ts・thumbs.ts) と試験はそのままで、検査の実体は 1 つに保つ。
export { assertSafeSvg as assertSafeCircuitSvg } from '../markdown/safeSvg'
