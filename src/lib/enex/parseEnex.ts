// ENEX (Evernote エクスポート) の XML を読む (設計は docs/28-エクスポート計画.md §4)。
//
// ENEX は 1 ファイルに複数ノートが入る形式なので、**最初からノートの配列**で
// 返す。「1 ファイルだけ対応」は入口 (UI / route) の話であって、ここの形では
// ない (後から複数ファイルへ広げるときに触らずに済む)。
//
// パーサは既に依存にある fast-xml-parser を使う (ndlSearch.ts と同じもの)。
// v5 は外部実体参照 (XXE) と引数実体を明示的に拒み、実体展開にも上限がある。
// **その安全側の既定に乗るため、DOCTYPE を自前で剥がしたりしない**。

import 'server-only'
import { createHash } from 'node:crypto'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export interface EnexResource {
  // **base64 のまま持つ**。復号したバイト列を全件ぶん抱えないための形
  // (decodeResourceData のコメント参照)
  base64: string
  // ENEX の申告。**信用しない** — 保存側は先頭バイトで判定し直す (uploads.ts)
  mime: string
  fileName: string | null
  // 本文の <en-media hash="..."> と突き合わせる鍵。ENEX には入っていないので
  // 復号したバイト列から計算する
  md5: string
}

// 添付 1 件を復号する。**保存する直前に呼ぶこと**。
//
// 復号したバイト列を EnexResource に持たせて全件を抱えると、40MB の ENEX で
// 復号済み 30MB 前後が丸ごと生き続ける。本番 VPS は RAM 2GB で既に swap を
// 常用しており (docs/09-vps振り分け移行手順.md)、そこに元の文字列と構文木まで
// 重なると余裕がない。1 件ずつ復号して保存し、そのつど捨てる形にする。
//
// md5 の計算で 1 度、ここで 1 度と 2 回復号することになるが、復号は 30MB でも
// 100ms 程度で済む。**CPU を少し払ってメモリのピークを下げる**取引。
export function decodeResourceData(
  resource: EnexResource,
): Uint8Array<ArrayBuffer> {
  return toOwnedBytes(Buffer.from(resource.base64, 'base64'))
}

// Buffer は共有 ArrayBuffer のプール上に載るため、そのまま Prisma へ渡すと
// 隣の添付まで書き込まれうる。自前の ArrayBuffer へ写して切り離す
function toOwnedBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)
  return bytes
}

// 読めなかった添付。**捨てるだけにしない** — 取り込み後のレポートに
// 「入らなかったもの」として出すため、理由を持って上まで運ぶ
export interface EnexRejectedResource {
  fileName: string | null
  mime: string
  reason: string
}

export interface EnexNote {
  title: string
  // ENML (XHTML 系)。Markdown への変換は enmlToMarkdown.ts の担当
  content: string
  tags: string[]
  createdAt: Date | null
  updatedAt: Date | null
  resources: EnexResource[]
  rejectedResources: EnexRejectedResource[]
}

const parser = new XMLParser({
  // 既定では値を数値へ変換してしまい、題名 "1996.10" が 1996.1 に化ける
  // (ndlSearch.ts と同じ罠)。ENEX の中身はすべて文字列として読む
  parseTagValue: false,
  // <data encoding="base64"> の encoding を見るために属性も読む
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // 1 件でも配列で受け取り、件数による分岐を無くす
  isArray: (name) => ['note', 'tag', 'resource'].includes(name),
})

// ENEX の日時は "20240115T093000Z" (基本形式の ISO 8601)。Date の直読みでは
// 通らないので、拡張形式へ組み直してから渡す。読めない値は null にして
// 「取り込み時刻で代用する」判断を呼び出し側へ残す
const ENEX_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/

// XML 宣言の encoding。Evernote は必ず UTF-8 で書き出すが、手で作った/変換した
// ファイルはこの限りではない
const XML_ENCODING = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i

// --- 添付本体を構文解析から外に出す ---
//
// ENEX の大きさはほぼ `<data>` の base64 が占める。これをそのまま
// fast-xml-parser に渡すと **入力の 25 倍**のメモリを使う
// (実測: 48MB の ENEX で構文解析だけ +1.2GB / 2.2 秒)。本番 VPS は RAM 2GB
// なので、40MB の書き出しを渡した時点で落ちる。
//
// そこで解析の前に base64 を抜き出して短い目印に差し替え、パーサには
// 構造だけを見せる。抜き出した中身は配列に持つが、これは V8 の部分文字列
// (元の文字列を指すだけ) なので**複製は起きない**。
// 復号は今までどおり保存の直前に 1 件ずつ行う (decodeResourceData)。
const DATA_PAYLOAD =
  /(<data\b[^>]*\bencoding\s*=\s*["']base64["'][^>]*>)([\s\S]*?)(<\/data\s*>)/gi

// base64 の文字集合に `-` は無いので、本物の中身とぶつからない
const PAYLOAD_PLACEHOLDER = /^enex-data-(\d+)$/

interface LiftedXml {
  xml: string
  payloads: string[]
}

function liftDataPayloads(xml: string): LiftedXml {
  const payloads: string[] = []
  const lifted = xml.replace(
    DATA_PAYLOAD,
    (_match, open: string, body: string, close: string) =>
      `${open}enex-data-${payloads.push(body) - 1}${close}`,
  )
  return { xml: lifted, payloads }
}

// 目印なら退避しておいた中身へ差し戻す。目印でなければそのまま
// (encoding 属性を書かない ENEX は差し替えの対象外なので、素の中身が来る)
function resolvePayload(text: string, payloads: string[]): string {
  const match = PAYLOAD_PLACEHOLDER.exec(text)
  if (!match) {
    return text
  }
  return payloads[Number(match[1])] ?? ''
}

export function parseEnexDate(value: string): Date | null {
  const match = ENEX_DATE.exec(value.trim())
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
  )
  return Number.isNaN(date.getTime()) ? null : date
}

// fast-xml-parser は「属性を持つ要素」を object、持たない要素を文字列で返す。
// どちらの形でも本文だけを取り出す
function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && '#text' in value) {
    return String((value as { '#text': unknown })['#text'] ?? '')
  }
  return ''
}

