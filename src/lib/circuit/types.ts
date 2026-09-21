// 回路図まわりの型と定数だけを置く葉 (docs/93-リファクタリング計画.md §2-2)。
//
// **prisma も node:child_process も引き込まない。** 描画とキャッシュの本体
// (circuit/cache.ts / circuit/circuitikz.ts / circuit/thumbs.ts) はサーバ専用で、
// client component (CircuitDiagram・MarkdownView・NoteBody・OfflineNote・
// 一覧の部品) が欲しいのはここにある型だけ。型の置き場をサーバ側の
// module と分けておけば、クライアントは合法的にここを import できる。
// このファイルに値の依存 (db・sharp・子プロセス) を足さないこと

// 1 つのメモで描く回路図の上限。
// 描画は 1 枚ずつ順に行い、1 枚あたり最大 CIRCUIT_TIMEOUT_MS かかる。
// 本文はもう待たない (planCircuits) が、際限なく並べられると 1 回の表示で
// 数十枚ぶんの TeX が走り、本番の 2GB / 3 コアを図だけで埋めてしまう
// (10,000 字あれば数十個書ける)。
// 一覧サムネの取得 (circuit/thumbs.ts) も同じ上限で切り、9 個目以降は
// 「描かれない図」なので引きにも行かない。
//
// **2 つの回路フェンス (circuitikz / circuit) の合算で数える** (docs/91 §4)。
// 上限の理由は「1 回の表示で走る TeX の総量」で、言語が増えても走る TeX の
// 重さは変わらない。言語ごとに 8 枚にすると、上限の意味が黙って倍になる
export const MAX_CIRCUITS_PER_MEMO = 8

// 回路 YAML フェンスが返す「行番号つきの 1 件」(docs/91)。
// **読めなかった行 (errors) と、お知らせ (notices) の両方**に使う —
// お知らせは読めなかったわけではなく、**図は描けたが思ったとおりには出ない**もの
// (斜めに入る足への線、部品 ID にも番地にも読める指し先など)。
// 行は分かるとは限らない (図全体に関わる指摘は null)。
// 実体配線図の BoardIssue (markdown/boardRender.ts) と同じ形
export interface CircuitIssue {
  readonly line: number | null
  readonly message: string
}

// 1 つの回路フェンスの描画結果。成功か失敗のどちらか。
//
// **「読めない行がある」は失敗ではない** (circuit-fence 0.8.0 から)。1 つでも
// 組めれば図は描けるので、読めなかった行は errors に載って**成功の側**に来る。
// 失敗 (error) は図を 1 つも組めなかったときで、そのとき errors は無い
// (言うことは error の字にすべて入っている)。実体配線図と同じ扱い (docs/97)。
//
// notices は circuit フェンス (YAML) だけが持つ。**成功にも失敗にも付く** —
// 図が描けたときこそ「見えている絵と繋がりが違う」を伝える必要がある。
// 書き手が `style: debug: off` と書いた図では空になる。
// **errors はその対象ではない** — 読めなかった行は直さない限り図が変わらないので、
// 承知のうえで黙らせる類のものではない
export type CircuitResult =
  | {
      svg: string
      notices?: readonly CircuitIssue[]
      errors?: readonly CircuitIssue[]
    }
  | { error: string; texLog: string; notices?: readonly CircuitIssue[] }

// 描画結果、または「まだ描いている最中」の約束
// (docs/85-回路図表示待ち計画.md §2)。
//
// 閲覧画面は**描き上がるのを待たずに本文を出す**ため、解けていない約束を
// そのまま置く。図の場所だけが Suspense で「準備中」になる
export type PendingCircuit = CircuitResult | Promise<CircuitResult>

// フェンスの中身 (trim 済み) → 描画結果
export type CircuitMap = ReadonlyMap<string, CircuitResult>

// 同上。描画中の図も置ける版。**CircuitMap はこれに代入できる** ので、
// 描き終わった結果しか持たない画面 (オフライン・一覧サムネ) は
// これまでどおり CircuitMap を渡せばよい
export type PendingCircuitMap = ReadonlyMap<string, PendingCircuit>

// 一覧の回路図サムネ (circuit/thumbs.ts の loadCircuitThumbs が作る)。
// itemNo → インライン SVG (本文の出現順)。小/大は先頭 1 枚、画像モードは全部。
// サーバ→クライアント境界を越える prop なので Map ではなく素の Record
export type CircuitThumbMap = Record<string, string[]>
