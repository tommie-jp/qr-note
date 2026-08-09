// 鍵束の設定・解錠の手順 (docs/51-部分暗号化計画.md §6)。ブラウザ専用。
//
// ここに 4 つの入口がある:
//
//   setupSecrets        … 初回設定。マスターキーを作り、復旧キーを返す
//   unlockWithPasskey   … 日常の解錠 (Face ID)
//   unlockWithRecovery  … 紙の復旧キーからの解錠 (PRF 非対応環境の正規の入口)
//   enrollThisDevice    … 解錠済みの状態で、別のパスキーにも包みを足す
//
// マスターキーの平文がサーバへ出ることは一度も無い。サーバに置くのは
// 「包んだ鍵」と「検証値」だけ。

import {
  loadKeyringCache,
  saveKeyringCache,
} from './offline/keyring'
import {
  fetchKeyring,
  initKeyring,
  saveKeyWrap,
  type KeyringState,
} from './secretApi'
import {
  checkVerifier,
  decodeRecoveryKey,
  deriveKek,
  encodeRecoveryKey,
  formatRecoveryKey,
  generateMasterKey,
  makeVerifier,
  unwrapMasterKey,
  wrapMasterKey,
} from './secretKeyring'
import { requestPrf } from './secretPrf'
import { unlockWith, unlockedMasterKeyBytes } from './secretSession'

// 鍵はあるはずなのに手順が噛み合わなかった、を利用者の言葉で伝える例外。
export class SecretSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretSetupError'
  }
}

// 初回設定。マスターキーを作り、この端末のパスキーで包んで保存し、
// **紙に控えるための復旧キー**を返す。
//
// 復旧キーを見せるのはこの 1 回だけ (サーバは平文の鍵を持たない)。
// 呼ぶ側は必ず利用者に印字・保管させること — これを失うと、全パスキーを
// 失ったときに断片が永久に読めなくなる (docs/51 §14)。
export async function setupSecrets(): Promise<string> {
  const keyring = await fetchKeyring()
  if (keyring.initialized) {
    throw new SecretSetupError('暗号化は既に設定されています')
  }

  const masterKey = generateMasterKey()

  // 鍵を作った後で認証器を呼ぶ。取り消されたらサーバには何も残らない
  const assertion = await requestPrf(keyring.wraps.map((wrap) => wrap.credentialId))
  const kek = await deriveKek(assertion.prfOutput)

  await initKeyring(
    await makeVerifier(masterKey),
    assertion.credentialId,
    await wrapMasterKey(kek, masterKey, assertion.credentialId),
  )

  await unlockWith(masterKey)
  await refreshKeyringCache()
  return formatRecoveryKey(encodeRecoveryKey(masterKey))
}

// 日常の解錠。Face ID → PRF → 包みを開く。
export async function unlockWithPasskey(): Promise<void> {
  const keyring = await requireInitialized()

  // 包みを持つパスキーだけを候補にする。持たないものを選ばれても開けないので、
  // 認証器の側で選ばせない方が親切
  const enrolled = keyring.wraps.filter((wrap) => wrap.wrapped !== null)
  if (enrolled.length === 0) {
    throw new SecretSetupError(
      'どのパスキーでも暗号化が有効になっていません。復旧キーで解錠してください',
    )
  }

  const assertion = await requestPrf(enrolled.map((wrap) => wrap.credentialId))
  const wrap = enrolled.find((row) => row.credentialId === assertion.credentialId)
  if (wrap?.wrapped == null) {
    // 別のパスキーで応えられた (allowCredentials を無視する認証器がある)。
    // そのパスキーで有効にすれば次から使えるので、そう案内する
    throw new SecretSetupError(
      'このパスキーでは暗号化が有効になっていません。設定画面から有効にしてください',
    )
  }

  const kek = await deriveKek(assertion.prfOutput)
  await unlockWith(await unwrapMasterKey(kek, wrap.wrapped, assertion.credentialId))
}

