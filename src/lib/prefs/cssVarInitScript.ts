// 初回描画の前に、端末に覚えた値を CSS 変数へ写すインラインスクリプトの生成
// (docs/93-リファクタリング計画.md §3-1)。
//
// chrome/PreHydrationScripts.tsx が layout の <head> に置く。useEffect で当てると、サーバが描いた既定の
// 見た目でひととおり組まれた後に跳ねるので、HTML の解析中に同期で当てる
// (Next の docs/01-app/02-guides/preventing-flash-before-hydration.md の theme と
// 同じ手)。テキストサイズ (prefs/noteFontScale.ts) とペインの寸法 (prefs/paneSize.ts) が
// 同じ骨格を別々に手で minify していたので、ここで組み立てる。
//
// **バンドルの前に走るので TS の関数は import できない。** 寄せ方の実装は
// JS の断片として二重に持つことになり、ずれると読み込み直後だけ別の見た目で
// 描かれる。各モジュールのテストが TS の実装と同じ表で突き合わせている。
//
// サーバ側 (layout の <head> を組む PreHydrationScripts) から import されるので
// client-only は付けない。

export interface CssVarInitTarget {
  readonly storageKey: string
  readonly cssVar: string
  // 数の後ろに付ける単位 ("rem" / "dvh")。単位の無い値は ""
  readonly unit: string
}

// 0.1 刻みに丸め、範囲外はいちばん近い端へ寄せる (clampPaneSize と同じ)
export interface ClampInitTarget extends CssVarInitTarget {
  readonly min: number
  readonly max: number
}

// いちばん近い段へ寄せる (normalizeNoteFontScale と同じ。等距離なら先の段)。
// 寄せた段が skip と同じなら書かない — CSS 側の既定 (var の第 2 引数) と同じ値を
// html の style に足す意味がない
export interface NearestStepInitTarget extends CssVarInitTarget {
  readonly steps: readonly number[]
  readonly skip: number
}

export type CssVarInitScriptSpec =
  | { readonly normalize: 'clamp'; readonly targets: readonly ClampInitTarget[] }
  | {
      readonly normalize: 'nearestStep'
      readonly targets: readonly NearestStepInitTarget[]
    }

// 読めた数 n を寄せる断片。t は [storageKey, cssVar, unit, 寄せ方の引数 2 つ]。
// continue すると、その変数には何も書かない
const NORMALIZE = {
  clamp: 'n=Math.round(n*10)/10;if(n<t[3])n=t[3];if(n>t[4])n=t[4];',
  nearestStep:
    'var s=t[3],c=s[0];for(var j=1;j<s.length;j++){if(Math.abs(s[j]-n)<Math.abs(c-n))c=s[j]}if(c===t[4])continue;n=c;',
} as const

function targetTuples(spec: CssVarInitScriptSpec): unknown[] {
  if (spec.normalize === 'clamp') {
    return spec.targets.map((t) => [t.storageKey, t.cssVar, t.unit, t.min, t.max])
  }
  return spec.targets.map((t) => [t.storageKey, t.cssVar, t.unit, t.steps, t.skip])
}

// 保存が無い・数として読めない値は何も書かず、CSS の既定のまま描かせる。
//
// 全体を try で包むのは、localStorage を塞いでいるブラウザ (iOS のプライベート
// 閲覧など) で getItem が投げるため。覚えた値を当てられないだけで、既定の
// 見た目では出る (握りつぶすのはこの 1 か所だけ)。
//
// 埋め込む JSON の `<` は `\u003c` (文字列のエスケープ) にする。値はコード内の
// 定数だけだが、`</script>` が紛れ込むとインラインスクリプトがそこで切れるため
export function makeCssVarInitScript(spec: CssVarInitScriptSpec): string {
  const targets = JSON.stringify(targetTuples(spec)).replace(/</g, '\\u003c')
  return (
    `(function(){try{var T=${targets};for(var i=0;i<T.length;i++){` +
    'var t=T[i],r=localStorage.getItem(t[0]);if(r===null)continue;' +
    'var n=parseFloat(r);if(!isFinite(n))continue;' +
    NORMALIZE[spec.normalize] +
    'document.documentElement.style.setProperty(t[1],n+t[2])}}catch(e){}})()'
  )
}
