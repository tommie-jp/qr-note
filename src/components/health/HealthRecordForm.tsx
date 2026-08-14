"use client";

import { startTransition, useState } from "react";
import { BOX_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui";

// 記録ボタンが呼ぶ保存処理。ノート番号は呼び出し側で束ねておく
// (ItemView が `recordHealthAction.bind(null, itemNo)` で渡す) —
// MarkdownView は「本文をどう描くか」だけを受け取る道具にしておきたいので、
// どのノートかという素性はここまで下りてこない (ToggleTaskHandler と同じ作法)
export type RecordHealthHandler = (
  date: string,
  item: string,
  value: number,
  unit: string,
) => Promise<void>;

interface HealthRecordFormProps {
  // 記録する項目 (グラフの縦軸と同じもの)
  item: string;
  // 値に付ける単位 (無ければ空文字)。既にある記録に揃えるため、
  // 人に選ばせず本文から引き継ぐ
  unit: string;
  // 日付欄の初期値 (JST の今日)。**呼ぶ側から渡してもらう** —
  // ここで現在時刻を読むと、サーバが描いた HTML と食い違って hydration が
  // 壊れる。JST 固定なのはタイムスタンプの表示 (datetime.ts) と同じ作法で、
  // サーバの TZ 設定にも依らない
  today: string;
  onRecord: RecordHealthHandler;
}

const FIELD_CLASS = `${BOX_CLASS} min-h-11 text-base`;

// ```health グラフの上に出す記録欄 (docs/83-健康管理フェンス計画.md §7)。
// BPNote の入力画面に当たるもので、**書き込む先はこのフェンスがあるノート**。
export function HealthRecordForm({
  item,
  unit,
  today,
  onRecord,
}: HealthRecordFormProps) {
  const [date, setDate] = useState(today);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const measured = Number(value);
    if (value.trim() === "" || !Number.isFinite(measured)) {
      setError("数値を入れてください");
      return;
    }
    setError("");
    setSaved(false);
    // Server Action はトランジションの中から呼ぶ約束 (server-actions.md)
    startTransition(async () => {
      try {
        await onRecord(date, item, measured, unit);
        // 入れた値は消す。**残すと「押したのに何も起きていない」に見える** —
        // グラフ側の最新値が入れ替わるのが成功の合図になる
        setValue("");
        setSaved(true);
      } catch {
        setError("記録できませんでした");
      }
    });
  };

  return (
    <form onSubmit={submit} className="mb-2 flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className={FIELD_CLASS}
        aria-label="記録する日"
        required
      />
      <label className="flex items-center gap-1">
        <span className="font-medium text-gray-700">{item}</span>
        {/* inputMode … iPhone で数字のキーボードを先に出す。
            step=any … 体重の 66.4 のような小数を刻み幅で弾かせない。
            text-base (16px) … これを割ると iOS Safari が画面を勝手に拡大する */}
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          className={`${FIELD_CLASS} w-24`}
          aria-label={`${item}の値`}
          required
        />
        {unit && <span className="text-gray-600">{unit}</span>}
      </label>
      <button type="submit" className={PRIMARY_BUTTON_CLASS}>
        記録
      </button>
      {/* 押した結果は必ず文字で言う。静かに失敗させない */}
      {error !== "" && <span className="text-red-700">{error}</span>}
      {saved && error === "" && (
        <span className="text-emerald-700">記録しました</span>
      )}
    </form>
  );
}
