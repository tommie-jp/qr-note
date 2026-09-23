import type { FenceEditor } from 'fence-kit/shell'
import type { GuiFenceLang } from '@/lib/markdown/fenceLanguages'

// 殻に渡す editor (docs/99-フェンスGUI編集計画.md)。処理系は**開くときに読む** —
// 1 つ gzip 55〜60KB あり、普段の編集には載せない (boardRender.ts と同じ扱い)。
//
// **読むのは渡した言語の分だけ** (docs/100 の決め 3)。呼ぶ側はノートに書いてある
// 言語を渡す (guiFenceLangsIn) — 板 1 種類のノートで回路図の処理系まで取りに行かない。
//
// editor は開くたびに作る。殻 1 つに 1 組で、上流の playground もそうしている

type Factory = () => FenceEditor

// 言語ごとの読み込み先。回路図の editor は掴む用の簡略図を自分で描くので、
// TeX もサーバも要らない (上流 52 の docs/08)。引数 (注釈の枠) は既定のまま
const LOADERS: Readonly<Record<GuiFenceLang, () => Promise<Factory>>> = {
  breadboard: () => import('breadboard-fence/core').then((core) => core.createBreadboardEditor),
  perfboard: () => import('perfboard-fence/core').then((core) => core.createPerfboardEditor),
  circuit: () => import('circuit-fence/core').then((core) => () => core.createCircuitEditor()),
}

// 読み込みは言語ごとに 1 回だけ。**しくじったら忘れる** — 電波が切れて読めなかった
// 失敗を覚えると、戻ってきても二度と開けない
const loading = new Map<GuiFenceLang, Promise<Factory>>()

function loadFactory(lang: GuiFenceLang): Promise<Factory> {
  const cached = loading.get(lang)
  if (cached) {
    return cached
  }
  const promise = LOADERS[lang]().catch((error: unknown) => {
    loading.delete(lang)
    throw error
  })
  loading.set(lang, promise)
  return promise
}

export async function loadFenceEditors(
  langs: readonly GuiFenceLang[],
): Promise<readonly FenceEditor[]> {
  const factories = await Promise.all(langs.map(loadFactory))
  return factories.map((make) => make())
}
