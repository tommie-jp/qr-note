"use client";

import { useState } from "react";
import { PaletteIcon } from "@/components/MenuIcons";
import { HEADER_MENU_ROW_CLASS } from "@/components/ui";
import {
  applyRowTint,
  ROW_TINTS,
  type RowTint,
  type RowTintId,
} from "@/lib/rowTint";

// ハンバーガーメニューの「選択色」(docs/88-選択行の色計画.md §3)。
//
// 検索結果でいま開いている行の地色を 6 色から選ぶ。
//
// **保存先はサーバ (user_settings)。** 文字サイズ (docs/61) やペイン構成
// (docs/86) が端末ごとの好みなのに対し、見やすい色は同じ人なら iPhone でも
// PC でも同じなので、端末をまたいで揃える。初期値はサーバが layout で読んで
// 降ろすので、この部品は「押されたら変える」だけを持つ。
//
// **押した瞬間に当てる。** 保存の返事を待って塗り替えると、メニューを開いた
// まま何度か押し比べる操作 (この機能の主な使い方) が毎回もたつく。
// 失敗しても色は戻さない — 見えている色と押した色が食い違うほうが混乱する。
// 食い違いは下の文言で伝え、次の読み込みで元へ戻ることを含みにする。

// 色見本 1 つぶんのボタン。行の高さ (min-h-9) と同じ 36px 角にして、
// 行だけ背が高くならないようにする (TextSizeMenuItem の ＋ / − と同じ)
const SWATCH_BUTTON_CLASS =
  "inline-flex size-9 items-center justify-center rounded transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:opacity-60";

// 保存を諦めるまで。1 行を upsert するだけの口なので、これだけ待って
// 返らなければ電波か鯖の問題で、待ち続けても変わらない
const SAVE_TIMEOUT_MS = 10_000;

function Swatch({ tint, selected }: { tint: RowTint; selected: boolean }) {
  // 選んだ色は**外側の輪**で示す。ring / outline を使わないのは、内側の丸を
  // 実際の地色 (50 番台のごく淡い色) で塗るため — 淡い丸の縁に淡い輪を足すと
  // どちらが選択の印か読めない。濃い枠を 1 本だけ外に回す
  return (
    <span
      className={`inline-flex rounded-full border-2 p-0.5 ${
        selected ? "border-gray-800" : "border-transparent"
      }`}
    >
      {/* 中の丸は「一覧の行がこの色になる」の見本。地色だけだと白い紙の上で
          輪郭が消えるので、画像タイルで使う枠色 (400 番台) で縁取る */}
      <span
        className="size-4 rounded-full border"
        style={{ backgroundColor: tint.bg, borderColor: tint.border }}
      />
    </span>
  );
}

export function RowTintMenuItem({ value }: { value: RowTintId }) {
  const [tint, setTint] = useState<RowTintId>(value);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const pick = async (next: RowTintId) => {
    setTint(next);
    applyRowTint(document.documentElement, next);
    setFailed(false);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/row-tint", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tint: next }),
        // **打ち切りを必ず持たせる。** 保存中は 6 つのボタンを止めている
        // ので、電波の悪い所で応答が返らないと色を選び直せないまま固まる。
        // 断られたのと同じ扱い (catch へ落ちて文言が出る) にする
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      });
      // fetch は 4xx/5xx で投げない。**ここで見ないと、断られたことに
      // 気づかないまま「保存できた」ことになる**
      if (!response.ok) {
        throw new Error(`保存に失敗しました (${response.status})`);
      }
    } catch (error) {
      console.error("選択色の保存に失敗しました:", error);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    // **クリックをここで止める。** シートは「項目を押したら閉じる」を親の
    // バブリング 1 か所で受けているので (HeaderMenu.tsx)、素通しすると 1 色
    // 押しただけで閉じてしまい、色を押し比べられない (TextSizeMenuItem と同じ)。
    // 開いたままなら、暗くした覆いの向こうに一覧の色の変化も見える。
    // flex-wrap … テキストサイズを上げるとこの行も大きくなり、狭い端末では
    // 見本 6 つが 1 行に収まらない。折り返すほうが、右端の色が画面の外へ
    // 出るより扱いやすい
    <div
      className={`${HEADER_MENU_ROW_CLASS} flex-wrap justify-between`}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="flex items-center gap-2">
        <PaletteIcon />
        選択色
      </span>
      {/* -mr-3 … ボタンの的を行の px-3 の外へはみ出させて、右端の余白を
          他の行と揃える (テキストサイズと同じ手) */}
      {/* radiogroup … 6 つで 1 つの値を選ぶ。button を並べただけだと
          読み上げが「いまどれが選ばれているか」を言えない */}
      <span
        role="radiogroup"
        aria-label="選択中の行の色"
        className="-mr-3 flex shrink-0 items-center"
      >
        {ROW_TINTS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === tint}
            aria-label={option.label}
            // 保存中は止める。連打すると、遅れて届いた古い色が最後に
            // 書かれて「押した色と違う色で保存される」ことがある
            disabled={saving}
            onClick={() => void pick(option.id)}
            className={SWATCH_BUTTON_CLASS}
          >
            <Swatch tint={option} selected={option.id === tint} />
          </button>
        ))}
      </span>
      {/* 保存できなかったときだけ出す。**黙って諦めない** — 色は当たって
          いるので、言わなければ次に開いたとき勝手に戻ったように見える。
          role="alert" … 行の外に出た後でも読み上げに届く */}
      {failed && (
        <span role="alert" className="w-full text-sm font-normal text-red-700">
          色を保存できませんでした (この端末では次に開くまで有効)
        </span>
      )}
    </div>
  );
}
