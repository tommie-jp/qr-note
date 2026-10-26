-- サーバ経由のクリップボードの枠に、中身の見本を持つ (docs/115)。
--   thumb   … 見本の絵 (WebP)。画像はサーバが置くときに作り、動画・PDF はクライアントが
--             作った絵を後から貼る (サーバが makeThumbnail で作り直してから置く)
--   preview … 見本の抜粋 (テキストファイル・Office の本文の先頭 300 字)
-- 文字の枠と、見本を作れなかったファイルはどちらも NULL。
ALTER TABLE "clipboard_slots" ADD COLUMN "thumb" BYTEA;
ALTER TABLE "clipboard_slots" ADD COLUMN "preview" TEXT;

-- 全文検索の PGroonga インデックスは Prisma スキーマで表現できず drift 扱いになる。
-- 「無ければ張り直す」ことで冪等に保つ (20261025000000 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_pgroonga_idx"
  ON "items" USING pgroonga ("memo");
