"use client";

// お絵かき画面の上部バー (見出し・レイヤ・下敷きの切り替え・閉じる)。
// DrawModal から切り出した (docs/128 §8-1)。

import type { LayerId } from "@/lib/draw/layers";
import { DrawLayerPanel } from "./DrawLayerPanel";
import type { DrawSession } from "./useDrawSession";

const BAR_BUTTON_CLASS =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded px-3 font-medium text-white transition active:scale-95 disabled:opacity-40 disabled:active:scale-100";

interface DrawHeaderBarProps {
  session: DrawSession;
  // 下敷きの候補。無ければ切り替えボタンを出さない
  sourceImageUrl: string | null;
  layerCounts: Readonly<Record<LayerId, number>>;
  isEmpty: boolean;
  isBusy: boolean;
  isSaving: boolean;
  onClose: () => void;
}

export function DrawHeaderBar({
  session,
  sourceImageUrl,
  layerCounts,
  isEmpty,
  isBusy,
  isSaving,
  onClose,
}: DrawHeaderBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <h2 className="font-medium">お絵かき</h2>
      <DrawLayerPanel
        active={session.layerState.active}
        hidden={session.layerState.hidden}
        layerCounts={layerCounts}
        open={session.isLayerPanelOpen}
        onToggleOpen={session.toggleLayerPanel}
        onClose={session.closeLayerPanel}
        onSetActive={session.setActiveLayer}
        onToggleHidden={session.toggleLayerHidden}
        disabled={isBusy}
      />
      <div className="ml-auto flex items-center gap-2">
        {sourceImageUrl && (
          <button
            type="button"
            onClick={() => session.toggleBackground(isEmpty)}
            disabled={isBusy}
            className={`${BAR_BUTTON_CLASS} bg-white/15 hover:bg-white/25`}
          >
            {session.useBackground ? "白紙にする" : "画像に描く"}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className={`${BAR_BUTTON_CLASS} bg-white/15 hover:bg-white/25`}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
