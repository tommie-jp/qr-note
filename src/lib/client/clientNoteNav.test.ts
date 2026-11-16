import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  clientNoteClickHref,
  clientNoteHref,
  DOUBLE_CLICK_MS,
  DOUBLE_CLICK_SLOP_PX,
  editNoteHref,
  isSecondRowClick,
  openClientNote,
  registerClientNotePane,
  rowEditItemId,
  showingClientNote,
} from './clientNoteNav'
import { dropDeferredRefresh, flushDeferredRefresh, navigate, refreshRouter, registerRouter } from './navigation'

// 検索画面の中でノートを端末で開く遷移 (docs/123 §12)

const ORIGIN = 'https://qr.example'
const ID = '0199a8f2-1c3d-7e4f-8a5b-6c7d8e9f0a1b'

class FakeElement {
  constructor(private readonly anchor: FakeAnchor | null = null) {}
  closest(): FakeAnchor | null {
    return this.anchor
  }
}

class FakeAnchor extends FakeElement {
  constructor(
    readonly href: string,
    readonly target = '',
    private readonly download = false,
  ) {
    super()
  }
  override closest(): FakeAnchor {
    return this
  }
  hasAttribute(name: string): boolean {
    return name === 'download' && this.download
  }
}

function click(target: unknown, extra: Partial<Record<string, unknown>> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: target as EventTarget,
    ...extra,
  }
}

function stubDom() {
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('HTMLAnchorElement', FakeAnchor)
}

function stubLocation(pathname: string, search = '') {
  const pushState = vi.fn()
  const replaceState = vi.fn()
  vi.stubGlobal('location', { origin: ORIGIN, pathname, search, hash: '' })
  vi.stubGlobal('window', { history: { pushState, replaceState } })
  return { pushState, replaceState }
}

afterEach(() => {
  registerRouter(null)
  vi.unstubAllGlobals()
})

describe('clientNoteHref', () => {
  test('同じ origin の /item/<UUID> だけを、query と hash ごと返す', () => {
    expect(clientNoteHref(`${ORIGIN}/item/${ID}?q=a#h`, ORIGIN)).toBe(`/item/${ID}?q=a#h`)
    expect(clientNoteHref(`/item/${ID}`, ORIGIN)).toBe(`/item/${ID}`)
  })

  test('旧番号・深いパス・別 origin・壊れた URL は端末で開かない', () => {
    expect(clientNoteHref(`${ORIGIN}/item/1003`, ORIGIN)).toBeNull()
    expect(clientNoteHref(`${ORIGIN}/item/${ID}/history`, ORIGIN)).toBeNull()
    expect(clientNoteHref(`https://other.example/item/${ID}`, ORIGIN)).toBeNull()
    expect(clientNoteHref('http://[', ORIGIN)).toBeNull()
  })
})

describe('clientNoteClickHref', () => {
  test('印の付いたリンクの素の左クリックなら行き先を返す', () => {
    stubDom()
    const anchor = new FakeAnchor(`${ORIGIN}/item/${ID}?q=a`)
    expect(clientNoteClickHref(click(new FakeElement(anchor)), ORIGIN)).toBe(`/item/${ID}?q=a`)
  })

  test('修飾キー・中ボタン・処理済み・別タブ・download・印なしはブラウザに任せる', () => {
    stubDom()
    const anchor = new FakeAnchor(`${ORIGIN}/item/${ID}`)
    expect(clientNoteClickHref(click(anchor, { metaKey: true }), ORIGIN)).toBeNull()
    expect(clientNoteClickHref(click(anchor, { button: 1 }), ORIGIN)).toBeNull()
    expect(clientNoteClickHref(click(anchor, { defaultPrevented: true }), ORIGIN)).toBeNull()
    expect(clientNoteClickHref(click(new FakeAnchor(`${ORIGIN}/item/${ID}`, '_blank')), ORIGIN)).toBeNull()
    expect(clientNoteClickHref(click(new FakeAnchor(`${ORIGIN}/item/${ID}`, '', true)), ORIGIN)).toBeNull()
    expect(clientNoteClickHref(click(new FakeElement(null)), ORIGIN)).toBeNull()
  })
})

