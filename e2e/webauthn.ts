import type { CDPSession, Page } from '@playwright/test'

// 仮想認証器 (CDP の WebAuthn ドメイン) をページに付ける (docs/96 §4-3, §7)。
//
// **CDP セッションは 1 本だけ。** enable → 認証器を足す → 存在確認の自動応答、
// までを同じセッションで続け、以後もそのセッションを閉じない。別のセッションを
// 張り直すと UV (isUserVerified) が外れ、navigator.credentials.* が
// NotAllowedError になる (playwright-virtual-authenticator-gotcha の記憶)。
// page.reload() や同じページ内の遷移では消えない。新しいページ・コンテキストには
// 付いてこない (要るなら WebAuthn.getCredentials で写して addCredential で入れ直す。
// PRF の出力は credential の鍵で決まるので、同じ credential を入れ直せば同じ
// マスターキーの包みが開く)。
//
// transport は 'usb'。'internal' は 1 環境に 1 つしか持てない。usb だと
// authenticatorAttachment が cross-platform になるが、PRF が返るので QR 委譲の
// 文言 (lib/secret/prf.ts) には落ちない
export interface VirtualAuthenticator {
  cdp: CDPSession
  authenticatorId: string
}

export async function attachVirtualAuthenticator(
  page: Page,
): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'usb',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      // 鍵の素 (PRF = hmac-secret)。**登録時に prf を要求した credential にだけ**
      // 返す (docs/96 §4-3 の実測。register-options が要求するようになった)
      hasPrf: true,
    },
  })
  // 「認証器に触れてください」に自動で応える。無いと create / get が待ち続ける
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: true,
  })
  return { cdp, authenticatorId }
}
