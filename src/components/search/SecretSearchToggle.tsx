"use client";

import { LockIcon } from "@/components/icons";
import { COMPACT_ICON_BUTTON_CLASS } from "@/components/ui";
import {
  disableSecretSearch,
  enableSecretSearch,
  useSecretSearch,
} from "@/lib/secret/searchSession";

// 入っているときの見た目。**COMPACT_ICON_BUTTON_CLASS に色を足す形にしない** —
// あちらの bg-white / border-gray-300 と同種のユーティリティどうしになり、勝敗が
// class 属性の並び順ではなく生成 CSS の並び順で決まる (ui.ts の STATE_TOGGLE_CLASS
// と同じ罠)。寸法 (36px 角) だけ揃えて、色は全部こちらで持つ
const ON_CLASS =
  "inline-flex min-h-9 w-9 items-center justify-center rounded border border-amber-500 bg-amber-100 text-amber-700 transition active:scale-95";

// シークレット内検索のトグル (docs/130-シークレット内検索計画.md §3-1)。
//
// 入れると (未解錠なら Face ID で解錠して) テキスト断片を端末で復号し、検索語を
// 断片の中身にも当てる。結果は一覧の先頭の節 (SecretSearchHits) に出る。
//
// **状態は保存しない。** 再読み込みの後は切れた状態から始まる — 開いただけで
// Face ID が出ないようにするため。施錠されたときも勝手に切れる
// (secret/searchSession.ts)。
//
// 失敗の理由はここには出さない (36px 角の釦に文字は載らない)。節の側が出す。
export function SecretSearchToggle() {
  const state = useSecretSearch();
  const isOn = state.status !== "off";
  const label = isOn ? "シークレット内の検索をやめる" : "シークレット内も検索";

  return (
    <button
      type="button"
      onClick={() => (isOn ? disableSecretSearch() : void enableSecretSearch())}
      aria-pressed={isOn}
      aria-busy={state.status === "loading"}
      aria-label={label}
      title={label}
      className={isOn ? ON_CLASS : COMPACT_ICON_BUTTON_CLASS}
    >
      <LockIcon size="regular" />
    </button>
  );
}
