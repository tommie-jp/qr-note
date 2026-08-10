import { isDemoMode } from './appEnv'
import {
  type AudioFormat,
  AUDIO_EXTENSION_ALTERNATION,
} from './audioFormats'
import {
  TEXT_EXTENSION_ALTERNATION,
  TEXT_EXTENSIONS,
  type TextFormat,
} from './textFormats'
import { VIDEO_EXTENSION_ALTERNATION } from './videoFormats'

// 保存できる画像形式 (final mime) → 拡張子。
// これは「そのまま DB に保存できる = ブラウザが表示できる」形式の表。
// HEIC/HEIF・TIFF は保存時に WebP へ変換するのでここには無い
// (変換後の image/webp として入る。docs/26-画像形式対応計画.md §2)。
// SVG はスクリプトを埋め込めるため対応しない。
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// 動画だけは別枠で大きい上限を持つ (docs/14-動画挿入計画.md)。3 分・720p・
// 映像 1Mbps + 音声 64kbps で約 24MB になるため、余裕を見て 30MB。画像・音声・
// PDF・テキストは従来どおり MAX_IMAGE_BYTES (10MB) のまま — 動画以外を大きく
// する理由はないので、種別で上限を分ける (判定は attachmentStore が中身を見て)。
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024

// デモインスタンスでの 1 ファイル上限 (docs/38-デモモード計画.md §5)。
// guest に書き込みを許す代わりに縮める。総量クォータは別計画だが、
// 1 枚を小さくするだけでも「ファイル置き場」化をだいぶ抑えられる。
// 動画はデモでは扱わない (2MB では成立しない。録画ボタンも出さない)。
export const DEMO_MAX_IMAGE_BYTES = 2 * 1024 * 1024

// リクエスト全体で受け入れうる 1 ファイルの上限 (= 全種別の最大)。
// checkUploadRequest の Content-Length 事前チェックと route の申告サイズ検査が
// 使う「本文を読む前の門」。動画が最大なので非デモでは MAX_VIDEO_BYTES に開く。
// **種別ごとの上限はこの後 attachmentStore が中身を見て絞る** (動画 30MB /
// それ以外 10MB)。定数ではなく関数にするのは DEMO_MODE を起動時 env で切り替える
// ため (テストも env で差せる)。デモでは動画を扱わないので従来の 2MB のまま。
export function maxUploadBytes(): number {
  return isDemoMode() ? DEMO_MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
}

// 動画以外 (画像・音声・PDF・テキスト) の 1 ファイル上限。デモでは 2MB。
// attachmentStore がスニッフ後にこの値で絞る (route はこれを渡す)。
export function maxAttachmentBytes(): number {
  return isDemoMode() ? DEMO_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES
}

// 保存ファイル名は「サーバが生成した UUID + 対応拡張子」のみ。
// クライアント由来の文字列をパスに使わないことでトラバーサルを防ぐ。
// heic/tiff は変換後に webp になるため、ここには現れない
const IMAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|avif)$/

export function extForMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null
}

export function mimeForName(name: string): string | null {
  const ext = name.split('.').pop()
  const entry = Object.entries(MIME_TO_EXT).find(([, e]) => e === ext)
  return entry ? entry[0] : null
}

export function isValidImageName(name: string): boolean {
  return IMAGE_NAME_PATTERN.test(name)
}

// アップロードで受け付ける画像形式。normalizeImage はこの値で
// 「無変換保存」か「WebP へ変換」かを振り分ける (docs/26 §2)。
export type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'heic' | 'tiff'

// offset 0 固定の先頭バイト署名。png/jpg/gif/webp/tiff はこれで判定できる。
// クライアント申告の MIME を信用せず、実際の中身から形式を決める
// (MIME を空で送る OS があり、詐称対策にもなる)
const HEAD_SIGNATURES: Array<[ImageFormat, number[]]> = [
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]], // "GIF8" (87a/89a 共通)
  ['tiff', [0x49, 0x49, 0x2a, 0x00]], // "II*\0" little-endian
  ['tiff', [0x4d, 0x4d, 0x00, 0x2a]], // "MM\0*" big-endian
]

