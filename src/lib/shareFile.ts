// ファイルを OS の共有シートへ渡す (41-QR-search/docs/12-添付ファイル種類拡張メモ.md)。
//
// **なぜ要るか**: ホーム画面から起動した PWA (standalone) には、PDF を印刷・
// 保存・他アプリへ送る手段が無い。ブラウザなら「新しいタブ」でネイティブ
// ビューアへ逃がせるが、standalone ではそれができない (offline/displayMode.ts)。
// 共有シートなら OS 側にそれらを委ねられ、閉じれば PWA に戻る。
//
// **URL ではなくファイルの実体を渡す**のが要点。iOS のホーム画面 web app は
// Safari と Cookie を共有しないため、認証つきの URL を渡しても共有先では
// ログイン要求に化ける。バイト列を渡せばその問題が起きない。

// 共有できるかの検出。**ダミーの File で canShare を試す**のが肝で、
// navigator.share の有無だけでは足りない — ファイル共有 (Web Share Level 2) は
// URL 共有と別物で、デスクトップ Linux Chrome などは share があっても
// ファイルは受け取れない。
export function canShareFiles(nav: Navigator = navigator): boolean {
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function') {
    return false
  }
  try {
    // 中身は見られないので空で構わない。判定は型と API の対応可否だけ
    const probe = new File([], 'probe.pdf', { type: 'application/pdf' })
    return nav.canShare({ files: [probe] })
  } catch {
    // File が作れない環境 (古いブラウザ) は共有もできないとみなす
    return false
  }
}

// iOS (WebKit) か。SSR では判定できないので false。
//
// 共有ボタンは **API が使えるかではなく、要るか + 実際に動くか**で出し分ける。
// 実機で全環境を当たった結果 (41-QR-search/docs/12)、両方を満たすのは iOS だけだった:
//   - PC (Win/Mac/Linux): プレイヤーの ⋮ / 右クリックで保存できるうえ、
//     Windows は files 付き share がブラウザを問わず Permission denied になる
//     既知問題がある (mdn/browser-compat-data#21312)
//   - Android Chrome: ⋯ メニューで保存できるうえ、share は同様に恒久拒否
//   - iOS: 長押しもダウンロードも無く共有が唯一の出口で、share も動く (実機確認)
//
// 判定は UA 文字列の解析ではなく **navigator.standalone の有無**で行う。
// このプロパティは iOS の WebKit にしか存在しない (値ではなく存在で見る —
// Safari 通常タブでは false が入っているため)。
export function isIosWebKit(nav: Navigator = navigator): boolean {
  return typeof (nav as { standalone?: unknown }).standalone === 'boolean'
}

// 共有ボタンを出してよいか = ファイル共有 API が使え、かつ iOS。
// 音声プレイヤーと PDF ビューアの両方がこの 1 本を見る。
export function shouldOfferShare(): boolean {
  return typeof navigator !== 'undefined' && canShareFiles() && isIosWebKit()
}

// 共有シートに出すファイル名を作る。
//
// 保存名 (URL 末尾) は `<UUID>.<ext>` で、UUID のままでは共有先で何のファイルか
// 判らない。表示名 (録音の日時など) があればそれを使い、拡張子だけ保存名から
// 借りる。表示名が無い・既定ラベル ("audio" など) のときは種別名を宛てる。
export function attachmentShareName(
  url: string,
  label: string,
  defaultBase: string,
): string {
  // 末尾の拡張子だけを保存名から取る (クエリ・ハッシュは落とす)
  const storedName = url.split(/[?#]/)[0].split('/').pop() ?? ''
  const ext = storedName.includes('.') ? storedName.split('.').pop()! : ''

  // ラベルから記法を壊す文字・パス区切りを除く。空や既定ラベルは種別名にする
  const cleaned = label.replace(/[/\\\r\n]/g, '').trim()
  const base = cleaned.length > 0 ? cleaned : defaultBase

  // ラベルが既に拡張子つきなら二重に付けない
  if (ext && base.toLowerCase().endsWith(`.${ext}`)) {
    return base
  }
  return ext ? `${base}.${ext}` : base
}

// 共有シートを閉じた・キャンセルしたときの合図。**失敗ではない**ので、
// 呼び出し側はこれをエラー表示しない
export function isShareAborted(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  )
}

// ファイルのバイト列を共有シートへ渡す。
//
// **ユーザー操作の直後に呼ぶこと**。iOS は transient activation が切れると
// NotAllowedError で弾くため、呼ぶ前に通信を挟まない (バイト列を手元に持って
// から呼ぶ。PDF は pdfService.getData、音声は fetch 済みの blob)。
export async function shareFile(
  bytes: Uint8Array,
  fileName: string,
  mime: string,
  nav: Navigator = navigator,
): Promise<void> {
  // Uint8Array をそのまま渡さず、実体の ArrayBuffer を切り出して File にする
  // (Prisma と同じで、共有プールを指す view を渡さない)
  const file = new File([bytes.slice().buffer as ArrayBuffer], fileName, {
    type: mime,
  })
  await nav.share({ files: [file], title: fileName })
}

// 共有が「一時的な許可切れ」で弾かれたか (AbortError = ユーザーが閉じた、とは別)。
// iOS は share の直前に通信を挟むと transient activation が切れ、
// NotAllowedError を投げる。このときはバイト列を手元に残して「もう一度押す」で
// 救えるので、呼び出し側がこの合図で 2 段構えに切り替える (41-QR-search/docs/12)。
export function isShareActivationLost(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'NotAllowedError'
  )
}
