import { afterEach, describe, expect, test, vi } from "vitest";
import {
  applyNearFocusZoom,
  applyTorch,
  applyZoom,
  findUltraWideDeviceId,
  isFrontFacing,
  NEAR_FOCUS_ZOOM,
  readCameraCapabilities,
  zoomLevelsFor,
} from "./cameraSelection";

describe("findUltraWideDeviceId", () => {
  const original = navigator.mediaDevices;

  const setEnumerateDevices = (
    enumerateDevices: (() => Promise<unknown>) | undefined,
  ) => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: enumerateDevices ? { enumerateDevices } : {},
      configurable: true,
    });
  };

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: original,
      configurable: true,
    });
  });

  const device = (kind: string, label: string, deviceId: string) =>
    ({ kind, label, deviceId }) as MediaDeviceInfo;

  test("英語ラベルの背面超広角を拾う", async () => {
    setEnumerateDevices(async () => [
      device("videoinput", "Back Camera", "wide"),
      device("videoinput", "Back Ultra Wide Camera", "ultra"),
      device("audioinput", "Microphone", "mic"),
    ]);
    expect(await findUltraWideDeviceId()).toBe("ultra");
  });

  test("日本語ラベルの超広角も拾う", async () => {
    setEnumerateDevices(async () => [
      device("videoinput", "背面カメラ", "wide"),
      device("videoinput", "背面超広角カメラ", "ultra"),
    ]);
    expect(await findUltraWideDeviceId()).toBe("ultra");
  });

  test("超広角が無ければ null (通常カメラの端末)", async () => {
    setEnumerateDevices(async () => [
      device("videoinput", "Back Camera", "wide"),
      device("videoinput", "Front Camera", "front"),
    ]);
    expect(await findUltraWideDeviceId()).toBeNull();
  });

  test("超広角ラベルでも videoinput 以外は拾わない", async () => {
    setEnumerateDevices(async () => [
      device("audiooutput", "Ultra Wide Speaker", "spk"),
    ]);
    expect(await findUltraWideDeviceId()).toBeNull();
  });

  test("enumerateDevices が無い環境では null", async () => {
    setEnumerateDevices(undefined);
    expect(await findUltraWideDeviceId()).toBeNull();
  });

  test("列挙が失敗しても投げずに null", async () => {
    setEnumerateDevices(async () => {
      throw new Error("denied");
    });
    expect(await findUltraWideDeviceId()).toBeNull();
  });
});

describe("applyNearFocusZoom", () => {
  const makeTrack = (
    caps: unknown,
    applyConstraints = vi.fn(async () => {}),
  ) =>
    ({
      getCapabilities: () => caps,
      applyConstraints,
    }) as unknown as MediaStreamTrack & {
      applyConstraints: ReturnType<typeof vi.fn>;
    };

  test("zoom 対応なら NEAR_FOCUS_ZOOM を上限内で適用する", async () => {
    const track = makeTrack({ zoom: { min: 1, max: 8 } });
    await applyNearFocusZoom(track);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: NEAR_FOCUS_ZOOM }],
    });
  });

  test("最大 zoom が目標より小さいなら最大に丸める", async () => {
    const track = makeTrack({ zoom: { min: 1, max: 1.5 } });
    await applyNearFocusZoom(track);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: 1.5 }],
    });
  });

  test("zoom 非対応なら何も適用しない", async () => {
    const track = makeTrack({});
    await applyNearFocusZoom(track);
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  test("getCapabilities 自体が無くても投げない", async () => {
    const track = {
      applyConstraints: vi.fn(async () => {}),
    } as unknown as MediaStreamTrack & {
      applyConstraints: ReturnType<typeof vi.fn>;
    };
    await expect(applyNearFocusZoom(track)).resolves.toBeUndefined();
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  test("applyConstraints が拒んでも投げない (近接は成立する)", async () => {
    const track = makeTrack(
      { zoom: { min: 1, max: 8 } },
      vi.fn(async () => {
        throw new Error("OverconstrainedError");
      }),
    );
    await expect(applyNearFocusZoom(track)).resolves.toBeUndefined();
  });
});

describe("applyZoom", () => {
  const makeTrack = (
    caps: unknown,
    applyConstraints = vi.fn(async () => {}),
  ) =>
    ({
      getCapabilities: () => caps,
      applyConstraints,
    }) as unknown as MediaStreamTrack & {
      applyConstraints: ReturnType<typeof vi.fn>;
    };

  test("範囲内の値をそのまま適用し、適用値を返す", async () => {
    const track = makeTrack({ zoom: { min: 1, max: 8 } });
    expect(await applyZoom(track, 4)).toBe(4);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ zoom: 4 }],
    });
  });

  test("上限を超える値は最大へ丸める", async () => {
    const track = makeTrack({ zoom: { min: 1, max: 3 } });
    expect(await applyZoom(track, 8)).toBe(3);
  });

  test("下限を下回る値は最小へ丸める", async () => {
    const track = makeTrack({ zoom: { min: 1.5, max: 8 } });
    expect(await applyZoom(track, 1)).toBe(1.5);
  });

  test("zoom 非対応なら null (何もしない)", async () => {
    const track = makeTrack({});
    expect(await applyZoom(track, 2)).toBeNull();
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  test("applyConstraints が拒んだら null", async () => {
    const track = makeTrack(
      { zoom: { min: 1, max: 8 } },
      vi.fn(async () => {
        throw new Error("rejected");
      }),
    );
    expect(await applyZoom(track, 2)).toBeNull();
  });
});

