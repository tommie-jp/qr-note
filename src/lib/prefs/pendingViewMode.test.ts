import { describe, expect, test } from 'vitest'
import {
  IDLE_VIEW_SWITCH,
  beginViewSwitch,
  expireViewSwitch,
  isSwitchingView,
  settleViewSwitch,
} from './pendingViewMode'

describe('表示モードの切替待ち', () => {
  test('押すと送った先を持ち、サーバの値と違う間は切替中', () => {
    const state = beginViewSwitch(IDLE_VIEW_SWITCH, 'card', 1)

    expect(isSwitchingView(state, 'compact')).toBe(true)
  })

  test('サーバの描き直しが送った先に追いついたら片付ける', () => {
    const state = beginViewSwitch(IDLE_VIEW_SWITCH, 'card', 1)

    expect(settleViewSwitch(state, 'card')).toBe(IDLE_VIEW_SWITCH)
  })

  test('続けて押したとき、途中の描き直し (1 回目の結果) では片付けない', () => {
    const first = beginViewSwitch(IDLE_VIEW_SWITCH, 'medium', 1)
    const second = beginViewSwitch(first, 'card', 2)

    const afterFirstRender = settleViewSwitch(second, 'medium')

    expect(afterFirstRender).toBe(second)
    expect(isSwitchingView(afterFirstRender, 'medium')).toBe(true)
  })

  test('返事が来ないまま上限を過ぎたら、その押下の分だけ捨てる (切替中のまま固まらない)', () => {
    const state = beginViewSwitch(IDLE_VIEW_SWITCH, 'card', 7)

    expect(expireViewSwitch(state, 7)).toBe(IDLE_VIEW_SWITCH)
  })

  test('後から押し直していれば、前の押下の上限では捨てない', () => {
    const first = beginViewSwitch(IDLE_VIEW_SWITCH, 'medium', 1)
    const second = beginViewSwitch(first, 'card', 2)

    expect(expireViewSwitch(second, 1)).toBe(second)
  })

  test('何も押していなければ切替中ではない', () => {
    expect(isSwitchingView(IDLE_VIEW_SWITCH, 'compact')).toBe(false)
  })
})
