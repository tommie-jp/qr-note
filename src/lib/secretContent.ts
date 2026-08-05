// 断片の中身を読み書きする層 (docs/51-部分暗号化計画.md §8, §9)。ブラウザ専用。
//
// 暗号化・復号はここだけで行い、画面は平文の文字列とバイト列だけを扱う。
// **平文がサーバへ出る経路はここには無い** — 送るのは必ず封をした後。

import { fetchSecretBlob, saveSecret } from './secretApi'
import { openSecret, sealSecret } from './secretEnvelope'
import { SECRET_TEXT_MIME, isSecretImageMime, isSecretMime } from './secretPayload'
import { unlockedKey } from './secretSession'

// 鍵がまだ無い状態で読み書きしようとした。画面は解錠を促す。
export class SecretLockedError extends Error {
  constructor() {
    super('シークレットが施錠されています')
    this.name = 'SecretLockedError'
  }
}

export interface SecretContent {
  mime: string
  bytes: Uint8Array
}

// 新しい断片の名前。**保存より先に決める** — エンベロープの AAD が名前に
// 縛られているため (docs/51 §7)。
export function newSecretName(): string {
  return crypto.randomUUID()
}

// エンベロープの AAD にする文脈。
//
// **名前だけでなく mime も縛る**。mime は暗号化しないメタデータなので、
// DB に書ける相手は `data` はそのままに mime だけを書き換えられる。それを
// 許すと、画像の生バイト列が「復号成功した markdown」として描画側へ渡る —
// 断片 A と B を入れ替えるのと同じすり替えの一種なのに、名前だけを縛って
// いると検知できない。両方入れておけば、どちらをいじっても復号が失敗する。
export function secretContext(name: string, mime: string): string {
  return `${name}:${mime}`
}

// 断片を取ってきて復号する。開けなければ SecretDecryptError が飛ぶ
// (握り潰して空を返さない — 「復号できなかった」を黙って空欄にするのが
// 一番まずい)。
export async function loadSecret(name: string): Promise<SecretContent> {
  const key = requireKey()
  const blob = await fetchSecretBlob(name)

  // サーバが返す mime は暗号化していないメタデータ。DB の値を鵜呑みにせず、
  // 既知のものだけを採用する (api/images が isAllowedContentMime を見るのと同じ)
  if (!isSecretMime(blob.mime)) {
    throw new Error('未知の種類のシークレットです')
  }

  return {
    mime: blob.mime,
    bytes: await openSecret(key, blob.bytes, secretContext(name, blob.mime)),
  }
}

// 断片本文 (markdown) を保存する。新規も編集も同じ (同名なら上書き)。
export async function saveSecretText(name: string, text: string): Promise<void> {
  await sealAndSave(name, SECRET_TEXT_MIME, new TextEncoder().encode(text))
}

// 断片の中に貼る画像を保存する。**画像パイプライン (images テーブル) は
// 通らない** ので、サムネも埋め込みもサーバに残らない (docs/51 §5)。
export async function saveSecretImage(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<void> {
  if (!isSecretImageMime(mime)) {
    throw new Error('この画像形式はシークレットにできません')
  }
  await sealAndSave(name, mime, bytes)
}

// 復号済みの断片を文字列として読む (本文用)。
export function secretText(content: SecretContent): string {
  return new TextDecoder().decode(content.bytes)
}

async function sealAndSave(
  name: string,
  mime: string,
  plaintext: Uint8Array,
): Promise<void> {
  const sealed = await sealSecret(requireKey(), plaintext, secretContext(name, mime))
  await saveSecret(name, mime, sealed)
}

function requireKey(): CryptoKey {
  const key = unlockedKey()
  if (key === null) {
    throw new SecretLockedError()
  }
  return key
}
