// サーバ側 (Node) の埋め込み生成 (docs/25-画像検索計画.md §4)。
//
// アップロード時 (saveImage) とバックフィル (scripts/backfillEmbeddings.ts) の
// 両方から使う共通の入口。ブラウザと同じ embedder.embed() を Node で走らせる
// ので、保存時に作るベクトルとカメラのベクトルが同じ空間に乗る。
//
// **何があっても throw しない**。埋め込みは data 由来の派生キャッシュで、
// 失敗しても画像検索の対象から外れるだけ (thumb と同じ思想)。アップロードや
// バックフィルの本筋を、モデルの不調で巻き添えにしない。

import 'server-only'
import { prisma } from '../db'
import { serializeEmbedding } from '../imageVector'
import { embed } from './embedder'

// 画像バイト列 → DB 保存用の埋め込みバイト列。作れなければ null。
export async function computeEmbeddingBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const vec = await embed(new Blob([bytes as BlobPart], { type: mime }))
    return serializeEmbedding(vec)
  } catch (err) {
    console.error('埋め込みを生成できませんでした', err)
    return null
  }
}

// アップロード直後に呼ぶ「待たない」埋め込み生成。
//
// 応答を埋め込み計算で待たせない (初回はモデル読み込みで数秒かかる)。
// 生成できたら該当行を更新し、できなければ null のままにする —
// null の画像は scripts/backfillEmbeddings.ts が後から拾う。
//
// 走査中に画像が消えている (GC・永久削除) こともあるので、更新の失敗も
// 握りつぶす (競走であって異常ではない)。
export function generateEmbeddingInBackground(
  name: string,
  bytes: Uint8Array,
  mime: string,
): void {
  void generateEmbedding(name, bytes, mime)
}

// 上と同じことを「待てる」形で行う。**何があっても throw しない**のは同じ。
//
// 一括取り込み (scripts/importEnex.ts) 用。あちらは処理を終えると
// prisma.$disconnect() してプロセスを畳むので、待たないと最後の数枚の
// 埋め込みが切断と競合して黙って欠ける (画像検索から漏れるだけなので
// 気づきにくい)。待つぶん遅くなるが、CLI は応答時間を気にする場所ではない。
export async function generateEmbedding(
  name: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  const embedding = await computeEmbeddingBytes(bytes, mime)
  if (!embedding) {
    return
  }
  try {
    await prisma.image.update({ where: { name }, data: { embedding } })
  } catch (err) {
    console.error(`埋め込みを保存できませんでした (name=${name})`, err)
  }
}
