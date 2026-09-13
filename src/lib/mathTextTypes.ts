// 一覧の数式 HTML (mathText.ts の buildMathTexts が作る) の型だけを置く葉
// (docs/93-リファクタリング計画.md §2-2)。
//
// mathText.ts は katex (~280KB) を引き込むサーバ専用 module。表示側の
// client component (ItemList・TrashList・ImageMasonry) が欲しいのは型だけ
// なので、置き場を分けてクライアントが合法的に import できるようにする。
// このファイルに値の依存を足さないこと

// itemNo → 数式入りのタイトル/プレビュー (KaTeX 済み HTML)。数式の無い
// フィールドは持たない (表示側がプレーンテキストへフォールバック)。
// サーバ→クライアント境界を越える prop なので素の Record
export type MathTextMap = Record<string, { title?: string; preview?: string }>
