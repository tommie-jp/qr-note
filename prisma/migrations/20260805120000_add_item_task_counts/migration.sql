-- タスクリスト (`- [ ]` / `- [x]`) の個数の派生キャッシュ
-- (docs/56-チェック検索計画.md §3)。検索の is:todo / is:done で使う。
--
-- 既存行は 0 のまま置く。ここで埋めようとすると SQL で Markdown を解析する
-- ことになり、コードフェンスの中の `- [ ]` を数えてしまう。正しい値は
-- パーサを通すバックフィル (scripts/backfillTaskCounts.ts) で入れる。
--
-- この 2 列自体に索引は張らない。現状の規模では seq scan の整数比較が 1 つ
-- 増えるだけで、deleted_at IS NULL と同格のコストにしかならない。

ALTER TABLE "items"
  ADD COLUMN "task_todo" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "task_done" INTEGER NOT NULL DEFAULT 0;

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate は DROP INDEX を自動生成するため
-- 採用せず、「無ければ張り直す」ことで冪等に保つ (20260805000000 と同じ)。
-- 落ちても全文検索は seq scan で動いてしまい気づけないので、手で `\di` を
-- 確かめる運用に頼らず、毎回ここで張り直す。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
