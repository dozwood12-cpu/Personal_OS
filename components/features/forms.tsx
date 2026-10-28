"use client";
import { useState, type ReactNode } from "react";
import { writeData, dateToday, type Dataset, type Row } from "@/lib/model";
export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="panel modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-head">
          <h3>{title}</h3>
          <button aria-label="Tutup" onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: string;
  optional?: boolean;
};
export function fieldsFor(table: string, data: Dataset): Field[] {
  const category = (kind: string) => ({
    key: kind === "status" ? "status_id" : "category_id",
    label: kind === "status" ? "Status" : "Kategori",
    options: (data.categories || [])
      .filter((c) =>
        kind === "finance"
          ? ["income", "expense"].includes(String(c.kind))
          : c.kind === kind,
      )
      .map((c) => ({ value: c.id, label: String(c.name) })),
  });
  const account = {
    key: "account_id",
    label: "Akun",
    options: (data.accounts || []).map((a) => ({
      value: a.id,
      label: String(a.name),
    })),
  };
  const title = { key: "title", label: "Nama" },
    date = { key: "deadline", label: "Tenggat", type: "date" },
    amount = {
      key: "amount",
      label: "Jumlah (Rp)",
      type: "number",
      min: 0.01,
      step: ".01",
    };
  switch (table) {
    case "accounts":
      return [
        { key: "name", label: "Nama akun" },
        {
          key: "kind",
          label: "Jenis",
          options: [
            { value: "cash", label: "Kas" },
            { value: "bank", label: "Bank" },
            { value: "ewallet", label: "E-wallet" },
          ],
        },
        {
          key: "opening_balance",
          label: "Saldo awal (Rp)",
          type: "number",
          step: ".01",
        },
      ];
    case "transfers":
      return [
        title,
        { ...account, key: "from_account", label: "Dari akun" },
        { ...account, key: "to_account", label: "Ke akun" },
        amount,
        { key: "date", label: "Tanggal", type: "date" },
      ];
    case "budgets":
      return [
        category("expense"),
        { key: "month", label: "Bulan", type: "month" },
        amount,
      ];
    case "savings_goals":
      return [
        title,
        { ...amount, key: "target", label: "Target (Rp)" },
        { ...amount, key: "saved", label: "Terkumpul (Rp)", min: 0 },
        date,
      ];
    case "recurring_rules":
      return [
        title,
        amount,
        category("finance"),
        account,
        { key: "next_due", label: "Jatuh tempo berikutnya", type: "date" },
        {
          key: "frequency",
          label: "Frekuensi",
          options: [
            { value: "monthly", label: "Bulanan" },
            { value: "weekly", label: "Mingguan" },
            { value: "daily", label: "Harian" },
            { value: "yearly", label: "Tahunan" },
          ],
        },
        { key: "active", label: "Aktif", type: "checkbox" },
      ];
    case "mwbs":
      return [
        title,
        {
          key: "project_id",
          label: "Proyek (opsional)",
          optional: true,
          options: (data.projects || []).map((p) => ({
            value: p.id,
            label: String(p.title),
          })),
        },
        date,
        { key: "done", label: "Selesai", type: "checkbox" },
      ];
    case "subtasks":
      return [
        title,
        {
          key: "mwb_id",
          label: "MWB",
          options: (data.mwbs || []).map((m) => ({
            value: m.id,
            label: String(m.title),
          })),
        },
        { key: "done", label: "Selesai", type: "checkbox" },
      ];
    case "projects":
      return [
        title,
        category("status"),
        {
          key: "progress",
          label: "Progres (%)",
          type: "number",
          min: 0,
          max: 100,
        },
        date,
        { key: "is_mwb", label: "Tandai proyek sebagai MWB", type: "checkbox" },
      ];
    case "documents":
      return [
        title,
        category("document"),
        { key: "tags", label: "Tag (pisahkan koma)" },
        {
          key: "expires_on",
          label: "Kedaluwarsa (opsional)",
          type: "date",
          optional: true,
        },
      ];
    default:
      return [];
  }
}
export function RecordForm({
  table,
  data,
  record,
  close,
  refresh,
  defaults = {},
}: {
  table: string;
  data: Dataset;
  record?: Row;
  close: () => void;
  refresh: () => Promise<void>;
  defaults?: Record<string, unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fields = fieldsFor(table, data),
    values = { ...defaults, ...record };
  return (
    <Dialog
      title={record ? "Edit data" : "Tambah data"}
      close={() => !busy && close()}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const f = new FormData(e.currentTarget);
            const value: Record<string, unknown> = {};
            for (const field of fields) {
              const raw = f.get(field.key);
              value[field.key] =
                field.type === "checkbox"
                  ? raw === "on"
                  : field.type === "number"
                    ? Number(raw)
                    : field.optional && !raw
                      ? null
                      : String(raw || "");
            }
            if (table === "budgets") value.month = String(value.month) + "-01";
            if (table === "recurring_rules")
              value.anchor_day = Number(String(value.next_due).slice(-2));
            if (table === "documents")
              value.tags = String(value.tags || "")
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
            await writeData(
              table,
              record ? "update" : "create",
              value,
              record?.id,
            );
            await refresh();
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.map((field) => {
          let val = values[field.key];
          if (field.key === "month" && val) val = String(val).slice(0, 7);
          if (field.key === "tags")
            val = Array.isArray(val) ? val.join(", ") : "";
          return (
            <label
              className={field.type === "checkbox" ? "checkbox" : ""}
              key={field.key}
            >
              {field.label}
              {field.options ? (
                <select
                  aria-label={field.label}
                  name={field.key}
                  required={!field.optional}
                  defaultValue={String(val || "")}
                >
                  <option value="">Pilih</option>
                  {field.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <input
                  aria-label={field.label}
                  type="checkbox"
                  name={field.key}
                  defaultChecked={
                    val === undefined ? field.key === "active" : !!val
                  }
                />
              ) : (
                <input
                  aria-label={field.label}
                  name={field.key}
                  type={field.type || "text"}
                  required={!field.optional && field.key !== "tags"}
                  maxLength={field.type ? undefined : 200}
                  min={field.min}
                  max={field.max}
                  step={field.step || "1"}
                  defaultValue={
                    val !== undefined
                      ? String(val)
                      : field.type === "date"
                        ? dateToday()
                        : field.type === "month"
                          ? dateToday().slice(0, 7)
                          : field.type === "number"
                            ? "0"
                            : ""
                  }
                />
              )}
            </label>
          );
        })}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Menyimpan…" : "Simpan"}
        </button>
      </form>
    </Dialog>
  );
}
export function Actions({
  edit,
  remove,
}: {
  edit: () => void;
  remove: () => void;
}) {
  return (
    <div className="row-actions">
      <button aria-label="Edit" onClick={edit}>
        Edit
      </button>
      <button aria-label="Hapus" onClick={remove}>
        Hapus
      </button>
    </div>
  );
}
