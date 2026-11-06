import { activeFilterCount } from "../../engines/library";
import { cn } from "../../lib/format";
import { useLibrary } from "../../store/library";
import { Button, Select } from "../ui/primitives";

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("h-7 rounded-full border px-2.5 text-xs transition-colors", on ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

export function FilterPanel() {
  const { filter, setFilter, resetFilter, items, formats } = useLibrary();
  const present = new Set(items.filter((i) => !i.companion).map((i) => i.format));
  const fmtChoices = formats.filter((f) => present.has(f.id));
  const toggleFormat = (id: string) => setFilter({ formats: filter.formats.includes(id) ? filter.formats.filter((x) => x !== id) : [...filter.formats, id] });

  return (
    <div className="w-[320px] space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">Filter</span>
        <Button size="sm" variant="ghost" disabled={activeFilterCount(filter) === 0} onClick={resetFilter}>
          Reset
        </Button>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Show only</div>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={filter.favorites} onClick={() => setFilter({ favorites: !filter.favorites })}>
            Favorites
          </Chip>
          <Chip on={filter.live} onClick={() => setFilter({ live: !filter.live })}>
            Live Photos
          </Chip>
          <Chip on={filter.raw} onClick={() => setFilter({ raw: !filter.raw })}>
            RAW
          </Chip>
          <Chip on={filter.animated} onClick={() => setFilter({ animated: !filter.animated })}>
            Animated
          </Chip>
        </div>
      </div>
      {fmtChoices.length > 1 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Format</div>
          <div className="flex flex-wrap gap-1.5">
            {fmtChoices.map((f) => (
              <Chip key={f.id} on={filter.formats.includes(f.id)} onClick={() => toggleFormat(f.id)}>
                {f.name}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-faint">Orientation</span>
          <Select
            className="w-full"
            value={filter.orientation}
            onChange={(v) => setFilter({ orientation: v })}
            options={[
              { value: "any", label: "Any" },
              { value: "landscape", label: "Landscape" },
              { value: "portrait", label: "Portrait" },
              { value: "square", label: "Square" },
            ]}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-faint">Resolution</span>
          <Select
            className="w-full"
            value={filter.minMegapixels}
            onChange={(v) => setFilter({ minMegapixels: v })}
            options={[
              { value: 0, label: "Any" },
              { value: 2, label: "≥ 2 MP" },
              { value: 8, label: "≥ 8 MP" },
              { value: 12, label: "≥ 12 MP" },
              { value: 24, label: "≥ 24 MP" },
              { value: 45, label: "≥ 45 MP" },
            ]}
          />
        </label>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Date (captured, else modified)</div>
        <div className="flex items-center gap-2">
          <input type="date" value={filter.dateFrom ?? ""} onChange={(e) => setFilter({ dateFrom: e.target.value || null })} className="h-8 flex-1 rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-accent" />
          <span className="text-faint">–</span>
          <input type="date" value={filter.dateTo ?? ""} onChange={(e) => setFilter({ dateTo: e.target.value || null })} className="h-8 flex-1 rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-accent" />
        </div>
      </div>
    </div>
  );
}
