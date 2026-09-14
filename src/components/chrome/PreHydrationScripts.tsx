import { NOTE_FONT_SCALE_INIT_SCRIPT } from "@/lib/prefs/noteFontScale";
import { PANE_SIZE_INIT_SCRIPT } from "@/lib/prefs/paneSize";

// root layout の <head> に置く、hydration より前に同期で走るインラインスクリプト。
// どちらも端末に置いた好みを初回描画の前に html へ書き足す。書き足された
// style を React が「不整合」と見なさないよう、layout の html は
// suppressHydrationWarning を持つ (付け外しは layout.tsx 側)
export function PreHydrationScripts() {
  return (
    <>
      {/* 本文の文字サイズを初回描画の前に当てる (docs/61-テキストサイズ計画.md)。
          useEffect で当てると等倍の本文が一度見えてから大きくなるので、
          HTML の解析中に同期で走らせる (Next の
          docs/01-app/02-guides/preventing-flash-before-hydration.md と同じ手) */}
      <script
        dangerouslySetInnerHTML={{ __html: NOTE_FONT_SCALE_INIT_SCRIPT }}
      />
      {/* 検索 3 ペインの境界を動かした人の寸法 (docs/86 §4-2)。文字サイズと
          同じ理由で解析中に当てる — useEffect だと既定の寸法でひととおり
          組まれた後にペインだけ動く。保存が無ければ何も書かない */}
      <script dangerouslySetInnerHTML={{ __html: PANE_SIZE_INIT_SCRIPT }} />
    </>
  );
}
