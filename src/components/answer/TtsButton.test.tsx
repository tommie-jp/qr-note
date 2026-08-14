import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { TTS_SILENT_GENERIC_MESSAGE } from "@/lib/ttsSilence";
import { useTtsPress } from "./TtsButton";

// 読み上げそのものは差し替える。ここで見たいのは**押下 1 回ぶんの流れ** —
// 鳴らなかったときに押した見た目が残らないか、次の 1 押しで鳴らし直せるか
const { primeVoices, speakEnglish, stopSpeaking } = vi.hoisted(() => ({
  primeVoices: vi.fn<() => void>(),
  speakEnglish: vi.fn<(text: string, onEnd?: (spoke: boolean) => void) => boolean>(),
  stopSpeaking: vi.fn<() => void>(),
}));
vi.mock("@/lib/ttsSpeech", () => ({ primeVoices, speakEnglish, stopSpeaking }));

type Press = ReturnType<typeof useTtsPress>;

// この土台に jsdom は無い (vitest.config.ts の environment: 'node')。
// フックを静的描画の中で 1 度だけ呼び、返ってきた押下ハンドラを外へ
// 取り出して直に叩く (useLongPress.test.tsx と同じ作法)。
//
// **見るのは state ではなく振る舞い。** 描画が終わった後の setState は
// サーバ描画では捨てられるので、鳴っている / 鳴っていないは「次の 1 押しが
// 止めるほうへ行くか、鳴らすほうへ行くか」で確かめる (押した印は ref で
// 持っており、次の 1 押しが読むのもそちら)
function pressOf(onSilence: (message: string | null) => void): Press {
  const captured: Press[] = [];
  function Probe() {
    captured.push(useTtsPress("concise", onSilence));
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return captured[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // 既定は「鳴り始めたが、まだ終わっていない」端末
  speakEnglish.mockReturnValue(true);
});

test("押すと読み上げを頼み、前の警告を消す", () => {
  // Arrange
  const onSilence = vi.fn();
  const { press } = pressOf(onSilence);

  // Act
  press();

  // Assert
  expect(speakEnglish).toHaveBeenCalledOnce();
  expect(speakEnglish.mock.calls[0][0]).toBe("concise");
  expect(onSilence).toHaveBeenCalledExactlyOnceWith(null);
});

test("鳴っている間に押すと止める (もう一度鳴らさない)", () => {
  // Arrange
  const { press } = pressOf(vi.fn());

  // Act
  press();
  press();

  // Assert
  expect(stopSpeaking).toHaveBeenCalledOnce();
  expect(speakEnglish).toHaveBeenCalledOnce();
});

test("読み終えたら、次の 1 押しでまた鳴らす", () => {
  // Arrange
  let end: ((spoke: boolean) => void) | undefined;
  speakEnglish.mockImplementation((_text, onEnd) => {
    end = onEnd;
    return true;
  });
  const onSilence = vi.fn();
  const { press } = pressOf(onSilence);

  // Act
  press();
  end?.(true);
  press();

  // Assert — 鳴った回では警告を出さない
  expect(speakEnglish).toHaveBeenCalledTimes(2);
  expect(stopSpeaking).not.toHaveBeenCalled();
  expect(onSilence).not.toHaveBeenCalledWith(TTS_SILENT_GENERIC_MESSAGE);
});

test("その場で鳴らなかったときも、次の 1 押しで鳴らし直せる", () => {
  // Arrange — speak() が両方の試行で投げる端末では、失敗の知らせが
  // speakEnglish を抜ける前に**同期で**飛んでくる。呼んだ後に押した印を
  // 付けると、畳んだはずのボタンが鳴っている顔のまま残り、次の 1 押しが
  // 「止める」に使われて 2 度押さないと鳴らなくなる
  speakEnglish.mockImplementation((_text, onEnd) => {
    onEnd?.(false);
    return true;
  });
  const onSilence = vi.fn();
  const { press } = pressOf(onSilence);

  // Act
  press();
  press();

  // Assert
  expect(onSilence).toHaveBeenCalledWith(TTS_SILENT_GENERIC_MESSAGE);
  expect(speakEnglish).toHaveBeenCalledTimes(2);
  expect(stopSpeaking).not.toHaveBeenCalled();
});

test("読み上げに対応していない端末では理由を出し、押した印を残さない", () => {
  // Arrange
  speakEnglish.mockReturnValue(false);
  const onSilence = vi.fn();
  const { press } = pressOf(onSilence);

  // Act
  press();
  press();

  // Assert — 押しても何も起きない、が最も困る形なので必ず言葉にする
  expect(onSilence).toHaveBeenCalledWith(TTS_SILENT_GENERIC_MESSAGE);
  expect(speakEnglish).toHaveBeenCalledTimes(2);
  expect(stopSpeaking).not.toHaveBeenCalled();
});
