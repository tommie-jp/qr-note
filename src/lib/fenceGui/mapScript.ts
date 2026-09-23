// 図を掴んで動かす殻の本体の置き場 (docs/99-フェンスGUI編集計画.md)。
// scripts/assets.mjs が node_modules/fence-kit/dist/map.web.js をここへ運ぶ。
//
// **葉に置く** — 殻の頁を組む橋 (components/fenceGui) と、認証の素通し一覧
// (auth/publicPaths.ts) の両方が読む。素通しの側に殻の一式を引きずり込まない
export const FENCE_MAP_SCRIPT = '/fence/map.web.js'
