"use client";

import { type ReactNode, useCallback, useRef } from "react";
import { CycleSlot } from "@/components/CycleSlot";
import { SlotIcon } from "@/components/SlotIcon";
import { SlotMenu } from "@/components/SlotMenu";
import {
  BOTTOM_BAR_SLOT_CLASS,
  INLINE_SLOT_CLASS,
  SLOT_MENU_ITEM_CLASS,
} from "@/components/ui";
import { useLongPress } from "@/components/useLongPress";

// cookie を書くサーバーアクション。db.ts を巻き込まないよう prop で受ける
// (ItemList / BottomActionBar と同じ理由)
type SlotAction = (formData: FormData) => void | Promise<void>;

export interface BarSlotMenuItem<T extends string> {
  // 行の識別子 (種別)。**送る値とは別に持つ** — 並び順は選んである行だけ
  // 「方向を裏返した同じ種別」を送るので、行の同一性は value では決まらない
  key: string;
  // 押したときに送る値
  value: T;
  label: string;
  icon: ReactNode;
  checked: boolean;
  // ラベルだけでは何が起きるか判らない行 (現在行の再タップで方向が裏返る、
  // など) の読み上げ
  ariaLabel?: string;
  // 行末に離して置く補助表示 (並び順の方向)
  mark?: ReactNode;
}

interface BarSlotProps<T extends string> {
  action: SlotAction;
  // cookie 名。submit ボタンの name であり、CycleSlot が送信中の値を引く鍵でもある
  cookieName: string;
  current: T;
  nextOf: Record<T, T>;
  labelOf: Record<T, string>;
  iconOf: Record<T, ReactNode>;
  color: string;
  describe: (value: T) => string;
  // 何を選ぶメニューか (読み上げ用)
  menuLabel: string;
  items: readonly BarSlotMenuItem<T>[];
  // フォームで持ち回す hidden (検索語など)。要らない画面では省く
  hidden?: ReactNode;
  // 開閉は**親が持つ**。バーの中で二枚同時に開かないようにするには、
  // どのスロットが開いているかを 1 つの state で持つしかない
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  // 置き場所。bar = 画面下端の等幅スロット、inline = 検索結果の見出し行に
  // 並ぶコンパクトな形 (docs/86 §4-11)。ボタンの見た目とメニューの開く向きが
  // 変わるだけで、循環・長押し・送信の配線はまったく同じ
  variant?: "bar" | "inline";
}

// 長押しメニューの行頭に置く「いまこれ」の印 (docs/62-下部バー長押し計画.md §3)。
//
// 現在値でも枠や背景を塗らない。3 行のうち 1 行が塗られていると、それが
// 「選ばれている」ではなく「押せる主ボタン」に見える。選んでいない行にも
// 同じ幅を空けるのは、印の有無でラベルの左端がずれないようにするため
function MenuCheck({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className="w-4 shrink-0 text-center text-blue-600">
      {checked ? "✓" : ""}
    </span>
  );
}

