"use client";

// セッション内レイヤのパネル (docs/50 §4)。
// ツールバーは既に満杯なので、上部バーに「レイヤ N」ボタンを 1 つ置き、
// 押すと 3 行の小パネルを開く。暗い覆いの上に出すので、共有の白地ボタンでは
// なくこの画面だけの配色 (DrawToolbar と揃える) を持つ。

import { EyeIcon } from "@/components/icons";
import { LAYER_IDS, type LayerId } from "@/lib/draw/layers";

const BUTTON_BASE =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded px-3 font-medium text-white transition active:scale-95 disabled:opacity-40 disabled:active:scale-100";
const BUTTON_TRIGGER = `${BUTTON_BASE} bg-white/15 hover:bg-white/25`;

interface DrawLayerPanelProps {
  active: LayerId;
  hidden: readonly LayerId[];
  layerCounts: Readonly<Record<LayerId, number>>;
  open: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  onSetActive: (layer: LayerId) => void;
  onToggleHidden: (layer: LayerId) => void;
  disabled: boolean;
}

export function DrawLayerPanel({
  active,
  hidden,
  layerCounts,
  open,
  onToggleOpen,
  onClose,
  onSetActive,
  onToggleHidden,
  disabled,
}: DrawLayerPanelProps) {
  // 手前 (3) が上、奥 (1) が下。重なりの順にそのまま並べる
  const rows = [...LAYER_IDS].reverse();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleOpen}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={BUTTON_TRIGGER}
      >
        レイヤ {active}
      </button>

      {open && (
        <>
          {/* パネルの外を押したら閉じる。canvas より前に敷く透明な覆い */}
          <button
            type="button"
            aria-label="レイヤパネルを閉じる"
            onClick={onClose}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg bg-gray-800 p-1 shadow-lg ring-1 ring-white/15"
          >
            {rows.map((layer) => {
              const isActive = layer === active;
              const isHidden = hidden.includes(layer);
              return (
                <div key={layer} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => onSetActive(layer)}
                    className={`flex min-h-11 flex-1 items-center gap-2 rounded px-3 text-left transition ${
                      isActive ? "bg-blue-600 text-white" : "text-white hover:bg-white/10"
                    }`}
                  >
                    <span className="font-medium">レイヤ {layer}</span>
                    <span className="ml-auto text-xs text-white/70">
                      {layerCounts[layer]}
                    </span>
                  </button>
                  <button
                    type="button"
                    // アクティブレイヤは隠せない (見えない場所に描かせない。§2)
                    onClick={() => onToggleHidden(layer)}
                    disabled={isActive}
                    aria-label={
                      isActive
                        ? `レイヤ ${layer} (表示中・アクティブ)`
                        : isHidden
                          ? `レイヤ ${layer} を表示`
                          : `レイヤ ${layer} を非表示`
                    }
                    aria-pressed={!isHidden}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded text-white transition hover:bg-white/10 disabled:opacity-30"
                  >
                    <EyeIcon hidden={isHidden} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default DrawLayerPanel;
