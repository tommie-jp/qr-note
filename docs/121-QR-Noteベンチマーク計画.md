# QR-Note ベンチマーク計画

7z b の MIPS (サーバー情報の「計測する」) は CPU の素の速さしか測れない。
WSL と本番の差を縮める手がかりにも、VPS の移行先を選ぶ物差しにも、
**QR-Note の典型的な処理そのもの**の速さが要る。独立したページ
`/settings/benchmark` に、サーバ側・クライアント側・回線の 3 つを
**押したときだけ**測って保存し、後は保存した値を表示する仕組みを作る。

決めたこと (2026-10-29):

- サーバ側は新しく作る。実処理の関数をブラウザ無しで呼び、段階ごとの ms を
  中央値で保存する (§3)。環境が違っても比べられる**固定の材料** (同梱の
  Markdown・生成した画像) の行を必ず含める
- クライアント側は新しく作らない。計測テスト (docs/120) の 12 段を流し、
  `結果=完了` が届いた時点でサーバが要約して保存する (§4-3)。環 (200 行)
  に残っているうちに拾う
- 回線は計測テストの 1 段目に足す (§4-1)。種別 (有線 / Wi-Fi / キャリア)
  はブラウザには分からないので人が選ぶ。保存の鍵は**端末 × 回線**
- 保存は `notesRepoDir()` 直下の JSON。既存の `qr-benchmark.json` (7z b)
  は触らず、ファイルを分ける (§2)
- 回路フェンス解析の内訳は 2 段構え。画面には段階の列 (環境どうしで比べる)、
  深掘りは `node:inspector` の cpuprofile をダウンロード (§3-4)。npm
  モジュール単位までは Next の外のスクリプトで見る (§5)
- 7z b の節はサーバー情報からこのページへ移す。計測は 1 か所に集める (§1)
- 測るのは**本番ビルドで**。`next dev` は全体読み込みを繰り返すので手元の
  数字が本番と比べられない (docs/118 §0-1 の `:perf` ビルド)。画面に注記する

## 0. 何が判れば十分か

| 知りたいこと | どこで測るか |
| --- | --- |
| 移行先の CPU で回路フェンスの冷え解析が何 ms か | サーバ: 固定 20 件 + 同梱の Markdown (§3-1) |
| DB + PGroonga の検索が何 ms か | サーバ: `searchItems` 4 語 (§3-1) |
| 同期の組み立て (db → json → gzip) が何 ms か | サーバ: `loadOfflineSyncPayload` + gzip (§3-1) |
| sharp の縮小が何 ms か | サーバ: 生成した画像 (§3-1) |
| 端末ごと・回線ごとに検索・表示切替・ノート・同期が何 ms か | クライアント: 計測テストの要約 (§4-3) |
| 回線だけで何 ms・何 Mbps か | クライアント: RTT・下り・上り (§4-1) |
| 解析のどの関数が重いか | cpuprofile (§3-4)、スクリプト (§5) |

docs/28 の合否の目安 (シングル 6000〜7000 MIPS) に、本番の初回計測から
「同梱 Markdown の冷え解析 ○ms 以下」「検索 (オペアンプ) ○ms 以下」を足す。

## 1. ページ

`src/app/settings/benchmark/page.tsx`。管理者だけ (`requireAdminPage()`)。
proxy は `publicPaths` に無いパスを既定で閉じるので、proxy 側の変更は無い。
デモでは Server Action の `requireUserOutsideDemo` が断る (7z b と同じ)。

- メニュー (`components/chrome/AppHeaderMenu.tsx`): 「サーバー情報」の下に
  「ベンチマーク」。`isAdminUser(user)` の同じ判定で隠す
- サーバー情報 (`settings/server/page.tsx`): 「CPU 性能 (7z b)」の節と
  `BenchmarkButton` を**このページへ移す**。代わりに「ベンチマーク →」の
  リンクを置く。`CopyTextButton` の文字列から 7z b の分を外す
- `force-dynamic` は付けない。開くたびに集めるものは無く、保存した値を
  読むだけ。読むのは `page.tsx` (Server Component) で、client の
  `BenchmarkPanel` に initial として渡す (7z b と同じ受け渡し)

節の並び (上から):

1. **環境** — CPU 名・スレッド数・メモリ・Node 版・アプリ版・ノート件数・
   回路フェンスを持つノート件数・計測日時 (§3-3)。表 (`dl`) はサーバー情報の
   `SectionBlock` と同じ見た目
