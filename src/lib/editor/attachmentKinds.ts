// 編集画面が添付として受け取るファイルの種類の判定 (docs/93-リファクタリング計画.md §5-1)。
//
// ファイル選択ダイアログの絞り込み (accept)・ペースト/ドロップで拾うかの判定・
// 保存後の URL から本文に書く記法を決める振り分けを、ここ 1 か所に置く。
// どれも「クライアントが**入口で**どこまで受けるか」の話で、最終的な形式判定は
// サーバが中身を見て行う (uploads.ts の sniff*)。
//
// 形式の一覧そのもの (拡張子) は audioFormats / videoFormats / textFormats が
// 唯一の出どころ。ここは MIME の別名や入力側の拡張子を足して受け口を作る。

import { AUDIO_EXTENSION_ALTERNATION } from '@/lib/audioFormats'
import { TEXT_EXTENSION_ALTERNATION } from '@/lib/textFormats'
import { VIDEO_EXTENSION_ALTERNATION } from '@/lib/videoFormats'

// ファイル選択ダイアログの絞り込み。MIME に加えて拡張子も併記するのは、
// iOS/一部 OS が HEIC の MIME を空で送ることがあり、MIME だけだと選べないため。
// HEIC/HEIF・TIFF はサーバが保存時に WebP へ変換する (docs/26-画像形式対応計画.md)。
// 最終的な形式判定はサーバの sniffImageFormat が中身を見て行う
const ACCEPTED_IMAGE_TYPES =
  'image/png,image/jpeg,image/gif,image/webp,image/avif,image/heic,image/heif,image/tiff,.png,.jpg,.jpeg,.gif,.webp,.avif,.heic,.heif,.tif,.tiff'

// 音声 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。mp3/m4a/wav/webm を受け付ける。
// audio/x-m4a は一部ブラウザが m4a に付ける別名。webm はブラウザ内録音の
// 出力形式で、ファイル選択からも受ける。最終判定はサーバの
// sniffAudioFormat が中身を見て行う (音声トラックだけの webm しか通らない)
const ACCEPTED_AUDIO_TYPES =
  'audio/mpeg,audio/mp4,audio/wav,audio/x-m4a,audio/webm,.mp3,.m4a,.wav,.webm'

// 動画 (41-QR-search/docs/14-動画挿入計画.md)。mp4/webm/mov を受け付ける。iOS カメラロールは
// .mov (QuickTime)、Android の録画は .webm。最終判定はサーバの sniffVideoFormat が
// 中身を見て行う (映像トラックを持つものだけが動画として通る)。webm 動画は
// 保存時に .mkv へ写す (videoFormats.ts の経緯) が、ここは**入力**の受け口なので
// ユーザーのファイル名 (.webm) と MIME を併記する
const ACCEPTED_VIDEO_TYPES =
  'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov,.mkv,.3gp'

// PDF (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。表示はブラウザ内蔵ビューアに任せ、
// 本文にはリンクだけを出す
const ACCEPTED_PDF_TYPES = 'application/pdf,.pdf'

// テキスト系 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。**MIME も併記する** —
// iOS の file picker は accept の各項目を UTI に変換して照合し、`.md` には
// iOS 標準の UTI が無いため、拡張子だけだと Evernote 等から渡る .md が
// どれにも一致せずグレーアウトする。`text/plain` (= public.plain-text) を
// 足すと、plain-text 系として型付けされた .md が選べるようになる。
// これで拡張子なしのテキストも選べてしまうが、対象外は ignoredFilesMessage と
// サーバの拒否メッセージがちゃんと知らせるので無反応にはならない
const ACCEPTED_TEXT_TYPES = 'text/plain,text/csv,text/markdown,.txt,.csv,.md'

export const ACCEPTED_FILE_TYPES = `${ACCEPTED_IMAGE_TYPES},${ACCEPTED_AUDIO_TYPES},${ACCEPTED_VIDEO_TYPES},${ACCEPTED_PDF_TYPES},${ACCEPTED_TEXT_TYPES}`

// ペースト/ドロップで拾う画像の判定。MIME が image/* のもの、または
// 対応拡張子を持つもの (MIME を空で送る HEIC 対策)。実体の検査はサーバが行う
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|tiff?)$/i

// 音声の判定。MIME が audio/* のもの、または対応拡張子を持つもの。
const AUDIO_EXT_RE = new RegExp(`\\.(?:${AUDIO_EXTENSION_ALTERNATION})$`, 'i')

// 動画の入力判定。ペースト/ドロップ/ファイル選択で拾う。MIME が video/* の
// もの、または動画の入力拡張子。**保存名の拡張子 (VIDEO_EXTENSION_ALTERNATION =
// mp4|mkv|mov) とは別**で、こちらはユーザーが持つファイル名 (.webm 等) を拾う。
const VIDEO_INPUT_EXT_RE = /\.(?:mp4|m4v|webm|mov|mkv|3gp)$/i

// 保存後の URL から動画と判る拡張子 (attachmentKind / 表示の振り分け用)。
// サーバが付ける保存名の拡張子 (mp4|mkv|mov)。
const VIDEO_URL_EXT_RE = new RegExp(
  `\\.(?:${VIDEO_EXTENSION_ALTERNATION})$`,
  'i',
)