function startsWith(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((byte, i) => bytes[i] === byte)
}

// 署名やボックス型の照合はバイトのまま行う。比較のたびに文字列へ起こさないため、
// 決め打ちの ASCII は最初に一度だけバイト列にしておく
const encodeAscii = (text: string) => new TextEncoder().encode(text)

// WebP は RIFF コンテナ: "RIFF" (0) + "WEBP" (8)
function isWebp(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte)
  )
}

// HEIC/AVIF は ISO-BMFF。offset 4 の "ftyp" ボックスに major brand と
// compatible brands が並ぶ。offset 0 固定署名では判定できないため、
// ブランド一覧を読んで種別を決める (docs/26 §4)
const AVIF_BRANDS = new Set(['avif', 'avis'])
// mif1/msf1 は HEIF 汎用ブランドで AVIF ファイルにも現れうるが、
// AVIF を先に判定するのでここに残してよい (HEVC 系の総称として扱う)
const HEIC_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
])

// ISO-BMFF の ftyp ボックスから brand 一覧 (major + compatible) を読む。
// ISO-BMFF でない・短すぎる入力は null。画像 (HEIC/AVIF) と音声 (m4a) の
// どちらもこの一覧を見て種別を決めるので、読み取り自体はここに集約する。
function readIsoBmffBrands(bytes: Uint8Array): string[] | null {
  // ボックス長(4) + "ftyp"(4) + major brand(4) の最低 12 バイトが無ければ
  // ISO-BMFF ではない。下の getUint32 が短い入力で throw しないための明示ガード
  // でもある (この関数は throw しない契約。呼び出し側は try/catch しない)
  if (bytes.byteLength < 12) {
    return null
  }
  // "ftyp" が offset 4 に無ければ ISO-BMFF ではない
  if (!startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) {
    return null
  }
  // ボックス長で compatible brands の走査範囲を縛る (壊れた長さは全長で代用)
  const declared = new DataView(
    bytes.buffer, bytes.byteOffset, bytes.byteLength,
  ).getUint32(0)
  const end = declared >= 16 && declared <= bytes.byteLength ? declared : bytes.byteLength
  const decoder = new TextDecoder('latin1')
  // major brand(8..12) と compatible brands(16..) を集める (12..16 は minor version)
  const brands: string[] = [decoder.decode(bytes.subarray(8, 12))]
  for (let off = 16; off + 4 <= end; off += 4) {
    brands.push(decoder.decode(bytes.subarray(off, off + 4)))
  }
  return brands
}

function sniffIsoBmff(bytes: Uint8Array): ImageFormat | null {
  const brands = readIsoBmffBrands(bytes)
  if (!brands) {
    return null
  }
  // AVIF を先に見る: mif1 を兼ねる AVIF を HEIC と誤判定しないため
  if (brands.some((b) => AVIF_BRANDS.has(b))) {
    return 'avif'
  }
  if (brands.some((b) => HEIC_BRANDS.has(b))) {
    return 'heic'
  }
  return null // ftyp だが画像でない (mp4 動画など)
}

// 先頭バイトから画像形式を判定する。判定できなければ null (=非対応)。
// アップロード経路・書影取得の両方がこれを唯一の入口にする
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  for (const [format, signature] of HEAD_SIGNATURES) {
    if (startsWith(bytes, signature)) {
      return format
    }
  }
  if (isWebp(bytes)) {
    return 'webp'
  }
  return sniffIsoBmff(bytes)
}

// --- 音声 (docs/12-添付ファイル種類拡張メモ.md) ---
//
// 音声は画像と違い、変換もサムネも埋め込みもしない。ブラウザが直接再生できる
// 形式 (mp3/m4a/wav) だけを受け付け、images テーブルへそのまま bytes で保存し、
// そのまま配信する。images テーブルを流用するのは、pg_dump 一発でメモと一緒に
// バックアップできる利点 (imageStore.ts) を音声にも効かせるため。

