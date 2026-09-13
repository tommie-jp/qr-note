// storeAttachment の音声分岐 (41-QR-search/docs/12-添付ファイル種類拡張メモ.md、
// docs/93-リファクタリング計画.md §4-5)。形式の判定と大きさの検査は store.ts が
// 済ませてから呼ぶ。
import 'server-only'
import { savePlainAttachment } from '@/lib/imageStore'
import { moveMoovToFront } from '@/lib/mp4Faststart'
import { type AudioFormat, audioSaveInfo } from '@/lib/uploads/sniff/audio'
import { type AttachmentResult, succeed } from './result'

export async function storeAudio(
  bytes: Uint8Array<ArrayBuffer>,
  format: AudioFormat,
): Promise<AttachmentResult> {
  // 音声は変換もサムネも要らない。中身をそのまま保存する。
  // 唯一の例外が m4a の moov 並べ替えで、これは変換ではなく**箱の詰め替え**
  // (音声データは 1 バイトも変わらない)。iOS Safari の録音とボイスメモは
  // moov が末尾に付き、そのままだと <audio> が再生を始められない
  const { mime, ext } = audioSaveInfo(format)
  const stored = format === 'm4a' ? (moveMoovToFront(bytes) ?? bytes) : bytes
  return succeed(await savePlainAttachment(stored, mime, ext), false)
}
