"use client";

import type { ReactNode } from "react";
import { BarSlot } from "@/components/bottombar/BarSlot";
import { useShownValue } from "@/components/bottombar/CycleSlot";
import { SlotIcon } from "@/components/bottombar/SlotIcon";
import { SortAscIcon, SortDescIcon, SortIcon } from "@/components/icons";
import { BOTTOM_BAR_SLOT_CLASS, INLINE_SLOT_CLASS } from "@/components/ui";
import { cycleOf } from "@/lib/prefs/cycle";
import type { SortSpec } from "@/lib/prefs/sortDirection";
import { SORT_BASE_LABEL, SORT_DIRECTION_LABEL } from "@/lib/prefs/sortLabels";
import type { TrashSortBase } from "@/lib/validation";

const SORT_COLOR = "text-amber-600";

type Variant = "bar" | "inline";

interface SortSlotProps<S extends string, B extends TrashSortBase & S> {
  spec: SortSpec<S, B>;
  sort: S;
  // 並び順を cookie に覚えて遷移するサーバーアクション
  action: (formData: FormData) => void | Promise<void>;
  // cookie 名。検索一覧とゴミ箱で別々に覚える (src/lib/prefs/sortMode.ts)
  cookieName: string;
  // フォームで持ち回す hidden (検索一覧の検索語)。ゴミ箱には無い
  hidden?: ReactNode;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  // 置き場所 (BarSlot と同じ)。既定は画面下端のバー
  variant?: Variant;
}

// 方向の呼び名。基底の値は「その種別の既定の方向」なので、
// 種別と値が同じかどうかがそのまま逆順かどうかになる
function directionLabelOf<S extends string, B extends TrashSortBase & S>(
  spec: SortSpec<S, B>,
  value: S,
): string {
  const base = spec.baseOf(value);
  return SORT_DIRECTION_LABEL[base][base === (value as string) ? 0 : 1];
}

// 下部バー / 見出し行の「並び順」— **種別の釦と向きの釦の 2 つ** (docs/64 追記 2026-11-17)。
//
// もとは 1 つの釦で、向きは長押しメニューの現在行の再タップに載せていた
// (docs/64 §3)。それだと逆順にするのに「長押し → 同じ行をもう一度」と
// 隠れた手順を知っている必要があった。向きは独立した釦にして 1 タップで裏返す。
//
// **種別を変えても向きは保つ** (同 案 B)。「↓ のまま登録順へ」は新しい順の
// 登録順になる。矢印は種別をまたいで同じ意味 (上が大きいか小さいか) を持ち、
// 押す前に見えている矢印がそのまま押した後の並びになる。
//
// **リンクではなくフォームなのは cookie に覚えるため** — リンクだと URL しか
// 変わらず、`?sort=` を持たない入口から入るたびに既定へ戻っていた
// (src/lib/prefs/sortMode.ts)。送る値は今までどおり 8 値 (ゴミ箱は 10 値) の
// どれかで、cookie・URL・SQL は種別と向きの分け方を知らない。
//
// 種別が 4 つ (検索一覧) か 5 つ (ゴミ箱の削除順を含む) かの違いは spec が持つ
// (docs/67-ゴミ箱表示形式計画.md §4)。
export function SortSlot<S extends string, B extends TrashSortBase & S>({
  spec,
  sort,
  action,
  cookieName,
  hidden,
  open,
  onOpen,
  onClose,
  variant = "bar",
}: SortSlotProps<S, B>) {
  // その種別で、指定した向きになる値
  const withDirection = (base: B, descending: boolean): S =>
    spec.isDescending(base) === descending ? base : spec.reverseOf(base);

  // 短いタップは種別だけを回し、向きは保つ。
  // 循環の順は spec.bases の並びそのもの (メニューの上下と揃う)
  const nextBaseOf = cycleOf(spec.bases);
  const nextSortOf = spec.by<S>((value) =>
    withDirection(nextBaseOf[spec.baseOf(value)], spec.isDescending(value)),
  );

  // CycleSlot へ渡す表は妥当な値ぶん全部要る (送信中の値を畳む鍵になる)
  const labelOf = spec.by((value) => SORT_BASE_LABEL[spec.baseOf(value)]);
  // 種別の釦は向きを描かない — 向きは隣の釦が持つ。両向きの矢印 1 つに固定
  const iconOf = spec.by<ReactNode>(() => <SortIcon />);

  const currentBase = spec.baseOf(sort);
  const descending = spec.isDescending(sort);

  return (
    <BarSlot
      action={action}
      cookieName={cookieName}
      current={sort}
      nextOf={nextSortOf}
      labelOf={labelOf}
      iconOf={iconOf}
      color={SORT_COLOR}
      describe={(value) =>
        `並び順: ${labelOf[value]}・${directionLabelOf(spec, value)} (押すと${labelOf[nextSortOf[value]]}に切替、長押しで一覧)`
      }
      menuLabel="並び順"
      hidden={hidden}
      // 行は種別を選ぶだけ。向きは今のまま持ち越す (短いタップと同じ)。
      // 選んである行は同じ値を送り直すだけで、何も変わらない
      items={spec.bases.map((base) => ({
        key: base,
        value: base === currentBase ? sort : withDirection(base, descending),
        label: SORT_BASE_LABEL[base],
        icon: <SortIcon />,
        checked: base === currentBase,
      }))}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      variant={variant}
      extra={
        <SortDirectionButton
          spec={spec}
          sort={sort}
          cookieName={cookieName}
          variant={variant}
        />
      }
    />
  );
}

// 向きの釦。押すと同じ種別のまま向きだけを裏返す。
//
// 長押しメニューは持たない (選択肢が 2 つしかなく、タップで往復できる)。
// 見出し行では矢印だけを出す — 「新しい順」は種別ごとに言い方が変わるうえ、
// 横に並べると帯が 4 文字ぶん伸びる。言葉は読み上げと title に置く
function SortDirectionButton<S extends string, B extends TrashSortBase & S>({
  spec,
  sort,
  cookieName,
  variant,
}: {
  spec: SortSpec<S, B>;
  sort: S;
  cookieName: string;
  variant: Variant;
}) {
  // 種別の釦の送信中も、その送った先の向きを見せる (同じ form の中なので読める)
  const { pending, shown } = useShownValue(cookieName, sort, spec.by(() => true));
  const flipped = spec.reverseOf(shown);
  const label = directionLabelOf(spec, shown);
  const description = `並び順の向き: ${label} (押すと${directionLabelOf(spec, flipped)}に切替)`;
  const isBar = variant === "bar";

  return (
    <button
      type="submit"
      name={cookieName}
      value={flipped}
      aria-label={description}
      title={description}
      aria-busy={pending}
      // min-w-8 … 見出し行では矢印 1 つで 28px しかなく、隣の種別の釦と
      // 押し分けにくい。32px まで広げて中央に置く
      className={`${
        isBar ? BOTTOM_BAR_SLOT_CLASS : `${INLINE_SLOT_CLASS} min-w-8 justify-center`
      } text-gray-700`}
    >
      <SlotIcon color={SORT_COLOR} busy={pending}>
        {spec.isDescending(shown) ? <SortDescIcon /> : <SortAscIcon />}
      </SlotIcon>
      {/* 帯は等幅のスロットでラベルを必ず出す作り (他のスロットと揃える) */}
      {isBar && <span>{label}</span>}
    </button>
  );
}
