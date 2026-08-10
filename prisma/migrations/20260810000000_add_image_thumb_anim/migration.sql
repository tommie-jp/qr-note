-- 動画の「動くサムネ」(アニメーション WebP) の派生キャッシュ列を images に追加する
-- (src/lib/video/videoAnim.ts / docs/72-動画アニメサムネ計画.md)。
--
-- 静止サムネ (thumb) と列を分けるのが要点。既定は静止のまま配り、一覧では
-- ホバー中 (PC) / 画面に入った時 (スマホ) だけ差し替える。1 列にまとめて
-- アニメで上書きすると、一覧の 20 行が一斉に動いて転送量が跳ね上がり、
-- <video poster> まで動いてしまう。
--
-- NULL 可なのは、既存の動画がバックフィルされないことと (サーバに ffmpeg が
-- 無く、コマの抽出はアップロード時のブラウザでしかできない)、生成に失敗しうる
-- ため。NULL のときは配信が 404 を返し、表示は静止サムネのままになる。
ALTER TABLE "images" ADD COLUMN "thumb_anim" BYTEA;

-- 全文検索の PGroonga インデックス (20260714193604 で作成) は Prisma スキーマで
-- 表現できず drift 扱いになる。prisma migrate はここでも DROP INDEX を自動生成した
-- ため採用せず、「無ければ張り直す」ことで冪等に保つ (20260717072516 と同じ)。
CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE INDEX IF NOT EXISTS "items_memo_url_pgroonga_idx"
  ON "items" USING pgroonga ("memo", "url");
