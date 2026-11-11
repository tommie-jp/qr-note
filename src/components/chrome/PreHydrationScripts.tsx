import { NOTE_FONT_SCALE_INIT_SCRIPT } from "@/lib/prefs/noteFontScale";
import { PANE_SIZE_INIT_SCRIPT } from "@/lib/prefs/paneSize";
import { PANE_SIDE_PADDING_INIT_SCRIPT } from "@/lib/prefs/paneSidePadding";
import { SCROLLBARS_INIT_SCRIPT } from "@/lib/prefs/scrollbars";

// root layout の <head> に置く、hydration より前に同期で走るインラインスクリプト。
// どちらも端末に置いた好みを初回描画の前に html へ書き足す。書き足された
// style を React が「不整合」と見なさないよう、layout の html は
// suppressHydrationWarning を持つ (付け外しは layout.tsx 側)
// nonce は proxy.ts が要求ごとに作る CSP のもの (lib/security/csp.ts)。無いと
// CSP に止められて文字サイズ・ペイン幅の初期化がちらつく
export function PreHydrationScripts({ nonce }: { nonce?: string }) {
  return (
    <>
      {/* 本文の文字サイズを初回描画の前に当てる (docs/61-テキストサイズ計画.md)。
          useEffect で当てると等倍の本文が一度見えてから大きくなるので、
          HTML の解析中に同期で走らせる (Next の
          docs/01-app/02-guides/preventing-flash-before-hydration.md と同じ手) */}
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: NOTE_FONT_SCALE_INIT_SCRIPT }}
      />
      {/* 検索 3 ペインの境界を動かした人の寸法 (docs/86 §4-2)。文字サイズと
          同じ理由で解析中に当てる — useEffect だと既定の寸法でひととおり
          組まれた後にペインだけ動く。保存が無ければ何も書かない */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PANE_SIZE_INIT_SCRIPT }} />
      {/* ペインの左右の余白 (docs/86 §4-20。カレンダーの設定で選ぶ)。同じ理由 */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PANE_SIDE_PADDING_INIT_SCRIPT }} />
      {/* スクロールバーを出すか (docs/11 §6-8。メニューで選ぶ)。同じ理由 — 後から
          消すとバーの幅のぶん中身が横に揺れる */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SCROLLBARS_INIT_SCRIPT }} />
    </>
  );
}
