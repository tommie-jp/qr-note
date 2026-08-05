import { describe, expect, test } from 'vitest'
import {
  MAX_SECRET_BYTES,
  SECRET_TEXT_MIME,
  checkSecretPayload,
  isSecretImageMime,
  isSecretMime,
} from './secretPayload'

describe('isSecretMime', () => {
  test('accepts the fragment body and displayable images', () => {
    expect(isSecretMime(SECRET_TEXT_MIME)).toBe(true)
    expect(isSecretMime('image/webp')).toBe(true)
    expect(isSecretMime('image/jpeg')).toBe(true)
  })

  test('rejects anything else (未知の mime を溜め込まない)', () => {
    expect(isSecretMime('text/html')).toBe(false)
    expect(isSecretMime('application/pdf')).toBe(false)
    expect(isSecretMime('image/svg+xml')).toBe(false)
    expect(isSecretMime('')).toBe(false)
  })
})

describe('isSecretImageMime', () => {
  test('separates images from the fragment body', () => {
    expect(isSecretImageMime('image/png')).toBe(true)
    expect(isSecretImageMime(SECRET_TEXT_MIME)).toBe(false)
  })
})

describe('checkSecretPayload', () => {
  test('accepts a normal payload', () => {
    expect(checkSecretPayload(SECRET_TEXT_MIME, 100)).toBe(null)
  })

  test('rejects an unknown mime with 400', () => {
    expect(checkSecretPayload('text/html', 100)?.status).toBe(400)
  })

  test('rejects an empty body (エンベロープの体を成さない)', () => {
    expect(checkSecretPayload(SECRET_TEXT_MIME, 0)?.status).toBe(400)
  })

  test('rejects an oversized body with 413', () => {
    expect(checkSecretPayload('image/png', MAX_SECRET_BYTES + 1)?.status).toBe(
      413,
    )
  })
})
