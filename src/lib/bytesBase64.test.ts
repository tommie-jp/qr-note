import { describe, expect, test } from 'vitest'
import { base64ToBytes, base64UrlToBytes, bytesToBase64 } from './bytesBase64'

describe('bytesToBase64 / base64ToBytes', () => {
  test('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42])
    const back = base64ToBytes(bytesToBase64(bytes))
    expect(back && Array.from(back)).toEqual(Array.from(bytes))
  })

  test('round-trips an empty array', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    const back = base64ToBytes('')
    expect(back && back.byteLength).toBe(0)
  })

  test('handles a large array without blowing the stack', () => {
    const bytes = new Uint8Array(200_000).fill(7)
    const back = base64ToBytes(bytesToBase64(bytes))
    expect(back?.byteLength).toBe(bytes.byteLength)
  })

  test('returns null for a non-base64 string (外から来る値を信じない)', () => {
    expect(base64ToBytes('!!!!')).toBe(null)
    expect(base64ToBytes('a')).toBe(null)
  })
})

describe('base64UrlToBytes', () => {
  test('decodes the unpadded url-safe form (credential ID の形)', () => {
    // 0xfb 0xff 0xbf は base64 で "+/+/" になり、base64url では "-_-_"
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xfb, 0xff, 0xbf])
    const urlSafe = bytesToBase64(bytes)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const back = base64UrlToBytes(urlSafe)
    expect(back && Array.from(back)).toEqual(Array.from(bytes))
  })

  test('accepts a length that needs padding restored', () => {
    const back = base64UrlToBytes(bytesToBase64(new Uint8Array([1])).replace(/=+$/, ''))
    expect(back && Array.from(back)).toEqual([1])
  })
})
