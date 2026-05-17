import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
};

function optionHaystack(o: SearchableSelectOption) {
  return [o.label, o.value, o.meta ?? "", o.searchText ?? ""].join(" ").toLowerCase();
}

function rankOption(o: SearchableSelectOption, q: string) {
  const label = o.label.toLowerCase();
  const value = o.value.toLowerCase();
  const hay = optionHaystack(o);
  if (label.startsWith(q)) return 0;
  if (value.startsWith(q)) return 1;
  if (hay.includes(q)) return 2;
  return 3;
}

function highlightLabel(label: string, query: string) {
  const q = query.trim();
  if (!q) return label;
  const idx = label.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return label;
  return (
    <>
      {label.slice(0, idx)}
      <mark className="searchable-select__match">{label.slice(idx, idx + q.length)}</mark>
      {label.slice(idx + q.length)}
    </>
  );
}

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
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    return options.find((o) => o.value === value)?.label ?? value;
  }, [options, value]);

  const query = inputText.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return options;
    return options
      .filter((o) => optionHaystack(o).includes(query))
      .slice()
      .sort((a, b) => {
        const ra = rankOption(a, query);
        const rb = rankOption(b, query);
        if (ra !== rb) return ra - rb;
        return a.label.localeCompare(b.label);
      });
  }, [options, query]);

  const completionSuffix = useMemo(() => {
    if (!open || !query || filtered.length === 0) return "";
    const typed = inputText.trim();
    const top = filtered[0];
    const label = top.label;
    if (!label.toLowerCase().startsWith(typed.toLowerCase())) return "";
    return label.slice(typed.length);
  }, [filtered, inputText, open, query]);

  useEffect(() => {
    if (!open) setInputText(value ? selectedLabel : "");
  }, [value, selectedLabel, open]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  function selectOption(o: SearchableSelectOption) {
    onChange(o.value);
    setInputText(o.label);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  function onInputFocus() {
    if (disabled) return;
    setOpen(true);
    setInputText(value ? selectedLabel : inputText);
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }

  function onInputChange(next: string) {
    setInputText(next);
    setOpen(true);
    setActiveIndex(0);
    if (value && next !== selectedLabel) onChange("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      if (!open || filtered.length === 0) return;
      e.preventDefault();
      const pick = filtered[activeIndex >= 0 ? activeIndex : 0];
      if (pick) selectOption(pick);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setInputText(value ? selectedLabel : "");
      setActiveIndex(-1);
      return;
    }
    if (e.key === "Tab" && open && filtered.length > 0 && query) {
      const pick = filtered[activeIndex >= 0 ? activeIndex : 0];
      if (pick && pick.label.toLowerCase().startsWith(query)) {
        selectOption(pick);
      }
    }
  }

  const activeOptionId =
    activeIndex >= 0 && filtered[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div className={`field searchable-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      {showLabel ? <span className="field__label">{label}</span> : null}
      <div className="searchable-select__combobox">
        <input
          ref={inputRef}
          type="text"
          className="field__input searchable-select__input"
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeOptionId}
          aria-label={!showLabel && !labelId ? label : undefined}
          aria-labelledby={!showLabel && labelId ? labelId : undefined}
          placeholder={open ? searchPlaceholder : placeholder}
          value={inputText}
          onFocus={onInputFocus}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {completionSuffix ? (
          <span className="searchable-select__ghost" aria-hidden>
            <span className="searchable-select__ghost-typed">{inputText}</span>
            <span className="searchable-select__ghost-rest">{completionSuffix}</span>
          </span>
        ) : null}
        <span className="searchable-select__chev" aria-hidden>
          ▾
        </span>
      </div>

      {open && !disabled && (
        <div className="searchable-select__popover">
          <div id={listId} className="searchable-select__list" role="listbox" aria-label={label}>
            {filtered.length === 0 ? (
              <div className="searchable-select__empty muted small">No matches</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.value}
                  id={`${listId}-opt-${i}`}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`searchable-select__option${
                    o.value === value ? " searchable-select__option--on" : ""
                  }${i === activeIndex ? " searchable-select__option--active" : ""}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectOption(o)}
                >
                  <span className="searchable-select__option-label">
                    {highlightLabel(o.label, inputText)}
                  </span>
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
