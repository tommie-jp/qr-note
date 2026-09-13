"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerIcon } from "@/components/icons";
import { primeVoices, speakEnglish, stopSpeaking } from "@/lib/tts/speak";
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
  const { isSpeaking, press } = useTtsPress(text, onSilence);

  return (
    <button
      type="button"
      // 押す的を文字より広く取る (AnswerSpoiler の ▶ と同じ)
      className="px-1 align-baseline text-sky-700 hover:text-sky-900"
      aria-label={isSpeaking ? `${label}の再生を止める` : `${label}を再生`}
      onClick={press}
    >
      <SpeakerIcon speaking={isSpeaking} />
    </button>
  );
}

// 押下 1 回ぶんの流れ (鳴らす / 止める / 鳴らなかったと知らせる)。
//
// **描画から切り離してある。** この土台に jsdom は無いので、ボタンを置いた
// まま押し心地を確かめる手が無い (TextSizeMenuItem.test.tsx と同じ制約)。
// フックにしておけば押下の順番だけを固定できる (TtsButton.test.tsx) —
// 鳴らなかった回にボタンをどう畳むかは、実機でしか出ない争点そのもの
export function useTtsPress(
  text: string,
  onSilence: (message: string | null) => void,
) {
  const [isSpeaking, setSpeaking] = useState(false);
  // 後片付け (アンマウント) と次の 1 押しの判断に使う。state はクリーンアップ
  // 関数が作られた時点の値で固まるので、いま鳴っているかは ref で見る
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

  const press = () => {
    if (speakingRef.current) {
      stopSpeaking();
      markSpeaking(false);
      return;
    }
    onSilence(null);
    // **押した印は speakEnglish を呼ぶ前に付ける。** 知らせ (onEnd) はその場で
    // 同期に飛んでくることがある — 声の代入も speak() も投げる端末では、
    // 失敗までが 1 本の同期の流れで走る。呼んだ後に印を付けると、既に畳んだ
    // ボタンを鳴っている顔 (点滅 + 「止める」) に戻してしまい、次の 1 押しが
    // 止めるほうへ行って 2 度押さないと鳴らなくなる
    markSpeaking(true);
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
      // 対応していない端末。付けた印をここで戻す (点滅したまま残さない)
      markSpeaking(false);
      onSilence(ttsSilenceMessage());
    }
  };

  return { isSpeaking, press };
}
