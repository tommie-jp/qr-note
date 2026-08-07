// エクスポート ZIP の中の配置 (docs/28-エクスポート計画.md §1)。
//
//   notes/<itemNo>.md   … frontmatter + 本文
//   images/<保存名>      … 添付をそのままファイル化
//
// **書くときと読むときで同じ規則を使う**のがこのファイルの役目。エクスポートが
// 組み立てたパスをインポートが読み違えると、書き出したものを戻せなくなる。
//
// 読む側 (classifyEntry) は防波堤も兼ねる。ZIP の項目名は書き手が自由に
// 決められるので、`../` や `notes/sub/` のような形はここで断つ。

import { isValidAttachmentName } from '@/lib/uploads'
import { isValidItemNo } from '@/lib/validation'

const NOTES_DIR = 'notes'
const IMAGES_DIR = 'images'
const NOTE_EXT = '.md'

// 書き出しの覚え書き (docs/28 §1)。どの版がいつ書き出したかを ZIP 自身に
// 残しておくためのもので、**取り込みは中身を要求しない** — 旧い ZIP にも
// 手で組んだ vault にも無いので、無ければ無いで読む
export const META_ENTRY_PATH = 'export.json'

// ノート 1 件のパス。
//
// git 履歴 (lib/git/notePath.ts) も同じ `notes/<itemNo>.md` を使うが、**意図して
// 別に持つ**。あちらはリポジトリの内部配置、こちらは外へ出す公開フォーマットで、
// 片方の都合 (階層を分ける等) がもう片方を黙って変えてはならない。
export function noteEntryPath(itemNo: string): string {
  // itemNo は Ver1 由来の文字列 PK = 利用者由来の文字列。呼ぶ側の検証を
  // 当てにせず、ファイル名にする直前でもう一度確かめる
  if (!isValidItemNo(itemNo)) {
    throw new Error(`itemNo が不正です: ${itemNo}`)
  }
  return `${NOTES_DIR}/${itemNo}${NOTE_EXT}`
}

// 添付 1 件のパス。保存名 (UUID + 拡張子) はそのまま使う — 名前を変えると
// 本文の参照 (../images/<名前>) と食い違い、戻したときに画像が割れる。
export function attachmentEntryPath(name: string): string {
  if (!isValidAttachmentName(name)) {
    throw new Error(`添付の保存名が不正です: ${name}`)
  }
  return `${IMAGES_DIR}/${name}`
}

export type EntryKind =
  | { kind: 'note' }
  | { kind: 'attachment'; name: string }
  // 書き出しの覚え書き (export.json)。取り込みでは中身を使わないが、
  // **「このアプリが書き出した ZIP だ」という印**にはなる
  | { kind: 'meta' }
  // ディレクトリ項目など、読み飛ばしてよいもの
  | { kind: 'skip' }
  | { kind: 'reject'; reason: string }

// ZIP の項目名を振り分ける。**許すものだけを書く**方針で、想定外は理由を付けて
// 断る (黙って読み飛ばすと「入ったつもりで入っていない」が起きる)。
export function classifyEntry(path: string): EntryKind {
  // 覚え書きは直下に 1 枚だけ。**下の「notes/ と images/ の外」より先に見る**
  if (path === META_ENTRY_PATH) {
    return { kind: 'meta' }
  }

  // ディレクトリ項目は ZIP の構造でしかない (中身を持たない)
  if (path.endsWith('/')) {
    return path === `${NOTES_DIR}/` || path === `${IMAGES_DIR}/`
      ? { kind: 'skip' }
      : { kind: 'reject', reason: '想定していないフォルダです' }
  }

  const slash = path.indexOf('/')
  const dir = slash === -1 ? '' : path.slice(0, slash)
  const rest = slash === -1 ? path : path.slice(slash + 1)

  // 直下のみ許す。`notes/sub/x.md` も `../notes/x.md` もここで外れる
  if (rest.includes('/')) {
    return { kind: 'reject', reason: 'フォルダの入れ子は読み込めません' }
  }

  if (dir === NOTES_DIR) {
    // 拡張子だけ見る。ファイル名は目印でしかなく、itemNo の正本は
    // frontmatter 側にある (手書きの Markdown を受けるため)
    return rest.endsWith(NOTE_EXT)
      ? { kind: 'note' }
      : { kind: 'reject', reason: `${NOTES_DIR}/ に置けるのは ${NOTE_EXT} だけです` }
  }

  if (dir === IMAGES_DIR) {
    // 保存名は配信 URL (/api/images/<名前>) に組み立てる値。ZIP から来た
    // 文字列をそのまま信じない
    return isValidAttachmentName(rest)
      ? { kind: 'attachment', name: rest }
      : { kind: 'reject', reason: '添付の保存名が書式外です' }
  }

  return {
    kind: 'reject',
    reason: `${NOTES_DIR}/ と ${IMAGES_DIR}/ の外にあります`,
  }
}