2. **操作** — 釦「サーバを計測」(§3)・釦「この端末を計測」+ 回線種別の
   選択 (§4-2)。計測中は釦を無効にし「計測中… (○秒ほど)」
3. **CPU (7z b)** — 既存の `formatBenchmark` の 1 行
4. **サーバ** — 表 `項目 | 中央値 | 規模 | 段階`。例:
   `回路の冷え解析 (固定 20 件) | 68ms/件 | 20 件 | sha1=0 解析=61 抽出=4 yaml=3`
5. **クライアント** — 端末 × 回線ごとに 1 枚の表 (`PC / Wi-Fi`、
   `iPhone / キャリア` …)。行は §4-3 の要約の項目。見出しに `panes=`・
   `幅=`・計測日時
6. **プロファイル** — `qr-benchmark-parse.cpuprofile` のダウンロードリンクと
   取得日時。「Chrome DevTools の Performance で Load profile」の一言

「コピー」は `key=値` の 1 行 1 項目 (docs/119 §1-1 と同じ流儀)。先頭に
環境の行、次に CPU・サーバ・クライアントの順。WSL・本番・移行先の 3 枚を
貼り並べて差を読む。

## 2. 保存の形

置き場は `notesRepoDir()` 直下 (`benchmark.ts` の `benchmarkFilePath` と同じ
理由: 永続 volume に乗っていて、ノートの add / status には混ざらない。
**.git の中には置かない**)。

| ファイル | 中身 | 書く人 |
| --- | --- | --- |
| `qr-benchmark.json` | 7z b (既存。形は変えない) | `benchmark.ts` |
| `qr-benchmark-server.json` | `ServerBenchResult` | §3 |
| `qr-benchmark-client.json` | `Record<string, ClientBenchRun>` (鍵は `端末/回線`) | §4-3 |
| `qr-benchmark-parse.cpuprofile` | V8 の cpuprofile (JSON) | §3-4 |

```ts
// lib/diag/benchTypes.ts (状態を持たない葉。client にも import できる)
export interface BenchEnv {
  cpuModel: string; threads: number; totalMemMB: number
  nodeVersion: string; appVersion: string
  items: number; circuitItems: number
  measuredAt: string            // ISO 8601
}
export interface ServerBenchItem {
  id: string                    // 'search:抵抗' | 'parse:cold' | 'parse:fixture' | …
  label: string
  medianMs: number
  scale: string                 // '21 件' | '20 件' | '2.3MB' | '1200×900'
  phases: Record<string, number>   // 段階の中央値 (無い項目は {})
}
export interface ServerBenchResult {
  version: 1
  env: BenchEnv
  items: ServerBenchItem[]
}
export interface ClientBenchRun {
  version: 1
  device: string                // 'PC' | 'iPhone'
  line: string                  // '有線' | 'Wi-Fi' | 'キャリア'
  panes: string; width: string
  measuredAt: string
  rows: { label: string; value: string }[]   // §4-3 の要約
}
```

読み書きは `lib/diag/benchStore.ts` に集める。`readSavedBenchmark` と同じ
作法: 無ければ `null`、壊れていれば投げる (未計測と取り違えない)。書くのは
`tmp` に書いて `rename`。形の検算は `version` と必須の型を見る。

## 3. サーバ側ベンチ

`lib/diag/serverBench.ts`。実処理の関数を直接呼ぶ。`loadSearchResults` や
`markdownPipeline` は Server Component の文脈 (cookie・headers・RSC) に
依るので呼ばない。下の層を使う。

### 3-1. 項目

| id | 呼ぶもの | 規模 | 段階 | データ依存 |
| --- | --- | --- | --- | --- |
| `search:抵抗` `search:コンデンサ` `search:オペアンプ` `search:全件` | `items/search.ts` の `searchItems` (1 ページ目・ゴミ箱なし) | 件数 | — | あり |
| `parse:cold` | 回路フェンスを持つノートを **id 順に固定 20 件** 読み、`createFenceMemo()` を**新しく作って**通す | 20 件 | sha1 / 解析 / 抽出 / yaml | あり |
| `parse:fixture` | 同梱の Markdown (`lib/diag/benchFixture.ts` の文字列) を同じ段階で | 1 件・○KB | 同上 | **なし** |
| `thumb:fixture` | `sharp.create` で 1200×900 のノイズ画像を作り、サムネと同じ縮小 (`thumbnail.ts` の寸法・品質) | 1200×900 | 生成 / 縮小 | **なし** |
| `sync:payload` | `offline/syncItems.ts` の `loadOfflineSyncPayload()` → `JSON.stringify` → `gzipSync` | 件数・gzip 後 MB | db / json / gzip | あり |

