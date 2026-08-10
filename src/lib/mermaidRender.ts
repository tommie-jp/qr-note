// mermaid の読み込みと描画 (閲覧の MermaidDiagram と編集のライブプレビューで共有)。
//
// **1 か所に寄せる理由は初期化。** mermaid.initialize はモジュール単位の
// 状態を触るので、閲覧側と編集側がそれぞれ import すると設定が二重に走る。
// `securityLevel: "strict"` を two-way で保つ意味でも出どころは 1 つにする。
//
// import そのものが重い (数百 KB) ので、図を描く段になるまで読み込まない。

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

export function loadMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })
    return mermaid
  })
  return mermaidPromise
}

// mermaid.render に渡せる id へ均す (DOM id になるため記号を落とす)
export function mermaidRenderId(seed: string): string {
  return `mermaid-${seed.replace(/[^a-zA-Z0-9]/g, '')}`
}

// 1 つの図を SVG 文字列にする。**失敗しても後片付けをする**のが要点 —
// mermaid は構文エラーのとき一時要素を body に置き去りにするので、
// 拾わないとエラーのたびに DOM が増える
export async function renderMermaidSvg(
  code: string,
  renderId: string,
): Promise<string> {
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(renderId, code)
    return svg
  } catch (e) {
    // 外側の div は "d" + renderId の id を持つ
    document.getElementById(`d${renderId}`)?.remove()
    document.getElementById(renderId)?.remove()
    throw e instanceof Error ? e : new Error(String(e))
  }
}
