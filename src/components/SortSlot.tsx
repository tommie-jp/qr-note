"use client";

import type { ReactNode } from "react";
import { BarSlot } from "@/components/BarSlot";
import { SortAscIcon, SortDescIcon, SortIcon } from "@/components/MenuIcons";
import { cycleOf } from "@/lib/cycle";
import type { SortSpec } from "@/lib/sortDirection";
import { SORT_BASE_LABEL, SORT_DIRECTION_LABEL } from "@/lib/sortLabels";
import type { TrashSortBase } from "@/lib/validation";

const SORT_COLOR = "text-amber-600";

// 並び順メニューの現在行だけに出す方向の印 (docs/64-並び順逆順計画.md §4)。
//
// **行の右端に離して置く**のが要点。ラベルの隣に付けると種別の名前の一部に
// 見えるが、離すと「この行にもう 1 つ的がある」と読める — 実際この行は
// 押すと方向が裏返る。矢印の向きは並びそのもの (降順なら ↓) で、
// 「押すと下がる」ではない。読み上げ側は行の aria-label が持つので隠す
function DirectionMark({ descending }: { descending: boolean }) {
  return (
    <span
      aria-hidden
      className="ml-auto pl-4 text-base leading-none text-amber-600"
    >
      {descending ? "↓" : "↑"}
    </span>
  );
}

interface SortSlotProps<S extends string, B extends TrashSortBase & S> {
  spec: SortSpec<S, B>;
  sort: S;
  // 並び順を cookie に覚えて遷移するサーバーアクション
  action: (formData: FormData) => void | Promise<void>;
  // cookie 名。検索一覧とゴミ箱で別々に覚える (src/lib/sortMode.ts)
  cookieName: string;
  // フォームで持ち回す hidden (検索一覧の検索語)。ゴミ箱には無い
  hidden?: ReactNode;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

// 下部バーの「並び順」スロット。
//
// **リンクではなくフォームなのは cookie に覚えるため** — リンクだと URL しか
// 変わらず、`?sort=` を持たない入口から入るたびに既定へ戻っていた
// (src/lib/sortMode.ts)。アクション側が cookie を書いてから `?sort=` 付きの
// URL へ redirect するので、URL が正なのは変わらない。
//
// **逆順は行を増やさない** (docs/64-並び順逆順計画.md)。8 行のメニューと
// 8 値の循環にすると、選ぶ前に読む量も一周の遠さも倍になる。ここで扱うのは
// 種別のままで、方向はメニューの現在行の再タップに載せる。
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
}: SortSlotProps<S, B>) {
  // 方向の呼び名。基底の値は「その種別の既定の方向」なので、
  // 種別と値が同じかどうかがそのまま逆順かどうかになる
  const directionLabelOf = (value: S) => {
    const base = spec.baseOf(value);
    return SORT_DIRECTION_LABEL[base][base === (value as string) ? 0 : 1];
  };

  // 短いタップは**種別だけ**を回し、方向はその種別の既定に戻す。
  // 方向を引き継ぐと、同じ「番号順」を押しても前回どちらを見ていたかで
  // 結果が変わる (押す前に何が起きるか読めない)。
  // 循環の順は spec.bases の並びそのもの (メニューの上下と揃う)
  const nextBaseOf = cycleOf(spec.bases);
  const nextSortOf = spec.by<S>((value) => nextBaseOf[spec.baseOf(value)]);

  // CycleSlot へ渡す表は妥当な値ぶん全部要る (送信中の値を畳む鍵になる)。
  // 種別ごとの表から広げるだけなので、逆順を足しても書く表は増えない
  const labelOf = spec.by((value) => SORT_BASE_LABEL[spec.baseOf(value)]);
  // 種別では形を変えない — 「並び替え」という 1 つの機能の中の選択肢だから
  // (色も 1 色)。**変えるのは方向だけ**で、↑ / ↓ をラベルに足す代わりに
  // アイコンで出す (docs/64 §4。「アクセス順↓」は 5 スロットの幅に入らない)
  const iconOf = spec.by<ReactNode>((value) =>
    spec.isDescending(value) ? <SortDescIcon /> : <SortAscIcon />,
  );

  const currentBase = spec.baseOf(sort);
  const flipped = spec.reverseOf(sort);

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
        `並び順: ${labelOf[value]}・${directionLabelOf(value)} (押すと${labelOf[nextSortOf[value]]}に切替、長押しで一覧)`
      }
      menuLabel="並び順"
      hidden={hidden}
      // 行は種別のまま。**選んである行だけ、送る値が「方向を裏返した同じ
      // 種別」になる** (docs/64 §3) — 選び直す意味の無いタップに逆順を
      // 載せるので、行も循環の値も増えない。押すたびに往復するので迷子にならない
      items={spec.bases.map((base) => {
        const isCurrent = base === currentBase;
        return {
          key: base,
          value: isCurrent ? flipped : base,
          label: SORT_BASE_LABEL[base],
          icon: <SortIcon />,
          checked: isCurrent,
          // 現在行は押しても種別が変わらないので、何が起きるかを読み上げに
          // 書く。矢印だけでは「押せる」と判らない
          ariaLabel: isCurrent
            ? `${SORT_BASE_LABEL[base]}・${directionLabelOf(sort)} (押すと${directionLabelOf(flipped)}に切替)`
            : undefined,
          mark: isCurrent ? (
            <DirectionMark descending={spec.isDescending(sort)} />
          ) : undefined,
        };
      })}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
}