- `parse:*` の段階は、ベンチ側 (`lib/diag/parseBench.ts`) で
  `createHash('sha1')` → `createNoteParser().parse()` → 木を辿って回路
  フェンスを拾い重複を畳む、の順に呼んで測る (sha1 / 解析 / 抽出)。YAML の
  組み立ては描画の段で、抽出には入らないので測らない。本番のコード (`fences.ts`) には
  計時を足さない — 描画と同じ経路を通すことより、内訳を見ることを選ぶ。
  合計が `extractCircuitFences` 1 回と合うことをテストで確かめる (§7)
- `parse:cold` の 20 件は `hasNoCircuitFence` で足切りした上で
  `ORDER BY id LIMIT 20`。id は UUID v7 なので古いノートから固定で選ばれ、
  回ごとに変わらない。回路ノートが 20 件未満なら、ある分だけで `規模` に
  件数を出す
- **共有メモ (`circuitFencesOf`) は使わず、汚さない。** 冷えた値を取るため
- 同梱 Markdown は、手元の典型的な回路ノート (見出し・表・数式・タスク・
  回路 4 つ・VNA・ブレッドボード) と同じ形に**合成した** 5KB (手元の回路
  ノートの中央値 4.5KB に近い)。回路フェンスは circuit 4 + circuitikz 1。
  利用者のノートは写さない (qr-note は公開リポジトリ)。**ファイルは置かない**
  (standalone のトレースに乗らない)。TypeScript の文字列定数にする。画像も
  同じ理由で、固定の種の乱数から raw を作って sharp で JPEG にする

### 3-2. 回し方

- 項目ごとに **ならし 1 回 + 計測 3 回**、中央値を保存する (VPS の CPU は
  ぶれる。DB は 1 回目だけ遅い)。`parse:cold` のならしも新しいメモで
  (ならしの結果を計測が使わない)
- 項目の間と、`parse:cold` の 1 件ごとに `await setImmediate` を挟む。
  解析はイベントループを塞ぐので、要求を 1 件ずつ通す (`syncItems.ts` の
  `PARSE_YIELD_EVERY` と同じ考え)。worker_threads には出さない — Prisma を
  worker に持ち込む手間に見合わない。全体で数秒で終わる
- 7z b と同時に走らせない。`benchmark.ts` の `running` / `lastError` を
  `lib/diag/benchJob.ts` に切り出し、`startJob(fn)` / `jobProgress()` を
  7z b とサーバ側ベンチで共有する (片方が走っていれば他方は始めない)。
  計測テスト (docs/120) が立っている間も始めない (`isPerfLogEnabled()` を見る)
- 画面は `getBenchStatusAction` を 3 秒おきに引く (`BenchmarkButton` と同じ。
  数秒で終わるが、nginx の 60 秒の壁に当たる作りにはしない)
- 失敗した項目は落とさず `medianMs: -1` ではなく**その項目を除いて**保存し、
  `lastError` に項目名と理由を残す。画面では「失敗した項目: …」として出す

### 3-3. 環境

`collectBenchEnv()`。`os.cpus()[0].model`・`os.cpus().length`・
`os.totalmem()`・`process.version`・`package.json` の版 (`appInfo.ts` が
既に読んでいる口を使う)・`SELECT count(*)` ×2。回路ノートの数は
`position('```circuit' in memo) > 0` で数える (**LIKE は PGroonga が
乗っ取る**ので使わない)。

### 3-4. cpuprofile

`parse:cold` の計測 3 回のうち最後の 1 回を `node:inspector/promises` の
`Session` で包む。

```ts
const s = new Session(); s.connect()
await s.post('Profiler.enable')
await s.post('Profiler.setSamplingInterval', { interval: 100 })   // µs
await s.post('Profiler.start')
// … 20 件の冷え解析 …
const { profile } = await s.post('Profiler.stop')
s.disconnect()
await writeAtomic(profilePath(), JSON.stringify(profile))
```

