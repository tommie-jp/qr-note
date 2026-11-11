// いまの URL の検索 (検索語・並び順) と、出している表示の引数 (カレンダーの月など) を
// 残した検索画面の URL。ノートの URL (/item/…) からも組める。ノートだけの引数
// (tab・date など) は落とす
import { buildSearchUrl } from '@/lib/search/url'
import { parseSort } from '@/lib/validation'
import { carryResultViewParams } from '@/modules/registry'

export function searchHrefKeepingView(params: URLSearchParams): string {
  const list = buildSearchUrl((params.get('q') ?? '').trim(), 1, parseSort(params.get('sort')))
  return carryResultViewParams(list, params)
}