// webm はブラウザ内録音の受け皿 (docs/12「ノート内録音の実装計画」)。
// Chrome / Android の MediaRecorder は webm/opus しか出せないため、
// 録音をノートへ挿入するにはこの形式を受ける必要がある。
// 形式の一覧そのものは audioFormats.ts が持つ (表示・OCR 除外と共有するため)
export type { AudioFormat }

// 保存できる音声形式 (final mime) → 拡張子。画像の MIME_TO_EXT と同じ役割で、
// 配信時に「DB の mime を信じてよいか」の判定にも使う (未知 mime を配らない)。
// **video/webm は載せない** — 受け付けるのは音声トラックだけの webm なので、
// 動画として配信する mime は持たない。
const AUDIO_MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
}

const AUDIO_FORMAT_TO_MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
}

// 保存名は画像と同じ「UUID + 対応拡張子」だけ。拡張子は形式名がそのまま入る。
const AUDIO_NAME_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${AUDIO_EXTENSION_ALTERNATION})$`,
)

// sniff で決めた形式を、保存に使う mime / ext へ写す (mp3/m4a/wav は形式名=拡張子)。
export function audioSaveInfo(format: AudioFormat): { mime: string; ext: string } {
  return { mime: AUDIO_FORMAT_TO_MIME[format], ext: format }
}

export function isValidAudioName(name: string): boolean {
  return AUDIO_NAME_PATTERN.test(name)
}

// 画像・音声・PDF のいずれの保存名も許すか。配信ゲート (route.ts) と proxy の
// 素通し判定 (publicPaths.ts) が使う。**memoImages などの「画像だけ」を
// 拾う経路は isValidImageName のままにする** — 音声や PDF を一覧サムネや画像
// 検索の対象に混ぜないため (この 2 つを分けているのが肝)。
export function isValidAttachmentName(name: string): boolean {
  return (
    isValidImageName(name) ||
    isValidAudioName(name) ||
    isValidVideoName(name) ||
    isValidPdfName(name) ||
    isValidTextName(name)
  )
}

// 配信時に Content-Type としてそのまま返してよい mime か。画像・音声・PDF とも
// 保存時に中身を検証済みだが、DB の値を鵜呑みにせず既知の mime のときだけ採用する。
export function isAllowedContentMime(mime: string): boolean {
  return (
    mime in MIME_TO_EXT ||
    mime in AUDIO_MIME_TO_EXT ||
    mime in VIDEO_MIME_TO_EXT ||
    mime === PDF_MIME ||
    mime in TEXT_MIME_TO_EXT
  )
}

// WAV は RIFF コンテナ: "RIFF"(0) + "WAVE"(8)
function isWav(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    [0x57, 0x41, 0x56, 0x45].every((byte, i) => bytes[8 + i] === byte)
  )
}

// MP3: ID3v2 タグ ("ID3") で始まるか、生フレームの同期語で始まる。
// 同期語は 11bit すべて 1 = 先頭 0xFF かつ次バイトの上位 3bit が立っている。
// JPEG (FF D8 …) は次バイトの上位 3bit が 110 なので当たらない (画像と衝突しない)。
function isMp3(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0x49, 0x44, 0x33])) {
    return true
  }
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
}

// m4a を名乗る ISO-BMFF ブランド。動画 (mp42/isom 単独) を音声として受けない
// よう、音声専用の M4A / M4B だけを見る。iPhone のボイスメモ (.m4a) は major
// brand が "M4A " なのでこれで拾える。他ツール由来の mp42 単独 m4a は弾かれるが、
// 動画混入を防ぐことを優先する (docs/12)。
const M4A_BRANDS = new Set(['M4A ', 'M4B '])

// ISO-BMFF のトップレベルから指定のボックスを探して中身を返す (無ければ null)。
// ボックスは [長さ(4)][型(4)][中身] の並び。長さ 1 は 64bit 拡張長 (型の直後に
// 8 バイト)、長さ 0 は「ファイル末尾まで」を意味する。
// 壊れた長さで無限ループしないよう、進めない長さを見たら諦める (throw しない)。
function findTopLevelBox(bytes: Uint8Array, type: string): Uint8Array | null {
  if (bytes.byteLength < 8) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 型はバイトのまま比べる。1 ボックスごとに文字列へ起こすと、細かいボックスを
  // 大量に並べた入力で確保だけが積み上がる
  const wanted = encodeAscii(type)
  let at = 0
  while (at + 8 <= bytes.byteLength) {
    const declared = view.getUint32(at)
    let size = declared
    let headerSize = 8
    if (declared === 1) {
      if (at + 16 > bytes.byteLength) {
        return null
      }
      size = Number(view.getBigUint64(at + 8))
      headerSize = 16
    } else if (declared === 0) {
      size = bytes.byteLength - at
    }
    if (matchesAt(bytes, at + 4, wanted, bytes.byteLength)) {
      return bytes.subarray(at + headerSize, Math.min(at + size, bytes.byteLength))
    }
    if (size < headerSize) {
      return null // 進めない長さ = 壊れている。ここで諦める
    }
    at += size
  }
  return null
}

// hdlr ボックスの並び [長さ(4)]["hdlr"(4)][version+flags(4)][pre_defined(4)]
// [handler(4)] から handler だけを集める。moov の中は入れ子 (trak > mdia > hdlr)
// なので、構造を全部たどらず "hdlr" の出現位置から直接読む。
const HDLR_TYPE = encodeAscii('hdlr')
const HDLR_HANDLER_OFFSET = 12 // "hdlr" の先頭から handler までの距離

function handlerTypesIn(moov: Uint8Array): string[] {
  const decoder = new TextDecoder('latin1')
  const handlers: string[] = []
  const limit = moov.byteLength
  for (let at = 0; at + HDLR_HANDLER_OFFSET + 4 <= limit; at++) {
    if (matchesAt(moov, at, HDLR_TYPE, limit)) {
      const from = at + HDLR_HANDLER_OFFSET
      handlers.push(decoder.decode(moov.subarray(from, from + 4)))
    }
  }
  return handlers
}

// moov のトラック構成が「音声のみ」か。ブランド名の列挙 (M4A_BRANDS) は
// 「どのブランドが来るか」の当てずっぽうになりがちで、Safari の MediaRecorder が
// 出す mp4 (iso5 系) はそこを通らない。トラックの種別で判定すればブランドに
// 依らず正しく、しかも映像トラックを持つ mp4 を確実に弾ける (docs/12)。
function hasAudioOnlyTracks(bytes: Uint8Array): boolean {
  const moov = findTopLevelBox(bytes, 'moov')
  if (!moov) {
    return false
  }
  const handlers = handlerTypesIn(moov)
  return handlers.includes('soun') && !handlers.includes('vide')
}

function sniffIsoBmffAudio(bytes: Uint8Array): AudioFormat | null {
  const brands = readIsoBmffBrands(bytes)
  if (!brands) {
    return null
  }
  // ブランドが音声を名乗る (iPhone ボイスメモ) か、moov のトラックが音声だけ
  // (Safari の録音) なら音声として受ける
  if (brands.some((b) => M4A_BRANDS.has(b))) {
    return 'm4a'
  }
  return hasAudioOnlyTracks(bytes) ? 'm4a' : null
}

// --- webm (ブラウザ内録音, docs/12) ---
//
// webm/matroska は EBML マジックで判るが、**画像や PDF と違い音声と動画で
// 同じコンテナを使う**ため、マジックだけでは動画を弾けない。「動画を音声として
// 受けない」既存方針を保つため、Tracks 要素に現れる CodecID 文字列を見て
// 「音声があり映像が無い」ものだけを受ける。
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]

// 音声 CodecID を探す範囲。MediaRecorder の出力は Tracks をヘッダ側に置くので
// 数 KB あれば足りる (実測: Chrome は offset 220、Firefox は 202)。
// ここより後ろにしか音声 CodecID が無いものは安全側に倒して拒否する。
const WEBM_AUDIO_SCAN_BYTES = 64 * 1024

const WEBM_AUDIO_CODEC_IDS = ['A_OPUS', 'A_VORBIS'].map(encodeAscii)

// 映像 CodecID。1 つでもあれば動画とみなして拒否する。
const WEBM_VIDEO_CODEC_IDS = [
  'V_VP8',
  'V_VP9',
  'V_AV1',
  'V_MPEG',
  'V_THEORA',
  'V_MS/',
].map(encodeAscii)

// マーカーの 1 バイト目を引くための表 (256 要素)。走査ループで
// 「ここから照合する価値があるか」を配列 1 回の添字引きで判定するために使う。
function leadByteTable(markers: readonly Uint8Array[]): Uint8Array {
  const table = new Uint8Array(256)
  for (const marker of markers) {
    table[marker[0]] = 1
  }
  return table
}

const WEBM_AUDIO_LEADS = leadByteTable(WEBM_AUDIO_CODEC_IDS)
const WEBM_VIDEO_LEADS = leadByteTable(WEBM_VIDEO_CODEC_IDS)

function matchesAt(bytes: Uint8Array, at: number, marker: Uint8Array, limit: number): boolean {
  if (at + marker.byteLength > limit) {
    return false
  }
  for (let i = 0; i < marker.byteLength; i++) {
    if (bytes[at + i] !== marker[i]) {
      return false
    }
  }
  return true
}

// ASCII マーカーのいずれかが bytes[0, end) にあるか。
// **文字列へ起こさない** — 10MB を latin1 文字列にすると倍のメモリを食うため、
// バイトのまま見る。1 バイト目で絞ってから照合するので 10MB でも実用的に速い。
function containsMarker(
  bytes: Uint8Array,
  markers: readonly Uint8Array[],
  leads: Uint8Array,
  end: number,
): boolean {
  const limit = Math.min(end, bytes.byteLength)
  for (let at = 0; at < limit; at++) {
    if (leads[bytes[at]] === 0) {
      continue
    }
    for (const marker of markers) {
      if (matchesAt(bytes, at, marker, limit)) {
        return true
      }
    }
  }
  return false
}

function isWebmAudio(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, EBML_MAGIC)) {
    return false
  }
  // 映像 CodecID は**ファイル全体**から探す。先頭だけ見ていると、EBML の
  // Void 要素で窓を埋めて映像トラックを走査範囲の外へ押し出せてしまう
  // (security-reviewer が PoC で実証済み: A_OPUS → 70KB の詰め物 → V_VP9)。
  // 音声側と違い、こちらは「見落とすと通してしまう」向きなので範囲を切らない。
  if (containsMarker(bytes, WEBM_VIDEO_CODEC_IDS, WEBM_VIDEO_LEADS, bytes.byteLength)) {
    return false
  }
  return containsMarker(
    bytes,
    WEBM_AUDIO_CODEC_IDS,
    WEBM_AUDIO_LEADS,
    WEBM_AUDIO_SCAN_BYTES,
  )
}

// 先頭バイトから音声形式を判定する。判定できなければ null (=非対応)。
// route.ts は画像判定 (sniffImageFormat) が外れたときにこれを試す。
export function sniffAudioFormat(bytes: Uint8Array): AudioFormat | null {
  if (isMp3(bytes)) {
    return 'mp3'
  }
  if (isWav(bytes)) {
    return 'wav'
  }
  if (isWebmAudio(bytes)) {
    return 'webm'
  }
  return sniffIsoBmffAudio(bytes)
}

// --- 動画 (docs/14-動画挿入計画.md) ---
//
// 動画は音声と同じく変換もサムネ生成もサーバではしない。ブラウザが直接再生できる
// 形式だけを受け付け、images テーブルへそのまま bytes で保存し、そのまま配信する。
// 音声のスニッフが「動画トラックを持つものを弾く」のに対し、こちらは「動画
// トラックを持つもの**だけ**を受ける」— ちょうど裏返しの判定になる。
//
// サムネイル (poster) はクライアントが先頭フレームから WebP を作って別途送り、
// thumb カラムへ入れる (サーバに ffmpeg を持ち込まない)。

// スニッフが返す**中身の形式**。保存拡張子とは分ける — webm 動画は中身は
// video/webm だが、保存名は `.mkv` に写す (videoFormats.ts の経緯: 音声のみの
// `.webm` と URL 上で衝突させない)。
export type VideoFormat = 'mp4' | 'webm' | 'mov'

const VIDEO_FORMAT_TO_MIME: Record<VideoFormat, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

// 中身の形式 → 保存名の拡張子。mp4/mov は形式名と同じ、webm 動画だけ `.mkv`。
const VIDEO_FORMAT_TO_EXT: Record<VideoFormat, string> = {
  mp4: 'mp4',
  webm: 'mkv',
  mov: 'mov',
}

// 配信時に「DB の mime を信じてよいか」の判定に使う (未知 mime を配らない)。
// キーだけを見るので値は保存拡張子でよい。
const VIDEO_MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'mkv',
  'video/quicktime': 'mov',
}

// 保存名は画像・音声と同じ「UUID + 対応拡張子」だけ (拡張子は mp4/mkv/mov)。
const VIDEO_NAME_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${VIDEO_EXTENSION_ALTERNATION})$`,
)