- フラグも依存も要らず、standalone で動く。測る区間だけに絞れるので、
  要求の処理が混ざらない
- ダウンロードは `GET /api/diag/profile` (`src/app/api/diag/profile/route.ts`)。
  管理者だけ・デモは 404・`Content-Disposition: attachment`。proxy は既定で
  閉じているので追記なし
- 本番ビルドのサーバコードは `.next/server/chunks/` に束ねられ、関数名は
  残るが npm モジュールの出どころは読みにくい。それでも「どの関数の self
  time が大きいか」は読める。モジュール単位は §5

### 3-5. Server Action

`src/app/actions/benchmark.ts` を広げる (`requireAdmin` は既存のものを使う):

- `startServerBenchAction(): Promise<BenchStatus>` — `startJob` で始めて
  直ちに返す
- `getBenchStatusAction(): Promise<BenchStatus>` — `{ running, cpu, server,
  client, profileAt, error }`。保存ファイルを読んで整形済みで返す
- 既存の `startBenchmarkAction` (7z b) はそのまま。`BenchmarkStatus` は
  `BenchStatus` に吸収し、`BenchmarkButton` を `BenchmarkPanel` の中に取り込む

## 4. クライアント側

### 4-1. 回線

ブラウザから同一オリジンへ 3 つ測り、`[計測] 回線 種別=Wi-Fi RTT=18ms
下り=85Mbps 上り=12Mbps` の 1 行を送る。

| 項目 | 方法 |
| --- | --- |
| RTT | `GET /api/diag/net?size=0` を 5 回。`performance.now()` の差の中央値 |
| 下り | `GET /api/diag/net?size=2097152` を 1 回。Resource Timing の `responseStart → responseEnd` と `encodedBodySize` から Mbps |
| 上り | 1MB の乱数を `POST /api/diag/net`。`performance.now()` で包んで Mbps |

- 口は `src/app/api/diag/net/route.ts`。ログイン必須 (proxy の既定閉じ)・
  デモは 404。GET は `application/octet-stream`、`Cache-Control: no-store`、
  `Content-Encoding: identity` を付ける。中身は `crypto.randomBytes(2MB)` を
  globalThis に 1 度作って使い回す (テキストにすると nginx の gzip が縮めて
  数字が嘘になる)。`size` の上限は 2MB。POST は本文を読み切って捨て、
  `{ ok: true, bytes }` を返す。上限 1MB を超えたら 413
- nginx は**変えない** (実装で改めた)。口はログイン必須で、取得鍵の口
  (`/api/logs/perf/export`) のように誰でも叩けるものではない。本文の上限は
  server 既定の 35M の内側で、アプリが 1MB で 413 にする。nginx の gzip は
  既定の text/html だけで octet-stream は縮めず、中身も乱数なので縮まない
- ブラウザ側は `lib/logging/netProbe.ts` (純粋な手順。fetch と時計は引数で
  受ける) と、それを `PerfTestRunner` から呼ぶ 1 段。各項目 3 回の中央値。
  **ループで何十 MB も使う speedtest にはしない** (キャリアの通信量)
- 既存の `受信=`・`転送=` はサーバと描画が混ざっている。この行と引き算
  すれば、同期の 1 秒のうち回線が何割かが出る

### 4-2. 釦と回線種別

ベンチマークページの「この端末を計測」は、`PerfTestMenuItem` の `start` と
同じ流れ (計測を立てて印を付け、`/` を `location.assign`)。違いは印の中身。

- `perfTestFlag.ts` の印を `'1'` から JSON `{ line?: string, returnTo?:
  string }` に広げる。`markPerfTestPending(opts)` / `takePerfTestPending():
  PerfTestOptions | null`。読めない・旧形式 `'1'` は `{}` として扱う
  (メニューの「計測開始」は今までどおり中身なし)
- 回線種別は `<select>` (有線 / Wi-Fi / キャリア)。前回の選択は
  `localStorage` (`qr:benchLine`) に覚える (端末ごとの便宜。読めなくても動く)
- `PerfTestRunner` は `line` があれば 1 段目に回線 (§4-1) を流し、
  `describe()` に `回線=Wi-Fi` を足す。`returnTo` があれば、計測を止めた後に
  `location.assign(returnTo)` で戻る (戻るのは `/settings/benchmark` だけを
  許す。印の値は自分で書いた物だが、開いた先の URL を印から組むので
  固定の 1 つに絞る)
