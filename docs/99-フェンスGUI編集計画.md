# フェンス GUI 編集計画 (図を掴んで動かす)

計画日: 2026-09-23 / 状態: **実装済み (Phase 1・2)**。iPhone 実機と circuit (Phase 3) は未 (末尾の §9)

上流 ([tommie-fence](https://github.com/tommie-jp/tommie-fence)) には、部品を
マウスや指で掴んで YAML を書き換える**マップの殻**がある (VS Code 拡張と
playground が同じ殻を使っている)。それを QR ノートの編集画面から呼べるようにする。

[97](97-実体配線図フェンス計画.md) §5 が「殻は playground 1 つぶんの仕事」と
先送りした話。**殻は書かずに借りる**ので、こちらの仕事は入口と器と橋だけになる。

前提: 上流が殻を配れる形にする (52 の docs/59: `fence-kit/shell` と
`fence-kit/map.web.js` の tgz)。**§4 の Phase 1 はそれを待たずに進められる。**

## 1. 何ができるようになるか

1. 本文の `breadboard` / `perfboard` フェンスの中にカーソルを置く
   (ライブプレビューの図をタップしてもカーソルはフェンスの先頭に移る。既存の動き)
2. 下部バーの**「図を編集」**が押せるようになる (フェンスの外では押せない)
3. 押すと全画面に上流のマップが開く。部品を掴んで動かす・置く・消す・向きを変える・
   属性を直す。中に元に戻す/やり直すがある
4. 「閉じる」で本文のフェンスが書き換わる。**元に戻すは 1 段** (開いてから閉じるまでが 1 つ)
5. 新しく図を書き始めるときは、書式メニューの「ブレッドボード図」「基板図」で
   骨組みを差し込む → 1 に戻る

## 2. 決め

| # | 決め | なぜ |
| --- | --- | --- |
| 1 | **入口は下部バーの 1 ボタン「図を編集」。** カーソルが対象フェンスの中にあるときだけ有効、外では disabled。位置は 検索 の右 (ページ の左) | 秘密ボタン (カーソルで「秘密を編集」に変わる) と同じ作法で、`trackSecretLabel` の写しで済む。打鍵の合間に使うものなので帯の前寄り。ラベルは変えず disabled で示す — 対象が無いときに押す意味が無い |
| 2 | **図の上のボタンは足さない。** 図をタップ → カーソルが移る → ボタンが点く、の 2 タップ | [70](70-編集ライブプレビュー計画.md) §11 の「ウィジェットは読み取り専用、タップは元の字へ」を破らない。要るときは後で足せる |
| 3 | **殻は上流のものを iframe (`srcdoc`) で動かす。自前で組まない** | 上流の webview は import 時に `window` へ listener を張り `acquireVsCodeApi()` をトップレベルで呼ぶ。頁に直接は載せられず、iframe が正しい境界。タッチ (1 本指 = マウス、2 本指で移動・ピンチ、長押しメニュー、720px 以下の並び) も上流が持っている |
| 4 | **宿主は playground の `host.ts` / `doc.ts` の写し。** 殻には**本文の全文**を渡し、殻は操作のたびに写し (文字列) を書き換える。**閉じるときに 1 回だけ** `view.dispatch` する | 上流の約束「文書は Markdown の全文、書き換えの経路は殻 1 本」(52 の docs/43) を守る。CodeMirror への書き込みが 1 回なので undo が 1 段、`applySecret` と同じ形。開いている間はモーダルが独占するので、写しと本文はずれない (閉じるときに突き合わせ、ずれていたら断る) |
| 5 | 対象は **breadboard / perfboard**。circuit (YAML) は Phase 3 | circuit も `createCircuitEditor` を持ち、掴む用の図は TeX 抜きでブラウザで描ける。ただし circuit-fence/core をブラウザに載せるのは初めてで、版を上げると `./doBackfill.sh circuits` が要る (91 §3)。板の 2 つで殻の配線を確かめてから |
| 6 | 殻の中の undo は殻自前 (`undo: 'own'`)。**閉じる = 当てる。** 捨てる釦は持たない | VS Code のカスタムエディタも操作のたびに書く。しくじりは殻の中の元に戻すで足り、閉じた後は CodeMirror の元に戻す 1 段で全部戻る |
| 7 | 器は DrawModal 型の全画面 (`fixed inset-0 z-50`、上の帯に「図を編集」と 閉じる)。**safe-area は器で取る**。iframe は `flex-1`、器に `touch-none` は付けない | 52 の docs/50: iframe の中の `env()` はブラウザで値が違う。ピンチとパンは iframe の中で捌くので、器が指を取ってはいけない |
| 8 | `map.web.js` は `scripts/assets.mjs` で `node_modules/fence-kit/dist/` から `public/fence/` へ写す (tikzjax・zxing と同じ)。`panelHtml` の `scriptUri` は `/fence/map.web.js` | 資材の運び方はこの 1 表に寄せてある (93 §7-1)。`public/` は `Cache-Control: max-age=0` で配られ、古いものが残らない。srcdoc は同一出所なので `cspSource: "'self'"` で通り、CSP は QR ノート側に無い |
| 9 | 明るいまま: 殻の頁の `<html` に `data-theme="light"` を書く (実装で変えた。§9) | QR ノートにダークモードは無い (97 の決め 2 の続き)。上流 docs/59 の決め 4 で口が付く |
| 10 | 殻を開く一式 (`fence-kit/shell`・板 2 つの core) は **開くときに動的 import** | 普段の編集には載せない。core はライブプレビューが既に動的に読んでいるので、増えるのは shell と map.web.js だけ |
| 11 | 「カーソルのあるフェンス」は構文木で引く (`FencedCode` を親へ辿る)。開きの行の言語は `drawableFence` の正規表現を 1 か所に寄せて使う | `fenceCompletion` `quizLinter` `fenceBlocks` が同じ辿り方をしている。原文で見るのは開きの行だけ |
| 12 | 書式メニューに「ブレッドボード図」「基板図」の雛形を足す | 新規の道が無いと「図を編集」に辿り着けない。雛形は e2e の `board-fence.spec.ts` の最小形 |
| 13 | 4 つの tgz (板 2 つ・circuit・fence-kit) は**同じ日の Release から取る**。Phase 2 で板は 0.10.0 / 0.7.0 に上げる。circuit は上げない | `FenceEditor` の型がコアと shell の両方に写しで入っており、構造で突き合わせる。同じコミットから出た tgz なら一致する。circuit を上げると backfill が要るので決め 5 と一緒に |
| 14 | **殻の iframe は `sandbox="allow-scripts"`** (同じ出所を与えない)。殻の本体 `/fence/map.web.js` はその 1 本だけ認証を素通しにし、中へ送る宛先は `'*'` | 中の頁はノート本文から組む。上流のエスケープと殻の CSP (nonce) の 2 枚に、3 枚目として**出所の分離**を足す — 漏れが 1 つあってもアプリの cookie・localStorage・鍵束に届かない。殻は storage も cookie も使わず親へ postMessage するだけなので、これで動く (実装時のセキュリティレビューの指摘)。代わりに出所が不透明になり、中から取りに行くスクリプトに session cookie が付かない (cross-site 扱い) ので、`auth/publicPaths.ts` に完全一致で 1 本足した。中身は上流が GitHub Pages でも配る静的な JS で、秘密もノートも含まない (sw.js と同じ理由)。宛先は名指しできないので `'*'` — 受け手は自分の `contentWindow` に固定されている |

## 3. 触るところ

| ファイル | 何を |
| --- | --- |
| `package.json` `vendor/` | `fence-kit-0.1.0.tgz`、`breadboard-fence-0.10.0.tgz`、`perfboard-fence-0.7.0.tgz` |
| `scripts/assets.mjs` `.gitignore` | ASSETS に 1 行 (`fence-kit/map.web.js` → `public/fence/map.web.js`)。`/public/fence` を ignore |
| `src/lib/markdown/fenceLanguages.ts` | `GUI_FENCE_LANGS = [BREADBOARD_LANG, PERFBOARD_LANG]` / `isGuiFenceLang`。開きの行の正規表現 `fenceOpeningLang(line)` をここへ (fenceBlocks の `drawableFence` も使う) |
| `src/lib/editor/fenceAtCursor.ts` (新) | `fenceAtCursor(state): { lang, from, to, bodyLine } \| null`。純関数 |
| `src/lib/fenceGui/doc.ts` (新) | playground `doc.ts` の写し: `docOver` `applyChanges` `replaceLines`。`DOC_URI = 'qr-note:memo'` |
| `src/lib/fenceGui/session.ts` (新) | playground `host.ts` の写し: `createFenceGuiSession(port)`。`createFence` は持たない (固定した 1 本を編集するだけ)、`highlight` は空 |
| `src/lib/fenceGui/editors.ts` (新) | `loadFenceEditors()`: `breadboard-fence/core` と `perfboard-fence/core` を動的 import して `[createBreadboardEditor(), createPerfboardEditor()]` |
| `src/lib/fenceGui/commit.ts` (新) | `commitSpec(before, after, state): TransactionSpec \| null`。純関数 (§5) |
| `src/components/fenceGui/openFenceGui.ts` (新) | playground `map/index.ts` の写し (DOM 側): srcdoc・`load` まで溜める送り口・`message` の聞き耳 (`event.source === frame.contentWindow` だけ)・`data-theme`・片付け |
| `src/components/fenceGui/FenceGuiModal.tsx` (新) | 器。props `{ text, fenceLine, onClose(next) }`。中で `openFenceGui`。読めなかったら (動的 import 失敗) 中に一言と 閉じる |
| `src/components/editor/hooks/useFenceGui.ts` (新) | `{ fenceGui, canOpen, openFenceGui, closeFenceGui, trackFenceGui }` (§5) |
| `src/components/editor/MemoEditorInner.tsx` | フック 1 つ、`handleUpdate` に `trackFenceGui`、`toolbar.fenceGui` |
| `src/components/editor/EditToolbar.tsx` | `EditToolbarEditor.fenceGui: { enabled, open }`、`ToolButton` 1 つ (検索の右) |
| `src/components/editor/EditorModals.tsx` | `FenceGuiModal` を dynamic で。`fenceGui.fenceGui && <FenceGuiModal …>` |
| `src/components/icons/editor.tsx` | `BoardEditIcon` (板の升目に矢印) |
| `src/components/editor/markdownFormat.ts` `FormatMenuButton.tsx` | `TemplateAction` に `breadboard` / `perfboard`、`INSERT_ITEMS` に 2 行 |
| `docs/メモ記法.md` | 「実体配線図」の節に「図を編集」の 3 行 |

**触らないところ**: `fenceBlocks.ts` の `FenceWidget` (決め 2)、`offline/*`、`public/sw.js`、
`api/*`、`prisma/*`。

## 4. 手順

### Phase 1 — 上流を待たずにできるもの (純関数と入口)

| # | 所 | 何を | 大きさ |
| --- | --- | --- | --- |
| 1 | `fenceLanguages.ts` / `.test.ts` | **RED**: `isGuiFenceLang` が板 2 つだけ真、`fenceOpeningLang` が ``` と ~~~ と字下げ 3 つまで → **GREEN**。`drawableFence` を `fenceOpeningLang` に乗せ換え (`fenceBlocks.test.ts` は変えずに通る) | S |
| 2 | `fenceAtCursor.ts` / `.test.ts` | **RED** (§5 の表) → **GREEN**。`resolveInner(head, -1)` で `FencedCode` に当たらなければ `(head, 1)` も見る (開きの行頭にカーソルがあるとき、-1 は前の段落に付く) | S |
| 3 | `commit.ts` / `.test.ts` | **RED** → **GREEN**。共通の頭と尻を除いた 1 か所を `changes` に。`before` と今の本文が違えば投げる | S |
| 4 | `markdownFormat.ts` / `FormatMenuButton.tsx` / `markdownFormat.test.ts` | 雛形 2 つ。`CURSOR_MARK` は `R1` の前 | S |
| 5 | `icons/editor.tsx` / `icons.snapshot.json` | `BoardEditIcon`。スナップショットを更新 | S |
| 6 | `EditToolbar.tsx` / `.test.tsx` / `useFenceGui.ts` / `MemoEditorInner.tsx` | ボタンと有効・無効。`useFenceGui` はこの段では `openFenceGui` が state を立てるだけ (モーダルは Phase 2)。**RED**: 「フェンスの外では disabled、中では有効」 | M |

### Phase 2 — 殻を繋ぐ (fence-kit の tgz が要る)

| # | 所 | 何を | 大きさ |
| --- | --- | --- | --- |
| 7 | `vendor/` / `package.json` | 上流 Release から 3 つの tgz (SHA256SUMS を照合)。`npm install`。typecheck が通る = `FenceEditor` の 2 つの写しが一致している | S |
| 8 | `scripts/assets.mjs` / `.gitignore` | 1 行。`npm run copy:assets` で `public/fence/map.web.js` が出る | S |
| 9 | `lib/fenceGui/doc.ts` `session.ts` / テスト | playground の `doc.test.ts` `session.test.ts` を写す。**処理系はモックしない** (`createBreadboardEditor()` を本物で): `move` を 1 つ送って本文のフェンスの中だけが変わる | M |
| 10 | `lib/fenceGui/editors.ts` | 動的 import。`boardRender.ts` の `loadRenderer` と同じ「1 回だけ」の形 | S |
| 11 | `components/fenceGui/openFenceGui.ts` / `FenceGuiModal.tsx` / テスト | playground `index.dom.test.ts` を写す: srcdoc が立つ、他の出所の message は無視、`load` で溜めた分が流れて `data-theme=light` が立つ、閉じると `dispose` と listener の片付け | M |
| 12 | `useFenceGui.ts` / `EditorModals.tsx` | `openFenceGui`: 本文を写して `fenceLine` (= 開きの行の `number`。`lineAt(from).number` は 1 始まりなので、そのまま本文 1 行目の 0 始まりの番号になる) を state に。`closeFenceGui(next)`: `commitSpec` → `dispatch` → `focus`。ずれていたら `setError('本文が変わっていたので図の編集を当てられませんでした')` | S |
| 13 | `e2e/fence-gui.spec.ts` (新) | §5 の E2E | M |
| 14 | `docs/メモ記法.md` / `docs/README.md` | 記法ヘルプと索引 | S |

### Phase 3 — 実機と circuit

| # | 何を |
| --- | --- |
| 15 | iPhone 実機 (§6)。直しは上流に返すものと器で吸うものを分ける |
| 16 | circuit (YAML) を対象に足す: `GUI_FENCE_LANGS` に 1 語、`editors.ts` に `createCircuitEditor()`、`circuit-fence/core` をブラウザで読んだ大きさを測る。版を上げるなら 91 §3 の backfill とセット |

Phase 1 が **半日**、Phase 2 が **1 日** (E2E 込み)。上流 (52 の docs/59) の半日と並行できる。

## 5. 中身の要点

`fenceAtCursor` が返すもの:

```ts
export interface FenceAtCursor {
  readonly lang: string    // 開きの行の言語 (小文字)。無ければ ''
  readonly from: number    // 開きの行頭
  readonly to: number      // FencedCode の終わり (閉じが無ければ本文の末尾)
  readonly bodyLine: number // 本文 1 行目の行番号 (0 始まり)。殻の fenceLine にそのまま渡す
}
```

| カーソル | 返す |
| --- | --- |
| 本文の行の途中 | そのフェンス |
| 開きの行頭 (`from` そのもの) | そのフェンス (side 1 で拾う) |
| 閉じの行の末尾 (`to`) | そのフェンス (ウィジェットの「触れている」判定と同じ) |
| 閉じの次の行 | null |
| ` ```quiz ` の中 | lang `quiz` (有効かどうかは呼ぶ側が `isGuiFenceLang` で決める) |
| 閉じの無いフェンス | そのフェンス (本文の末尾まで) |

`commitSpec`:

```ts
// before: 開いたときの本文の写し / after: 殻が書き換えた写し / state: いまのエディタ
// - state.doc が before と違えば Error (呼ぶ側が setError)
// - before === after なら null (何もしない)
// - それ以外は共通の頭と尻を除いた 1 か所: { changes: { from, to, insert } }
export function commitSpec(before: string, after: string, state: EditorState): TransactionSpec | null
```

殻との橋 (playground `map/index.ts` の写し。変える所だけ):

- `EDITORS` は板の 2 つ (Phase 3 で 3 つ)
- `scriptUri: '/fence/map.web.js'`
- `onLoad` で `frame.contentDocument?.documentElement.dataset.theme = 'light'` を先に
- `onStatus` は要らない (頁のログが無い)。`onBind` は殻の一覧で別のフェンスを選び直したときに
  `fenceLine` を差し替えるだけ

`useFenceGui` の形 (秘密のフックと同じ骨):

```ts
export interface EditorFenceGui {
  fenceGui: { text: string; fenceLine: number } | null // null なら閉じている
  canOpen: boolean                                     // カーソルが対象フェンスの中
  openFenceGui: () => void
  closeFenceGui: (next: string) => void
  trackFenceGui: (update: ViewUpdate) => void          // docChanged || selectionSet のときだけ
}
```

E2E (`e2e/fence-gui.spec.ts`。`board-fence.spec.ts` の BODY を使う):

1. カーソルが本文の外 → 「図を編集」が disabled
2. `R1` の行にカーソル → 有効 → 押す → `iframe[title="図を編集"]` の中に `.cf-chip[data-part="R1"]`
3. `R1` を押す → 属性の `input[name="value"]` に `1k` → Enter → 閉じる →
   エディタの本文に `R1: resistor a5 a10 1k`、他の行は元のまま
4. 元に戻す 1 回で `330` に戻る
5. 開いて何もせず閉じる → 本文が変わらず、元に戻す は押せないまま

## 6. iPhone で確かめること

| 何を | 期待 | 直す所 |
| --- | --- | --- |
| 2 本指の移動・ピンチ | iframe の中で効く。頁が動かない | 器 (`touch-none` を足さない・`overflow-hidden`) |
| 長押し | OS のコピー/共有が出ず、殻のメニューが出る | 上流 (`panelHtml` の `-webkit-touch-callout: none`) |
| 属性の欄 | 欄を押したときだけキーボードが出る。部品を掴んだだけでは出ない | 上流 (`pointer: fine` のときだけ focus) |
| 角とホームバー | 上の帯と下端が欠けない | 器の `env(safe-area-inset-*)` |
| 暗色の端末 | 殻が白いまま | `data-theme=light` |
| 閉じる → 本文 | フェンスの中だけ変わり、元に戻す 1 回で戻る | `commitSpec` |

## 7. やらないこと

- **図の上に「編集」ボタンを重ねる** (決め 2)
- **操作のたびに CodeMirror へ書く宿主** (1 操作 = 1 undo)。要るなら `SessionHost.applyEdits`
  を `changesForFence` → `dispatch` に、`nativeUndo` を CodeMirror の undo に繋ぎ替える。
  決め 4 の宿主と入れ替え可能な形にしておく
- **オフラインで開く。** `map.web.js` は `sw.js` の `SHELL_EXTRAS` に無い。要るときは 1 行
- **ダークテーマ** (決め 9)
- **circuitikz** (素の TeX)。上流に editor が無い

## 8. 関連

- [97](97-実体配線図フェンス計画.md) — 板の 2 つを描けるようにした。§5 がこの計画の先送り
- [70](70-編集ライブプレビュー計画.md) §11 — ウィジェットの 4 つの規則 (決め 2)
- [52](52-シークレット編集導線計画.md) — カーソルで変わるボタン (決め 1 の下敷き)
- [93](93-リファクタリング計画.md) §5-1, §7-1 — フックの作法、資材の運び方
- 上流: `52-tommie-fence/docs/59` (殻の出口)、`15` §「iframe が webview の役」、`43`、`50`
- 41 の `docs/26` §7 — 「マップ editor は取り込まない」と決めた時点の見立て

## 9. 実装の記録 (2026-09-23)

上流 (52 の docs/59) が同じ日に fence-kit 0.1.0 を Release したので、Phase 1 と 2 を
続けて通した。取り込んだ tgz は `fence-kit-0.1.0` / `breadboard-fence-0.10.0` /
`perfboard-fence-0.7.0` (どれも Release の `SHA256SUMS` で照合)。板の 2 つの版上げは
USB コネクタの追加 (Added) だけで、既存の描画の試験は変えずに通った。

### 計画と違ったこと

| 何 | どうしたか |
| --- | --- |
| **言語の読み方を drawableFence と分けた** (決め 11) | 計画は開きの行の正規表現を 1 か所に寄せる形だったが、**寄せると押せるのに殻が見失う**。殻 (fence-kit の `extractFences`) は「行頭から字下げ 3 つまで」「先頭の語が綴りどおり」でしか拾わない。プレビューの `drawableFence` は字下げも大文字小文字も緩く見るので、同じにすると引用の中や `Breadboard` でボタンが点く。`fenceAtCursor` は上流の正規表現を写し、`drawableFence` は触らなかった |
| `fenceAtCursor` は `{ lang, bodyLine }` だけ返す | 範囲 (`from` / `to`) は使い道が無かった。当てる位置は `commitSpec` が全文の差分から出す |
| `commitSpec` は投げずに 3 通りを返す | `unchanged` / `stale` / `change`。呼ぶ側 (`useFenceGui`) が分岐して、`stale` はエディタ直下の赤い欄に出す。`change` には `isolateHistory` を付けた — 付けないと、開く直前の打鍵と 500 ms 以内だと 1 段にまとまりうる |
| 明るいままは頁の頭の印だけ (決め 9) | 上流が案内する「`load` で `contentDocument` に書く」は sandbox (決め 14) では出所が違って届かない。`panelHtml` の出力の `<html ` に `data-theme="light"` を差す。最初の描画から明るくもなる (`load` を待つと、暗色の端末では一瞬だけ暗い殻が出る)。上流が `<html` の書き方を変えたら、単体試験 (`openFenceGui.test.ts`) と E2E (暗色の端末) で落ちる |
| 橋は iframe と window を最小の型で受ける | jsdom は直の依存に無い (fabric と node-tikzjax が連れてくるだけ)。`FenceGuiFrame` / `FenceGuiHost` にして、試験は node の `EventTarget` で偽物を組んだ |
| **sandbox を足した** (決め 14 を新設) | 計画には無かった。実装後のセキュリティレビューが「本文から組んだ頁を同じ出所の iframe で動かしている」ことを多層防御の穴 (MEDIUM) として挙げた。`allow-scripts` だけにすると殻のスクリプトに cookie が付かずログインの門で止まる (E2E で確かめた) ので、その 1 本を素通しにした。宛先は一度 `location.origin` にしたが、出所が不透明になったので `'*'` に戻した |
| 殻の操作がしくじったら帯に出す | `session.handle` が投げたら、殻の帯 (読めなかった行とお知らせ) に `notice` で出す。黙って何も起きない形にしない |
| `refresh` は持たない | 開いている間は殻だけが写しを書き換えるので、外から組み直させる場面が無い |
| 処理中 (busy) はボタンを止める | アップロードや OCR は本文の印を書き換える。開いている間に動くと、閉じたときに `stale` になって編集が捨てられる |
| E2E は保存しない | 見るのはエディタの本文 (hidden の `memo` 欄) だけ。ノートを作らないので片付けも要らない |

### 触ったところ

| ファイル | 何を |
| --- | --- |
| `vendor/` `package.json` | tgz 3 つ (板 2 つの差し替え + fence-kit) |
| `scripts/assets.mjs` `.gitignore` | `fence-kit/dist/map.web.js` → `public/fence/map.web.js` (41,572 バイト。上流の実測と同じ) |
| `src/lib/markdown/fenceLanguages.ts` | `GUI_FENCE_LANGS` / `isGuiFenceLang` |
| `src/lib/editor/fenceAtCursor.ts` `commitSpec.ts` (新) | 純関数 2 つ |
| `src/lib/fenceGui/doc.ts` `session.ts` `editors.ts` (新) | playground の `doc.ts` / `host.ts` の写しと、処理系の動的 import |
| `src/components/fenceGui/openFenceGui.ts` `FenceGuiModal.tsx` (新) | 橋と器 (sandbox) |
| `src/lib/fenceGui/mapScript.ts` (新) / `src/lib/auth/publicPaths.ts` | 殻の本体の置き場と、その 1 本の素通し (決め 14) |
| `src/components/editor/hooks/useFenceGui.ts` (新) / `MemoEditorInner.tsx` / `EditorModals.tsx` / `EditToolbar.tsx` | 配線とボタン (検索の直後) |
| `src/components/icons/editor.tsx` | `BoardEditIcon` (穴の並んだ板に矢印) |
| `src/components/editor/markdownFormat.ts` `FormatMenuButton.tsx` | 雛形「ブレッドボード図」「基板図」 |
| `docs/メモ記法.md` | 「図を掴んで動かす(図を編集)」の節 |

### 試験

| ファイル | 見るもの |
| --- | --- |
| `src/lib/editor/fenceAtCursor.test.ts` | 本文の途中・開きの行頭・閉じの行末・外・閉じの無いフェンス・`~~~`・情報文字列・引用の中は言語なし・大文字はそのまま |
| `src/lib/editor/commitSpec.test.ts` | 1 か所の変更・`isolateHistory`・変わらない・`stale`・行の増減・同じ字の並びで範囲が逆転しない |
| `src/lib/fenceGui/doc.test.ts` `session.test.ts` | playground の写し。**処理系はモックしない**: 動かす・属性の欄・殻の中の元に戻すで、フェンスの行だけが変わる |
| `src/components/fenceGui/openFenceGui.test.ts` | srcdoc・自前の履歴・頁の頭の明るい印・`load` まで溜める・自分の iframe だけ聞く・閉じたら聞かない |
| `src/lib/auth/publicPaths.test.ts` | `/fence/map.web.js` だけが素通し。置き場の他のファイルや名前違いは閉じたまま |
| `src/components/editor/quizTemplate.test.ts` | 板の雛形が読めない行なしで描ける (本物の処理系) |
| `src/components/editor/EditToolbar.test.tsx` | フェンスの外・処理中は押せない、検索の直後に並ぶ |
| `e2e/fence-gui.spec.ts` (新) | 本物のブラウザで 6 本 (開くたびに iframe が `sandbox="allow-scripts"` であることも見る): 暗色の端末でも殻が白い / 外では押せず図を押すと押せる / 属性の欄で値を直して閉じると 1 行だけ変わり、元に戻す 1 回で戻る / 何もせず閉じると変わらない / 部品を掴んで 3 行下げると `a5 a10` → `d5 d10` / iPhone 幅でも全幅で開き横にはみ出さない |

E2E を書いていて分かったこと: **ドラッグは穴 (`.cf-cell`) の上で掴んで穴の上で離す。**
部品の真ん中 (ラベル込み) を掴んで 3 行ぶん動かすと、離した所が穴の間に落ちて
「元へ戻す」扱いになった (上流の `mapState` の約束どおり)。

確かめたこと:

| 何 | 結果 |
| --- | --- |
| 単体 | 4,590 件 (全体) |
| E2E | 40 本 (全 chromium。既存の板の描画を含む) |
| 型・lint・本番ビルド | 通った |
| 殻の束の大きさ | `fence-kit/shell` は編集画面の本体と別のかたまり (114 KB / gzip 34 KB)。開いたときだけ読む。`map.web.js` は 41.6 KB で `public/fence/` から配る |
| レビュー | code-review は指摘なし。security-reviewer は CRITICAL / HIGH なし — 1 回目の MEDIUM (同じ出所の iframe) を決め 14 で直し、再レビューで解消と判定。残りは下の「上流に返すこと」 |

### 残り (Phase 3)

- **iPhone 実機** (§6 の表)。とくに長押しのメニューと、属性の欄を押したときだけ
  キーボードが出るか
- **circuit (YAML)** — 決め 5 のとおり、`circuit-fence/core` をブラウザで読んだ大きさを
  測ってから

### 上流に返すこと

- **webview (`map.ts`) の `message` の聞き手が送り主を確かめていない。** 中へ届いた
  `map` の `html` をそのまま `innerHTML` に入れる。殻の CSP (nonce) でスクリプトは
  動かず、QR ノートでは sandbox で出所も分けたので実害は見当たらないが、
  `event.source === window.parent` を見るのが筋 (セキュリティレビューの MEDIUM)
- **宛先 `'*'` の残り (再レビューの MEDIUM、任意)。** エスケープと CSP の両方が破られて
  中でスクリプトが動いた場合に限り、中は自分の枠を別の出所へ移せる。そのあと親が送る
  図 (本文から組んだもの) は移った先へ届き、`event.source` の照合も同じ枠なので通る。
  塞ぐには最初の `load` で `MessageChannel` の port を 1 回だけ渡し、以降は port で話す
  (port は文書に結び付くので、移った先には届かない)。webview の送り口と聞き手が
  `window` 決め打ちなので、**上流の変更が要る**
- 「`load` で `contentDocument` に `data-theme` を書く」という宿主への案内は、sandbox の
  宿主では使えない。頁の頭に書く口 (`panelHtml` の引数など) があると、文字列の
  差し替えをしなくて済む
