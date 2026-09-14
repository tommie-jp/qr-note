// 画像検索の索引をサーバから取り、client 側の照合で使える形にする
// (docs/25-画像検索計画.md §5)。埋め込みは base64 の生バイト列で届くので
// Float32Array へ復号する。

import { EMBEDDING_DIM } from '@/lib/embedding/model'
import { type ImageVectorEntry } from '@/lib/embedding/imageSearch'
import { deserializeEmbedding } from '@/lib/embedding/imageVector'

// base64 → Uint8Array (ブラウザの atob 経由)。
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

interface IndexEntryDTO {
  itemNo: string
  title: string
  imageName: string
  embedding: string
}

// /api/image-search/index を取得し、復号済みの索引を返す。
// 壊れた埋め込み (長さ不正) の行は黙って捨てる (検索対象から外れるだけ)。
export async function fetchImageSearchIndex(): Promise<ImageVectorEntry[]> {
  const res = await fetch('/api/image-search/index', {
    // 認証は Basic + 同一サイト判定。同一オリジンの fetch は same-origin になる
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`索引の取得に失敗しました (${res.status})`)
  }
  const body: { data?: { entries?: IndexEntryDTO[] } } = await res.json()
  const dtos = body.data?.entries ?? []

  const entries: ImageVectorEntry[] = []
  for (const dto of dtos) {
    const embedding = deserializeEmbedding(base64ToBytes(dto.embedding))
    // 次元が今のモデルと違う埋め込みは捨てる。モデルを差し替えた直後
    // (backfill --force 未完了) は旧次元が混ざりうる。ここで弾かないと
    // rankItems の dot() が次元不一致で throw し、検索全体が黙って倒れる。
    if (!embedding || embedding.length !== EMBEDDING_DIM) {
      continue
    }
    entries.push({
      itemNo: dto.itemNo,
      title: dto.title,
      imageName: dto.imageName,
      embedding,
    })
  }
  return entries
}
