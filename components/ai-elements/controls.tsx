"use client";

import { useReactFlow, useStore } from "@xyflow/react";
import { ZoomIn, ZoomOut, Maximize2, MapPin, MapPinXInside, AlignHorizontalDistributeCenter } from "lucide-react";
import { useAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { showMinimapAtom } from "@/lib/workflow-store";

type ControlsProps = {
  onFitView?: () => void;
  onAutoLayout?: () => void;
};

const zoomSelector = (state: { transform: [number, number, number] }): number =>
  Math.round(state.transform[2] * 100);

export const Controls = ({ onFitView, onAutoLayout }: ControlsProps) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const [showMinimap, setShowMinimap] = useAtom(showMinimapAtom);
  const zoomPercent = useStore(zoomSelector);

  const handleZoomIn = () => {
    zoomIn();
  };

  const handleZoomOut = () => {
    zoomOut();
  };

  const handleFitView = () => {
    if (onFitView) {
      onFitView();
    } else {
      fitView({ padding: 0.2, duration: 300 });
    }
  };

  const handleToggleMinimap = () => {
    setShowMinimap(!showMinimap);
  };

  const buttonClass =
    "border hover:bg-black/5 disabled:opacity-100 dark:hover:bg-white/5 disabled:[&>svg]:text-muted-foreground";

  return (
    <ButtonGroup orientation="vertical">
      <Button
        className={buttonClass}
        onClick={handleZoomIn}
        size="icon"
        title="Zoom in"
        variant="secondary"
      >
        <ZoomIn className="size-4" />
      </Button>
      <Button
        className={`${buttonClass} text-[10px] font-medium tabular-nums`}
        onClick={handleFitView}
        size="icon"
        title="Fit view"
        variant="secondary"
      >
        {zoomPercent}%
      </Button>
      <Button
        className={buttonClass}
        onClick={handleZoomOut}
        size="icon"
        title="Zoom out"
        variant="secondary"
      >
        <ZoomOut className="size-4" />
      </Button>
      <Button
        className={buttonClass}
        onClick={handleFitView}
        size="icon"
        title="Fit view"
        variant="secondary"
      >
        <Maximize2 className="size-4" />
      </Button>
      {onAutoLayout && (
        <Button
          className={buttonClass}
          onClick={onAutoLayout}
          size="icon"
          title="Auto-layout"
          variant="secondary"
        >
          <AlignHorizontalDistributeCenter className="size-4" />
        </Button>
      )}
      <Button
        className={buttonClass}
        onClick={handleToggleMinimap}
        size="icon"
        title={showMinimap ? "Hide minimap" : "Show minimap"}
        variant="secondary"
      >
        {showMinimap ? (
          <MapPin className="size-4" />
        ) : (
          <MapPinXInside className="size-4" />
        )}
      </Button>
    </ButtonGroup>
  );
};