const PDF_EXT_RE = /\.pdf$/i

// テキストの判定は**拡張子だけ**で行う。音声や PDF と違って MIME で広めに
// 拾わないのは、サーバが受ける条件がまさに「名前が txt/csv/md であること」
// だから (uploads/sniff/text.ts の textSaveInfo)。ここで広く拾うと、選べたのに 400 で
// 断られるものが出てしまう
const TEXT_EXT_RE = new RegExp(`\\.(?:${TEXT_EXTENSION_ALTERNATION})$`, 'i')

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXT_RE.test(file.name)
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_INPUT_EXT_RE.test(file.name)
}

// サムネ (静止 poster + 動くサムネのコマ) を作りに行くか。**MIME が video/* の
// ときだけ**にする — .webm は音声と拡張子を共有するので、名前だけで判ると音声
// webm でも 5 秒待って空フレームを作る無駄が出る。録画・実際の動画ファイルは
// video/* が付く。
export function shouldMakeThumbs(file: File): boolean {
  return file.type.startsWith('video/')
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || PDF_EXT_RE.test(file.name)
}

export function isTextFile(file: File): boolean {
  return TEXT_EXT_RE.test(file.name)
}

// アップロード対象に拾うファイル (画像・音声・動画・PDF・テキスト)。
export function pickFiles(
  list: ArrayLike<File> | undefined | null,
): File[] {
  return Array.from(list ?? []).filter(
    (f) =>
      f.type.startsWith('image/') ||
      IMAGE_EXT_RE.test(f.name) ||
      isAudioFile(f) ||
      isVideoFile(f) ||
      isPdfFile(f) ||
      isTextFile(f),
  )
}

// 拾わなかったファイルがあれば、その知らせの文を返す (無ければ null)。
//
// pickFiles は対応外を黙って捨てるので、**何も起きない**状態になる。
// 「選んだのに入らない」はエラーですらないぶん原因を探しようがなく、
// 対応形式が増えるほど踏みやすい (.json や .log はテキストに見える)
export function ignoredFilesMessage(
  list: ArrayLike<File> | undefined | null,
  picked: readonly File[],
): string | null {
  const ignored = Array.from(list ?? []).filter((f) => !picked.includes(f))
  if (ignored.length === 0) {
    return null
  }
  return `対応していない形式のため挿入しませんでした: ${ignored
    .map((f) => f.name)
    .join('、')}`
}

// PDF・テキストは元のファイル名を画像記法の alt に残す。UUID 名では中身が
// 判らないうえ、本文に入れておけば PGroonga の全文検索でファイル名から引ける。
// `]` と改行は画像記法そのものを壊すので落とす (URL 側はサーバ発番の UUID)。
export function attachmentAltText(fileName: string, fallback: string): string {
  const cleaned = fileName.replace(/[[\]\r\n]/g, '').trim()
  return cleaned.length > 0 ? cleaned : fallback
}

export type AttachmentKind = 'image' | 'audio' | 'video' | 'pdf' | 'text'

// 保存された添付の種類を**保存後の URL の拡張子**から決める。
//
// 元 File の MIME や名前では決めない。何として保存するかを決めるのは中身を見た
// サーバで、クライアントの申告ではないため (拡張子を偽装したファイルはここで
// 食い違う)。MarkdownView も同じく URL の拡張子で描き分けるので、
// **本文に書く記法と表示の振り分けが必ず一致する**
export function attachmentKind(url: string): AttachmentKind {
  if (AUDIO_EXT_RE.test(url)) {
    return 'audio'
  }
  // 保存名の拡張子 (mp4|mkv|mov)。音声の .webm とは重ならない (VideoFormat の
  // webm 動画は .mkv で保存される)
  if (VIDEO_URL_EXT_RE.test(url)) {
    return 'video'
  }
  if (PDF_EXT_RE.test(url)) {
    return 'pdf'
  }
  if (TEXT_EXT_RE.test(url)) {
    return 'text'
  }
  return 'image'
}

// alt が空になったときの表示名 (MarkdownView の既定ラベルと揃える)
export const KIND_FALLBACK: Record<'pdf' | 'text', string> = {
  pdf: 'PDF',
  text: 'テキスト',
}

// 種類ごとに呼び手が決める alt (録音・録画は日時、お絵かきは描いた日時)
export interface AttachmentAlts {
  audio: string
  video: string
  image: string
}

// 画像記法に入れる alt を決める。
//
// 音声は ![audio](url)、動画は ![video](url)、PDF・テキストは
// ![ファイル名.pdf](url) で挿入し、MarkdownView が src の拡張子を見て
// <audio> / <video> / ビューアに振り分ける。画像は従来どおり ![](url)
export function attachmentAlt(
  kind: AttachmentKind,
  fileName: string,
  alts: AttachmentAlts,
): string {
  if (kind === 'pdf' || kind === 'text') {
    return attachmentAltText(fileName, KIND_FALLBACK[kind])
  }
  return alts[kind]
}
