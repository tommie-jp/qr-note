-- サーバ経由のクリップボード (docs/114-サーバクリップボード計画.md)。
-- Windows と iPhone の間で、OS のクリップボードの中身 (文字か画像) を運ぶ。
--
-- 利用者ごとに 1 行・上書きのみ。履歴は持たない。文字 (text) か画像
-- (mime + data) のどちらか一方だけが入る — 両方 NULL の行は作らず、
-- 空にするときは行ごと消す。「どちらか 1 つ」は表の形ではなく store
-- (clipboard/slotStore.ts) が守る。
--
-- bytes は中身の大きさ (文字は UTF-8 のバイト数)。メニューを開くたびに「画像 1.2MB」を
-- 出すので、最大 10MB の data を読まずに済むよう列に持つ。
--
-- 期限 (10 分) は updated_at から読む側が判定し、切れていれば読むときに消す。
-- 掃除用の常駐は置かないので、期限の索引は要らない (主キーで 1 行を引くだけ)。
CREATE TABLE "clipboard_slots" (
    "user_name" TEXT NOT NULL,
    "text" TEXT,
    "mime" TEXT,
    "data" BYTEA,
    "bytes" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clipboard_slots_pkey" PRIMARY KEY ("user_name")
);

-- 全文検索の PGroonga インデックスは Prisma スキーマで表現できず drift 扱いになる。
-- prisma migrate は DROP INDEX を自動生成しうるため採用せず、「無ければ張り直す」
-- ことで冪等に保つ (20261018000000 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_pgroonga_idx"
  ON "items" USING pgroonga ("memo");