describe('openClientNote', () => {
  test('別の URL へは push、今と同じ URL や replace 指定は replace', () => {
    const { pushState, replaceState } = stubLocation('/', '?q=a')

    openClientNote(`/item/${ID}?q=a`)
    openClientNote('/?q=a')
    openClientNote(`/item/${ID}`, { replace: true })

    expect(pushState).toHaveBeenCalledWith(null, '', `/item/${ID}?q=a`)
    expect(replaceState).toHaveBeenNthCalledWith(1, null, '', '/?q=a')
    expect(replaceState).toHaveBeenNthCalledWith(2, null, '', `/item/${ID}`)
  })
})

describe('検索画面に器が居るときの navigate / refreshRouter', () => {
  test('ノートへの navigate は router を使わず端末で開く', () => {
    const { pushState } = stubLocation('/')
    const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
    registerRouter(router)
    const unregister = registerClientNotePane()

    navigate(`/item/${ID}?saved=1`)
    navigate('/trash')
    unregister()

    expect(pushState).toHaveBeenCalledWith(null, '', `/item/${ID}?saved=1`)
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/trash')
  })

  test('端末で開いたノートを出している間の refresh は、閉じるまで遅らせる', () => {
    // Arrange
    stubLocation(`/item/${ID}`, '?q=a')
    const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
    const unregister = registerClientNotePane()

    // Act / Assert: 出している間は流さない
    expect(showingClientNote()).toBe(true)
    refreshRouter(router)
    flushDeferredRefresh()
    expect(router.refresh).not.toHaveBeenCalled()

    // 閉じたら 1 回だけ流す
    stubLocation('/', '?q=a')
    flushDeferredRefresh()
    flushDeferredRefresh()
    unregister()
    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })

  test('検索画面を離れたら遅らせた refresh は捨てる', () => {
    stubLocation(`/item/${ID}`)
    const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
    const unregister = registerClientNotePane()

    refreshRouter(router)
    unregister()
    dropDeferredRefresh()
    stubLocation('/trash')
    flushDeferredRefresh()

    expect(router.refresh).not.toHaveBeenCalled()
  })

  test('一覧に居るときの refresh はふつうの refresh', () => {
    stubLocation('/', '?q=a')
    const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
    const unregister = registerClientNotePane()

    refreshRouter(router)
    unregister()

    expect(router.refresh).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
  })
})

describe('一覧の行のダブルクリック', () => {
  test('印の付いた行のリンクなら、そのノートの番号を返す', () => {
    stubDom()
    const anchor = new FakeAnchor(`${ORIGIN}/item/${ID}?q=a`)
    expect(rowEditItemId(new FakeElement(anchor) as unknown as EventTarget, ORIGIN)).toBe(ID)
  })

  test('印の付いたリンクの外・旧番号・別 origin は null', () => {
    stubDom()
    expect(rowEditItemId(new FakeElement(null) as unknown as EventTarget, ORIGIN)).toBeNull()
    expect(rowEditItemId(new FakeAnchor(`${ORIGIN}/item/1003`) as unknown as EventTarget, ORIGIN)).toBeNull()
    expect(rowEditItemId(new FakeAnchor(`https://other.example/item/${ID}`) as unknown as EventTarget, ORIGIN)).toBeNull()
    expect(rowEditItemId(null, ORIGIN)).toBeNull()
  })

  test('間が短く同じ所なら 2 回目と見なす', () => {
    const mark = { itemId: ID, x: 100, y: 200, at: 1000 }
    expect(isSecondRowClick(mark, { x: 100, y: 200, at: 1000 + DOUBLE_CLICK_MS })).toBe(true)
    expect(
      isSecondRowClick(mark, { x: 100 + DOUBLE_CLICK_SLOP_PX, y: 200 - DOUBLE_CLICK_SLOP_PX, at: 1200 }),
    ).toBe(true)
  })

  test('遅い・離れている・控えが無いときは 2 回目にしない', () => {
    const mark = { itemId: ID, x: 100, y: 200, at: 1000 }
    expect(isSecondRowClick(mark, { x: 100, y: 200, at: 1001 + DOUBLE_CLICK_MS })).toBe(false)
    expect(isSecondRowClick(mark, { x: 101 + DOUBLE_CLICK_SLOP_PX, y: 200, at: 1100 })).toBe(false)
    expect(isSecondRowClick(mark, { x: 100, y: 201 + DOUBLE_CLICK_SLOP_PX, at: 1100 })).toBe(false)
    expect(isSecondRowClick(null, { x: 100, y: 200, at: 1100 })).toBe(false)
  })

  test('編集画面の URL', () => {
    expect(editNoteHref(ID)).toBe(`/edit/${ID}`)
  })
})
