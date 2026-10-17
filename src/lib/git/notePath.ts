import { isLegacyItemNo, isValidItemId } from '@/lib/validation'

// リポジトリ内でノート本文が置かれる相対パス (docs/57-ノートgit履歴計画.md §2)。
//
// **git へ渡すパスはこの関数だけが作る**。isValidItemId (UUID の小文字表記)
// を通った itemId しかファイル名にしないことで、パス区切り・`..`・先頭 `-`
// (オプションと誤読される) が git コマンドへ届かないことをここで確約する。
// itemId は URL やフォームから来る値なので、呼ぶ側の検証を当てにしない。
export function noteFilePath(itemId: string): string {
  if (!isValidItemId(itemId)) {
    throw new Error(`itemId が不正です: ${itemId}`)
  }
  return `notes/${itemId}.md`
}

// 移行前の名前 notes/<旧番号>.md (docs/107 §4-1)。改名の前の版を読むときだけ使う。
// 旧番号の形 ([0-9A-Za-z_-]) を通ったものしか作らないのは noteFilePath と同じ理由
export function legacyNoteFilePath(itemNo: string): string {
  if (!isLegacyItemNo(itemNo)) {
    throw new Error(`旧番号が不正です: ${itemNo}`)
  }
  return `notes/${itemNo}.md`
}

// URL から受け取ったコミット oid の書式検査。40 桁 hex の完全一致だけを
// 通すことで、`HEAD` や `--all` のような別解釈がリビジョン指定へ紛れ込む
// 余地をなくす (履歴一覧が返した oid をそのまま持ち回る前提)。
export function isValidCommitOid(oid: string): boolean {
  return /^[0-9a-f]{40}$/.test(oid)
}