// sniff で決めた中身の形式を、保存に使う mime / ext へ写す。
export function videoSaveInfo(format: VideoFormat): { mime: string; ext: string } {
  return { mime: VIDEO_FORMAT_TO_MIME[format], ext: VIDEO_FORMAT_TO_EXT[format] }
}

export function isValidVideoName(name: string): boolean {
  return VIDEO_NAME_PATTERN.test(name)
}

// QuickTime (.mov) の major brand。iPhone のカメラロール由来の mov を mp4 と
// 区別して mime を付けるために見る (再生自体はどちらもブラウザ任せ)。
const QUICKTIME_BRANDS = new Set(['qt  '])

// moov のトラックに映像 (vide) ハンドラがあるか。音声の hasAudioOnlyTracks の
// 裏返しで、ブランド名に依らずトラック種別で判定する (Safari の録画が名乗る
// iso5 系ブランドでも正しく拾える)。
function hasVideoTrack(bytes: Uint8Array): boolean {
  const moov = findTopLevelBox(bytes, 'moov')
  if (!moov) {
    return false
  }
  return handlerTypesIn(moov).includes('vide')
}

function sniffIsoBmffVideo(bytes: Uint8Array): VideoFormat | null {
  const brands = readIsoBmffBrands(bytes)
  if (!brands) {
    return null
  }
  // 映像トラックを持たない ISO-BMFF (音声だけの m4a など) は動画にしない
  if (!hasVideoTrack(bytes)) {
    return null
  }
  return brands.some((b) => QUICKTIME_BRANDS.has(b)) ? 'mov' : 'mp4'
}

