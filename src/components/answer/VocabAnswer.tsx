"use client";

import { useState } from "react";
import { parseVocabAnswer } from "@/lib/vocabTts";
import { TtsButton } from "./TtsButton";

interface VocabAnswerProps {
  // 開いた答えの文字 (`||` の中身)
  text: string;
  // 答えの直前にある見出し語 (rehypeAnswerTts が刻んだもの)。無ければ null
  word: string | null;
}

// 開いた答えを、発音ボタン付きで描く (docs/81-単語TTS発音計画.md)。
//
//   [🔈] /kənˈsaɪs/ 簡潔な、要領を得た [🔈] His answer was concise and clear.
//    └ 見出し語を読む                   └ 例文を読む
//
// **単語帳の形でなければ何もしない。** 発音記号で始まらない `||答え||`
// (電験ノートなど) は素の文字のまま返す — 記法を増やしていないので、
// 単語帳以外のノートの見た目は 1 文字も変わらない。
export function VocabAnswer({ text, word }: VocabAnswerProps) {
  // 鳴らなかったときの知らせ。**行に 1 つだけ**、答えの後ろに出す
  // (ボタンごとに出すと、答えの途中に長い警告が割り込んで読めなくなる)
  const [silence, setSilence] = useState<string | null>(null);
  const parsed = parseVocabAnswer(text);
  if (parsed === null) {
    return <>{text}</>;
  }

  // head と example をつなぐと元の答えに戻る (vocabTts.ts)。
  // 文字を落とさないために、切った物をそのまま並べる
  return (
    <>
      {word !== null && (
        <TtsButton
          text={word}
          label={`${word} の発音`}
          onSilence={setSilence}
        />
      )}
      {parsed.head}
      {parsed.example !== null && (
        <TtsButton text={parsed.example} label="例文" onSilence={setSilence} />
      )}
      {parsed.example}
      {silence !== null && (
        // block … 答えの行を割らずに下へ落とす。警告なので地味な灰色にはせず、
        // かといって枠は持たせない (押した本人だけが見る一時的な知らせ)。
        // role="status" … 読み上げ環境にも「何か出た」ことを伝える
        <span
          className="mt-0.5 block text-xs font-medium text-red-700"
          role="status"
        >
          ⚠ {silence}
        </span>
      )}
    </>
  );
}