describe("applyTorch", () => {
  const makeTrack = (
    caps: unknown,
    applyConstraints = vi.fn(async () => {}),
  ) =>
    ({
      getCapabilities: () => caps,
      applyConstraints,
    }) as unknown as MediaStreamTrack & {
      applyConstraints: ReturnType<typeof vi.fn>;
    };

  test("対応端末で点灯し true を返す", async () => {
    const track = makeTrack({ torch: true });
    expect(await applyTorch(track, true)).toBe(true);
    expect(track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ torch: true }],
    });
  });

  test("トーチ非対応なら false (何もしない)", async () => {
    const track = makeTrack({ torch: false });
    expect(await applyTorch(track, true)).toBe(false);
    expect(track.applyConstraints).not.toHaveBeenCalled();
  });

  test("applyConstraints が拒んだら false", async () => {
    const track = makeTrack(
      { torch: true },
      vi.fn(async () => {
        throw new Error("rejected");
      }),
    );
    expect(await applyTorch(track, true)).toBe(false);
  });
});

describe("isFrontFacing", () => {
  test("settings の facingMode: user は前面", () => {
    const track = {
      getSettings: () => ({ facingMode: "user" }),
    } as unknown as MediaStreamTrack;
    expect(isFrontFacing(track)).toBe(true);
  });

  test("settings の facingMode: environment は背面", () => {
    const track = {
      getSettings: () => ({ facingMode: "environment" }),
      label: "Front Camera", // settings が勝つ (ラベルは見ない)
    } as unknown as MediaStreamTrack;
    expect(isFrontFacing(track)).toBe(false);
  });

  test("settings が無ければラベルで判定する (英語・日本語)", () => {
    const byLabel = (label: string) =>
      isFrontFacing({ label } as unknown as MediaStreamTrack);
    expect(byLabel("Front Camera")).toBe(true);
    expect(byLabel("前面カメラ")).toBe(true);
    expect(byLabel("Back Ultra Wide Camera")).toBe(false);
  });

  test("何も取れなければ前面と断定しない", () => {
    expect(isFrontFacing({} as unknown as MediaStreamTrack)).toBe(false);
  });
});

describe("zoomLevelsFor", () => {
  test("最大が段階を全て上回れば全段階を返す", () => {
    expect(zoomLevelsFor(8)).toEqual([1, 2, 4]);
  });

  test("最大で出せる段階だけに絞る", () => {
    expect(zoomLevelsFor(3)).toEqual([1, 2]);
  });

  test("1 段階しか出せないならボタンを出さない (空配列)", () => {
    expect(zoomLevelsFor(1)).toEqual([]);
    expect(zoomLevelsFor(1.9)).toEqual([]);
  });
});

describe("readCameraCapabilities", () => {
  const makeTrack = (caps: unknown) =>
    ({ getCapabilities: () => caps }) as unknown as MediaStreamTrack;

  test("torch と zoom を読み取る", () => {
    const track = makeTrack({ torch: true, zoom: { min: 1, max: 8 } });
    expect(readCameraCapabilities(track)).toEqual({
      torch: true,
      zoom: { min: 1, max: 8 },
    });
  });

  test("非対応なら torch=false・zoom=null", () => {
    expect(readCameraCapabilities(makeTrack({}))).toEqual({
      torch: false,
      zoom: null,
    });
  });

  test("getCapabilities 自体が無くても落ちない", () => {
    const track = {} as MediaStreamTrack;
    expect(readCameraCapabilities(track)).toEqual({ torch: false, zoom: null });
  });
});
