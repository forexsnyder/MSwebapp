import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
};

export function SearchableSelect({
  className,
  label,
  showLabel = true,
  labelId,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  value,
  options,
  disabled = false,
  onChange,
}: {
  className?: string;
  label: string;
  showLabel?: boolean;
  labelId?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  value: string;
  options: SearchableSelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    return options.find((o) => o.value === value)?.label ?? value;
  }, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const haystack = [o.label, o.value, o.meta ?? "", o.searchText ?? ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <div className={`field searchable-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      {showLabel ? <span className="field__label">{label}</span> : null}
      <button
        type="button"
        className="field__input searchable-select__button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={!showLabel && !labelId ? label : undefined}
        aria-labelledby={!showLabel && labelId ? labelId : undefined}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setQuery("");
        }}
      >
        <span className={value ? "" : "muted"}>{value ? selectedLabel : placeholder}</span>
        <span className="searchable-select__chev" aria-hidden>
          ▾
        </span>
      </button>

      {open && !disabled && (
        <div className="searchable-select__popover">
          <input
            ref={inputRef}
            className="field__input searchable-select__search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={searchPlaceholder}
          />
          <div className="searchable-select__list" role="listbox" aria-label={label}>
            {filtered.length === 0 ? (
              <div className="searchable-select__empty muted small">No matches</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`searchable-select__option${o.value === value ? " searchable-select__option--on" : ""}`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="searchable-select__option-label">{o.label}</span>
                  {o.meta ? <span className="searchable-select__option-meta">{o.meta}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

