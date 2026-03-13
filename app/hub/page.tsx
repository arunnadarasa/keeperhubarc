"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { HubHero } from "@/keeperhub/components/hub/hub-hero";
import { HubResults } from "@/keeperhub/components/hub/hub-results";
import { ProtocolDetailModal } from "@/keeperhub/components/hub/protocol-detail-modal";
import { ProtocolStrip } from "@/keeperhub/components/hub/protocol-strip";
import { WorkflowSearchFilter } from "@/keeperhub/components/hub/workflow-search-filter";
import { useDebounce } from "@/keeperhub/lib/hooks/use-debounce";
import type { ProtocolDefinition } from "@/keeperhub/lib/protocol-registry";
import { api, type PublicTag, type SavedWorkflow } from "@/lib/api-client";

export default function HubPage(): React.ReactElement {
  return (
    <Suspense>
      <HubPageContent />
    </Suspense>
  );
}

function HubPageContent(): React.ReactElement {
  const router = useRouter();
  const [featuredWorkflows, setFeaturedWorkflows] = useState<SavedWorkflow[]>(
    []
  );
  const [communityWorkflows, setCommunityWorkflows] = useState<SavedWorkflow[]>(
    []
  );
  const [publicTags, setPublicTags] = useState<PublicTag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagSlugs, setSelectedTagSlugs] = useState<string[]>([]);
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const [protocols, setProtocols] = useState<ProtocolDefinition[]>([]);
  const searchParams = useSearchParams();
  const [selectedProtocolSlug, setSelectedProtocolSlug] = useState<
    string | null
  >(searchParams.get("protocol"));

  const selectedProtocol = useMemo(
    () => protocols.find((p) => p.slug === selectedProtocolSlug) ?? null,
    [protocols, selectedProtocolSlug]
  );

  const handleProtocolSelect = useCallback(
    (slug: string): void => {
      setSelectedProtocolSlug(slug);
      const params = new URLSearchParams(searchParams.toString());
      params.set("protocol", slug);
      router.replace(`/hub?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const clearProtocolSelection = useCallback((): void => {
    setSelectedProtocolSlug(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("protocol");
    const qs = params.toString();
    router.replace(qs ? `/hub?${qs}` : "/hub", { scroll: false });
  }, [router, searchParams]);

  /** Merge featured + community, featured first, deduplicated */
  const allWorkflows = useMemo((): SavedWorkflow[] => {
    const seen = new Set<string>();
    const merged: SavedWorkflow[] = [];
    for (const w of featuredWorkflows) {
      if (!seen.has(w.id)) {
        seen.add(w.id);
        merged.push(w);
      }
    }
    for (const w of communityWorkflows) {
      if (!seen.has(w.id)) {
        seen.add(w.id);
        merged.push(w);
      }
    }
    return merged;
  }, [featuredWorkflows, communityWorkflows]);

  const featuredIds = useMemo(
    () => new Set(featuredWorkflows.map((w) => w.id)),
    [featuredWorkflows]
  );

  const isSearchActive = Boolean(
    debouncedSearchQuery.trim() ||
      selectedTagSlugs.length > 0
  );

  const searchResults = useMemo((): SavedWorkflow[] | null => {
    if (!isSearchActive) {
      return null;
    }

    const query = debouncedSearchQuery.trim().toLowerCase();
    let filtered = allWorkflows;

    if (selectedTagSlugs.length > 0) {
      filtered = filtered.filter((w) =>
        w.publicTags?.some((t) => selectedTagSlugs.includes(t.slug))
      );
    }

    if (query) {
      filtered = filtered.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.description?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [
    isSearchActive,
    allWorkflows,
    selectedTagSlugs,
    debouncedSearchQuery,
  ]);

  const handleToggleTag = (slug: string): void => {
    setSelectedTagSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const clearFilters = useCallback((): void => {
    setSearchQuery("");
    setSelectedTagSlugs([]);
  }, []);

  useEffect(() => {
    const fetchWorkflows = async (): Promise<void> => {
      try {
        const [featured, community, tags] = await Promise.all([
          api.workflow.getFeatured(),
          api.workflow.getPublic(),
          api.publicTag.getAll().catch(() => [] as PublicTag[]),
        ]);
        setFeaturedWorkflows(featured);
        setCommunityWorkflows(community);
        setPublicTags(tags);
      } catch {
        // Workflow fetch failure handled by empty state
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkflows();
  }, []);

  useEffect(() => {
    const fetchProtocols = async (): Promise<void> => {
      try {
        const res = await fetch("/api/protocols");
        if (res.ok) {
          const data: ProtocolDefinition[] = await res.json();
          setProtocols(data);
        }
      } catch {
        // Protocol fetch failure should not block the Hub
      }
    };

    fetchProtocols();
  }, []);

  return (
    <div className="pointer-events-auto fixed inset-0 overflow-x-hidden overflow-y-auto bg-sidebar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-h-full flex-col transition-[margin-left] duration-200 ease-out md:ml-[var(--nav-sidebar-width,60px)]">
        {isLoading ? (
          <div className="container mx-auto max-w-7xl px-6 pt-20 pb-8 animate-pulse">
            <div className="mb-1 h-8 w-64 rounded bg-muted/20" />
            <div className="mb-5 h-4 w-80 rounded bg-muted/10" />
            <div className="mb-8 h-10 w-96 rounded-lg bg-muted/10" />
            <div className="mb-6 flex gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  className="h-9 w-28 rounded-lg bg-muted/10"
                  key={`proto-${String(i)}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  className="h-[180px] rounded-xl bg-muted/10"
                  key={`card-${String(i)}`}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="container mx-auto max-w-7xl px-6 pt-20 pb-8">
            <HubHero
              onSearchChange={setSearchQuery}
              searchQuery={searchQuery}
            />

            {protocols.length > 0 && (
              <ProtocolStrip
                onSelect={handleProtocolSelect}
                protocols={protocols}
              />
            )}

            <div className="mt-4 mb-4">
              <div className="mb-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border/30" />
                  <h2 className="shrink-0 text-[var(--color-text-accent)]/60 text-xs uppercase tracking-widest">
                    Templates
                    <span className="ml-1.5 text-muted-foreground/40">
                      {allWorkflows.length}
                    </span>
                  </h2>
                  <div className="h-px flex-1 bg-border/30" />
                </div>

                <WorkflowSearchFilter
                  onTagToggle={handleToggleTag}
                  publicTags={publicTags}
                  selectedTagSlugs={selectedTagSlugs}
                />
              </div>

              <HubResults
                communityWorkflows={allWorkflows}
                featuredIds={featuredIds}
                isSearchActive={isSearchActive}
                onClearFilters={clearFilters}
                searchResults={searchResults}
              />
            </div>

            <ProtocolDetailModal
              onOpenChange={(open) => {
                if (!open) {
                  clearProtocolSelection();
                }
              }}
              open={selectedProtocolSlug !== null}
              protocol={selectedProtocol}
            />
          </div>
        )}
      </div>
    </div>
  );
}
