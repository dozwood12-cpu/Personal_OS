"use client";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Upload,
  FileCheck2,
  X,
} from "lucide-react";
type InputProps = InputHTMLAttributes<HTMLInputElement>;
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T12:00:00");
  return !Number.isNaN(d.getTime()) && iso(d) === s ? d : null;
};
export function formatDate(s: unknown) {
  const d = parseDate(String(s || ""));
  return d
    ? new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(d)
    : String(s || "—");
}
export function DateField({
  value,
  defaultValue,
  onChange,
  name,
  required,
  disabled,
  min,
  max,
  type = "date",
  ...props
}: InputProps) {
  const normalize = (v: unknown) => {
    const raw = String(v ?? "");
    return type === "month"
      ? /^\d{4}-\d{2}$/.test(raw) && parseDate(raw + "-01")
        ? raw
        : ""
      : parseDate(raw)
        ? raw
        : "";
  };
  const initial = normalize(value ?? defaultValue);
  const [local, setLocal] = useState(initial),
    [open, setOpen] = useState(false),
    [invalid, setInvalid] = useState(false);
  const selected = value !== undefined ? normalize(value) : local;
  const monthOnly = type === "month";
  const [view, setView] = useState(
    () => parseDate(initial + (monthOnly ? "-01" : "")) || new Date(),
  );
  const [focus, setFocus] = useState(initial || iso(new Date()));
  const [position, setPosition] = useState<CSSProperties>({});
  const anchor = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const ident = useId();
  const label =
    props["aria-label"] ||
    {
      date: "Tanggal",
      deadline: "Tenggat waktu",
      month: "Bulan",
      expires_on: "Kedaluwarsa",
    }[name || ""] ||
    "Pilih tanggal";
  function commit(s: string) {
    setLocal(s);
    setInvalid(false);
    onChange?.({
      target: { value: s, name },
      currentTarget: { value: s, name },
    } as ChangeEvent<HTMLInputElement>);
    setOpen(false);
    anchor.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(328, innerWidth - 32);
      const top =
        r.bottom + 8 + 392 < innerHeight
          ? r.bottom + 8
          : Math.max(16, r.top - 392);
      setPosition({
        position: "fixed",
        left: Math.max(16, Math.min(r.left, innerWidth - width - 16)),
        top,
        width,
        maxHeight: "calc(100dvh - 32px)",
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const day = popup.current?.querySelector<HTMLButtonElement>(
        `[data-date="${selected || iso(new Date())}"]`,
      );
      (
        day ||
        popup.current?.querySelector<HTMLButtonElement>(
          ".picker-months .picked, .picker-months button",
        )
      )?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !anchor.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        anchor.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(view.getFullYear(), view.getMonth(), i - offset + 1),
  );
  const text = selected
    ? monthOnly
      ? new Date(selected + "-01T12:00:00").toLocaleDateString("id-ID", {
          month: "long",
          year: "numeric",
        })
      : formatDate(selected)
    : monthOnly
      ? "Pilih bulan"
      : "Pilih tanggal";
  return (
    <span className="date-field">
      <input
        className="field-proxy"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={selected}
        disabled={disabled}
        required={required}
        pattern={monthOnly ? "[0-9]{4}-[0-9]{2}" : "[0-9]{4}-[0-9]{2}-[0-9]{2}"}
        onChange={() => {}}
        onInvalid={(e) => {
          e.preventDefault();
          setInvalid(true);
          anchor.current?.focus();
        }}
      />
      <button
        ref={anchor}
        type="button"
        className="date-trigger"
        disabled={disabled}
        aria-label={label}
        aria-required={required}
        aria-invalid={invalid}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? ident : undefined}
        onClick={() => {
          setView(parseDate(selected + (monthOnly ? "-01" : "")) || new Date());
          setFocus(selected || iso(new Date()));
          setOpen((v) => !v);
        }}
      >
        <span>{text}</span>
        <CalendarDays size={17} strokeWidth={1.3} />
      </button>
      {invalid && (
        <small className="field-error">Pilih tanggal terlebih dahulu.</small>
      )}
      {open &&
        createPortal(
          <div
            ref={popup}
            id={ident}
            className="date-popover"
            role="dialog"
            aria-label={monthOnly ? "Pilih bulan" : "Pilih tanggal"}
            style={position}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="picker-head">
              <button
                type="button"
                aria-label="Periode sebelumnya"
                onClick={() =>
                  setView(
                    new Date(
                      view.getFullYear() - (monthOnly ? 1 : 0),
                      view.getMonth() - (monthOnly ? 0 : 1),
                      1,
                    ),
                  )
                }
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {view.toLocaleDateString("id-ID", {
                  month: monthOnly ? undefined : "long",
                  year: "numeric",
                })}
              </span>
              <button
                type="button"
                aria-label="Periode berikutnya"
                onClick={() =>
                  setView(
                    new Date(
                      view.getFullYear() + (monthOnly ? 1 : 0),
                      view.getMonth() + (monthOnly ? 0 : 1),
                      1,
                    ),
                  )
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="picker-selects">
              <select
                aria-label="Tahun kalender"
                value={view.getFullYear()}
                onChange={(e) =>
                  setView(new Date(Number(e.target.value), view.getMonth(), 1))
                }
              >
                {Array.from(
                  { length: 151 },
                  (_, i) => new Date().getFullYear() - 100 + i,
                ).map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
              {!monthOnly && (
                <select
                  aria-label="Bulan kalender"
                  value={view.getMonth()}
                  onChange={(e) =>
                    setView(
                      new Date(view.getFullYear(), Number(e.target.value), 1),
                    )
                  }
                >
                  {Array.from({ length: 12 }, (_, m) => (
                    <option key={m} value={m}>
                      {new Date(2026, m, 1).toLocaleDateString("id-ID", {
                        month: "long",
                      })}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {monthOnly ? (
              <div className="picker-months">
                {Array.from({ length: 12 }, (_, m) => {
                  const key = `${view.getFullYear()}-${String(m + 1).padStart(2, "0")}`;
                  return (
                    <button
                      type="button"
                      key={key}
                      className={selected === key ? "picked" : ""}
                      onClick={() => commit(key)}
                    >
                      {new Date(2026, m, 1).toLocaleDateString("id-ID", {
                        month: "short",
                      })}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="picker-week">
                  {["S", "S", "R", "K", "J", "S", "M"].map((d, i) => (
                    <span key={i}>{d}</span>
                  ))}
                </div>
                <div className="picker-days" role="grid" aria-label="Tanggal">
                  {days.map((d) => {
                    const key = iso(d),
                      isToday = key === iso(new Date()),
                      out = d.getMonth() !== view.getMonth();
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        key={key}
                        data-date={key}
                        aria-label={formatDate(key)}
                        aria-selected={selected === key}
                        className={`${selected === key ? "picked" : ""} ${isToday ? "is-today" : ""} ${out ? "outside" : ""}`}
                        disabled={
                          (typeof min === "string" && key < min) ||
                          (typeof max === "string" && key > max)
                        }
                        tabIndex={focus === key ? 0 : -1}
                        onFocus={() => setFocus(key)}
                        onKeyDown={(e) => {
                          const n = (
                            {
                              ArrowLeft: -1,
                              ArrowRight: 1,
                              ArrowUp: -7,
                              ArrowDown: 7,
                            } as Record<string, number>
                          )[e.key];
                          if (n) {
                            e.preventDefault();
                            const next = new Date(d);
                            next.setDate(d.getDate() + n);
                            const v = iso(next);
                            setFocus(v);
                            setView(
                              new Date(next.getFullYear(), next.getMonth(), 1),
                            );
                            setTimeout(
                              () =>
                                popup.current
                                  ?.querySelector<HTMLButtonElement>(
                                    `[data-date="${v}"]`,
                                  )
                                  ?.focus(),
                              0,
                            );
                          }
                        }}
                        onClick={() => commit(key)}
                      >
                        {d.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="picker-footer">
              <button
                type="button"
                className="tertiary"
                onClick={() =>
                  commit(
                    monthOnly ? iso(new Date()).slice(0, 7) : iso(new Date()),
                  )
                }
              >
                Hari ini
              </button>
              {!required && (
                <button
                  type="button"
                  className="tertiary"
                  onClick={() => commit("")}
                >
                  Kosongkan
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Tutup kalender"
                onClick={() => {
                  setOpen(false);
                  anchor.current?.focus();
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
function numeric(raw: string) {
  const s = raw.replace(/Rp|\s/gi, "").replace(/[^\d.,-]/g, "");
  if (s.includes(","))
    return s
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/\.(.*)\./g, ".$1");
  if (/^-?\d+\.\d{1,2}$/.test(s)) return s;
  return s.replace(/\./g, "");
}
function displayNumber(raw: string) {
  const negative = raw.startsWith("-");
  const [whole, fraction] = raw.replace(/-/g, "").split(".");
  const grouped = whole
    ? whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    : "";
  return (
    (negative ? "-" : "") +
    grouped +
    (fraction !== undefined ? "," + fraction : "")
  );
}
export function CurrencyField({
  value,
  defaultValue,
  name,
  required,
  min,
  max,
  disabled,
  onChange,
  ...props
}: InputProps) {
  const [raw, setRaw] = useState(String(value ?? defaultValue ?? "")),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const actual = value === undefined ? raw : String(value);
  useEffect(() => {
    const n = Number(actual);
    let e = "";
    if (
      actual &&
      (!Number.isFinite(n) ||
        (min !== undefined && n < Number(min)) ||
        (max !== undefined && n > Number(max)))
    )
      e = "Nominal berada di luar batas yang tersedia.";
    input.current?.setCustomValidity(e);
  }, [actual, min, max]);
  return (
    <span className="currency-field">
      <span className="currency-prefix" aria-hidden="true">
        Rp
      </span>
      <input
        {...props}
        ref={input}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        required={required}
        value={displayNumber(actual)}
        onInvalid={() => setError("Periksa nominal yang dimasukkan.")}
        onBlur={() => {
          if (input.current?.validity.valid) setError("");
        }}
        onChange={(e) => {
          const next = numeric(e.target.value);
          if (!/^-?\d*(\.\d{0,2})?$/.test(next)) return;
          setRaw(next);
          setError("");
          onChange?.({
            target: { value: next, name },
            currentTarget: { value: next, name },
          } as ChangeEvent<HTMLInputElement>);
        }}
      />
      <input type="hidden" name={name} value={actual} disabled={disabled} />
      {error && <small className="field-error">{error}</small>}
    </span>
  );
}
export function FileDrop({
  compact = false,
  hint,
  ...props
}: InputProps & { compact?: boolean; hint?: string }) {
  const [over, setOver] = useState(false),
    [file, setFile] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <span
      className={`file-drop ${compact ? "compact" : ""} ${over ? "drag-over" : ""} ${props.disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!props.disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (props.disabled || !e.dataTransfer.files.length || !input.current)
          return;
        const transfer = new DataTransfer();
        transfer.items.add(e.dataTransfer.files[0]);
        input.current.files = transfer.files;
        input.current.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    >
      <input
        {...props}
        ref={input}
        type="file"
        onChange={(e) => {
          setFile(e.target.files?.[0]?.name || "");
          props.onChange?.(e);
        }}
      />
      <span className="file-drop-content">
        {file ? (
          <FileCheck2 size={compact ? 16 : 24} strokeWidth={1.2} />
        ) : (
          <Upload size={compact ? 16 : 24} strokeWidth={1.2} />
        )}
        <span>
          {file ||
            (compact ? "Ganti gambar" : "Pilih atau letakkan file di sini")}
        </span>
        {!compact && <small>{hint || "Satu file pada setiap unggahan"}</small>}
      </span>
    </span>
  );
}
