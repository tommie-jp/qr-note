// 一覧ページ (検索・ゴミ箱) が描画前に読む「端末ごとの好み」の cookie
// (docs/93-リファクタリング計画.md §4-8)。
//
// 並び順・表示モード・ペイン構成はどれも URL ではなく (並び順は URL と併用で)
// cookie に持つ。サーバで読めるから初回描画から正しい見た目で出る。
// 読み方の規則はそれぞれのモジュールが持ち、ここは束ねるだけ:
//
//   並び順     … sortMode.ts   (URL → cookie → 既定)
//   表示モード … viewMode.ts   (docs/23-検索結果表示モード計画.md §5)
//   ペイン構成 … paneMode.ts   (docs/86 §4-4)
//
// cookie の読み口は next/headers の cookies() が返す物をそのまま受ける。
// 型は get だけの最小形にして、テストでは素のオブジェクトで差し替える

import { parsePaneMode, PANE_MODE_COOKIE, type PaneMode } from './paneMode'
import {
  resolveSort,
  resolveTrashSort,
  SORT_COOKIE,
  TRASH_SORT_COOKIE,
} from './sortMode'
import type { Sort, TrashSort } from './validation'
import { parseViewMode, VIEW_MODE_COOKIE, type ViewMode } from './viewMode'

export interface CookieReader {
  get(name: string): { value: string } | undefined
}

export interface SearchPrefs {
  sort: Sort
  view: ViewMode
  paneMode: PaneMode
}

export interface TrashPrefs {
  sort: TrashSort
  view: ViewMode
}

// 検索一覧 ((search)/page.tsx)。urlSort は `?sort=` の値 (無ければ undefined)
export function readSearchPrefs(
  cookieStore: CookieReader,
  urlSort: unknown,
): SearchPrefs {
  return {
    // 並び順は URL → cookie → 既定 の順に決める (src/lib/sortMode.ts)。
    // URL だけを見ていた頃は、?sort= を持たない入口 (ヘッダーのホーム・
    // 検索フォーム・スキャン・タグリンク) から入るたびに既定へ戻っていた
    sort: resolveSort(urlSort, cookieStore.get(SORT_COOKIE)?.value),
    // 表示モードは検索状態ではなく端末ごとの好みなので URL ではなく cookie。
    // ここ (サーバ) で読めるから初回描画から正しい見た目で出る
    // (docs/23-検索結果表示モード計画.md §5)
    view: parseViewMode(cookieStore.get(VIEW_MODE_COOKIE)?.value),
    // ペイン構成 (docs/86 §4-4)。フォルダーを出すか、先頭のノートを自動で
    // 選ぶかがここで決まる。**サーバで決めるのが要点** — クライアントで
    // 隠すだけだと、出さない構成でもタグの集計を引いてしまう
    paneMode: parsePaneMode(cookieStore.get(PANE_MODE_COOKIE)?.value),
  }
}

// ゴミ箱 (trash/page.tsx)。表示形式と並び順は検索一覧と同じ作法で決める
// (docs/67-ゴミ箱表示形式計画.md):
//   表示形式 … cookie 1 つを検索一覧と共有 (端末ごとの好み)
//   並び順   … URL → ゴミ箱用 cookie → 既定 (削除順)
export function readTrashPrefs(
  cookieStore: CookieReader,
  urlSort: unknown,
): TrashPrefs {
  return {
    sort: resolveTrashSort(urlSort, cookieStore.get(TRASH_SORT_COOKIE)?.value),
    view: parseViewMode(cookieStore.get(VIEW_MODE_COOKIE)?.value),
  }
}
