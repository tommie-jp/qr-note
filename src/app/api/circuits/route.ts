import type { NextResponse } from 'next/server'
import { apiFail, apiOk, readJsonObject } from '@/lib/authApi'
import { denyCrossSite, denyUnlessLoggedIn } from '@/lib/apiAuth'
import { getOrRenderCircuit } from '@/lib/circuitCache'
import { renderCircuitYaml } from '@/lib/circuitYaml'
import { CIRCUIT_LANG, isCircuitLang } from '@/lib/fenceLanguages'
import { CircuitRenderError } from '@/lib/circuitikz'
import { MAX_TEXT_LENGTH } from '@/lib/validation'

// 受け付けるソースの長さ。本文を経由しない直接の呼び出しを断つための門で、
// **本文そのものの上限に合わせる** — 1 つのフェンスが本文より長くなることは
// ないので、これ以上絞ると本文に書ける図を描けなくする側の門になる
// (別の数を置くと、本文上限を上げたときに黙ってそちら側へ倒れる)
const MAX_CIRCUIT_SOURCE_CHARS = MAX_TEXT_LENGTH

// ```circuitikz フェンスを SVG にする口 (docs/70-編集ライブプレビュー計画.md §7)。
//
// **編集画面のライブプレビューのためだけにある。** 閲覧 (MarkdownView) は
// ページを描くサーバが renderCircuits で先に済ませて props で渡すので、この口を
// 通らない。編集画面はクライアントで、その結果を持っていないため要る。
//
// 描画そのものは getOrRenderCircuit に任せる — DB キャッシュ (circuit_svgs)・
// 出力の検査 (assertSafeCircuitSvg)・タイムアウトはすべて向こうが持っており、
// **閲覧とまったく同じ 1 本を通る**。ここが別経路で描くと、編集画面でだけ
// 通る図・通らない図が出てしまう。
//
// デモは断らない。回路図は本文の一部で、デモでも閲覧では描かれている
// (閉じると編集画面だけ図が出ない、という食い違いになる)。

export async function POST(request: Request): Promise<NextResponse> {
  const denied = (await denyUnlessLoggedIn()) ?? denyCrossSite(request)
  if (denied) {
    return denied
  }

  const body = await readJsonObject(request)
  const source = body?.source
  if (typeof source !== 'string' || source.trim() === '') {
    return apiFail('回路図のソースがありません', 400)
  }
  // 長さで断る。描画は 1 枚 1 秒強かかる LaTeX の実行で、際限なく長い入力を
  // 受けると 1 要求で時間を使い切れてしまう。本文側と同じ上限に合わせる
  if (source.length > MAX_CIRCUIT_SOURCE_CHARS) {
    return apiFail('回路図のソースが長すぎます', 413)
  }

  // どちらの回路フェンスか。**省略は circuitikz** — この口は元々そちら専用で、
  // 言語を送らない古い画面が残っていても今までどおり描ける
  const lang = body?.lang
  if (lang !== undefined && !isCircuitLang(lang)) {
    return apiFail('知らないフェンス言語です', 400)
  }

  // YAML 側は投げない造り (読めない行も結果に畳んで返す) なので、
  // そのまま writeResult へ流す
  if (lang === CIRCUIT_LANG) {
    return apiOk({ ...(await renderCircuitYaml(source.trim())) })
  }

  try {
    return apiOk({ svg: await getOrRenderCircuit(source.trim()) })
  } catch (e) {
    // 書き間違いは**普通のこと**なので 200 で返し、理由 (TeX のログ) を渡す。
    // 編集中は毎打鍵のように失敗するため、そのたびに 5xx を出すと本物の
    // 不具合が埋もれる
    if (e instanceof CircuitRenderError) {
      return apiOk({ error: e.message, texLog: e.texLog })
    }
    return apiFail('回路図を描画できませんでした', 500)
  }
}
