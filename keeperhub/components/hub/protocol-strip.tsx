"use client";

import { Box, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ProtocolDefinition } from "@/keeperhub/lib/protocol-registry";

type ProtocolStripProps = {
  protocols: ProtocolDefinition[];
  onSelect: (slug: string) => void;
};

export function ProtocolStrip({
  protocols,
  onSelect,
}: ProtocolStripProps): React.ReactElement | null {
  const scrollRef = useRef<HTMLDivElement>(null);

  const arrowVisibility = useMemo((): string => {
    const count = protocols.length;
    if (count > 6) {
      return "flex";
    }
    if (count > 4) {
      return "flex lg:hidden";
    }
    if (count > 3) {
      return "flex md:hidden";
    }
    if (count > 1) {
      return "flex sm:hidden";
    }
    return "hidden";
  }, [protocols.length]);

  const scroll = useCallback((direction: "left" | "right") => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const itemWidth = 180;
    const gap = 12;
    const scrollAmount = itemWidth + gap;
    container.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  }, []);

  if (protocols.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-2xl">Protocols</h2>
        <div className={`gap-2 ${arrowVisibility}`}>
          <Button
            aria-label="Scroll left"
            onClick={() => scroll("left")}
            size="icon"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            aria-label="Scroll right"
            onClick={() => scroll("right")}
            size="icon"
            variant="outline"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div
        className="flex gap-3 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={scrollRef}
      >
        {protocols.map((protocol) => (
          <button
            className="flex w-[180px] shrink-0 items-center gap-3 rounded-lg border border-border/50 bg-sidebar px-3 py-3 text-left transition-colors hover:brightness-125"
            key={protocol.slug}
            onClick={() => onSelect(protocol.slug)}
            type="button"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#2a3342]">
              {protocol.icon ? (
                <Image
                  alt={protocol.name}
                  className="rounded"
                  height={20}
                  src={protocol.icon}
                  width={20}
                />
              ) : (
                <Box className="size-4 text-[#09fd67]" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">{protocol.name}</p>
              <p className="text-muted-foreground text-xs">
                {protocol.actions.length}{" "}
                {protocol.actions.length === 1 ? "action" : "actions"}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
