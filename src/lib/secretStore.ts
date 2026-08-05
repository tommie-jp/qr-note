// シークレット断片と鍵束の読み書き (docs/51-部分暗号化計画.md §4, §6)。
//
// **この層は中身を一切解釈しない**。受け取るのも返すのも暗号エンベロープの
// バイト列で、サーバに鍵は無い。images テーブルと違いサムネも埋め込みも
// 作らないのが要点で、そのために表ごと分けてある (docs/51 §5)。

import { Prisma } from '@/generated/prisma/client'
import { prisma } from './db'

export interface StoredSecret {
  mime: string
  data: Uint8Array
}

export async function findSecret(name: string): Promise<StoredSecret | null> {
  const row = await prisma.secret.findUnique({
    where: { name },
    select: { mime: true, data: true },
  })
  return row === null ? null : { mime: row.mime, data: new Uint8Array(row.data) }
}

// 断片を保存する (新規も編集も同じ口)。
//
// **名前を決めるのはクライアント**で、画像 (imageStore.ts が UUID を振る) とは
// 逆になっている。暗号エンベロープの AAD が断片の名前に縛られており
// (docs/51 §7)、封をする時点で名前が決まっていなければならないため。
// トラバーサル対策は「サーバが振る」ことではなく isValidSecretName の書式検算が
// 担う (route が UUID 以外を 400 で弾く)。
//
// 編集は**同名で上書き**する。画像の回転 (docs/49 §1) が新 UUID で保存し直すのと
// 逆の選択で、配信が no-store なので immutable キャッシュの問題が無く、同名なら
// 本文のトークンが変わらない = CodeMirror の undo 履歴と干渉しない (docs/51 §9)。
export async function saveSecret(
  name: string,
  mime: string,
  data: Uint8Array<ArrayBuffer>,
): Promise<void> {
  await prisma.secret.upsert({
    where: { name },
    create: { name, mime, data },
    update: { mime, data },
  })
}

// --- 鍵束 (docs/51 §6) ---

// 鍵束の検証値。null = まだ暗号化を設定していない。
export async function findKeyringVerifier(): Promise<Uint8Array | null> {
  const row = await prisma.secretKeyring.findUnique({
    where: { id: 1 },
    select: { verifier: true },
  })
  return row === null ? null : new Uint8Array(row.verifier)
}

// 一意制約違反 (Prisma のエラーコード)。主キー衝突がこれ
const UNIQUE_VIOLATION = 'P2002'

// 鍵束を初期化する。**既にあれば何もせず false** — 上書きを許すと、既存の
// 断片を開けるマスターキーの検証値が消え、全断片が読めなくなる。
//
// **捕まえるのは主キー衝突だけ**。すべての例外を false に丸めると、DB が
// 一時的に落ちているだけでも「もう設定済みです」と嘘を返してしまう。しかも
// 鍵束は実在しないので、次に解錠しようとすると「まだ設定されていません」と
// 矛盾したことを言い出し、利用者は本当の原因 (DB 障害) に辿り着けない。
export async function initKeyring(
  verifier: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  try {
    await prisma.secretKeyring.create({ data: { id: 1, verifier } })
    return true
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      // 既に設定済み。競合で 2 行目ができることはない (CHECK と主キーで
      // DB 側も縛ってある)
      return false
    }
    throw error
  }
}

// 鍵束を消す。**初回設定が途中で失敗したときの巻き戻し専用**
// (api/secrets/keyring の POST)。包みが 1 つも無い鍵束を残すと、復旧キーも
// まだ画面に出ていないため誰にも開けられず、しかも初回設定は「既に設定済み」で
// 断られて作り直せない行き止まりになる。
//
// 断片が既にあるなら消してはいけないが、この関数を呼ぶのは「たった今
// 作った鍵束を畳む」場面だけなので、その状況は起こらない。
export async function deleteKeyring(): Promise<void> {
  await prisma.secretKeyring.deleteMany({ where: { id: 1 } })
}

export interface KeyWrapSummary {
  credentialId: string
  label: string
  // 包んだマスターキー。持っていないパスキーは null
  wrapped: Uint8Array | null
}

// 登録済みパスキーと、それぞれの包んだマスターキー。
//
// 包んだ後のバイト列なので、ログイン済みの相手にまとめて返してよい
// (開けるのは認証器を持つ本人だけ)。画面は「この端末の分があるか」を
// 見て、解錠と「この端末で有効にする」を出し分ける。
export async function listKeyWraps(): Promise<KeyWrapSummary[]> {
  const rows = await prisma.webAuthnCredential.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, secretKeyWrap: true },
  })
  return rows.map((row) => ({
    credentialId: row.id,
    label: row.label,
    wrapped: row.secretKeyWrap === null ? null : new Uint8Array(row.secretKeyWrap),
  }))
}

// そのクレデンシャル ID のパスキーが登録されているか。
//
// **鍵束を作る前に確かめるために要る**。順番を逆にすると、知らないパスキーで
// 設定を試みたときに「鍵束だけ出来て、それを開ける包みが 1 つも無い」状態が
// 残る。復旧キーはまだ画面に出ていないので、その鍵束は**誰にも開けられない**
// うえ、初回設定は 409 で断られて作り直せない (行き止まりになる)。
export async function hasCredential(credentialId: string): Promise<boolean> {
  const count = await prisma.webAuthnCredential.count({
    where: { id: credentialId },
  })
  return count > 0
}

// パスキー 1 つ分の包んだマスターキーを入れ替える。
// 知らないクレデンシャル ID なら false (パスキーの行が正本で、鍵だけが
// 宙に浮くことはない — パスキーを消せば包みも一緒に消える)。
export async function saveKeyWrap(
  credentialId: string,
  wrapped: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const { count } = await prisma.webAuthnCredential.updateMany({
    where: { id: credentialId },
    data: { secretKeyWrap: wrapped },
  })
  return count > 0
}
