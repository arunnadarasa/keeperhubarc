import { BookOpen, Play, Search, X } from "lucide-react";

type HubHeroProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

export function HubHero({
  searchQuery,
  onSearchChange,
}: HubHeroProps): React.ReactElement {
  return (
    <div className="pb-6">
      <div className="flex items-end justify-between gap-8">
        <div>
          <h1 className="font-semibold text-lg tracking-tight">
            Web3 Workflow Templates
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            On-chain monitoring, DeFi strategies, and security alerts. Fork any
            template to your organisation in one click.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          <a
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-[var(--color-hub-icon-bg)] px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:border-border/60 hover:text-foreground motion-reduce:transition-none"
            href="https://youtube.com/@KeeperHub"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Play className="size-3" />
            Demos
          </a>
          <a
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-[var(--color-hub-icon-bg)] px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:border-border/60 hover:text-foreground motion-reduce:transition-none"
            href="https://docs.keeperhub.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            <BookOpen className="size-3" />
            Docs
          </a>
        </div>
      </div>

      <div className="mt-6 max-w-sm">
        <label className="sr-only" htmlFor="hub-search">
          Search templates
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-[var(--color-hub-icon-bg)] px-3.5 py-2 transition-colors focus-within:border-[var(--color-text-accent)]/40 focus-within:ring-1 focus-within:ring-[var(--color-text-accent)]/20">
          <Search className="size-3.5 shrink-0 text-muted-foreground/60" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            id="hub-search"
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search templates..."
            type="text"
            value={searchQuery}
          />
          {searchQuery && (
            <button
              aria-label="Clear search"
              className="text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onSearchChange("")}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