// EBML (webm/matroska) で、映像 CodecID を含むものを動画として受ける。
// 音声側 (isWebmAudio) が映像 CodecID を見つけたら弾くのと同じ列挙 (裏返し)。
function isWebmVideo(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, EBML_MAGIC)) {
    return false
  }
  return containsMarker(
    bytes,
    WEBM_VIDEO_CODEC_IDS,
    WEBM_VIDEO_LEADS,
    bytes.byteLength,
  )
}

// 先頭バイトから動画形式を判定する。判定できなければ null (=非対応)。
// attachmentStore は音声判定より後にこれを試す (音声のみのファイルは
// hasVideoTrack が false になり、ここでも null になるので取り違えない)。
export function sniffVideoFormat(bytes: Uint8Array): VideoFormat | null {
  if (isWebmVideo(bytes)) {
    return 'webm'
  }
  return sniffIsoBmffVideo(bytes)
}

// クライアントが送ってきた動画サムネ (poster) が信用できるか。
//
// **形式は webp に限定しない。** canvas.toBlob('image/webp') は Safari (iOS) が
// 出せず PNG/JPEG に化けるため、webp 限定だと iPhone 録画に poster が付かない
// (実機報告)。クライアントは JPEG を出し、端末によっては PNG になる。sharp が
// 読める光栅画像 (sniffImageFormat が種別を返すもの = png/jpg/webp/gif/avif/tiff)
// なら受け、attachmentStore が makeThumbnail で webp へ作り直す。SVG は
// sniffImageFormat が弾く (スクリプト混入対策) ので、ここも自動で拒否される。
// 大きさは 200KB を超えないものだけ (バッファ済みの防波堤は route 側にもある)。
export const MAX_VIDEO_THUMB_BYTES = 200 * 1024

