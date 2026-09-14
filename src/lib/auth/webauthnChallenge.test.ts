import { beforeEach, describe, expect, test } from 'vitest'
import {
  __resetChallengesForTest,
  CHALLENGE_MAX,
  CHALLENGE_TTL_MS,
  consumeChallenge,
  consumeChallengeFromClientData,
  countPendingChallenges,
  rememberChallenge,
} from './webauthnChallenge'

const NOW = new Date('2026-07-19T00:00:00.000Z')

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms)
}

beforeEach(() => {
  __resetChallengesForTest()
})

describe('rememberChallenge / consumeChallenge', () => {
  test('accepts a challenge that was handed out', () => {
    rememberChallenge('abc', NOW)

    expect(consumeChallenge('abc', NOW)).toBe(true)
  })

  test('rejects a challenge that was never handed out', () => {
    expect(consumeChallenge('never-issued', NOW)).toBe(false)
  })

  test('rejects a replay of an already used challenge', () => {
    rememberChallenge('abc', NOW)
    consumeChallenge('abc', NOW)

    expect(consumeChallenge('abc', NOW)).toBe(false)
  })

  test('rejects a challenge once its 5 minutes are up', () => {
    rememberChallenge('abc', NOW)

    expect(consumeChallenge('abc', later(CHALLENGE_TTL_MS + 1))).toBe(false)
  })

  test('still accepts a challenge just before it expires', () => {
    rememberChallenge('abc', NOW)

    expect(consumeChallenge('abc', later(CHALLENGE_TTL_MS - 1))).toBe(true)
  })

  test('consumes an expired challenge instead of leaving it behind', () => {
    rememberChallenge('abc', NOW)
    consumeChallenge('abc', later(CHALLENGE_TTL_MS + 1))

    expect(countPendingChallenges()).toBe(0)
  })

  test('keeps challenges independent of one another', () => {
    rememberChallenge('a', NOW)
    rememberChallenge('b', NOW)

    expect(consumeChallenge('a', NOW)).toBe(true)
    expect(consumeChallenge('b', NOW)).toBe(true)
  })
})

describe('bounding the store', () => {
  test('never grows past the cap however many are requested', () => {
    for (let i = 0; i < CHALLENGE_MAX * 5; i += 1) {
      rememberChallenge(`challenge-${i}`, NOW)
    }

    expect(countPendingChallenges()).toBeLessThanOrEqual(CHALLENGE_MAX)
  })

  test('drops the oldest challenge when the cap is reached', () => {
    rememberChallenge('oldest', NOW)
    for (let i = 0; i < CHALLENGE_MAX; i += 1) {
      rememberChallenge(`challenge-${i}`, NOW)
    }

    expect(consumeChallenge('oldest', NOW)).toBe(false)
  })

  test('sweeps expired challenges rather than counting them against the cap', () => {
    rememberChallenge('stale', NOW)

    rememberChallenge('fresh', later(CHALLENGE_TTL_MS + 1))

    expect(countPendingChallenges()).toBe(1)
    expect(consumeChallenge('fresh', later(CHALLENGE_TTL_MS + 1))).toBe(true)
  })
})

describe('consumeChallengeFromClientData', () => {
  function clientData(challenge: string): string {
    return Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge }), 'utf8').toString(
      'base64url',
    )
  }

  test('consumes the challenge the authenticator signed over', () => {
    rememberChallenge('abc', NOW)

    consumeChallengeFromClientData(clientData('abc'), NOW)

    // 一度使われた以上、もう通ってはいけない
    expect(consumeChallenge('abc', NOW)).toBe(false)
  })

  test('leaves other challenges alone', () => {
    rememberChallenge('mine', NOW)
    rememberChallenge('yours', NOW)

    consumeChallengeFromClientData(clientData('mine'), NOW)

    expect(consumeChallenge('yours', NOW)).toBe(true)
  })

  test('does nothing when the client data is not valid base64 JSON', () => {
    rememberChallenge('abc', NOW)

    consumeChallengeFromClientData('not-base64-json', NOW)

    expect(countPendingChallenges()).toBe(1)
  })

  test('does nothing when the value is missing or not a string', () => {
    rememberChallenge('abc', NOW)

    consumeChallengeFromClientData(undefined, NOW)
    consumeChallengeFromClientData(null, NOW)
    consumeChallengeFromClientData(42, NOW)

    expect(countPendingChallenges()).toBe(1)
  })

  test('does nothing when the JSON has no challenge field', () => {
    rememberChallenge('abc', NOW)

    const noChallenge = Buffer.from(JSON.stringify({ type: 'webauthn.get' }), 'utf8').toString(
      'base64url',
    )
    consumeChallengeFromClientData(noChallenge, NOW)

    expect(countPendingChallenges()).toBe(1)
  })
})
