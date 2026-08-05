import { describe, expect, test } from "vitest";
import { buildScannerConstraints, rollbackTarget } from "./scannerConstraints";

describe("buildScannerConstraints", () => {
  test("外側 (environment) は facingMode: environment", () => {
    expect(
      buildScannerConstraints({
        facing: "environment",
        nearFocus: false,
        ultraWideId: null,
      }),
    ).toEqual({ facingMode: "environment" });
  });

  test("内側 (user) は facingMode: user", () => {
    expect(
      buildScannerConstraints({
        facing: "user",
        nearFocus: false,
        ultraWideId: "front",
      }),
    ).toEqual({ facingMode: "user" });
  });

  test("近接かつ超広角 deviceId があれば deviceId を名指しする", () => {
    expect(
      buildScannerConstraints({
        facing: "environment",
        nearFocus: true,
        ultraWideId: "ultra",
      }),
    ).toEqual({ deviceId: { exact: "ultra" } });
  });

  test("近接でも超広角 deviceId が無ければ facingMode へ退避する", () => {
    expect(
      buildScannerConstraints({
        facing: "environment",
        nearFocus: true,
        ultraWideId: null,
      }),
    ).toEqual({ facingMode: "environment" });
  });
});

describe("rollbackTarget", () => {
  const back = { facing: "environment", nearFocus: false } as const;
  const near = { facing: "environment", nearFocus: true } as const;
  const front = { facing: "user", nearFocus: false } as const;

  test("開けなかった狙いから、最後に開けた狙いへ戻す", () => {
    // 近接に切り替えられなかった → 直前まで写っていた通常の外側へ帰る
    expect(rollbackTarget(near, back)).toEqual(back);
  });

  test("内外切替に失敗しても最後に開けた狙いへ戻す", () => {
    expect(rollbackTarget(front, back)).toEqual(back);
  });

  test("まだ一度も開けていなければ戻り先が無い (null)", () => {
    // 初回起動の失敗 (権限拒否など)。戻す先が無いので触らず、表示は
    // エラーだけに任せる
    expect(rollbackTarget(back, null)).toBeNull();
  });

  test("いまの狙いが最後に開けたものなら何もしない (null)", () => {
    // 戻り先で開き直しても失敗したときに、同じ constraints を投げ続けて
    // 無限に開き直さないための番人
    expect(rollbackTarget(back, back)).toBeNull();
    expect(rollbackTarget(near, near)).toBeNull();
  });
});