export function isValidVideoThumb(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_VIDEO_THUMB_BYTES &&
    sniffImageFormat(bytes) !== null
  )
}

// 「動くサムネ」(docs/72-動画アニメサムネ計画.md) のためにクライアントが送る
// コマ数の上限。抽出も送信も 1 コマぶんずつ増えるので、増やすほど録画直後の
// 待ち時間と本文サイズが伸びる。8 コマ x 400ms で約 3.2 秒の紙芝居になる。
export const MAX_VIDEO_ANIM_FRAMES = 8

// コマ 1 枚の上限バイト。クライアントは 320px の JPEG を出すので実測 15〜30KB
// で収まり、80KB はその余裕分。
//
// **合計が multipart のオーバーヘッド枠 (MULTIPART_OVERHEAD_BYTES = 1MB) に
// 収まる大きさにしてある**のが要点。8 x 80KB + poster 200KB = 840KB なので、
// コマを足しても checkUploadRequest の Content-Length 検査 (動画本体の上限 +
// 1MB) に当たらない。ここを緩めるならあちらも一緒に見直すこと。
export const MAX_VIDEO_ANIM_FRAME_BYTES = 80 * 1024

// 動くサムネのコマとして受け取ってよいバイト列か。判定の考え方は
// isValidVideoThumb と同じ (中身で決める / SVG は sniffImageFormat が弾く) で、
// 上限だけが違う。
export function isValidVideoAnimFrame(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > 0 &&
    bytes.byteLength <= MAX_VIDEO_ANIM_FRAME_BYTES &&
    sniffImageFormat(bytes) !== null
  )
}

