"use client";

import { startTransition, useState } from "react";

// 押されたら呼ぶ保存処理。ノート番号は呼び出し側で束ねておく
// (ItemView が `toggleMemoTaskAction.bind(null, itemNo)` で渡す) —
// MarkdownView は「本文をどう描くか」だけを受け取る道具にしておきたいので、
// どのノートかという素性はここまで下りてこない
export type ToggleTaskHandler = (
  line: number,
  checked: boolean,
) => Promise<void>;

interface TaskCheckboxProps {
  // 元の Markdown の行番号 (1 始まり)。rehypeTaskLines が刻んだもの
  line: number;
  // 描画時点の状態。押した後はこの component の state が正になる
  initialChecked: boolean;
  onToggle: ToggleTaskHandler;
}

// 閲覧画面 (markdown タブ) のタスクリストのチェックボックス
// (docs/55-チェックボックス操作計画.md)。押すと本文の `- [ ]` ↔ `- [x]` が
// 書き換わって保存される。
//
// **押した瞬間に見た目を反転させる** (楽観更新) — 単語帳として次々に印を付ける
// 使い方をするので、サーバ往復を待たせない。失敗したら反転を戻して文言を出す
// (静かに握り潰さない)。
//
// 押している間も disabled にはしない。Server Action はクライアント側で
// 順に送られ、送るのは毎回「望む状態」なので、連打しても最後の状態に落ち着く。
export function TaskCheckbox({
  line,
  initialChecked,
  onToggle,
}: TaskCheckboxProps) {
  const [checked, setChecked] = useState(initialChecked);
  const [failed, setFailed] = useState(false);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setChecked(next);
    setFailed(false);
    // Server Action はトランジションの中から呼ぶ約束 (server-actions.md)。
    // 進行中の印は出さないので useTransition の isPending は要らない
    startTransition(async () => {
      try {
        await onToggle(line, next);
      } catch {
        setChecked(!next);
        setFailed(true);
      }
    });
  };

  return (
    <>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        // 指で押す前提の大きさ。prose の既定では小さすぎる
        className="mr-2 size-5 cursor-pointer align-middle accent-blue-600"
      />
      {failed && (
        <span className="mr-1 text-sm text-red-700">保存できませんでした</span>
      )}
    </>
  );
}
