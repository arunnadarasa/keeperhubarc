"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FeaturedCarousel } from "@/keeperhub/components/hub/featured-carousel";
import { getWorkflowTrigger } from "@/keeperhub/components/hub/get-workflow-trigger";
import { HubHero } from "@/keeperhub/components/hub/hub-hero";
import { HubResults } from "@/keeperhub/components/hub/hub-results";
import { ProtocolDetailModal } from "@/keeperhub/components/hub/protocol-detail-modal";
import { ProtocolStrip } from "@/keeperhub/components/hub/protocol-strip";
import { WorkflowSearchFilter } from "@/keeperhub/components/hub/workflow-search-filter";
import { api, type PublicTag, type SavedWorkflow } from "@/lib/api-client";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { ProtocolDefinition } from "@/lib/protocol-registry";

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
  const [selectedTrigger, setSelectedTrigger] = useState<string | null>(null);
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

  const triggers = useMemo(() => {
    const unique = new Set<string>();
    for (const workflow of communityWorkflows) {
      const trigger = getWorkflowTrigger(workflow.nodes);
      if (trigger) {
        unique.add(trigger);
      }
    }
    return Array.from(unique).sort();
  }, [communityWorkflows]);

  const isSearchActive = Boolean(
    debouncedSearchQuery.trim() ||
      selectedTrigger ||
      selectedTagSlugs.length > 0
  );

  const searchResults = useMemo((): SavedWorkflow[] | null => {
    if (!isSearchActive) {
      return null;
    }

    const query = debouncedSearchQuery.trim().toLowerCase();

    let filtered = communityWorkflows;

    if (selectedTrigger) {
      filtered = filtered.filter((w) => {
        const trigger = getWorkflowTrigger(w.nodes);
        return trigger === selectedTrigger;
      });
    }

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
    communityWorkflows,
    selectedTrigger,
    selectedTagSlugs,
    debouncedSearchQuery,
  ]);

  const handleToggleTag = (slug: string): void => {
    setSelectedTagSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

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
      } catch (error) {
        console.error("Failed to fetch workflows:", error);
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

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const gradient = gradientRef.current;
    if (!(container && gradient)) {
      return;
    }

    const handleScroll = (): void => {
      const scrollTop = container.scrollTop;
      const fadeDistance = 500;
      const opacity = Math.max(0, 1 - scrollTop / fadeDistance);
      gradient.style.opacity = String(opacity);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div
      className="pointer-events-auto fixed inset-0 overflow-y-auto bg-sidebar [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      ref={scrollContainerRef}
    >
      <div className="transition-[margin-left] duration-200 ease-out md:ml-[var(--nav-sidebar-width,60px)]">
        {isLoading ? (
          <div className="container mx-auto px-4 pt-20 pb-8 animate-pulse">
            {/* Hero skeleton */}
            <div className="grid items-center gap-8 lg:grid-cols-2">
              <div>
                <div className="mb-4 h-10 w-3/4 rounded bg-muted/30" />
                <div className="mb-2 h-4 w-full max-w-lg rounded bg-muted/20" />
                <div className="mb-6 h-4 w-2/3 max-w-lg rounded bg-muted/20" />
                <div className="flex gap-3">
                  <div className="h-10 w-36 rounded-md bg-muted/20" />
                  <div className="h-10 w-32 rounded-md bg-muted/20" />
                </div>
              </div>
              <div className="hidden h-[200px] rounded-lg bg-muted/10 lg:block" />
            </div>
            {/* Featured skeleton */}
            <div className="mt-10 flex gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  className="h-[240px] w-[280px] shrink-0 rounded-lg bg-muted/10"
                  key={`feat-${String(i)}`}
                />
              ))}
            </div>
            {/* Content skeleton */}
            <div className="mt-10">
              <div className="mx-auto mb-4 h-8 w-48 rounded bg-muted/20" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    className="h-[200px] rounded-lg bg-muted/10"
                    key={`card-${String(i)}`}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <div className="container mx-auto px-4 pt-20">
                <HubHero />
              </div>
            </div>
            <div className="bg-white/[0.03] py-6 relative">
              <div className="absolute top-0 h-full bg-[var(--color-hub-overlay)] w-full" />
              <div className="container mx-auto px-4">
                <FeaturedCarousel workflows={featuredWorkflows} />
              </div>
            </div>

            {protocols.length > 0 && (
              <div className="bg-sidebar py-6">
                <div className="container mx-auto px-4">
                  <ProtocolStrip
                    onSelect={handleProtocolSelect}
                    protocols={protocols}
                  />
                </div>
              </div>
            )}

            <div className="relative pt-6 pb-8">
              <div className="absolute inset-0 bg-[var(--color-hub-overlay)]" />
              <div className="relative container mx-auto px-4">
                <h2 className="mb-4 font-bold text-2xl">Community Workflows</h2>
                <div className="grid grid-cols-[1fr_3fr] items-start gap-8">
                  <div className="sticky top-28">
                    <WorkflowSearchFilter
                      onSearchChange={setSearchQuery}
                      onTagToggle={handleToggleTag}
                      onTriggerChange={setSelectedTrigger}
                      publicTags={publicTags}
                      searchQuery={searchQuery}
                      selectedTagSlugs={selectedTagSlugs}
                      selectedTrigger={selectedTrigger}
                      triggers={triggers}
                    />
                  </div>

                  <HubResults
                    communityWorkflows={communityWorkflows}
                    isSearchActive={isSearchActive}
                    searchResults={searchResults}
                  />
                </div>
              </div>
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
          </>
        )}
      </div>
    </div>
  );
}