// --- PDF (docs/12-添付ファイル種類拡張メモ.md) ---
//
// PDF も音声と同じく変換もサムネも埋め込みもせず、images テーブルへそのまま
// 保存する。表示はブラウザ内蔵ビューアに任せ (本文にはリンクだけ出す)、
// 配信は音声と同じ経路 (Content-Type + Range) をそのまま使う。

export const PDF_MIME = 'application/pdf'
export const PDF_EXT = 'pdf'

// 保存名は画像・音声と同じ「UUID + .pdf」だけ (トラバーサル対策)。
const PDF_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/

export function isValidPdfName(name: string): boolean {
  return PDF_NAME_PATTERN.test(name)
}

// PDF は先頭が "%PDF-" (25 50 44 46 2D)。仕様上ヘッダは先頭 1KB 以内に
// あればよいが、ポリグロット (先頭が別形式に見える PDF) を避けるため
// offset 0 固定で見る (画像の署名判定と同じ厳しさ)。
export function sniffPdf(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
}

// --- テキスト系 (docs/12-添付ファイル種類拡張メモ.md) ---
//
// txt / csv / md。音声・PDF と同じく変換もサムネも埋め込みもせず、そのまま
// images テーブルへ保存する。違いは 2 つだけ:
//
// - **中身の判定は署名ではなく「テキストとして読めるか」** (normalizeText.ts)。
// - **保存する拡張子はクライアントの申告 (ファイル名) から決める。** 中身からは
//   txt / csv / md を区別できないため。ただし申告文字列を保存名に使うのではなく、
//   下の 3 つのいずれかへ**写す**だけなので、トラバーサルの余地は無い。
//
// 配信 mime に charset を含めるのは、保存時に必ず UTF-8 へ正規化しているから
// (normalizeText.ts)。表示側が文字コードを推測する必要が無くなる。

const TEXT_FORMAT_TO_MIME: Record<TextFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
}

