// サーバーアクションの入口。使う側は置き場のファイルではなく `@/app/actions` から読む。
//
// バレルはこのリポジトリでは作らない流儀だが、ここは例外の 1 つ
// (docs/93-リファクタリング計画.md §1)。もとは 826 行の 1 本で、ページと部品の
// 10 か所から import されている。置き場を割り直すたびにその import を
// 書き換えずに済むよう、入口をここに固定する。
//
// 置き場 (どれも先頭に 'use server'):
//
//   actions/items.ts   … 本文の保存・チェック・健康記録・開いた記録
//   actions/publish.ts … 公開 (docs/22)
//   actions/offline.ts … オフラインの印 (docs/65)
//   actions/trash.ts   … ゴミ箱 (docs/12)
//   actions/tags.ts    … 一括タグ
//   actions/prefs.ts   … 見た目の好みの cookie (ペイン・表示モード・並び順)
//   actions/history.ts … git 履歴 (docs/57)
//
// `_` で始まる actions/_*.ts はアクションではない共有部品で、'use server' を
// 付けない (付けると export した関数が外から呼べる口になる)。**ここから
// 再 export するのもアクションだけ**にする
export {
  recordAccessAction,
  recordHealthAction,
  toggleMemoTaskAction,
  updateItemAction,
  updateMemoAction,
} from './actions/items'
export { setItemPublicAction } from './actions/publish'
export { setItemOfflinePinAction, setItemsOfflinePinAction } from './actions/offline'
export {
  emptyTrashAction,
  purgeItemsAction,
  restoreItemsAction,
  trashItemsAction,
} from './actions/trash'
export { bulkTagAction } from './actions/tags'
export {
  setPaneModeAction,
  setSortAction,
  setTrashSortAction,
  setViewModeAction,
} from './actions/prefs'
export {
  backfillHistoryAction,
  commitNoteAction,
  restoreNoteVersionAction,
} from './actions/history'
