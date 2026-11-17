"use client";

// お絵かき画面の選択状態 (道具・色と太さ・レイヤ・下敷きの有無)。
// DrawModal から切り出した (docs/128 §8-1)。どれも useState だけで、
// effect は持たない。

import { useState } from "react";
import {
  DEFAULT_DRAW_COLOR,
  DEFAULT_DRAW_WIDTH,
  loadDrawPrefs,
  saveDrawPrefs,
} from "@/lib/draw/drawPrefs";
import {
  createLayerState,
  type LayerId,
  type LayerState,
  setActive,
  toggleHidden,
} from "@/lib/draw/layers";
import type { DrawTool } from "./drawTools";

export interface DrawPrefsValue {
  color: string;
  width: number;
}

// 色と太さ。端末に覚えておき、次に開いたときも同じ道具立てで始める
function useDrawPrefsState() {
  const [prefs, setPrefs] = useState<DrawPrefsValue>(() =>
    typeof window === "undefined"
      ? { color: DEFAULT_DRAW_COLOR, width: DEFAULT_DRAW_WIDTH }
      : loadDrawPrefs(window.localStorage),
  );
  const updatePrefs = (next: DrawPrefsValue) => {
    setPrefs(next);
    if (typeof window !== "undefined") {
      saveDrawPrefs(window.localStorage, next);
    }
  };
  return { prefs, updatePrefs };
}

export interface DrawSession {
  tool: DrawTool;
  selectTool: (next: DrawTool) => void;
  prefs: DrawPrefsValue;
  updatePrefs: (next: DrawPrefsValue) => void;
  layerState: LayerState;
  setActiveLayer: (layer: LayerId) => void;
  toggleLayerHidden: (layer: LayerId) => void;
  isLayerPanelOpen: boolean;
  toggleLayerPanel: () => void;
  closeLayerPanel: () => void;
  useBackground: boolean;
  // 描いたものがあるときは確かめてから切り替える
  toggleBackground: (isEmpty: boolean) => void;
}

export function useDrawSession(sourceImageUrl: string | null): DrawSession {
  // 近くに画像があればそれを下敷きにして開く。要らなければ「白紙にする」で外せる
  const [useBackground, setUseBackground] = useState(sourceImageUrl !== null);
  const [tool, setTool] = useState<DrawTool>("pen");
  const { prefs, updatePrefs } = useDrawPrefsState();
  // セッション内レイヤ (docs/50)。保存で 1 枚に平坦化するので、この状態は
  // 画面を閉じれば消える。既定はレイヤ 1 がアクティブ・全表示
  const [layerState, setLayerState] = useState(createLayerState);
  const [isLayerPanelOpen, setLayerPanelOpen] = useState(false);

  return {
    tool,
    // 道具を変えたらパネルは畳む (描画・別操作へ移るとき邪魔にならないよう。§4)
    selectTool: (next) => {
      setTool(next);
      setLayerPanelOpen(false);
    },
    prefs,
    updatePrefs,
    layerState,
    // アクティブ化・表示切り替えは純関数に委ねる (docs/50 §5)。
    // アクティブレイヤを隠せない規則も toggleHidden の中で守られる
    setActiveLayer: (layer) => setLayerState((previous) => setActive(previous, layer)),
    toggleLayerHidden: (layer) => setLayerState((previous) => toggleHidden(previous, layer)),
    isLayerPanelOpen,
    toggleLayerPanel: () => setLayerPanelOpen((previous) => !previous),
    closeLayerPanel: () => setLayerPanelOpen(false),
    useBackground,
    // 下敷きを入れ替えると器の寸法が変わり、描いた線の位置が合わなくなる。
    // 作り直す前に断る
    toggleBackground: (isEmpty) => {
      if (!isEmpty && !window.confirm("描いたものは消えます。切り替えますか？")) {
        return;
      }
      setUseBackground((previous) => !previous);
    },
  };
}
