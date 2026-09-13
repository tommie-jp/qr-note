import { describe, expect, test } from 'vitest'
import {
  CAMERA_ERROR_MESSAGES,
  SCANNER_ERROR_MESSAGES,
  cameraErrorMessage,
} from './cameraErrors'

const domError = (name: string) => new DOMException('', name)

describe('cameraErrorMessage (getUserMedia の例外名)', () => {
  test.each([
    ['NotAllowedError', CAMERA_ERROR_MESSAGES.permissionDenied],
    ['SecurityError', CAMERA_ERROR_MESSAGES.permissionDenied],
    ['NotFoundError', CAMERA_ERROR_MESSAGES.noCamera],
    ['NotReadableError', CAMERA_ERROR_MESSAGES.inUse],
    ['OverconstrainedError', CAMERA_ERROR_MESSAGES.overconstrained],
  ])('%s は対応する文言にする', (name, expected) => {
    // Arrange
    const err = domError(name)

    // Act
    const message = cameraErrorMessage(err, false)

    // Assert
    expect(message).toBe(expected)
  })

  test('知らない例外名は「開けませんでした」にする', () => {
    // Arrange
    const err = domError('AbortError')

    // Act
    const message = cameraErrorMessage(err, false)

    // Assert
    expect(message).toBe('カメラを開けませんでした。')
  })

  test('https でない (mediaDevices が無い) なら、知らない例外は https の案内にする', () => {
    // Arrange
    const err = new Error('getUserMedia is not a function')

    // Act
    const message = cameraErrorMessage(err, true)

    // Assert
    expect(message).toBe('カメラは https でしか使えません。https でアクセスしてください。')
  })

  test('https でなくても、名前の分かる例外はその文言を優先する', () => {
    // Arrange
    const err = domError('NotFoundError')

    // Act
    const message = cameraErrorMessage(err, true)

    // Assert
    expect(message).toBe(CAMERA_ERROR_MESSAGES.noCamera)
  })

  test('DOMException でないものは名前を見ない (Error の name が一致しても)', () => {
    // Arrange
    const err = Object.assign(new Error('x'), { name: 'NotAllowedError' })

    // Act
    const message = cameraErrorMessage(err, false)

    // Assert
    expect(message).toBe(CAMERA_ERROR_MESSAGES.unknown)
  })
})

describe('SCANNER_ERROR_MESSAGES (<Scanner> の分類コード)', () => {
  test('同じ原因は getUserMedia 側と同じ文言を出す', () => {
    // Arrange / Act / Assert
    expect(SCANNER_ERROR_MESSAGES['permission-denied']).toBe(
      cameraErrorMessage(domError('NotAllowedError'), false),
    )
    expect(SCANNER_ERROR_MESSAGES['no-camera']).toBe(
      cameraErrorMessage(domError('NotFoundError'), false),
    )
    expect(SCANNER_ERROR_MESSAGES['in-use']).toBe(
      cameraErrorMessage(domError('NotReadableError'), false),
    )
    expect(SCANNER_ERROR_MESSAGES.overconstrained).toBe(
      cameraErrorMessage(domError('OverconstrainedError'), false),
    )
    expect(SCANNER_ERROR_MESSAGES.unknown).toBe(cameraErrorMessage(domError('AbortError'), false))
  })

  test('security だけは getUserMedia 側 (SecurityError → 許可なし) と行き先が違う', () => {
    // Arrange / Act / Assert
    expect(SCANNER_ERROR_MESSAGES.security).toBe('セキュリティ設定によりカメラを開けませんでした。')
    expect(cameraErrorMessage(domError('SecurityError'), false)).not.toBe(
      SCANNER_ERROR_MESSAGES.security,
    )
  })

  test('ScannerModal が以前持っていた文言をそのまま保つ', () => {
    // Arrange / Act / Assert
    expect(SCANNER_ERROR_MESSAGES).toEqual({
      'permission-denied':
        'カメラの使用が許可されていません。ブラウザのサイト設定でカメラを許可してください。',
      'no-camera': 'カメラが見つかりません。',
      'in-use': '他のアプリがカメラを使用中です。閉じてからもう一度お試しください。',
      overconstrained: 'この端末のカメラでは条件を満たせませんでした。',
      'insecure-context': 'カメラは https でしか使えません。https でアクセスしてください。',
      unsupported: 'このブラウザはカメラのスキャンに対応していません。',
      aborted: 'カメラの起動が中断されました。',
      security: 'セキュリティ設定によりカメラを開けませんでした。',
      'type-error': 'カメラの起動に失敗しました。',
      unknown: 'カメラを開けませんでした。',
    })
  })
})