// 紙の復旧キーからの解錠。PRF が使えない環境の正規の入口でもある。
export async function unlockWithRecoveryKey(input: string): Promise<void> {
  const keyring = await requireInitialized()

  const masterKey = decodeRecoveryKey(input)
  if (masterKey === null) {
    throw new SecretSetupError('復旧キーの形式が違います')
  }

  // 検証値と噛み合わない鍵で解錠してしまうと、以後の保存が「開けない断片」を
  // 作り続ける。打ち間違いはここで必ず止める
  if (
    keyring.verifier === null ||
    !(await checkVerifier(masterKey, keyring.verifier))
  ) {
    throw new SecretSetupError('復旧キーが違います')
  }

  await unlockWith(masterKey)
}

// 解錠済みの状態で、いま使っているパスキーにも包みを足す。
// 2 台目の端末・新しいパスキー・PRF 対応の環境へ移るときに使う。
export async function enrollThisDevice(): Promise<void> {
  const masterKey = unlockedMasterKeyBytes()
  if (masterKey === null) {
    throw new SecretSetupError('先に解錠してください')
  }

  const keyring = await requireInitialized()
  const assertion = await requestPrf(keyring.wraps.map((wrap) => wrap.credentialId))
  const kek = await deriveKek(assertion.prfOutput)

  await saveKeyWrap(
    assertion.credentialId,
    await wrapMasterKey(kek, masterKey, assertion.credentialId),
  )
  // 足した包みを写しにも入れる。**これが無いと、有効にした端末が圏外へ出た
  // 途端に「このパスキーでは有効になっていません」に戻る**
  await refreshKeyringCache()
}

async function requireInitialized(): Promise<KeyringState> {
  const keyring = await readKeyring()
  if (!keyring.initialized) {
    throw new SecretSetupError(
      '暗号化がまだ設定されていません。設定画面から始めてください',
    )
  }
  return keyring
}

// 鍵束を読む。**サーバを先に見て、駄目なら端末の写しへ落ちる**
// (docs/65-オフライン対応計画.md §9)。
//
// 順番が逆ではいけない。写しを先に使うと、別の端末でパスキーを足した直後に
// 「有効になっていません」と断られる — 直し方の判らない不具合になる。
// サーバが答えられるなら常にそちらが正で、写しは圏外の保険にすぎない。
//
// 写しも無ければ**サーバ側の失敗をそのまま投げる**。「圏外だから解錠できない」
// ことと「鍵束が壊れている」ことは、利用者にできることが違う。
async function readKeyring(): Promise<KeyringState> {
  try {
    const keyring = await fetchKeyring()
    // 写しを更新するのはここだけ。取れたときに必ず書き直せば、写しが古いまま
    // 残る窓は「取れなかった間」に限られる
    await saveKeyringCache(keyring).catch((error: unknown) => {
      // 保存できなくても解錠はできる。困るのは次に圏外へ出たときだけ
      console.warn('鍵束を端末に保存できませんでした', error)
    })
    return keyring
  } catch (cause) {
    const cached = await loadKeyringCache().catch((error: unknown) => {
      console.warn('端末の鍵束を読めませんでした', error)
      return null
    })
    if (cached === null) {
      throw cause
    }
    return cached
  }
}

// 鍵束を書き換えた後に写しを追いつかせる (初回設定・パスキーの追加)。
//
// **書いた値を自分で組み立てて写しに入れない。** サーバが返す形 (label など
// こちらが知らない列を含む) をそのまま持つのが写しの約束で、手で作ると
// 「オンラインで読んだ形」と「書いた直後の形」の 2 通りが生まれる。
async function refreshKeyringCache(): Promise<void> {
  try {
    await saveKeyringCache(await fetchKeyring())
  } catch (error) {
    // 追いつけなくても次にオンラインで解錠したときに揃う
    console.warn('鍵束の写しを更新できませんでした', error)
  }
}
