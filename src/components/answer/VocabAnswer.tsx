"use client";

import { useState } from "react";
import { parseVocabAnswer } from "@/lib/vocabTts";
import { shouldShowTtsHint, TTS_SILENT_HINT } from "@/lib/ttsSilence";
import { TtsButton } from "./TtsButton";
import { TtsNotice } from "./TtsNotice";

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
  // 発音ボタンの知らせ。**行に 1 つだけ**、答えの後ろに出す
  // (ボタンごとに出すと、答えの途中に長い文が割り込んで読めなくなる)
  const [notice, setNotice] = useState<{
    message: string;
    dismissible: boolean;
  } | null>(null);

  // TtsButton からの知らせ。文面が来たら本当に鳴らなかったとき、null なら
  // **これから鳴らす** (押した時点で前の知らせを消す口) を意味する。
  //
  // **消音・着信音量 0 は判定できない** — iOS は消音でも onstart / onend を
  // 正常に返す (docs/81 §6-1-4)。だから「鳴らなかった」側には落ちてこない。
  // そこで判定をあきらめ、**押した時点で**直し方を添える。聞こえている人には
  // 無用なので消せるようにしてある
  const handleSilence = (message: string | null) => {
    if (message !== null) {
      setNotice({ message, dismissible: false });
      return;
    }
    setNotice(
      shouldShowTtsHint(window.localStorage)
        ? { message: TTS_SILENT_HINT, dismissible: true }
        : null,
    );
  };

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
          onSilence={handleSilence}
        />
      )}
      {parsed.head}
      {parsed.example !== null && (
        <TtsButton text={parsed.example} label="例文" onSilence={handleSilence} />
      )}
      {parsed.example}
      <TtsNotice
        message={notice?.message ?? null}
        dismissible={notice?.dismissible ?? false}
        onDismiss={() => setNotice(null)}
      />
    </>
  );
}
