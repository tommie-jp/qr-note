"use client";

// セッション内レイヤを fabric のオブジェクトへ落とし込む (docs/50-お絵かきレイヤ計画.md §3)。
// レイヤは各オブジェクトの拡張プロパティ `layer` (1〜3) で表し、Group は使わない。
// どのフラグを立てるか・どこへ挿し込むかは純関数 (lib/draw/layers.ts) に委ね、
// ここは fabric を走査して当てるだけにする。

import type * as fabric from "fabric";
import { useCallback, useState, type RefObject } from "react";
import {
  insertionIndex,
  type LayerId,
  type LayerState,
  layerFlags,
} from "@/lib/draw/layers";
import type { DrawTool } from "./drawTools";
import { applySelectionStyle } from "./selectionStyle";

// layer は @erase2d の erasable と同じ拡張プロパティで、古いスナップショットや
// 素の図形には無いので 1 に倒す (docs/50 §7)
function layerOf(object: fabric.FabricObject): LayerId {
  return ((object as { layer?: LayerId }).layer ?? 1) as LayerId;
}

// 新しく描いたものにアクティブレイヤを刻み、その帯の末尾へ挿し込む
// (docs/50 §3-1)。履歴・JSON から戻したものは自分の layer/erasable を
// 持っているので触らない —— layer の有無で「新規か復元か」を見分ける
export function attachLayerBanding(fc: fabric.Canvas, getActiveLayer: () => LayerId) {
  fc.on("object:added", (event) => {
    const object = event.target;
    if (!object || (object as { layer?: unknown }).layer !== undefined) {
      return;
    }
    const active = getActiveLayer();
    object.set("layer", active);
    // @erase2d が見る erasable の既定を立てる (fabric v7 の既定は未設定)。
    // 消せる/消せないの最終判断は applyLayerState がレイヤに応じて上書きする
    if ((object as { erasable?: unknown }).erasable === undefined) {
      object.set("erasable", true);
    }
    // 追加直後の object は列の末尾に居るので、それを除いた並びから
    // 帯の末尾位置を測って移す。moveObjectTo は object:added を出さない
    // (_onStackOrderChanged は再描画要求だけ) ので、ここで再帰しない
    const layers = fc
      .getObjects()
      .filter((other) => other !== object)
      .map(layerOf);
    fc.moveObjectTo(object, insertionIndex(layers, active));
  });
}

interface UseDrawLayersParams {
  fcRef: RefObject<fabric.Canvas | null>;
  // 初期化で 1 度だけ束ねたハンドラからも読むので、値ではなく控えで受ける
  layerStateRef: Readonly<RefObject<LayerState>>;
  toolRef: Readonly<RefObject<DrawTool>>;
  displayScaleRef: Readonly<RefObject<number>>;
}

export interface DrawLayers {
  isEmpty: boolean;
  // レイヤごとのオブジェクト数 (パネルの「どこに何があるか」表示に使う)
  layerCounts: Readonly<Record<LayerId, number>>;
  refreshStats: () => void;
  applyLayerState: () => void;
}

export function useDrawLayers({
  fcRef,
  layerStateRef,
  toolRef,
  displayScaleRef,
}: UseDrawLayersParams): DrawLayers {
  const [isEmpty, setIsEmpty] = useState(true);
  const [layerCounts, setLayerCounts] = useState<Record<LayerId, number>>({
    1: 0,
    2: 0,
    3: 0,
  });

  // 空判定とレイヤ別オブジェクト数をまとめて出し直す。オブジェクトが増減する
  // 節目 (描いた・戻した・全消し) で呼ぶ
  const refreshStats = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    const objects = fc.getObjects();
    setIsEmpty(objects.length === 0);
    const counts: Record<LayerId, number> = { 1: 0, 2: 0, 3: 0 };
    for (const object of objects) {
      counts[layerOf(object)] += 1;
    }
    setLayerCounts(counts);
  }, [fcRef]);

  // レイヤ状態 (アクティブ・非表示) を全オブジェクトのフラグへ落とし込む。
  // 当て直しの口はここ 1 つに集約する (docs/50 §3-2) —— レイヤ変更時・道具の
  // 切り替え時・履歴からの復元後の 3 箇所から呼ぶ。visible/erasable/selectable の
  // 導出は純関数 layerFlags に委ねる
  const applyLayerState = useCallback(() => {
    const fc = fcRef.current;
    if (!fc) {
      return;
    }
    const state = layerStateRef.current;
    const isSelect = toolRef.current === "select";
    fc.forEachObject((object) => {
      const flags = layerFlags(layerOf(object), state, isSelect);
      object.visible = flags.visible;
      object.set("erasable", flags.erasable);
      object.selectable = flags.selectable;
      object.evented = flags.selectable;
    });
    if (isSelect) {
      applySelectionStyle(fc, displayScaleRef.current);
    } else {
      fc.discardActiveObject();
    }
    fc.requestRenderAll();
  }, [displayScaleRef, fcRef, layerStateRef, toolRef]);

  return { isEmpty, layerCounts, refreshStats, applyLayerState };
}
