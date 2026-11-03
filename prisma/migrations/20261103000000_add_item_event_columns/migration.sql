-- 予定の派生列 (docs/126 §1-2)。
--
-- 手で書いた。prisma migrate dev に作らせると PGroonga の索引を DROP する差分が
-- 混ざることがある (20260715080225_add_circuit_svgs がそうだった)。
-- 既存の行は NULL のまま (2026-11-03 時点で date= を持つノートは本番に 0 件。
-- 埋めるときは doBackfill.sh events)

-- AlterTable
ALTER TABLE "items" ADD COLUMN "event_start" TIMESTAMP(3),
ADD COLUMN "event_end" TIMESTAMP(3),
ADD COLUMN "event_repeat" TEXT;

-- CreateIndex
CREATE INDEX "items_event_start_idx" ON "items"("event_start");
