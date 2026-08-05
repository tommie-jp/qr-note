import { describe, expect, test } from 'vitest'
import { fitWithin } from './secretImage'

describe('fitWithin', () => {
  test('keeps small images as they are', () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })

  test('shrinks the long side to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 })
  })

  test('never returns zero (1px の絵でも canvas を作れる)', () => {
    expect(fitWithin(1, 10000, 100)).toEqual({ width: 1, height: 100 })
  })
})
