// 登録済みパスキーの読み書き (docs/29-パスキー計画.md §5)。
//
// 持つのは公開鍵だけ。秘密鍵は端末の中 (Secure Enclave / iCloud キーチェーン)
// から出てこないので、この表が丸ごと漏れても成りすませない。
//
// 利用者は 1 名だけ (docs/29 §11) なので、行を利用者で絞らない。
// 登録された鍵はすべて「その 1 名のもの」として扱う。

import 'server-only'
import type { AuthenticatorTransportFuture, WebAuthnCredential } from '@simplewebauthn/server'
import { prisma } from './db'

// 画面に出すぶんだけ。公開鍵とカウンタは見せない (見せる意味がない)
export interface PasskeySummary {
  id: string
  label: string
  createdAt: Date
  lastUsedAt: Date | null
}

export async function listPasskeys(): Promise<PasskeySummary[]> {
  const rows = await prisma.webAuthnCredential.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  })
  return rows
}

export async function countPasskeys(): Promise<number> {
  return prisma.webAuthnCredential.count()
}

// ブラウザへ「この鍵たちのどれかで応えて」と伝えるための一覧。
// 登録時は excludeCredentials (同じ端末の二重登録を防ぐ)、
// ログイン時は allowCredentials に渡す。
export async function listCredentialDescriptors(): Promise<
  { id: string; transports?: AuthenticatorTransportFuture[] }[]
> {
  const rows = await prisma.webAuthnCredential.findMany({
    select: { id: true, transports: true },
  })
  return rows.map((row) => ({
    id: row.id,
    transports: row.transports as AuthenticatorTransportFuture[],
  }))
}

// 署名の検証に要る形 (SimpleWebAuthn の WebAuthnCredential) と、その鍵を
// 登録した利用者名を 1 件引く。
export interface StoredCredential {
  userName: string
  credential: WebAuthnCredential
}

export async function findCredential(id: string): Promise<StoredCredential | null> {
  const row = await prisma.webAuthnCredential.findUnique({ where: { id } })
  if (row === null) {
    return null
  }

  const credential: WebAuthnCredential = {
    id: row.id,
    publicKey: new Uint8Array(row.publicKey),
    // DB は BIGINT (uint32 が Int に収まらないため)。SimpleWebAuthn は
    // number を要求するのでここで落とす。カウンタは高々 2^32 なので
    // Number の安全な整数の範囲に十分収まる
    counter: Number(row.counter),
    transports: row.transports as AuthenticatorTransportFuture[],
  }

  return { userName: row.userName, credential }
}

export interface NewPasskey {
  id: string
  userName: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
  label: string
}

export async function savePasskey(passkey: NewPasskey): Promise<void> {
  await prisma.webAuthnCredential.create({
    data: {
      id: passkey.id,
      userName: passkey.userName,
      publicKey: Buffer.from(passkey.publicKey),
      counter: BigInt(passkey.counter),
      transports: passkey.transports,
      label: passkey.label,
    },
  })
}

// ログイン成功のたびに呼ぶ。カウンタを進め、最終使用日時を残す
// (一覧で「これはもう使っていない端末だ」と判断できるようにするため)。
export async function touchPasskey(
  id: string,
  counter: number,
  now: Date = new Date(),
): Promise<void> {
  await prisma.webAuthnCredential.update({
    where: { id },
    data: { counter: BigInt(counter), lastUsedAt: now },
  })
}

// 消せたら true、元から無ければ false。
export async function deletePasskey(id: string): Promise<boolean> {
  const { count } = await prisma.webAuthnCredential.deleteMany({ where: { id } })
  return count > 0
}