// 保存できるテキスト形式 (final mime) → 拡張子。画像の MIME_TO_EXT と同じ役割で、
// 配信時に「DB の mime を信じてよいか」の判定に使う。
// **text/html はここに無い** — HTML はテキストとして読めるので判定は通るが、
// 保存名は txt に倒し text/plain で配るため、mime としては現れない。
const TEXT_MIME_TO_EXT: Record<string, string> = Object.fromEntries(
  TEXT_EXTENSIONS.map((ext) => [TEXT_FORMAT_TO_MIME[ext], ext]),
)

// 保存名は画像・音声・PDF と同じ「UUID + 対応拡張子」だけ。
const TEXT_NAME_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${TEXT_EXTENSION_ALTERNATION})$`,
)

export function isValidTextName(name: string): boolean {
  return TEXT_NAME_PATTERN.test(name)
}

// 元のファイル名から、保存に使う mime / ext を決める。txt/csv/md 以外の
// 名前なら null (= テキストとして受けない)。
//
// **知らない拡張子を txt に倒さないのが肝。** テキストには署名が無く、HTML も
// SVG も「テキストとしては妥当」なので、中身の判定だけでは何でも通ってしまう。
// 名前でも名乗らせることで、既存の「拡張子・MIME を偽装したものは弾く」
// 方針 (x.png と名乗る HTML は 400) をテキスト追加後も保てる。
//
// 申告文字列そのものは保存名に使わない。ここで既知の 3 つへ**写す**だけなので、
// トラバーサルの余地は無い。
export function textSaveInfo(
  fileName: string | null | undefined,
): { mime: string; ext: TextFormat } | null {
  // ドットのある末尾だけを拡張子とみなす。split('.').pop() だと、
  // "csv" という名前 (拡張子なし) が拡張子扱いになってしまう
  const suffix = /\.([a-z0-9]+)$/.exec((fileName ?? '').toLowerCase())?.[1]
  const ext = TEXT_EXTENSIONS.find((known) => known === suffix)
  return ext ? { mime: TEXT_FORMAT_TO_MIME[ext], ext } : null
}

// multipart のヘッダ等のオーバーヘッド分を上限に足す
export const MULTIPART_OVERHEAD_BYTES = 1024 * 1024

export interface UploadRejection {
  status: number
  error: string
}

// 本文を読む前に弾けるものだけを見る。問題なければ null。
//
// maxBodyBytes を差し替えられるのは ENEX インポート (docs/28 §4) のため。
// ENEX は 1 ファイルに全ノートと添付が入るので画像 1 枚より桁が大きい。
// **CSRF の判定はどの経路でも同じ**なので、上限だけを引数にして本体は共有する。
//
// 既定を定数ではなく maxUploadBytes() から都度求めるのは、DEMO_MODE を
// 起動時 env で切り替えるため (docs/38 §5)。デモでは本文上限も 2MB に縮む。
export function checkUploadRequest(
  request: Request,
  maxBodyBytes: number = maxUploadBytes() + MULTIPART_OVERHEAD_BYTES,
): UploadRejection | null {
  // CSRF 対策: ブラウザがクロスオリジン POST に付ける Origin がホストと
  // 食い違う場合は本文を読む前に拒否する (同一オリジンの fetch は許可)
  const origin = request.headers.get('origin')
  if (origin && !isSameOrigin(origin, request)) {
    return { status: 403, error: 'クロスオリジンのアップロードは許可されていません' }
  }

  // メモリ枯渇対策: formData() は本文全体をバッファするため、
  // Content-Length の時点で明らかに大きすぎるものは先に弾く
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > maxBodyBytes) {
    return {
      status: 413,
      error: tooLargeMessage(maxBodyBytes - MULTIPART_OVERHEAD_BYTES),
    }
  }

  return null
}

function isSameOrigin(origin: string, request: Request): boolean {
  const host = request.headers.get('host') ?? new URL(request.url).host
  try {
    return new URL(origin).host === host
  } catch {
    // パースできない Origin は正規のブラウザが送るものではない。同一とはみなさない
    return false
  }
}

export function tooLargeMessage(maxBytes: number = MAX_IMAGE_BYTES): string {
  return `ファイルが大きすぎます (最大 ${Math.round(maxBytes / 1024 / 1024)}MB)`
}
