import { describe, expect, it } from 'vitest'
import { DRAG_START_PX, isClickAfterDrag, hasDragStarted } from './dragGesture'

describe('hasDragStarted', () => {
  it('stays a click while the pointer has not moved', () => {
    expect(hasDragStarted({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false)
  })

  it('stays a click for a small wobble', () => {
    expect(hasDragStarted({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(false)
  })

  it('becomes a drag once the pointer moves the threshold', () => {
    expect(hasDragStarted({ x: 10, y: 10 }, { x: 10, y: 10 + DRAG_START_PX })).toBe(true)
  })

  it('counts movement in any direction', () => {
    expect(hasDragStarted({ x: 10, y: 10 }, { x: 10 - DRAG_START_PX, y: 10 })).toBe(true)
  })
})

describe('isClickAfterDrag', () => {
  it('treats a click right after a drag as part of the drag', () => {
    expect(isClickAfterDrag(1000, 1100)).toBe(true)
  })

  it('treats a later click as a fresh click', () => {
    expect(isClickAfterDrag(1000, 2000)).toBe(false)
  })

  it('treats a click with no earlier drag as a fresh click', () => {
    expect(isClickAfterDrag(null, 1000)).toBe(false)
  })
})
