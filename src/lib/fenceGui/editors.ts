import type { FenceEditor } from 'fence-kit/shell'

// 殻に渡す editor (docs/99-フェンスGUI編集計画.md)。処理系は**開くときに読む** —
// 1 つ gzip 50KB 前後あり、普段の編集には載せない (boardRender.ts と同じ扱い)。
//
// editor は開くたびに作る。殻 1 つに 1 組で、上流の playground もそうしている

type Factory = () => FenceEditor

// 読み込みは 1 回だけ。**しくじったら忘れる** — 電波が切れて読めなかった
// 失敗を覚えると、戻ってきても二度と開けない
let loading: Promise<readonly Factory[]> | null = null

function loadFactories(): Promise<readonly Factory[]> {
  loading ??= Promise.all([
    import('breadboard-fence/core'),
    import('perfboard-fence/core'),
  ]).then(
    ([breadboard, perfboard]): readonly Factory[] => [
      breadboard.createBreadboardEditor,
      perfboard.createPerfboardEditor,
    ],
    (error: unknown) => {
      loading = null
      throw error
    },
  )
  return loading
}

export async function loadFenceEditors(): Promise<readonly FenceEditor[]> {
  const factories = await loadFactories()
  return factories.map((make) => make())
}
