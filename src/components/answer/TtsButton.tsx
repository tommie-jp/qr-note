"use client";

import { useEffect, useRef, useState } from "react";
import { primeVoices, speakEnglish, stopSpeaking } from "@/lib/ttsSpeech";
import { ttsSilenceMessage } from "@/lib/ttsSilence";

interface TtsButtonProps {
  // 読み上げる英語 (見出し語 または 例文)
  text: string;
  // 何を読み上げるボタンかの名前。読み上げ (aria-label) に使う
  label: string;
  // 鳴らなかったときの知らせ。文面を**自分では描かない** — 行の途中に
  // 長い警告が割り込むと答えが読めなくなるので、行を知っている側
  // (VocabAnswer) にまとめて出させる。押し直したときは null で消す
  onSilence: (message: string | null) => void;
}

// 本文に埋め込む発音ボタン (docs/81-単語TTS発音計画.md)。
//
// 44px の的は取らない。ここは行の中に混ざる小さな道具で、大きくすると
// 1 行 1 語の密度 (docs/79) を壊してしまう — 答え隠しの ▶ と同じ扱いで、
// 文字より少しだけ広い的にとどめる。
//
// **鳴らないときは黙らない。** 読み上げに対応していない端末では、押しても
// 何も起きないのではなく理由を出す (押し損ねたのかどうかが判らないため)。
export function TtsButton({ text, label, onSilence }: TtsButtonProps) {
  const [speaking, setSpeaking] = useState(false);
  // 後片付け (アンマウント) の判断に使う。state はクリーンアップ関数が
  // 作られた時点の値で固まるので、いま鳴っているかは ref で見る
  const speakingRef = useRef(false);

  const markSpeaking = (value: boolean) => {
    speakingRef.current = value;
    setSpeaking(value);
  };

  useEffect(() => {
    // iOS / Chrome の getVoices() は初回に空を返す。先に一度呼んでおくと
    // 読み込みが始まり、最初の 1 押しから英語の声で鳴る
    primeVoices();
    return () => {
      // 自分が鳴らしている最中に消えるとき (画面移動・答えを閉じる) だけ止める。
      // 無条件に止めると、別の語を鳴らしている途中で黙らせてしまう
      if (speakingRef.current) {
        stopSpeaking();
      }
    };
  }, []);

  const handleClick = () => {
    if (speakingRef.current) {
      stopSpeaking();
      markSpeaking(false);
      return;
    }
    onSilence(null);
    // 音が出なかったときも知らせが来る (speakEnglish の引数)。押しても何も
    // 起きない、が最も困る形なので、鳴らなかったことは必ず言葉にする。
    //
    // **iPhone で消音・着信音量 0 のときはここに落ちる** — 読み上げは始まらず
    // (onstart が来ない)、声を外して試し直しても同じなので、鳴らなかったと
    // 判る。設定そのものはブラウザから読めないので、この経路が唯一の手掛かり
    const started = speakEnglish(text, (spoke) => {
      markSpeaking(false);
      if (!spoke) {
        onSilence(ttsSilenceMessage());
      }
    });
    if (!started) {
      onSilence(ttsSilenceMessage());
      return;
    }
    markSpeaking(true);
  };

  return (
    <button
      type="button"
      // 押す的を文字より広く取る (AnswerSpoiler の ▶ と同じ)
      className="px-1 align-baseline text-sky-700 hover:text-sky-900"
      aria-label={speaking ? `${label}の再生を止める` : `${label}を再生`}
      onClick={handleClick}
    >
      <SpeakerIcon speaking={speaking} />
    </button>
  );
}

// スピーカーのアイコン。アイコンライブラリは足さない (MenuIcons.tsx と
// 同じ判断)。本文には既に `[🔊](辞書)` の絵文字リンクが並ぶので、
// 絵文字ではなく線画にして「別の物」に見せる。
//
// 鳴っている間は波を点滅させる。止める操作ができることの合図で、
// 文字を足さずに状態を出せる
function SpeakerIcon({ speaking }: { speaking: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="inline-block size-4 align-text-bottom"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d="M11 5 6.5 9H3v6h3.5L11 19z"
        fill="currentColor"
        fillOpacity={0.15}
      />
      <g className={speaking ? "animate-pulse" : undefined}>
        <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
        <path d="M17.5 7a7 7 0 0 1 0 10" />
      </g>
    </svg>
  );
}
