// 断片内の媒体参照を復号済みの Blob URL に差し替える (docs/51-部分暗号化計画.md §9、
// docs/53-シークレット挿入拡張計画.md §5)。
//
// もとは components/secret/SecretBlock.tsx の中にあった。断片の読み手 (本番は
// content.ts の loadSecret) と Blob URL の作り手 (本番は URL.createObjectURL) を
// 引数で受ける形にして切り出し、上限・飛ばし方・置き換え方を node で
// テストできるようにした (docs/96-シークレット・お絵かきのテスト計画.md §4-2)。

import type { SecretContent } from './content'
import { secretMimeKind } from './payload'
import { allSecretNames, secretUrl } from './secrets'

// 断片の中に貼れる媒体の数。復号 → Blob URL を一度に抱える上限で、
// 際限なく並べられると解錠のたびにその数ぶんメモリを掴むため
// (動画は 1 本で数十 MB になりうる)
const MAX_NESTED_MEDIA = 20

// 断片の markdown に埋まった媒体の種別 (Blob URL → 種別)。
// 拡張子を持たない Blob URL を MarkdownView が描き分けるために要る
export type NestedMediaKind = 'image' | 'audio' | 'video'

// 作った Blob URL の控え。作った順に積み、表示を畳むときにまとめて
// revokeObjectURL で片付ける (SecretBlock は React の ref をそのまま渡す)
export interface BlobUrlSink {
  current: string[]
}

// URL.createObjectURL に相当。ブラウザにしか無いので引数で受ける
export type CreateObjectUrl = (blob: Blob) => string

export interface NestedMediaIo {
  // 断片を取ってきて復号する (content.ts の loadSecret)
  load: (name: string) => Promise<SecretContent>
  createObjectUrl: CreateObjectUrl
}

export interface NestedMediaResult {
  markdown: string
  kinds: ReadonlyMap<string, NestedMediaKind>
}

// 断片内の媒体参照 (`/api/secrets/<name>`) を、復号した Blob URL に差し替える。
//
// **サーバへ問い合わせるのは暗号文だけ**で、復号はこのブラウザで行う。
// 開けなかったものは参照を残したまま (割れた画像として見える) — 黙って
// 消すと「元から無かった」ように見えてしまう。
//
// Blob URL は拡張子を持たないので、音声・動画を MarkdownView が描き分ける
// ための対応表も一緒に作って返す (docs/53 §5)。
export async function resolveNestedMedia(
  markdown: string,
  blobUrls: BlobUrlSink,
  io: NestedMediaIo,
): Promise<NestedMediaResult> {
  const all = allSecretNames(markdown)
  const names = all.slice(0, MAX_NESTED_MEDIA)
  if (all.length > names.length) {
    // 打ち切りを黙って行わない。上限を超えた分が出ない理由が誰にも分からなくなる
    console.warn(
      `断片内の媒体は ${MAX_NESTED_MEDIA} 個までです (${all.length} 個あるうち ${
        all.length - names.length
      } 個を表示していません)`,
    )
  }

  const kinds = new Map<string, NestedMediaKind>()
  let resolved = markdown

  for (const name of names) {
    try {
      const nested = await io.load(name)
      const kind = secretMimeKind(nested.mime)
      if (kind === null || kind === 'text') {
        continue
      }
      const url = trackBlob(blobUrls, nested.bytes, nested.mime, io.createObjectUrl)
      kinds.set(url, kind)
      resolved = resolved.split(secretUrl(name)).join(url)
    } catch (cause) {
      console.error(`断片内の媒体を開けませんでした (${name})`, cause)
    }
  }

  return { markdown: resolved, kinds }
}

// 復号したバイト列を Blob URL にして控えに積む
export function trackBlob(
  blobUrls: BlobUrlSink,
  bytes: Uint8Array,
  mime: string,
  createObjectUrl: CreateObjectUrl,
): string {
  const url = createObjectUrl(
    new Blob([bytes as unknown as BlobPart], { type: mime }),
  )
  blobUrls.current.push(url)
  return url
}
