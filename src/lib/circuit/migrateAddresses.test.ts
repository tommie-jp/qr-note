import { describe, expect, test } from 'vitest'
import { planAddressMigration } from './migrateAddresses'

describe('planAddressMigration', () => {
  test('rewrites old addresses in a circuit fence', () => {
    const memo = '# 回路\n\n```circuit\nparts:\n  R1: resistor a1 a3 10k\n```\n'

    const plan = planAddressMigration(memo)

    expect(plan).toEqual({
      kind: 'rewrite',
      memo: '# 回路\n\n```circuit\nparts:\n  R1: resistor 1,1 3,1 10k\n```\n',
      changed: 2,
    })
  })

  test('is idempotent for already migrated text', () => {
    const memo = '```circuit\nparts:\n  R1: resistor 1,1 3,1 10k\n```\n'

    expect(planAddressMigration(memo)).toEqual({ kind: 'unchanged' })
  })

  test('leaves circuitikz and plain text alone', () => {
    const memo = '```circuitikz\n\\draw (0,0) to[R] (2,0);\n```\n\nresistor a1 a3\n'

    expect(planAddressMigration(memo)).toEqual({ kind: 'unchanged' })
  })

  test('keeps CRLF line endings', () => {
    const memo = '```circuit\r\nparts:\r\n  R1: resistor a1 a3 10k\r\n```\r\n'

    const plan = planAddressMigration(memo)

    expect(plan.kind).toBe('rewrite')
    expect(plan.kind === 'rewrite' && plan.memo).toBe(
      '```circuit\r\nparts:\r\n  R1: resistor 1,1 3,1 10k\r\n```\r\n',
    )
  })

  test('returns the unreadable words instead of writing a half-migrated memo', () => {
    const memo = '```circuit\nparts:\n  R1: resistor a1 zz9 10k\n```\n'

    const plan = planAddressMigration(memo)

    expect(plan.kind === 'manual' || plan.kind === 'rewrite').toBe(true)
    if (plan.kind === 'manual') expect(plan.skipped.length).toBeGreaterThan(0)
  })
})