- 段数は 12 → 13 (回線が無いときは 12 のまま)。`TOTAL_STEPS` の計算に
  `line ? 1 : 0` を足し、テスト (`perfTest.test.ts`) の数え方も直す

### 4-3. 収穫 (要約の保存)

`結果=完了` が届いたとき、その端末の 1 回分を要約して
`qr-benchmark-client.json` に保存する。

- 場所は `src/app/api/client-logs/route.ts`。`pushBrowserLogs` の後、
  届いた項目に `[計測] テスト 結果=完了` があれば
  `harvestClientBench(device)` を呼ぶ (`lib/diag/clientBenchHarvest.ts`)
- `recentPerfLines()` から `device` が一致する行だけを取り、最新の
  `結果=開始` 以降を 1 回分とする。別の端末が同時に流していても混ざらない
  (端末名が同じ 2 台は混ざる。PC 2 台で同時に流さない — §9)
- 行の読み取りは `perfLine.ts` に `parsePerfLine(text): { kind, fields }` を
  足す (`formatPerfLine` の逆。`q="…"` の引用符と `_` 潰しをそのまま返す)
- 要約の行 (`rows`):

  | label | 元の行 |
  | --- | --- |
  | 回線 RTT / 下り / 上り | `回線` |
  | 検索 抵抗 / コンデンサ / オペアンプ: 全体・応答開始・描画 | `検索` (q が一致する最後の行) |
  | 全件: 全体 | `検索` (q が空) |
  | 表示 小→中 / 中→大 / 大→画像 / 画像→小: 即時・全体 | `表示` の `区分=測定` 4 行 |
  | 続き: 全体 | `続き` (無ければ `続きなし`) |
  | ノート 1 / 2: 全体・応答開始・描画 | `ノート` の 2 行 (開いた順) |
  | 同期: 結果・全体・転送 | `同期` |
  | 全体 | `テスト 結果=完了` の `全体=` |

- 鍵は `${device}/${line ?? '不明'}`。メニューの「計測開始」から流した
  (回線なし) 分も `PC/不明` として保存する。同じ鍵は上書き (最新 1 回)
- `開始` の行から `panes=`・`幅=` を取り、見出しに出す
- 要約は環に残っているうちに作る (200 行。打鍵ごとに積まれるので、完了の
  直後でないと押し流される)。`結果=中断` は保存しない

## 5. モジュール単位の内訳 (スクリプト)

`scripts/profileParse.ts`。Next の外で §3-1 の `parse:cold` と同じ関数を
呼ぶ (`serverBench.ts` の `runParseBench(items, memo)` を共有する)。

```bash
npx tsx --cpu-prof --cpu-prof-dir=/tmp/prof scripts/profileParse.ts   # 手元
docker compose exec app node --cpu-prof ... (standalone には tsx が無い。手元で測る)
```

- モジュールのパスがそのまま残るので、remark-parse / remark-gfm /
  remark-math / yaml のどれが重いかが一目で分かる。本番の cpuprofile
  (§3-4) は関数名で突き合わせる
- 見立て: sha1 は 5.5MB で 10ms なので無視できる。重いのは本文全体の
  micromark の字句解析と拡張の分。拡張のどれかが突出していれば「抽出だけは
  拡張を減らした parser で」が候補になるが、描画の parser とずれる危険が
  あるので、出どころを確かめてから別の計画で決める

## 6. 変更するファイル

