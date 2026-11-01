// mermaid の読み込みと描画 (閲覧の MermaidDiagram と編集のライブプレビューで共有)。
//
// **1 か所に寄せる理由は初期化。** mermaid.initialize はモジュール単位の
// 状態を触るので、閲覧側と編集側がそれぞれ import すると設定が二重に走る。
// `securityLevel: "strict"` を two-way で保つ意味でも出どころは 1 つにする。
//
// import そのものが重い (数百 KB) ので、図を描く段になるまで読み込まない。

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null

// mermaid の出力をもう一度濾す (2026-11 のセキュリティ監査 M-2)。
//
// `securityLevel: 'strict'` でも、flowchart のノードラベル (HTML ラベル =
// foreignObject の中) には <form action=外部><input type=password> や
// <a href>・<img src=外部> がそのまま残る (実測)。スクリプトは走らないが、
// 公開ノートの読者に**正規オリジン上の偽ログイン**を見せられる。
//
// DOMPurify を丸ごと掛けるのは使えない — foreignObject の中 (HTML) を名前空間の
// 混在として全部落とし、ラベルの文字が消える (実測)。そこで、描画先と同じ
// HTML の解釈 (template 要素) で一度読み、「送る・飛ぶ・取りに行く」要素と
// 属性だけを外して、同じ解釈で書き戻す。読む側 (innerHTML) と同じパーサを
// 使うので、検査した木と描かれる木がずれない。
// mermaid 自身のサニタイズ (script・on*・javascript: は落ちる) に重ねる第二の層
const FORBID_TAGS = new Set([
  'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object',
  'embed', 'img', 'a', 'base', 'meta', 'link', 'script', 'video', 'audio', 'image',
])
const FORBID_ATTR = new Set(['action', 'formaction', 'form', 'srcdoc', 'ping', 'src', 'data'])
// CSS の中から外を読みに行く書き方 (lib/markdown/safeSvg.ts と同じ考え方)
const UNSAFE_CSS = /url\s*\(|image-set\s*\(|expression\s*\(|@import|\\/i

export type SvgSanitizer = (svg: string) => string

// 描画先の document で動く。テストは jsdom の document を渡す
export function createMermaidSanitizer(doc: Document = document): SvgSanitizer {
  return (svg) => {
    const template = doc.createElement('template')
    template.innerHTML = svg
    const walker = doc.createTreeWalker(template.content, 1 /* SHOW_ELEMENT */)
    const doomed: Element[] = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node as Element
      const tag = element.localName.toLowerCase()
      if (FORBID_TAGS.has(tag)) {
        doomed.push(element)
        continue
      }
      if (tag === 'style' && UNSAFE_CSS.test(element.textContent ?? '')) {
        doomed.push(element)
        continue
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase()
        const value = attribute.value
        if (
          name.startsWith('on') ||
          FORBID_ATTR.has(name) ||
          ((name === 'href' || name.endsWith(':href')) && !value.startsWith('#')) ||
          (name === 'style' && UNSAFE_CSS.test(value)) ||
          /javascript\s*:/i.test(value)
        ) {
          element.removeAttribute(attribute.name)
        }
      }
    }
    for (const element of doomed) {
      element.remove()
    }
    return template.innerHTML
  }
}

let sanitizer: SvgSanitizer | null = null

export function sanitizeMermaidSvg(svg: string): string {
  sanitizer ??= createMermaidSanitizer()
  return sanitizer(svg)
}

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
    // 閲覧 (MermaidDiagram) とライブプレビュー (fenceBlocks) の共通出口なので、
    // ここで通せば両方に効く
    return sanitizeMermaidSvg(svg)
  } catch (e) {
    // 外側の div は "d" + renderId の id を持つ
    document.getElementById(`d${renderId}`)?.remove()
    document.getElementById(renderId)?.remove()
    throw e instanceof Error ? e : new Error(String(e))
  }
}