function attrOf(value: unknown, name: string): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  const key = `@_${name}`
  return key in record ? String(record[key] ?? '') : null
}

type ResourceParse =
  | { ok: true; resource: EnexResource }
  | { ok: false; rejected: EnexRejectedResource }

function parseResource(raw: unknown, payloads: string[]): ResourceParse {
  const node = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const attributes = node['resource-attributes']
  const fileName =
    attributes && typeof attributes === 'object'
      ? textOf((attributes as Record<string, unknown>)['file-name']) || null
      : null
  const mime = textOf(node.mime)
  const reject = (reason: string): ResourceParse => ({
    ok: false,
    rejected: { fileName, mime, reason },
  })

  // encoding は base64 のみ扱う。ENEX の仕様上ほかの値は現れないが、
  // 現れたなら中身を取り違えて保存するより捨てて報告するほうが安全
  const encoding = attrOf(node.data, 'encoding')
  if (encoding !== null && encoding.toLowerCase() !== 'base64') {
    return reject(`base64 以外の形式で埋め込まれています (${encoding})`)
  }

  const base64 = resolvePayload(textOf(node.data), payloads)
  if (base64 === '') {
    return reject('中身が空です')
  }
  // Buffer は base64 の文字集合に無い文字 (改行など) を読み飛ばす。
  // 実物の ENEX は 1 行 76 文字で折り返してあるので、これに頼る。
  //
  // ここで復号するのは「読めるか」の確認と md5 の計算のためだけで、
  // **バイト列は持ち帰らない** (捨てて GC に任せる)。保存時にもう一度
  // 復号する — decodeResourceData に理由を書いた
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.byteLength === 0) {
    return reject('base64 として読めません')
  }

  return {
    ok: true,
    resource: {
      base64,
      mime,
      fileName,
      md5: createHash('md5').update(buffer).digest('hex'),
    },
  }
}

function parseNote(raw: unknown, payloads: string[]): EnexNote {
  const node = (raw ?? {}) as Record<string, unknown>
  const tags = Array.isArray(node.tag) ? node.tag : []
  const rawResources = Array.isArray(node.resource) ? node.resource : []

  const resources: EnexResource[] = []
  const rejectedResources: EnexRejectedResource[] = []
  for (const rawResource of rawResources) {
    const parsed = parseResource(rawResource, payloads)
    if (parsed.ok) {
      resources.push(parsed.resource)
    } else {
      rejectedResources.push(parsed.rejected)
    }
  }

  return {
    title: textOf(node.title),
    content: textOf(node.content),
    tags: tags.map(textOf).filter((tag) => tag !== ''),
    createdAt: parseEnexDate(textOf(node.created)),
    updatedAt: parseEnexDate(textOf(node.updated)),
    resources,
    rejectedResources,
  }
}

// ENEX を読んでノートの配列を返す。
//
// XML として壊れているもの・ENEX でないものは**例外**にする。ファイル 1 枚
// まるごとが対象外という話で、「そのノートだけ飛ばす」で済む種類の失敗
// (添付が壊れている等) とは扱いを分ける (docs/28 §3 の検証方針)。
export function parseEnex(xml: string): EnexNote[] {
  // parse() は閉じ忘れなどを黙って読み流す (実測: "<en-export><note>" が
  // 通ってしまう)。インポートは書き込み境界なので、先に検証を通す
  // (docs/28 §3)。壊れたファイルを「0 件でした」と報告するのは嘘になる
  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    throw new Error(`XML として読めません: ${validation.err.msg}`)
  }

  // 呼び出し側は UTF-8 として復号済みの文字列を渡してくる。宣言が別の符号化を
  // 名乗っているなら、既に化けた文字列を読んでいるということ。そのまま取り込むと
  // 題名も本文も文字化けしたノートが黙って出来上がるので、ここで断る
  const declared = XML_ENCODING.exec(xml.slice(0, 200))?.[1]
  if (declared && !/^utf-?8$/i.test(declared)) {
    throw new Error(`UTF-8 で書かれた ENEX にのみ対応しています (${declared})`)
  }

  // 添付本体を外に出してから解析する (liftDataPayloads のコメント参照)。
  // 検証は元の文字列に対して済ませてあるので、差し替えの影響を受けない
  const lifted = liftDataPayloads(xml)
  const doc = parser.parse(lifted.xml) as Record<string, unknown>

  if (!('en-export' in doc)) {
    throw new Error('ENEX ファイルではありません (en-export 要素がありません)')
  }
  const root = doc['en-export']
  // ノートが 1 件も無い ENEX。空配列で返して「0 件でした」と伝える。
  // 属性の無い空要素は object ではなく空文字で返ってくるので、ここで受ける
  if (!root || typeof root !== 'object') {
    return []
  }
  const notes = (root as Record<string, unknown>).note
  return Array.isArray(notes)
    ? notes.map((note) => parseNote(note, lifted.payloads))
    : []
}