| ファイル | 内容 |
| --- | --- |
| `src/app/settings/benchmark/page.tsx` (新規) | ページ (§1)。`loading.tsx` も |
| `src/app/settings/benchmark/BenchmarkPanel.tsx` (新規) | 釦 2 つ・回線の選択・表・ポーリング。`BenchmarkButton` を吸収 |
| `src/app/settings/server/page.tsx` | 7z b の節を外し、リンクを置く |
| `src/components/chrome/AppHeaderMenu.tsx` | 「ベンチマーク」の項目 |
| `src/lib/diag/benchTypes.ts` (新規) | §2 の型 |
| `src/lib/diag/benchStore.ts` (新規) | 読み書き・検算・`profilePath()` |
| `src/lib/diag/benchJob.ts` (新規) | `running` / `lastError` を 7z b と共有 |
| `src/lib/diag/benchmark.ts` | `benchJob` を使う形に |
| `src/lib/diag/serverBench.ts` (新規) | §3 の項目・回し方・cpuprofile |
| `src/lib/diag/benchFixture.ts` (新規) | 同梱の Markdown (文字列定数) |
| `src/lib/diag/benchEnv.ts` (新規) | §3-3 |
| `src/lib/diag/clientBenchHarvest.ts` (新規) | §4-3 |
| `src/lib/diag/formatBench.ts` (新規) | 画面の表とコピーの文字列 |
| `src/lib/logging/perfLine.ts` | `parsePerfLine` |
| `src/lib/logging/perfTestFlag.ts` | 印を JSON に (§4-2) |
| `src/lib/logging/perfTest.ts` | 回線の段・`describe` に回線・`returnTo` |
| `src/lib/logging/netProbe.ts` (新規) | §4-1 のブラウザ側 |
| `src/components/diag/PerfTestRunner.tsx` | 回線の手足・戻り |
| `src/app/actions/benchmark.ts` | §3-5 |
| `src/app/api/diag/net/route.ts` (新規) | §4-1 の口 |
| `src/app/api/diag/profile/route.ts` (新規) | §3-4 のダウンロード |
| `src/app/api/client-logs/route.ts` | 完了を見て収穫 |
| `scripts/profileParse.ts` (新規) | §5 |
| `docs/109-*.md` | 7z b の節を移した旨 |
| `docs/120-*.md` | 回線の段・印の形・戻り先 |
| `docs/28-*.md` (41-QR-search) | 合否の目安を足す (本番の初回計測後) |

## 7. テスト

- `benchStore.test.ts`: 無い → null、壊れている → 投げる、tmp + rename
- `benchJob.test.ts`: 走っている間は 2 本目を始めない、失敗が `lastError` に
  残り `running` が戻る
- `serverBench.test.ts`: 段階の和が `extractCircuitFences` 1 回の結果と
  一致する (抽出した fence の数と中身)、中央値の計算、失敗した項目を除いて
  残りを保存する、ならしの結果を使わない (メモを差し替えて数える)
- `benchFixture.test.ts`: 同梱 Markdown から回路フェンスが 3 つ取れる
- `clientBenchHarvest.test.ts`: 端末で絞る、最新の `開始` 以降だけ、
  `区分=測定` の 4 行、`続きなし`、`中断` は保存しない
- `perfLine.test.ts`: `parsePerfLine(formatPerfLine(...))` が元に戻る
- `perfTestFlag.test.ts`: 旧形式 `'1'` を `{}` として読む
- `perfTest.test.ts`: 回線ありで 13 段、なしで 12 段
- `netProbe.test.ts`: 中央値・Mbps の計算 (fetch と時計は差し替え)
- `api/diag/net/route.test.ts`: `size` の上限、octet-stream と no-store、
  POST の 1MB 超は 413、デモは 404
- `settings/benchmark/page.test.tsx`: 未計測の表示、保存済みの表示、
  管理者以外は倒す (`settings/server/page.test.tsx` と同じ形)
- E2E は足さない。計測テストの流れは docs/120 の既存のまま

## 8. 使い方

1. **手元**: 作業ツリーを `:perf` でビルドして 3301 に立てる
   (docs/118 §0-1)。`localhost:3301/settings/benchmark` で「サーバを計測」。
   回線を「有線」にして「この端末を計測」
2. **本番**: 配布後に同じ 2 つ。iPhone は Wi-Fi とキャリアで 1 回ずつ
3. 3 枚の「コピー」を Claude に渡す。差が大きい行から docs/118 の次の手を選ぶ
4. **VPS 移行**: 移行先にダンプを復元して立て、「サーバを計測」だけ押す。
   `parse:fixture`・`thumb:fixture` と 7z b は中身に依らないので、本番の
   値と直接比べる。docs/28 の目安で合否を決める

## 9. やらないこと

- 結果の履歴 (前回との並べ表示)。最新 1 回だけ。比べるのは「コピー」の
  貼り並べで足りる。要るようになったら `history: []` を足す
