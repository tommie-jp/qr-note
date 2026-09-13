// vitest で `server-only` / `client-only` の差し替え先にする空の module
// (vitest.config.ts の resolve.alias。docs/93-リファクタリング計画.md §2-2)。
//
// 本物のマーカーは解決条件しだいで import しただけで throw する (server-only は
// react-server 条件の外で、client-only はその中で)。Next のビルドが層を見て
// 振り分けるための物で、テストは node 環境でサーバ側・ブラウザ側の module を
// どちらも直接読むので、中身の無いこれに向ける
export {}
