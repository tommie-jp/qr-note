-- サーバ経由のクリップボードの枠に、元のファイル名を残す (docs/114 §10)。
-- あらゆるファイルを運べるようにしたので、保存・共有の名前に拡張子が要る
-- (xlsx と zip は mime だけでは区別できない)。整形済みの名前 (sanitizeFileName) が入り、
-- クリップボードの画像など名前の無いものと既存の行は NULL。
ALTER TABLE "clipboard_slots" ADD COLUMN "name" TEXT;

-- 全文検索の PGroonga インデックスは Prisma スキーマで表現できず drift 扱いになる。
-- 「無ければ張り直す」ことで冪等に保つ (20261025000000 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_pgroonga_idx"
  ON "items" USING pgroonga ("memo");
