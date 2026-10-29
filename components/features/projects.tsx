"use client";
import { DateField } from "@/components/ui/fields";
import { filterWorkItems, stackWorkItems, workItems } from "@/lib/projects";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/components/ui/fields";
import { useEffect, useState } from "react";
import {
  command,
  dateToday,
  writeData,
  type Dataset,
  type Row,
} from "@/lib/model";
import { Actions, RecordForm } from "./forms";
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export default function Projects({
  data,
  refresh,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
}) {
  const [view, setView] = useState("table"),
    [anchor, setAnchor] = useState(new Date()),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("deadline"),
    [form, setForm] = useState<{
      table: string;
      record?: Row;
      defaults?: Record<string, unknown>;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await f();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function remove(table: string, r: Row) {
    if (confirm("Hapus data?"))
      void run(async () => {
        await writeData(table, "delete", undefined, r.id);
      });
  }
  const items = filterWorkItems(workItems(data), q, status);
  const rows = stackWorkItems(items, sort);
  const days: Date[] = [];
  if (view === "week") {
    const monday = new Date(anchor);
    monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
  } else {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    const len =
      Math.ceil(
        (((new Date(anchor.getFullYear(), anchor.getMonth(), 1).getDay() + 6) %
          7) +
          new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()) /
          7,
      ) * 7;
    for (let i = 0; i < len; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
  }
  return (
    <>
      <section className="panel">
        <div className="section-head">
          <h3>Proyek & MWB · {rows.length}</h3>
          <div className="segmented">
            {[
              ["table", "Tabel"],
              ["month", "Bulanan"],
              ["week", "Mingguan"],
            ].map(([k, n]) => (
              <button
                key={k}
                className={view === k ? "selected" : ""}
                onClick={() => setView(k)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar">
          <input
            placeholder="Cari proyek / MWB / subtask"
            aria-label="Cari proyek"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label="Filter status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua status</option>
            {data.categories
              .filter((c) => c.kind === "status")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {String(c.name)}
                </option>
              ))}
          </select>
          <select
            aria-label="Urutkan proyek"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="deadline">Tenggat terdekat</option>
            <option value="title">Nama</option>
            <option value="progress">Progres tertinggi</option>
          </select>
          <button
            className="primary"
            onClick={() => setForm({ table: "projects" })}
          >
            Tambah proyek
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {view === "table" ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proyek / MWB / Subtask</th>
                  <th>Status</th>
                  <th>Progres</th>
                  <th>Tenggat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.key}
                    data-work-key={item.key}
                    className={`work-row work-${item.table}`}
                  >
                    <td data-label="Nama">
                      <div
                        className="work-title"
                        style={{ paddingInlineStart: item.depth * 16 }}
                      >
                        <span className="tag">
                          {item.table === "projects"
                            ? "Proyek"
                            : item.table === "mwbs"
                              ? "MWB"
                              : "Subtask"}
                        </span>
                        <div>
                          <b>{String(item.record.title)}</b>
                          {item.context && (
                            <small className="muted work-context">
                              {item.context}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-label="Status">{item.status}</td>
                    <td data-label="Progres">
                      <progress max={100} value={item.progress} />{" "}
                      {item.progress}%
                    </td>
                    <td
                      data-label="Tenggat"
                      className={
                        item.deadline &&
                        item.deadline < dateToday() &&
                        item.progress < 100
                          ? "warning"
                          : ""
                      }
                    >
                      {item.deadline
                        ? formatDate(item.deadline)
                        : "Belum dijadwalkan"}
                    </td>
                    <td data-label="Aksi">
                      <Actions
                        edit={() =>
                          setForm({ table: item.table, record: item.record })
                        }
                        remove={() => remove(item.table, item.record)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <EmptyState message="Belum ada proyek, MWB, atau subtask yang sesuai." />
            )}
          </div>
        ) : (
          <>
            <div className="calendar-heading">
              <button
                aria-label="Periode sebelumnya"
                onClick={() =>
                  setAnchor((a) =>
                    view === "week"
                      ? new Date(a.getFullYear(), a.getMonth(), a.getDate() - 7)
                      : new Date(a.getFullYear(), a.getMonth() - 1, 1),
                  )
                }
              >
                ←
              </button>
              <h3>
                {anchor.toLocaleDateString("id-ID", {
                  month: "long",
                  year: "numeric",
                })}
                {view === "week" ? ` · ${iso(days[0])} — ${iso(days[6])}` : ""}
              </h3>
              <button
                aria-label="Periode berikutnya"
                onClick={() =>
                  setAnchor((a) =>
                    view === "week"
                      ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7)
                      : new Date(a.getFullYear(), a.getMonth() + 1, 1),
                  )
                }
              >
                →
              </button>
            </div>
            <p className="muted">
              Seret jadwal ke tanggal lain, atau klik untuk mengedit.
            </p>
            <div className="calendar-scroll">
              <div className="calendar">
                {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => (
                  <div className="day-label" key={d}>
                    {d}
                  </div>
                ))}
                {days.map((d) => (
                  <div
                    className={"day " + (iso(d) === dateToday() ? "today" : "")}
                    key={iso(d)}
                    data-date={iso(d)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const key = e.dataTransfer.getData("text/plain");
                      const item = items.find(
                        (item) =>
                          item.key === key ||
                          (item.table === "projects" && item.record.id === key),
                      );
                      if (item)
                        void run(async () => {
                          await writeData(
                            item.table,
                            "update",
                            { ...item.record, deadline: iso(d) },
                            item.record.id,
                          );
                        });
                    }}
                  >
                    <span>{d.getDate()}</span>
                    {items
                      .filter((item) => item.deadline === iso(d))
                      .sort((a, b) => a.key.localeCompare(b.key))
                      .map((item) => (
                        <button
                          key={item.key}
                          data-work-key={item.key}
                          className={`calendar-work ${item.progress === 100 ? "work-done" : ""}`}
                          title={[item.record.title, item.context, item.status]
                            .filter(Boolean)
                            .join(" · ")}
                          draggable={!busy}
                          onDragStart={(e) =>
                            e.dataTransfer.setData("text/plain", item.key)
                          }
                          onClick={() =>
                            setForm({ table: item.table, record: item.record })
                          }
                        >
                          <small>
                            {item.table === "projects"
                              ? "Proyek"
                              : item.table === "mwbs"
                                ? "MWB"
                                : "Subtask"}
                          </small>
                          <span>{String(item.record.title)}</span>
                          {item.table === "subtasks" && (
                            <small>{item.context}</small>
                          )}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
      <section className="panel">
        <div className="section-head">
          <h3>Major Work Blocks</h3>
          <button onClick={() => setForm({ table: "mwbs" })}>Tambah MWB</button>
        </div>
        <div className="settings-grid">
          {data.mwbs.map((m) => {
            const sessions = data.focus_sessions.filter(
                (s) => s.mwb_id === m.id,
              ),
              running = sessions.find((s) => !s.ended_at);
            const seconds = sessions.reduce(
              (n, s) =>
                n +
                (s.ended_at
                  ? Number(s.seconds)
                  : Math.max(
                      0,
                      Math.floor(
                        (now - new Date(String(s.started_at)).getTime()) / 1000,
                      ),
                    )),
              0,
            );
            const tasks = data.subtasks.filter((t) => t.mwb_id === m.id);
            return (
              <div className="panel" key={m.id}>
                <h3>{String(m.title)}</h3>
                <p className="muted">
                  {String(
                    data.projects.find((p) => p.id === m.project_id)?.title ||
                      "Mandiri",
                  )}{" "}
                  · {formatDate(m.deadline)}
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!m.done}
                    onChange={(e) =>
                      void run(async () => {
                        await writeData(
                          "mwbs",
                          "update",
                          { ...m, done: e.target.checked },
                          m.id,
                        );
                      })
                    }
                  />
                  Selesai
                </label>
                <div className="focus-timer">
                  <b>
                    {String(Math.floor(seconds / 3600)).padStart(2, "0")}:
                    {String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:
                    {String(seconds % 60).padStart(2, "0")}
                  </b>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (running)
                          await command("stop_focus", { id: running.id });
                        else
                          await writeData("focus_sessions", "create", {
                            mwb_id: m.id,
                          });
                      })
                    }
                  >
                    {running ? "Hentikan sesi" : "Mulai fokus"}
                  </button>
                </div>
                <p className="muted">
                  {sessions.length} sesi · {tasks.filter((t) => t.done).length}/
                  {tasks.length} subtask
                </p>
                {!tasks.length && (
                  <EmptyState message="Belum ada langkah kecil di sini." />
                )}
                {tasks.map((t) => (
                  <div className="category-row mwb-subtask" key={t.id}>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={!!t.done}
                        onChange={(e) =>
                          void run(async () => {
                            await writeData(
                              "subtasks",
                              "update",
                              { ...t, done: e.target.checked },
                              t.id,
                            );
                          })
                        }
                      />
                      {String(t.title)}
                    </label>
                    <div className="subtask-schedule">
                      <DateField
                        aria-label={`Tanggal subtask ${String(t.title)}`}
                        value={t.deadline ? String(t.deadline) : ""}
                        disabled={busy}
                        onChange={(e) => {
                          const deadline = e.target.value || null;
                          void run(async () => {
                            await writeData(
                              "subtasks",
                              "update",
                              { ...t, deadline },
                              t.id,
                            );
                          });
                        }}
                      />
                      <Actions
                        edit={() => setForm({ table: "subtasks", record: t })}
                        remove={() => remove("subtasks", t)}
                      />
                    </div>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setForm({ table: "subtasks", defaults: { mwb_id: m.id } })
                  }
                >
                  Tambah subtask
                </button>
                <Actions
                  edit={() => setForm({ table: "mwbs", record: m })}
                  remove={() => remove("mwbs", m)}
                />
              </div>
            );
          })}
        </div>
        {!data.mwbs.length && <EmptyState message="Belum ada MWB" />}
      </section>
      {form && (
        <RecordForm
          table={form.table}
          data={data}
          record={form.record}
          defaults={form.defaults}
          refresh={refresh}
          close={() => setForm(null)}
        />
      )}
    </>
  );
}
