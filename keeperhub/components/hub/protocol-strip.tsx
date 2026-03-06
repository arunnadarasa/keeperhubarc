"use client";

import {
  Box,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Pencil,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { getChainName } from "@/keeperhub/lib/chain-utils";
import type { ProtocolDefinition } from "@/keeperhub/lib/protocol-registry";

const MAX_VISIBLE_CHAINS = 3;

type ProtocolStripProps = {
  protocols: ProtocolDefinition[];
  onSelect: (slug: string) => void;
};

function collectChains(contracts: ProtocolDefinition["contracts"]): string[] {
  const set = new Set<string>();
  for (const contract of Object.values(contracts)) {
    for (const chain of Object.keys(contract.addresses)) {
      set.add(chain);
    }
  }
  return Array.from(set);
}

function countByType(actions: ProtocolDefinition["actions"]): {
  read: number;
  write: number;
} {
  let read = 0;
  let write = 0;
  for (const action of actions) {
    if (action.type === "read") {
      read++;
    } else {
      write++;
    }
  }
  return { read, write };
}

export function ProtocolStrip({
  protocols,
  onSelect,
}: ProtocolStripProps): React.ReactElement | null {
  const scrollRef = useRef<HTMLDivElement>(null);

  const arrowVisibility = useMemo((): string => {
    const count = protocols.length;
    if (count > 4) {
      return "flex";
    }
    if (count > 3) {
      return "flex lg:hidden";
    }
    if (count > 2) {
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
    const cardWidth = 340;
    const gap = 16;
    container.scrollBy({
      left: direction === "left" ? -(cardWidth + gap) : cardWidth + gap,
      behavior: "smooth",
    });
  }, []);

  if (protocols.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
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
        className="flex gap-4 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        ref={scrollRef}
      >
        {protocols.map((protocol) => {
          const chains = collectChains(protocol.contracts);
          const overflow = chains.length - MAX_VISIBLE_CHAINS;
          const { read, write } = countByType(protocol.actions);

          return (
            <button
              className="relative flex w-[340px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-[var(--color-hub-card)] text-left transition-colors hover:border-border hover:brightness-110"
              key={protocol.slug}
              onClick={() => onSelect(protocol.slug)}
              type="button"
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_70%_at_top_left,#243548_0%,transparent_70%)]" />
              <div className="relative flex flex-1 flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-hub-icon-bg)]">
                    {protocol.icon ? (
                      <Image
                        alt={protocol.name}
                        className="rounded"
                        height={24}
                        src={protocol.icon}
                        width={24}
                      />
                    ) : (
                      <Box className="size-5 text-[var(--color-text-accent)]" />
                    )}
                  </div>
                  <h3 className="font-semibold text-base">{protocol.name}</h3>
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </div>

                <p className="line-clamp-2 min-h-[2.5rem] text-muted-foreground text-sm leading-relaxed">
                  {protocol.description.replace(/ -- /g, ". ")}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  {chains.slice(0, MAX_VISIBLE_CHAINS).map((chain) => (
                    <span
                      className="rounded-full bg-[var(--color-bg-accent)] px-2.5 py-0.5 font-medium text-[var(--color-text-accent)] text-[11px]"
                      key={chain}
                    >
                      {getChainName(chain)}
                    </span>
                  ))}
                  {overflow > 0 && (
                    <span className="rounded-full bg-muted/50 px-2.5 py-0.5 font-medium text-muted-foreground text-[11px]">
                      +{overflow}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border/30 px-5 py-3 text-muted-foreground text-xs">
                <div className="flex items-center gap-3">
                  {read > 0 && (
                    <span className="flex items-center gap-1">
                      <Eye className="size-3" />
                      {read} read
                    </span>
                  )}
                  {write > 0 && (
                    <span className="flex items-center gap-1">
                      <Pencil className="size-3" />
                      {write} write
                    </span>
                  )}
                </div>
                <span>
                  {protocol.actions.length}{" "}
                  {protocol.actions.length === 1 ? "action" : "actions"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
