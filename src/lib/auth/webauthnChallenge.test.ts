import { beforeEach, describe, expect, test } from 'vitest'
import {
  __resetChallengesForTest,
  CHALLENGE_TTL_MS,
  CHALLENGE_USED_MAX,
  consumeChallenge,
  consumeChallengeFromClientData,
  countUsedChallenges,
  issueChallenge,
} from './webauthnChallenge'

// 署名入りチャレンジ (docs/29 §5, §9。2026-11 の監査で覚える方式から替えた)。
// 認証器は発行した文字列を base64url にして返す (clientDataJSON の challenge)

const NOW = new Date('2026-07-19T00:00:00.000Z')

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms)
}

// SimpleWebAuthn が options.challenge に入れる形 = 文字列の UTF-8 を base64url
const encoded = (challenge: string) => Buffer.from(challenge, 'utf8').toString('base64url')

beforeEach(() => {
  __resetChallengesForTest()
})

describe('issueChallenge / consumeChallenge', () => {
  test('accepts a challenge that was issued', () => {
    const challenge = issueChallenge(NOW)
    expect(consumeChallenge(encoded(challenge), NOW)).toBe(true)
  })

  test('rejects a challenge that was never issued (wrong signature)', () => {
    const forged = `${'a'.repeat(22)}.${later(60_000).getTime()}.${'b'.repeat(43)}`
    expect(consumeChallenge(encoded(forged), NOW)).toBe(false)
  })

  test('rejects a tampered expiry', () => {
    const [nonce, , signature] = issueChallenge(NOW).split('.')
    const stretched = `${nonce}.${later(10 * CHALLENGE_TTL_MS).getTime()}.${signature}`
    expect(consumeChallenge(encoded(stretched), later(2 * CHALLENGE_TTL_MS))).toBe(false)
  })

  test('rejects a replay of an already used challenge', () => {
    const challenge = issueChallenge(NOW)
    expect(consumeChallenge(encoded(challenge), NOW)).toBe(true)
    expect(consumeChallenge(encoded(challenge), NOW)).toBe(false)
  })

  test('rejects a challenge once its 5 minutes are up', () => {
    const challenge = issueChallenge(NOW)
    expect(consumeChallenge(encoded(challenge), later(CHALLENGE_TTL_MS))).toBe(false)
  })

  test('still accepts a challenge just before it expires', () => {
    const challenge = issueChallenge(NOW)
    expect(consumeChallenge(encoded(challenge), later(CHALLENGE_TTL_MS - 1))).toBe(true)
  })

  test('rejects garbage and values that are not base64url of the issued form', () => {
    expect(consumeChallenge('', NOW)).toBe(false)
    expect(consumeChallenge('!!!', NOW)).toBe(false)
    expect(consumeChallenge(encoded('no.dots'), NOW)).toBe(false)
  })

  // 覚える方式の弱点を塞いだことの固定: 何個発行されても、他の人の分は押し出されない
  test('a flood of fresh challenges does not invalidate an earlier one', () => {
    const mine = issueChallenge(NOW)
    for (let i = 0; i < 1000; i++) {
      issueChallenge(NOW)
    }
    expect(consumeChallenge(encoded(mine), NOW)).toBe(true)
  })

  test('a different process key (restart) rejects old challenges', () => {
    const challenge = issueChallenge(NOW)
    __resetChallengesForTest()
    expect(consumeChallenge(encoded(challenge), NOW)).toBe(false)
  })
})

describe('bounding the used set', () => {
  test('only genuine challenges are remembered (garbage cannot fill the set)', () => {
    for (let i = 0; i < 100; i++) {
      consumeChallenge(encoded(`x${i}.1.y`), NOW)
    }
    expect(countUsedChallenges()).toBe(0)
  })

  test('never grows past the cap', () => {
    for (let i = 0; i < CHALLENGE_USED_MAX + 50; i++) {
      consumeChallenge(encoded(issueChallenge(NOW)), NOW)
    }
    expect(countUsedChallenges()).toBeLessThanOrEqual(CHALLENGE_USED_MAX)
  })

  test('sweeps expired entries rather than keeping them', () => {
    consumeChallenge(encoded(issueChallenge(NOW)), NOW)
    consumeChallenge(encoded(issueChallenge(later(CHALLENGE_TTL_MS))), later(CHALLENGE_TTL_MS))
    expect(countUsedChallenges()).toBe(1)
  })
})

describe('consumeChallengeFromClientData', () => {
  function clientData(challenge: string): string {
    return Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge }), 'utf8').toString(
      'base64url',
    )
  }

  test('consumes the challenge the authenticator signed over', () => {
    const challenge = encoded(issueChallenge(NOW))

    consumeChallengeFromClientData(clientData(challenge), NOW)

    // 一度使われた以上、もう通ってはいけない
    expect(consumeChallenge(challenge, NOW)).toBe(false)
  })

  test('leaves other challenges alone', () => {
    const other = encoded(issueChallenge(NOW))
    consumeChallengeFromClientData(clientData(encoded(issueChallenge(NOW))), NOW)
    expect(consumeChallenge(other, NOW)).toBe(true)
  })

  test('does nothing when the client data is not valid base64 JSON', () => {
    expect(() => consumeChallengeFromClientData('not-json', NOW)).not.toThrow()
    expect(() => consumeChallengeFromClientData(undefined, NOW)).not.toThrow()
    expect(() => consumeChallengeFromClientData(42, NOW)).not.toThrow()
  })

  test('does nothing when the JSON has no challenge field', () => {
    const noChallenge = Buffer.from(JSON.stringify({ type: 'webauthn.get' })).toString('base64url')
    expect(() => consumeChallengeFromClientData(noChallenge, NOW)).not.toThrow()
    expect(countUsedChallenges()).toBe(0)
  })
})
