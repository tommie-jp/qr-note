// 保存の結果のうち、**画面に返す分**の形 (docs/87-編集競合対策計画.md §3-1)。
//
// 成功はリダイレクトして終わるので、ここに来るのは競合したときだけ。
// Server Action の戻り値として useActionState が受け取り、MemoEditor が
// バナーを出す材料にする。
//
// **client からも import されるので、DB (prisma) を引っぱる物は置かない。**
// items.ts の SaveOutcome を直接使わないのはそのため — 型だけのつもりでも
// 値の import が 1 本混ざれば、編集画面のバンドルに prisma が落ちてくる。

import type { Mode } from '@/lib/validation'

// 競合したとき「いまサーバにある版」。差分表示と「読み込む」で使う
export interface ConflictServerNote {
  memo: string
  url: string
  mode: Mode
  // ミリ秒。次の保存の基点になる (formatBase と同じ土俵)
  updatedAt: number
  // ゴミ箱の行と衝突したときだけ非 null。TrashedBanner はサーバ描画なので、
  // 値だけ返すこの経路では出ない。バナー側で言い添えるために持つ
  deletedAt: number | null
}

export type SaveState =
  | null
  | {
      // conflict = 別の書き込みが先にあった / exists = 新規のはずが行があった /
      // missing = 編集中に永久削除された / checkpointFailed = 上書きの前に
      // 消える版を履歴へ刻めなかった (だから上書きしていない)
      kind: 'conflict' | 'exists' | 'missing' | 'checkpointFailed'
      // Date.now()。同じ結果を 2 度処理しないための印 (バナーの既読管理)。
      // 連続で同じ競合に当たっても毎回出す
      seq: number
      // missing のときだけ null
      server: ConflictServerNote | null
    }

// Item をそのまま返さない — 派生列 (tags/props) やバイト列を画面へ渡す
// 理由がなく、client 境界を渡る物は小さいほどよい
export function noteSnapshot(item: {
  memo: string
  url: string
  mode: Mode
  updatedAt: Date
  deletedAt: Date | null
}): ConflictServerNote {
  return {
    memo: item.memo,
    url: item.url,
    mode: item.mode,
    updatedAt: item.updatedAt.getTime(),
    deletedAt: item.deletedAt === null ? null : item.deletedAt.getTime(),
  }
}