// 下部バーの 1 スロット (フォーム + 循環ボタン + 長押しメニュー)。
//
// 表示モードと並び順はどちらも「cookie に覚える値を 1 つのボタンで循環させ、
// 長押しでは循環を飛ばして直接選ぶ」という同じ形をしている。**その配線を
// ここ 1 か所に置く** — 送信を潰さずにメニューを閉じる順序 (closeAfterSubmit)
// も、開いているスロットの再タップを循環から外す振り分け (dismissOrCycle) も、
// 一度踏んだ落とし穴の上に建っているので、画面ごとに書き写すと必ずずれる
// (実際ゴミ箱にも同じバーを出すことになった。docs/67-ゴミ箱表示形式計画.md §4)。
//
// フォーム送信のままにしてあるのは JS 無効でも切り替わるから (CycleSlot 参照)。
export function BarSlot<T extends string>({
  action,
  cookieName,
  current,
  nextOf,
  labelOf,
  iconOf,
  color,
  describe,
  menuLabel,
  items,
  hidden,
  open,
  onOpen,
  onClose,
  variant = "bar",
}: BarSlotProps<T>) {
  const press = useLongPress(onOpen);
  // メニューを開いたボタン。SlotMenu が「外側の押下」からこの的を除くのに使う
  const buttonRef = useRef<HTMLButtonElement>(null);

  // メニューの行を選んだときの閉じ方。**その場で閉じてはいけない。**
  //
  // 行はフォームの submit ボタンで、送信はクリックの既定動作として
  // 後から走る。onClick で state を倒すと React はその場で再描画して
  // ボタンを DOM から外し、外れたボタンは form owner を失う。仕様上
  // form を持たない submit ボタンは何もしないので、**メニューで選んでも
  // 表示モードが変わらない**という形で出た (押した手応えだけがある)。
  // 0ms の setTimeout は「いまのタスクが終わってから」の意味で、
  // 送信が起動した後に閉じる。microtask では早すぎる — リスナーが
  // 返った時点で 1 度流れるので、既定動作より前に来てしまう
  const closeAfterSubmit = useCallback(() => {
    setTimeout(onClose, 0);
  }, [onClose]);

  // スロットを押したときの振り分け。**見る順番が要点**で、
  //
  //   1. 長押しを終えた指離し … 何もしない (メニューは開いたまま)
  //   2. 開いている間のタップ … 閉じるだけ。循環はさせない
  //   3. それ以外            … 今までどおり次の値へ循環 (送信を素通し)
  //
  // 1 を先に見ないと、メニューを出した指を離しただけでそれが 2 と見なされ、
  // 開いた瞬間に閉じる (長押しが効かないように見える)。
  // 2 が要るのは、開いたスロットをもう一度押すのが「メニューを引っ込めたい」
  // であって「次のモードにしたい」ではないから — 送信まで通すと、消すつもりの
  // タップで表示モードが 1 つ進む。閉じる的をボタン自身に持たせられるのは、
  // SlotMenu 側がこのボタンへの押下を「外側」から除いているため
  const dismissOrCycle = (event: React.MouseEvent) => {
    if (press.handlers.onClick(event)) {
      return;
    }
    if (open) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    // relative … メニュー (absolute) の基準になる
    <form action={action} className="relative flex flex-1">
      {hidden}
      <CycleSlot
        cookieName={cookieName}
        current={current}
        nextOf={nextOf}
        labelOf={labelOf}
        iconOf={iconOf}
        color={color}
        describe={describe}
        slotClass={
          variant === "bar" ? BOTTOM_BAR_SLOT_CLASS : INLINE_SLOT_CLASS
        }
        expanded={open}
        buttonRef={buttonRef}
        press={press}
        onClick={dismissOrCycle}
      />
      {/* メニューは**ボタンより後ろ**に置く。absolute なので見た目の
          位置は変わらないが、DOM の並びがそのままタブ順になるため、
          前に置くと開いた項目へ Shift+Tab でしか入れない */}
      {open && (
        <SlotMenu
          label={menuLabel}
          anchorRef={buttonRef}
          onClose={onClose}
          // 見出し行のスロットは画面の上側にあるので下向きに開く
          // (上へ開くと検索窓を覆う)
          side={variant === "bar" ? "top" : "bottom"}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="submit"
              name={cookieName}
              value={item.value}
              role="menuitemradio"
              aria-checked={item.checked}
              aria-label={item.ariaLabel}
              onClick={closeAfterSubmit}
              className={SLOT_MENU_ITEM_CLASS}
            >
              <MenuCheck checked={item.checked} />
              <SlotIcon color={color}>{item.icon}</SlotIcon>
              {item.label}
              {item.mark}
            </button>
          ))}
        </SlotMenu>
      )}
    </form>
  );
}