- 他環境の結果を貼って並べる欄。同上
- 回線を繰り返し測る speedtest。2MB + 1MB を 1 回ずつ (各 3 回の中央値まで)
- 解析を worker_threads へ出す。Prisma を持ち込む手間に見合わない
- 検索結果のサーバキャッシュ (docs/118 §7 と同じ)
- 同じ端末名 (PC 2 台) で同時に流す。端末名で分けているので混ざる
- 本番で `scripts/profileParse.ts` を流す (tsx が無い)。モジュール単位は手元

## 10. 進め方

1. §2・§3・§1 (サーバ側 + 7z b の移設 + ページ) + §3-4 の cpuprofile。
   ここまでで VPS 移行の判定に使える
2. 本番と手元で測り、docs/28 に目安を書く。§5 で解析の内訳を見る
3. §4 (回線・釦・収穫)。nginx も `compose.yaml` も変えない

実装 (2026-10-29): 1〜3 を 1 度に入れた。§5 のスクリプトで手元の回路ノート
200 件 (1.7MB) を測ると 1 件 3.3〜3.8ms で、うち解析 (remark) が 96%。
プロファイルの自己時間は micromark (18%)・micromark-util-subtokenize (10%)・
mdast-util-from-markdown (6%)・micromark-extension-gfm-table (5%) の順で、
特定の拡張が突出してはいない。本文全体の字句解析そのものが重い

## 11. 本番の初回計測とプロファイルの解析 (2026-10-29)

本番 vps1 (Broadwell 3 スレッド) で「サーバを計測」した。固定の行は、見本の
解析 79.0ms (手元 15.8ms の 5.0 倍)・サムネ 30.7ms (3.3 倍)。7z b の差
(2.2 倍) より JS の解析の差が大きい。数字の比較は 41-QR-search の docs/28 に置いた。

### 11-1. 本番の cpuprofile

`qr-benchmark-parse.cpuprofile` は実ノート 20 件の冷えた解析 1 回分。サンプルは
202 点・41ms (間隔は指定の 100µs ではなく約 180µs) なので、数 % の差は誤差の内。
束ねたファイルにモジュール名は残らないので、同じ版を手元で作り直したイメージから
同じ名前の束ね (`.next/server/chunks/ssr/_1k-qg_jx6dx2u._.js`) を取り出し、
列位置の前後のコード (トークン名の文字列) で元のライブラリを特定した。

| 自己時間 | 割合 | 中身 | ライブラリ |
| --- | --- | --- | --- |
| 5.1ms + 0.6ms | 約 16% | 表の編集位置の記録 (`addImplementation`) と表の resolve | micromark-extension-gfm-table 2.1.1 |
| 4.2 + 1.7 + 1.6 + 0.8 + 0.7ms | 約 22% | 字句解析の本体 (main・consume・enter・chunkFlow・write) | micromark 4.0.2 |
| 2.9 + 2.6 + 0.7ms | 約 15% | 入れ子の中身の字句解析 (subtokenize・SpliceBuffer) | micromark-util-subtokenize |
| 4.0ms | 10% | 木の組み立て (`n.parser`) | mdast-util-from-markdown |
| 3.6ms | 9% | GC | (V8) |
| 1.0ms | 2% | 拡張の結合 (解析のたびに組み直す) | micromark-util-combine-extensions |
| 1.0ms | 2% | 木を辿る (抽出) | unist-util-visit-parents |

- **表の拡張が 1 位。** `addImplementation` は編集位置の配列を毎回先頭から線形に
  探すので、行の多い表では編集の数の 2 乗で効く。手元の 200 件 (§10 の後段) では
  5% だったので、本番の先頭 20 件は表の大きいノート (教科書の章) に偏っている
  と見られる
- 残りは Markdown の字句解析そのもの (約 50%)。特定の箇所の手直しでは縮まない
- sha1 (fenceMemo の鍵) は 1% 未満で、無視できる

### 11-2. 改善の候補 (未着手)

1. **解析を書き込み時に済ませる (docs/118 §1-B)。** 回路フェンスを派生列に
   保存すれば、一覧・同期・配布直後のどれでも解析が消える。効き目が最も大きい
2. **抽出だけは表の拡張を外した parser で読む。** 表の中にフェンスは書けず、
   フェンスの開始は表を終わらせるので、抽出の結果は変わらない見込み。表の多い
   ノートで約 16% 縮む。ただし描画の parser と分けることになるので、全ノートで
   抽出の結果が一致することを確かめてから入れる
3. 同期の gzip (本番 292ms、その間ほかの要求を待たせる) の圧縮の強さを下げる
