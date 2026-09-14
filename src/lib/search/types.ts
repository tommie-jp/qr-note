// 全文検索の検索式の型と定数 (search/ の葉)。
// 解析 (parse.ts) と書き換え (rewrite.ts) のどちらも持たない、型と綴りだけの層。
// SQL 組み立て (items/where.ts) や補完 (search/keywordComplete.ts) のように、式を
// **受け取るだけ**の側はここだけを import すればよい。
// 検索窓の文法は parse.ts 冒頭を参照。

// チェック状態の絞り込み (docs/56-チェック検索計画.md §5)。
// todo = 未チェックの項目が残っている、done = チェック済みの項目がある。
export type TaskState = 'todo' | 'done'

// 検索語 1 つ。text は全文検索 (memo/url) + itemNo 前方一致、
// tag は items.tags の完全一致、task は items.task_todo / task_done の個数、
// untagged はタグが 1 つも無いノート (docs/86 §5 未分類フォルダー)。
export type SearchTerm =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'task'; value: TaskState }
  | { kind: 'untagged' }

// 検索式の抽象構文木。items/where.ts がこれを再帰的に WHERE 句へコンパイルする。
// DNF (選言標準形) へ展開しないのは、括弧と NOT の組み合わせで項が
// 指数的に増えうるため。木のままなら入力サイズに比例した SQL で済む。
export type SearchExpr =
  | { op: 'term'; term: SearchTerm }
  | { op: 'not'; child: SearchExpr }
  | { op: 'and'; children: SearchExpr[] }
  | { op: 'or'; children: SearchExpr[] }

// 1 クエリあたりの語数の上限 (式全体の葉の数)。
// 語数分だけ WHERE 条件が増えるため、極端に長い入力を防ぐ安全弁。
export const MAX_SEARCH_TERMS = 10

// タグの無いノートの絞り込み語 (docs/86 §5)。未分類フォルダーのリンク先を
// 検索語として表現するために足した — 「フォルダーは常に検索のエイリアス」
// を保つには、URL に書ける語が要る。リンクを組む側 (FolderPane) も
// この定数を使い、綴りの正本をここ 1 か所に保つ
export const UNTAGGED_TOKEN = 'is:untagged'
