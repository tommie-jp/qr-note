-- 本文から取り出した回路フェンスの控え (docs/122 §1)。
--
-- 手で書いた。prisma migrate dev に作らせると PGroonga の索引を DROP する差分が
-- 混ざることがある (20260715080225_add_circuit_svgs がそうだった)。
-- 既存の行は作らない (一覧・同期が引いたときに埋まる。まとめて埋めるのは
-- doBackfill.sh circuit-fences)

-- CreateTable
CREATE TABLE "memo_circuit_fences" (
    "memo_hash" TEXT NOT NULL,
    "fences" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memo_circuit_fences_pkey" PRIMARY KEY ("memo_hash")
);
