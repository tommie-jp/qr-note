import { isValidItemNo } from '@/lib/validation'

// リポジトリ内でノート本文が置かれる相対パス (docs/57-ノートgit履歴計画.md §2)。
//
// **git へ渡すパスはこの関数だけが作る**。isValidItemNo ([0-9A-Za-z_-]{1,20})
// を通った itemNo しかファイル名にしないことで、パス区切り・`..`・先頭 `-`
// (オプションと誤読される) が git コマンドへ届かないことをここで確約する。
// itemNo はユーザー由来の文字列 PK なので、呼ぶ側の検証を当てにしない。
export function noteFilePath(itemNo: string): string {
  if (!isValidItemNo(itemNo)) {
    throw new Error(`itemNo が不正です: ${itemNo}`)
  }
  return `notes/${itemNo}.md`
}

// URL から受け取ったコミット oid の書式検査。40 桁 hex の完全一致だけを
// 通すことで、`HEAD` や `--all` のような別解釈がリビジョン指定へ紛れ込む
// 余地をなくす (履歴一覧が返した oid をそのまま持ち回る前提)。
export function isValidCommitOid(oid: string): boolean {
  return /^[0-9a-f]{40}$/.test(oid)
}
