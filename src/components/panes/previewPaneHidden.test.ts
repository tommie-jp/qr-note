import { describe, expect, test, vi } from 'vitest'
import { listHrefFromItemUrl, notifyPreviewPaneHidden, onPreviewPaneHidden } from './previewPaneHidden'

describe('listHrefFromItemUrl (下のペインを隠すとき一覧へ戻す URL)', () => {
  test('ノートの URL から検索語・並び順・表示の引数 (月) を残し、ノートだけの引数は落とす', () => {
    const url = new URL('http://x/item/abc?q=%23%E4%BA%88%E5%AE%9A&cal=2026-11&tab=event&date=2026-11-05')
    expect(listHrefFromItemUrl(url)).toBe('/?q=%23%E4%BA%88%E5%AE%9A&cal=2026-11')
  })

  test('ノートに居なければ null', () => {
    expect(listHrefFromItemUrl(new URL('http://x/?q=a'))).toBeNull()
  })
})

test('知らせは購読している全員に届き、外したら届かない', () => {
  const listener = vi.fn()
  const off = onPreviewPaneHidden(listener)
  notifyPreviewPaneHidden()
  off()
  notifyPreviewPaneHidden()
  expect(listener).toHaveBeenCalledTimes(1)
})
