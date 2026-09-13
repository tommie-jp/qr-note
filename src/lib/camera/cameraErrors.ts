// カメラを開けなかった理由を、利用者に出す文にする (docs/09-スキャン計画.md §6・
// docs/25)。黙って真っ黒な画面を見せると原因を追えないので、何が起きたか・
// どうすれば直るかまで書く。
//
// 口は 2 つある。**文言は共有するが、対応表は分けたまま明示する**:
//
// - SCANNER_ERROR_MESSAGES … ScannerModal。<Scanner> (@yudiel/react-qr-scanner) が
//   分類済みのコード (ScannerErrorKind) で知らせてくる
// - cameraErrorMessage … ImageSearchModal。自分で呼んだ getUserMedia の
//   例外名 (DOMException.name) から引く
//
// 同じ原因でも 1 か所だけ行き先が違う: DOMException の SecurityError は
// 「許可されていない」と同じ文言にしている (ImageSearchModal に元からあった
// 対応表のまま) が、ライブラリの security は専用の文言を持つ。
//
// 録画・録音 (lib/video/videoRecorder.ts・lib/audio/audioRecorder.ts の
// mapCaptureError) は文体も対処の書き方も違う別系統なので、ここへは寄せていない

import type { ScannerErrorKind } from '@yudiel/react-qr-scanner'

export const CAMERA_ERROR_MESSAGES = {
  permissionDenied:
    'カメラの使用が許可されていません。ブラウザのサイト設定でカメラを許可してください。',
  noCamera: 'カメラが見つかりません。',
  inUse: '他のアプリがカメラを使用中です。閉じてからもう一度お試しください。',
  overconstrained: 'この端末のカメラでは条件を満たせませんでした。',
  // https でないと getUserMedia 自体が使えない (docs/09-スキャン計画.md §6)
  insecureContext: 'カメラは https でしか使えません。https でアクセスしてください。',
  unsupported: 'このブラウザはカメラのスキャンに対応していません。',
  aborted: 'カメラの起動が中断されました。',
  security: 'セキュリティ設定によりカメラを開けませんでした。',
  typeError: 'カメラの起動に失敗しました。',
  unknown: 'カメラを開けませんでした。',
} as const

// Record にして ScannerErrorKind の追加を型で検出させる (取りこぼし防止)
export const SCANNER_ERROR_MESSAGES: Record<ScannerErrorKind, string> = {
  'permission-denied': CAMERA_ERROR_MESSAGES.permissionDenied,
  'no-camera': CAMERA_ERROR_MESSAGES.noCamera,
  'in-use': CAMERA_ERROR_MESSAGES.inUse,
  overconstrained: CAMERA_ERROR_MESSAGES.overconstrained,
  'insecure-context': CAMERA_ERROR_MESSAGES.insecureContext,
  unsupported: CAMERA_ERROR_MESSAGES.unsupported,
  aborted: CAMERA_ERROR_MESSAGES.aborted,
  security: CAMERA_ERROR_MESSAGES.security,
  'type-error': CAMERA_ERROR_MESSAGES.typeError,
  unknown: CAMERA_ERROR_MESSAGES.unknown,
}

// getUserMedia が投げたもの → 文言。
// isInsecureContext は「navigator はあるのに mediaDevices が無い」= https でない
// (既定は実行環境から読む。テストでは明示して渡す)
export function cameraErrorMessage(
  err: unknown,
  isInsecureContext: boolean = typeof navigator !== 'undefined' &&
    !navigator.mediaDevices,
): string {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return CAMERA_ERROR_MESSAGES.permissionDenied
    case 'NotFoundError':
      return CAMERA_ERROR_MESSAGES.noCamera
    case 'NotReadableError':
      return CAMERA_ERROR_MESSAGES.inUse
    case 'OverconstrainedError':
      return CAMERA_ERROR_MESSAGES.overconstrained
    default:
      return isInsecureContext
        ? CAMERA_ERROR_MESSAGES.insecureContext
        : CAMERA_ERROR_MESSAGES.unknown
  }
}
