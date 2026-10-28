"use client";
import { useEffect, useState } from "react";
import {
  accountBalance,
  command,
  currency,
  dateToday,
  writeData,
  type Dataset,
  type Row,
} from "@/lib/model";
import {
  cashflow,
  filterTransactions,
  monthExpense,
  duplicateKey,
} from "@/lib/finance";
import { CategoryMark } from "./category-mark";
import { RecordForm, Actions } from "./forms";
import Papa from "papaparse";
function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function Count({ value }: { value: number }) {
  const [n, setN] = useState(value);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      setN(value * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{currency(n)}</>;
}
export default function Finance({
  data,
  refresh,
  editTransaction,
  removeTransaction,
  widgets,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
  editTransaction: (r?: Row) => void;
  removeTransaction: (r: Row) => void;
  widgets: string[];
}) {
  const [tab, setTab] = useState("journal"),
    [q, setQ] = useState(""),
    [kind, setKind] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [account, setAccount] = useState(""),
    [page, setPage] = useState(1),
    [period, setPeriod] = useState(7),
    [form, setForm] = useState<{ table: string; record?: Row } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = filterTransactions(data, q, kind, from, to, account),
    cats = new Map(data.categories.map((c) => [c.id, c])),
    income = data.transactions
      .filter((t) => cats.get(String(t.category_id))?.kind === "income")
      .reduce((n, t) => n + Number(t.amount), 0),
    expense = data.transactions
      .filter((t) => cats.get(String(t.category_id))?.kind === "expense")
      .reduce((n, t) => n + Number(t.amount), 0),
    opening = data.accounts.reduce((n, a) => n + Number(a.opening_balance), 0);
  const pages = Math.max(1, Math.ceil(rows.length / 15)),
    current = Math.min(page, pages);
  const chart = cashflow(data, period),
    max = Math.max(1, ...chart.flatMap((d) => [d.income, d.expense]));
  const donut = data.categories
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      ...c,
      total: rows
        .filter((t) => t.category_id === c.id)
        .reduce((n, t) => n + Number(t.amount), 0),
    }))
    .filter((c) => c.total > 0);
  const total = donut.reduce((n, c) => n + c.total, 0);
  let offset = 0;
  const gradient = donut
    .map((c, i) => {
      const start = offset;
      offset += (c.total / total) * 100;
      return `${c.color || ["#fafafa", "#a1a1aa", "#71717a", "#52525b"][i % 4]} ${start}% ${offset}%`;
    })
    .join(",");
  useEffect(() => setPage(1), [q, kind, from, to, account]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(table: string, r: Row) {
    if (confirm("Hapus data ini?"))
      await run(async () => {
        await writeData(table, "delete", undefined, r.id);
        await refresh();
      });
  }
  async function exportRows(excel: boolean) {
    await run(async () => {
      const output = rows.map((t) => ({
        Tanggal: t.date,
        Deskripsi: t.title,
        Kategori: cats.get(String(t.category_id))?.name,
        Jenis: cats.get(String(t.category_id))?.kind,
        Akun: data.accounts.find((a) => a.id === t.account_id)?.name,
        Jumlah: Number(t.amount),
      }));
      if (excel) {
        const Excel = await import("exceljs");
        const workbook = new Excel.Workbook();
        const sheet = workbook.addWorksheet("Transaksi");
        sheet.columns = Object.keys(
          output[0] || {
            Tanggal: "",
            Deskripsi: "",
            Kategori: "",
            Jenis: "",
            Akun: "",
            Jumlah: "",
          },
        ).map((key) => ({ header: key, key, width: 24 }));
        sheet.addRows(output);
        const b = await workbook.xlsx.writeBuffer();
        download(
          new Blob([b as ArrayBuffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          "orbit-transaksi.xlsx",
        );
      } else
        download(
          new Blob(
            ["\uFEFF" + Papa.unparse(output, { escapeFormulae: true })],
            { type: "text/csv;charset=utf-8" },
          ),
          "orbit-transaksi.csv",
        );
    });
  }
  const summary = (
    <div className="stats">
      <section className="panel balance">
        <div className="card-label">Total saldo</div>
        <h2>
          <Count value={opening + income - expense} />
        </h2>
        <small className="muted">Termasuk saldo awal {currency(opening)}</small>
      </section>
      <section className="panel">
        <div className="card-label">Pemasukan</div>
        <h2>
          <Count value={income} />
        </h2>
        <small className="muted">Seluruh transaksi</small>
      </section>
      <section className="panel">
        <div className="card-label">Pengeluaran</div>
        <h2>
          <Count value={expense} />
        </h2>
        <small className="muted">Transfer tidak termasuk</small>
      </section>
    </div>
  );
  const cash = (
    <div className="middle-grid">
      <section className="panel">
        <div className="section-head">
          <h3>Cash flow</h3>
          <select
            aria-label="Periode grafik"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value={7}>7 hari</option>
            <option value={30}>30 hari</option>
            <option value={12}>12 bulan</option>
          </select>
        </div>
        <div
          className="chart"
          role="img"
          aria-label="Grafik pemasukan dan pengeluaran"
        >
          <div className="cash-chart">
            {chart.map((d) => (
              <div className="chart-col" key={d.key}>
                <div className="bars">
                  <div
                    title={`${d.key}: ${currency(d.income)}`}
                    style={{ height: `${(d.income / max) * 100}%` }}
                  />
                  <div
                    title={`${d.key}: ${currency(d.expense)}`}
                    style={{ height: `${(d.expense / max) * 100}%` }}
                  />
                </div>
                <small>{d.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="legend">
          <span>
            <i />
            Pemasukan
          </span>
          <span>
            <i />
            Pengeluaran
          </span>
        </div>
      </section>
      <section className="panel">
        <h3>Pengeluaran per kategori</h3>
        <div
          className="donut"
          style={{
            background: total ? `conic-gradient(${gradient})` : "#27272a",
          }}
        >
          <div>{currency(total)}</div>
        </div>
        {donut.map((c) => (
          <div className="category-row" key={c.id}>
            <span style={{ color: String(c.color || "inherit") }}>
              {String(c.name)}
            </span>
            <span>{currency(c.total)}</span>
          </div>
        ))}
        {!total && (
          <p className="empty">Belum ada pengeluaran pada filter ini</p>
        )}
      </section>
    </div>
  );
  const deadlines = (
    <section className="panel">
      <h3>Tenggat proyek</h3>
      {data.projects
        .filter((p) => Number(p.progress) < 100)
        .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
        .slice(0, 3)
        .map((p) => (
          <div className="category-row" key={p.id}>
            <b>{String(p.title)}</b>
            <span>
              {String(p.deadline)} · {String(p.progress)}%
            </span>
          </div>
        ))}
    </section>
  );
  const journal = (
    <section className="panel">
      <div className="section-head">
        <h3>Transaksi · {rows.length}</h3>
        <div className="toolbar">
          <button disabled={busy} onClick={() => void exportRows(false)}>
            CSV
          </button>
          <button disabled={busy} onClick={() => void exportRows(true)}>
            Excel
          </button>
        </div>
      </div>
      <div className="toolbar">
        <input
          aria-label="Cari transaksi dan kategori"
          placeholder="Cari transaksi / kategori"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Jenis transaksi"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Semua jenis</option>
          <option value="income">Pemasukan</option>
          <option value="expense">Pengeluaran</option>
        </select>
        <select
          aria-label="Filter akun"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        >
          <option value="">Semua akun</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {String(a.name)}
            </option>
          ))}
        </select>
        <label>
          Dari
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Sampai
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>TRANSAKSI</th>
              <th>KATEGORI</th>
              <th>AKUN</th>
              <th>TANGGAL</th>
              <th>JUMLAH</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice((current - 1) * 15, current * 15).map((t) => (
              <tr key={t.id}>
                <td>{String(t.title)}</td>
                <td>
                  <CategoryMark category={cats.get(String(t.category_id))} />
                </td>
                <td>
                  {String(
                    data.accounts.find((a) => a.id === t.account_id)?.name ||
                      "",
                  )}
                </td>
                <td>{String(t.date)}</td>
                <td>
                  {cats.get(String(t.category_id))?.kind === "income"
                    ? "+"
                    : "−"}
                  {currency(Number(t.amount))}
                </td>
                <td>
                  <Actions
                    edit={() => editTransaction(t)}
                    remove={() => removeTransaction(t)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="empty">Tidak ada transaksi</p>}
      <div className="pagination">
        <button disabled={current <= 1} onClick={() => setPage((v) => v - 1)}>
          Sebelumnya
        </button>
        <span>
          {current} / {pages}
        </span>
        <button
          disabled={current >= pages}
          onClick={() => setPage((v) => v + 1)}
        >
          Berikutnya
        </button>
      </div>
    </section>
  );
  return (
    <>
      <div className="toolbar feature-tabs">
        {[
          ["journal", "Jurnal"],
          ["accounts", "Akun & transfer"],
          ["budgets", "Anggaran"],
          ["recurring_rules", "Transaksi berulang"],
          ["savings_goals", "Target tabungan"],
          ["import", "Impor CSV"],
        ].map(([key, label]) => (
          <button
            className={key === tab ? "selected" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {tab === "journal" &&
        widgets.map((w) => (
          <div className="widget" key={w} data-widget={w}>
            {{ summary, cashflow: cash, deadlines, journal }[w as "summary"]}
          </div>
        ))}
      {tab === "accounts" && (
        <>
          <div className="toolbar">
            <button
              className="primary"
              onClick={() => setForm({ table: "accounts" })}
            >
              Tambah akun
            </button>
            <button
              className="primary"
              onClick={() => setForm({ table: "transfers" })}
            >
              Transfer antar akun
            </button>
          </div>
          <div className="settings-grid">
            {data.accounts.map((a) => (
              <section className="panel" key={a.id}>
                <h3>
                  {String(a.name)} · {String(a.kind)}
                </h3>
                <h2>{currency(accountBalance(data, a.id))}</h2>
                <p className="muted">
                  Saldo awal {currency(Number(a.opening_balance))}
                </p>
                <Actions
                  edit={() => setForm({ table: "accounts", record: a })}
                  remove={() => void remove("accounts", a)}
                />
              </section>
            ))}
          </div>
          <section className="panel">
            <h3>Transfer · Tidak dihitung sebagai pemasukan/pengeluaran</h3>
            {data.transfers.map((t) => (
              <div className="category-row" key={t.id}>
                <span>
                  {String(t.date)} ·{" "}
                  {String(
                    data.accounts.find((a) => a.id === t.from_account)?.name,
                  )}{" "}
                  →{" "}
                  {String(
                    data.accounts.find((a) => a.id === t.to_account)?.name,
                  )}{" "}
                  · {currency(Number(t.amount))}
                </span>
                <Actions
                  edit={() => setForm({ table: "transfers", record: t })}
                  remove={() => void remove("transfers", t)}
                />
              </div>
            ))}
          </section>
        </>
      )}
      {["budgets", "recurring_rules", "savings_goals"].includes(tab) && (
        <>
          <button className="primary" onClick={() => setForm({ table: tab })}>
            Tambah
          </button>
          {tab === "recurring_rules" && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await command("recurring");
                  await refresh();
                  alert(`${r.result} transaksi jatuh tempo dicatat`);
                })
              }
            >
              Catat semua yang jatuh tempo
            </button>
          )}
          <div className="settings-grid finance-cards">
            {data[tab].map((r) => {
              const spent =
                  tab === "budgets"
                    ? monthExpense(data, String(r.category_id), String(r.month))
                    : Number(r.saved || 0),
                target = Number(r.target || r.amount),
                percent = Math.min(100, (spent / target) * 100);
              return (
                <section key={r.id} className="panel">
                  <h3>
                    {String(r.title || cats.get(String(r.category_id))?.name)}
                  </h3>
                  {tab === "recurring_rules" ? (
                    <>
                      <p>
                        {currency(Number(r.amount))} · {String(r.frequency)}
                      </p>
                      <p
                        className={
                          String(r.next_due) <= dateToday() && r.active
                            ? "warning"
                            : ""
                        }
                      >
                        {String(r.next_due)} · {r.active ? "Aktif" : "Nonaktif"}
                      </p>
                    </>
                  ) : (
                    <>
                      <h2>{currency(spent)}</h2>
                      <p>
                        {currency(target)} · {String(r.month || r.deadline)}
                      </p>
                      <progress
                        className={
                          spent > target
                            ? "danger"
                            : percent >= 80
                              ? "warning"
                              : ""
                        }
                        max={100}
                        value={percent}
                      />
                      {tab === "budgets" && spent >= target * 0.8 && (
                        <p className={spent > target ? "danger" : "warning"}>
                          {spent > target
                            ? "Melebihi anggaran"
                            : "Mendekati batas anggaran"}
                        </p>
                      )}
                    </>
                  )}
                  <Actions
                    edit={() => setForm({ table: tab, record: r })}
                    remove={() => void remove(tab, r)}
                  />
                </section>
              );
            })}
          </div>
        </>
      )}
      {tab === "import" && <BankImport data={data} refresh={refresh} />}
      {form && (
        <RecordForm
          data={data}
          table={form.table}
          record={form.record}
          refresh={refresh}
          close={() => setForm(null)}
        />
      )}
    </>
  );
}
function BankImport({
  data,
  refresh,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
}) {
  const [raw, setRaw] = useState<Record<string, string>[]>([]),
    [mapping, setMapping] = useState({ title: "", amount: "", date: "" }),
    [category, setCategory] = useState(""),
    [account, setAccount] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const cols = Object.keys(raw[0] || {});
  const known = new Set(data.transactions.map(duplicateKey));
  const preview = raw.map((r, i) => {
    const title = (r[mapping.title] || "").trim(),
      date = r[mapping.date] || "",
      amount = Number(r[mapping.amount]);
    const item = {
      title,
      date,
      amount,
      category_id: category,
      account_id: account,
    };
    const key = duplicateKey(item);
    const duplicate = known.has(key);
    known.add(key);
    return {
      ...item,
      index: i,
      duplicate,
      valid:
        !!title &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !Number.isNaN(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date &&
        !!category &&
        !!account &&
        Number.isFinite(amount) &&
        amount > 0,
    };
  });
  return (
    <section className="panel">
      <h3>Impor mutasi CSV</h3>
      <p className="muted">
        Tanggal YYYY-MM-DD, nominal positif tanpa pemisah ribuan. Pilih kategori
        yang menentukan masuk/keluar. Maksimal 2.000 baris.
      </p>
      <label>
        File CSV
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setError("");
            setMessage("");
            if (f.size > 5 * 1024 * 1024) {
              setError("CSV maksimal 5 MB");
              return;
            }
            Papa.parse<Record<string, string>>(f, {
              header: true,
              skipEmptyLines: true,
              complete: (r) => {
                if (r.errors.length) {
                  setError(r.errors[0].message);
                  return;
                }
                if (r.data.length > 2000) {
                  setError("Maksimal 2.000 baris");
                  return;
                }
                setRaw(r.data);
                setMapping({ title: "", date: "", amount: "" });
              },
              error: (e) => setError(e.message),
            });
          }}
        />
      </label>
      <div className="control-grid">
        {(["title", "amount", "date"] as const).map((k) => (
          <label key={k}>
            Kolom{" "}
            {{ title: "deskripsi", amount: "nominal", date: "tanggal" }[k]}
            <select
              aria-label={`Kolom ${k}`}
              value={mapping[k]}
              onChange={(e) =>
                setMapping((m) => ({ ...m, [k]: e.target.value }))
              }
            >
              <option value="">Pilih kolom</option>
              {cols.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ))}
        <label>
          Akun
          <select
            aria-label="Akun impor"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">Pilih akun</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {String(a.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kategori
          <select
            aria-label="Kategori impor"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Pilih kategori</option>
            {data.categories
              .filter((c) => ["income", "expense"].includes(String(c.kind)))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {String(c.name)} · {String(c.kind)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Deskripsi</th>
              <th>Jumlah</th>
              <th>Validasi</th>
            </tr>
          </thead>
          <tbody>
            {preview.slice(0, 100).map((r) => (
              <tr key={r.index}>
                <td>{r.date}</td>
                <td>{r.title}</td>
                <td>{currency(r.amount || 0)}</td>
                <td>
                  {!r.valid
                    ? "Data belum valid"
                    : r.duplicate
                      ? "Duplikat · dilewati"
                      : "Siap impor"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {preview.length} baris · Pratinjau maksimal 100 ·{" "}
        {preview.filter((r) => r.valid && !r.duplicate).length} baru
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        className="primary"
        disabled={
          busy ||
          !preview.length ||
          preview.some((r) => !r.valid) ||
          preview.every((r) => r.duplicate)
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await command("import", {
              rows: preview
                .filter((r) => !r.duplicate)
                .map(({ title, amount, date, category_id, account_id }) => ({
                  title,
                  amount,
                  date,
                  category_id,
                  account_id,
                })),
            });
            await refresh();
            setMessage(
              `${r.result.inserted} dimasukkan, ${r.result.skipped} duplikat dilewati`,
            );
            setRaw([]);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Konfirmasi impor
      </button>
    </section>
  );
}
