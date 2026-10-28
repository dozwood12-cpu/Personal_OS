"use client";
import { useEffect, useState } from "react";
import { command, dateToday, type Dataset } from "@/lib/model";
import { Dialog } from "./forms";
export const defaultWidgets = ["summary", "cashflow", "deadlines", "journal"];
export default function Platform({
  data,
  refresh,
  navigate,
  widgets,
  setWidgets,
}: {
  data: Dataset;
  refresh: () => Promise<void>;
  navigate: (n: number) => void;
  widgets: string[];
  setWidgets: (w: string[]) => void;
}) {
  const [search, setSearch] = useState(false),
    [q, setQ] = useState(""),
    [customize, setCustomize] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState("dark"),
    [notify, setNotify] = useState(false),
    [drag, setDrag] = useState("");
  useEffect(() => {
    const stored = localStorage.getItem("orbit-mode");
    const v =
      data.app_settings.find((s) => s.key === "mode")?.value ||
      stored ||
      "dark";
    setMode(String(v));
    document.documentElement.dataset.mode = String(v);
    setNotify(
      data.app_settings.find((s) => s.key === "notifications")?.value === true,
    );
  }, [data.app_settings]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if (e.key === "Escape") {
        setSearch(false);
        setCustomize(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (
      !notify ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    const run = () => {
      const today = dateToday();
      const tomorrow = new Date(today + "T12:00:00Z");
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const limit = tomorrow.toISOString().slice(0, 10);
      const due = [
        ...data.projects
          .filter(
            (p) => Number(p.progress) < 100 && String(p.deadline) <= limit,
          )
          .map((p) => ({
            id: "project-" + p.id,
            title: String(p.title),
            date: String(p.deadline),
          })),
        ...data.recurring_rules
          .filter((r) => r.active && String(r.next_due) <= limit)
          .map((r) => ({
            id: "bill-" + r.id,
            title: String(r.title),
            date: String(r.next_due),
          })),
      ];
      for (const d of due) {
        const key = `orbit-notified-${today}-${d.id}-${d.date}`;
        if (!localStorage.getItem(key)) {
          try {
            new Notification("ORBIT · Tenggat / tagihan", {
              body: `${d.title} · ${d.date}`,
              tag: d.id,
            });
            localStorage.setItem(key, "1");
          } catch {
            /* unsupported browser */
          }
        }
      }
    };
    run();
    const t = setInterval(run, 60000);
    return () => clearInterval(t);
  }, [notify, data.projects, data.recurring_rules]);
  async function setSetting(key: string, value: unknown) {
    setError("");
    try {
      await command("setting", { key, value });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const results = [
    ...data.transactions.map((t) => ({ ...t, module: 0, type: "Transaksi" })),
    ...data.projects.map((t) => ({ ...t, module: 1, type: "Proyek" })),
    ...data.documents.map((t) => ({ ...t, module: 2, type: "Dokumen" })),
  ]
    .filter((r) => String(r.title).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);
  function moveWidget(w: string, direction: number) {
    const all = [...widgets];
    const i = all.indexOf(w),
      j = i + direction;
    if (j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    setWidgets(all);
    void setSetting("widgets", all);
  }
  return (
    <>
      <div className="platform-tools">
        <button aria-label="Pencarian global" onClick={() => setSearch(true)}>
          Cari <kbd>Ctrl K</kbd>
        </button>
        <button onClick={() => setCustomize(true)}>Widget</button>
        <button
          aria-label="Ganti mode warna"
          onClick={() => {
            const v = mode === "dark" ? "light" : "dark";
            setMode(v);
            document.documentElement.dataset.mode = v;
            localStorage.setItem("orbit-mode", v);
            void setSetting("mode", v);
          }}
        >
          {mode === "dark" ? "Terang" : "Gelap"}
        </button>
        <button
          onClick={async () => {
            setError("");
            if (!("Notification" in window)) {
              setError("Browser tidak mendukung notifikasi");
              return;
            }
            if (notify) {
              await setSetting("notifications", false);
              return;
            }
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
              await setSetting("notifications", true);
              setNotice("Pengingat aktif saat aplikasi dibuka.");
            } else setError("Izin notifikasi belum diberikan.");
          }}
        >
          {notify ? "Matikan pengingat" : "Aktifkan pengingat"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice} ✕
        </button>
      )}
      {search && (
        <Dialog title="Pencarian global" close={() => setSearch(false)}>
          <input
            autoFocus
            aria-label="Cari lintas workspace"
            placeholder="Transaksi, proyek, dokumen…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="global-results">
            {results.map((r) => (
              <button
                key={r.type + r.id}
                onClick={() => {
                  navigate(r.module);
                  setSearch(false);
                }}
              >
                <span>{String(r.title)}</span>
                <small>{r.type}</small>
              </button>
            ))}
            {!results.length && <p className="empty">Tidak ada hasil</p>}
          </div>
        </Dialog>
      )}
      {customize && (
        <Dialog title="Atur widget dashboard" close={() => setCustomize(false)}>
          {[
            ...widgets,
            ...defaultWidgets.filter((w) => !widgets.includes(w)),
          ].map((w) => (
            <div
              className="category-row"
              key={w}
              draggable={widgets.includes(w)}
              onDragStart={() => setDrag(w)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (
                  drag === w ||
                  !widgets.includes(w) ||
                  !widgets.includes(drag)
                )
                  return;
                const n = widgets.filter((v) => v !== drag);
                n.splice(n.indexOf(w), 0, drag);
                setWidgets(n);
                void setSetting("widgets", n);
              }}
            >
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={widgets.includes(w)}
                  onChange={(e) => {
                    const n = e.target.checked
                      ? [...widgets, w]
                      : widgets.filter((v) => v !== w);
                    setWidgets(n);
                    void setSetting("widgets", n);
                  }}
                />
                {
                  {
                    summary: "Ringkasan saldo",
                    cashflow: "Grafik arus kas",
                    deadlines: "Tenggat proyek",
                    journal: "Jurnal transaksi",
                  }[w]
                }
              </label>
              <button
                disabled={!widgets.includes(w)}
                aria-label={`Naik ${w}`}
                onClick={() => moveWidget(w, -1)}
              >
                ↑
              </button>
              <button
                disabled={!widgets.includes(w)}
                aria-label={`Turun ${w}`}
                onClick={() => moveWidget(w, 1)}
              >
                ↓
              </button>
            </div>
          ))}
        </Dialog>
      )}
    </>
  );
}
