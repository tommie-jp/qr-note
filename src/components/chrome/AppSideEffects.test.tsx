import { isValidElement, type ReactNode } from "react";
import { expect, test } from "vitest";
import { BootTimingReport } from "@/components/BootTimingReport";
import { ClientLogCapture } from "@/components/ClientLogCapture";
import { DebugConsole } from "@/components/DebugConsole";
import { OfflineSync } from "@/components/OfflineSync";
import { RecordTagSearch } from "@/components/RecordTagSearch";
import { AppSideEffects } from "./AppSideEffects";

// どれも何も描かない部品なので、静的描画ではなく「どの部品をどの順で
// 仕掛けたか」を要素の木から読む
const mountedTypes = (props: Parameters<typeof AppSideEffects>[0]) => {
  const { children } = AppSideEffects(props).props as { children: ReactNode[] };
  return children.filter(isValidElement).map((child) => child.type);
};

test("ログイン中の非デモは 5 つを元の並びで仕掛ける", () => {
  // Arrange / Act
  const mounted = mountedTypes({ user: "tommie", isDemo: false });

  // Assert
  expect(mounted).toEqual([
    ClientLogCapture,
    RecordTagSearch,
    OfflineSync,
    BootTimingReport,
    DebugConsole,
  ]);
});

test("未ログインは eruda (DebugConsole) だけを仕掛ける", () => {
  // Arrange / Act
  const mounted = mountedTypes({ user: null, isDemo: false });

  // Assert
  expect(mounted).toEqual([DebugConsole]);
});

test("デモはサーバへ運ぶ 3 つを仕掛けず、タグ検索の記録と eruda は残す", () => {
  // Arrange / Act
  const mounted = mountedTypes({ user: "guest", isDemo: true });

  // Assert
  expect(mounted).toEqual([RecordTagSearch, DebugConsole]);
});
