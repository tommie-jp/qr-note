// console の引数を 1 行の文字列にする。サーバ側 (logging/buffer.ts) と
// ブラウザ側 (logging/clientCapture.ts) が同じ整形を使うためここに置く。

import { LOG_TEXT_LIMIT } from './entry'

// 色付けなどの ANSI エスケープ (CSI シーケンス)。
//
// WASM の中身 (onnxruntime / OpenCV) は端末に出す前提で色を付けて stderr に
// 書き、それが console 経由でここへ来る。画面では色にならず `[0;93m` の
// ような文字列として本文に混ざり、肝心の中身が読めなくなる (実機で確認)。
//
// ESC (\u001B) で始まるものだけを落とす。`[W:onnxruntime:]` のような、
// エスケープではない角括弧は本文の一部なので残す。
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}

// Error は message だけ採る (stack は 1 行の一覧では読めない。詳細は
// docker compose logs / eruda に残っている)。文字列化に失敗する値
// (循環参照など) は String() に落とす — 拾う側の失敗でログ自体を落とさない
export function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return stripAnsi(arg)
  }
  if (arg instanceof Error) {
    return stripAnsi(arg.message)
  }
  try {
    return stripAnsi(JSON.stringify(arg))
  } catch {
    return stripAnsi(String(arg))
  }
}

export function formatLogArgs(args: unknown[]): string {
  return args.map(formatLogArg).join(' ').slice(0, LOG_TEXT_LIMIT)
}
