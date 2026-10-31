"use client";
import {
  DateField,
  CurrencyField,
  FileDrop,
  formatDate,
} from "@/components/ui/fields";
import { EmptyState } from "@/components/ui/empty-state";
import { pendingUploadKey } from "@/lib/vault-upload";
import { uploadFile } from "@/lib/uploads";
import { CategoryMark } from "@/components/features/category-mark";
import dynamic from "next/dynamic";
import Finance from "@/components/features/finance";
import Projects from "@/components/features/projects";
import Documents from "@/components/features/documents";
import VaultUpload from "@/components/features/vault-upload";
import Accounts from "@/components/features/accounts";
import ExtraSettings from "@/components/features/settings";
import Platform, { defaultWidgets } from "@/components/features/platform";
import { tables, type Dataset, type Row } from "@/lib/model";
import {
  PersonalizeProvider,
  usePersonalization,
} from "@/components/personalize/provider";
import { Artwork } from "@/components/personalize/artwork";
const PersonalizeEditor = dynamic(
  () => import("@/components/personalize/editor"),
  { ssr: false },
);
import { Palette } from "lucide-react";
import { loginReport, networkLoginReport } from "@/lib/login-client";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  LayoutDashboard,
  Layers,
  FolderLock,
  Settings,
  Plus,
  Search,
  ArrowRight,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Pencil,
  X,
  Orbit,
  CalendarDays,
  List,
  Wallet,
  TrendingUp,
} from "lucide-react";
type Category = { id: string; name: string; kind: string };
type Transaction = {
  id: string;
  title: string;
  amount: number;
  category_id: string;
  date: string;
};
type Project = {
  id: string;
  title: string;
  status_id: string;
  progress: number;
  deadline: string;
  is_mwb: boolean;
};
type Doc = {
  id: string;
  title: string;
  category_id: string;
  size: number;
  created_at: string;
};
type Data = {
  categories: Category[];
  transactions: Transaction[];
  projects: Project[];
  documents: Doc[];
};
const empty: Data = {
  ...Object.fromEntries(tables.map((t) => [t, []])),
  categories: [],
  transactions: [],
  projects: [],
  documents: [],
};
const money = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const navigation = [
  { name: "Jurnal Keuangan", icon: LayoutDashboard },
  { name: "Project & MWBs", icon: Layers },
  { name: "Arsip Dokumen", icon: FolderLock },
  { name: "Settings", icon: Settings },
  { name: "Personalize", icon: Palette },
];
export default function Workspace({ initialAuth }: { initialAuth: boolean }) {
  const [authenticated, setAuthenticated] = useState(initialAuth);
  return (
    <PersonalizeProvider authenticated={authenticated}>
      <WorkspaceContent initialAuth={initialAuth} onAuth={setAuthenticated} />
    </PersonalizeProvider>
  );
}
function WorkspaceContent({
  initialAuth,
  onAuth,
}: {
  initialAuth: boolean;
  onAuth: (v: boolean) => void;
}) {
  const { theme } = usePersonalization();
  const [copied, setCopied] = useState(false);
  const [auth, setAuth] = useState(initialAuth),
    [page, setPage] = useState(0),
    [data, setData] = useState<Data>(empty),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [modal, setModal] = useState<{
      table: string;
      record?: Record<string, unknown>;
    } | null>(null);
  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/data");
      if (r.status === 401) {
        setAuth(false);
        setError(
          "ORBIT — Laporan error login\nEndpoint: GET /api/data\nHTTP: 401\nKode: LOGIN_SESSION_NOT_ACCEPTED\nPesan: Session login tidak diterima atau sudah kedaluwarsa.\nSaran: Login ulang. Jika berulang, pastikan cookie diizinkan, akses melalui HTTPS, dan SESSION_SECRET konsisten pada deployment.",
        );
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData({ ...empty, ...d });
      setError("");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    onAuth(auth);
    if (auth) void load();
  }, [auth]);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const effect = document.querySelector(".content")?.animate(
      [
        { opacity: 0.35, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(.2,.6,.25,1)" },
    );
    return () => effect?.cancel();
  }, [page]);
  const extended = data as unknown as Dataset;
  useEffect(() => {
    if (new URLSearchParams(location.search).get("settings") === "storage")
      setPage(3);
  }, []);
  const [widgets, setWidgets] = useState(defaultWidgets);
  useEffect(() => {
    const w = extended.app_settings?.find((s) => s.key === "widgets")?.value;
    if (Array.isArray(w)) setWidgets(w);
  }, [data]);
  async function mutate(
    table: string,
    action: string,
    id?: string,
    payload?: unknown,
  ) {
    const r = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table, action, id, data: payload }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Operasi gagal");
  }
  async function remove(table: string, id: string) {
    if (!confirm("Hapus item ini?")) return;
    setBusy(true);
    try {
      await mutate(table, "delete", id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!modal) return;
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      if (modal.table === "documents") {
        const file = f.get("file");
        if (!(file instanceof File)) throw new Error("Pilih file");
        await uploadFile("/api/files", file, {
          category_id: String(f.get("category_id")),
        });
      } else {
        const payload = Object.fromEntries(f);
        if (modal.table === "projects")
          Object.assign(payload, { is_mwb: f.get("is_mwb") === "on" });
        await mutate(
          modal.table,
          modal.record?.id ? "update" : "create",
          modal.record?.id as string,
          payload,
        );
      }
      setModal(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!auth)
    return (
      <main className="login-shell">
        <Artwork config={theme.login} login />
        <form
          className="panel login"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setCopied(false);
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(f)),
              });
              const report = await loginReport(r);
              if (report) {
                setError(report);
                return;
              }
              localStorage.removeItem(pendingUploadKey);
              setData(empty);
              setPage(0);
              setAuth(true);
            } catch {
              setError(networkLoginReport());
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="brand">
            <Orbit size={30} />
            <span>
              orbit<span className="muted"> / OS</span>
            </span>
          </div>
          <h1>Login</h1>
          <label>
            Username
            <input
              name="username"
              required
              autoComplete="username"
              placeholder="admin"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </label>
          {error && (
            <div role="alert" className="error login-error">
              <strong>Login belum berhasil</strong>
              <p>Salin laporan berikut dan kirimkan untuk diagnosis.</p>
              <textarea
                aria-label="Laporan error login"
                readOnly
                value={error}
                rows={10}
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(error);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                    const area = document.querySelector<HTMLTextAreaElement>(
                      ".login-error textarea",
                    );
                    area?.focus();
                    area?.select();
                  }
                }}
              >
                {copied ? "Laporan tersalin" : "Salin laporan error"}
              </button>
              <small>Password dan secret tidak disertakan.</small>
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Menghubungkan…" : "Masuk ke workspace"}
            <ArrowRight size={17} />
          </button>
        </form>
      </main>
    );
  const edit = (table: string, record?: object) => {
    setError("");
    setModal({ table, record: record as Record<string, unknown> });
  };
  const actions = (table: string, r: { id: string }) => (
    <div className="row-actions">
      <button
        className="icon-button"
        title="Edit"
        aria-label="Edit"
        onClick={() => edit(table, r)}
      >
        <Pencil size={17} strokeWidth={1.3} />
      </button>
      <button
        disabled={busy}
        aria-label="Hapus"
        className="icon-button"
        onClick={() => remove(table, r.id)}
      >
        <Trash2 size={17} strokeWidth={1.3} />
      </button>
    </div>
  );
  const add = () =>
    edit(
      page === 0
        ? "transactions"
        : page === 1
          ? "projects"
          : page === 2
            ? "documents"
            : "categories",
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Artwork config={theme.sidebar} />
        <a className="brand" href="/">
          <Orbit size={29} />
          <span>
            orbit<span className="muted"> / OS</span>
          </span>
        </a>
        <nav aria-label="Modul">
          {navigation.map((n, i) => (
            <button
              key={n.name}
              aria-label={n.name}
              aria-current={page === i ? "page" : undefined}
              title={n.name}
              className={page === i ? "active" : ""}
              onClick={() => {
                setPage(i);
                setSearch("");
                setFilter("");
              }}
            >
              <n.icon size={18} />
              {n.name}
              {i === 1 && <small>{data.projects.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="profile"
            aria-label="Keluar workspace"
            title="Keluar workspace"
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              localStorage.removeItem(pendingUploadKey);
              location.reload();
            }}
          >
            <span className="avatar">
              {theme.avatar.images.length ? (
                <Artwork config={theme.avatar} />
              ) : (
                "A"
              )}
            </span>
            <span>
              Akun<small>Keluar workspace</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            Workspace <span>/</span> <b>{navigation[page].name}</b>
          </div>
          <span className="top-date">
            {new Date().toLocaleDateString("id-ID", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Asia/Jakarta",
            })}
          </span>
        </header>
        <div className="content">
          <Platform
            data={extended}
            refresh={load}
            navigate={(n) => setPage(n)}
            widgets={widgets}
            setWidgets={setWidgets}
          />
          <div className="page-heading">
            <div>
              <h1>{navigation[page].name}</h1>
            </div>
            {page !== 4 && page !== 5 && page !== 1 && page !== 2 && (
              <button className="primary" onClick={add}>
                <Plus size={17} />
                {
                  [
                    "Transaksi baru",
                    "Proyek baru",
                    "Upload dokumen",
                    "Kategori baru",
                  ][page]
                }
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={() => void load()}>Coba lagi</button>
            </div>
          )}
          {loading && (
            <p className="muted" role="status">
              Memuat workspace…
            </p>
          )}
          {page === 4 && <PersonalizeEditor />}
          {page < 3 &&
            theme[(["journal", "projects", "documents"] as const)[page]].images
              .length > 0 && (
              <div className="module-banner">
                <Artwork
                  config={
                    theme[(["journal", "projects", "documents"] as const)[page]]
                  }
                />
              </div>
            )}
          {page === 0 && (
            <>
              {theme.dashboard.images.length > 0 && (
                <div className="module-banner">
                  <Artwork config={theme.dashboard} />
                </div>
              )}
              <Finance
                data={extended}
                refresh={load}
                widgets={widgets}
                editTransaction={(r) => edit("transactions", r)}
                removeTransaction={(r) => void remove("transactions", r.id)}
              />
            </>
          )}
          {page === 1 && <Projects data={extended} refresh={load} />}
          {page === 2 && (
            <Documents
              data={extended}
              refresh={load}
              upload={() => edit("documents")}
            />
          )}
          {page === 3 && (
            <>
              <Accounts />
              <ExtraSettings data={extended} refresh={load} />
              <div className="settings-grid">
                {[
                  ["income", "Kategori pemasukan"],
                  ["expense", "Kategori pengeluaran"],
                  ["status", "Status proyek"],
                  ["document", "Kategori dokumen"],
                ].map(([kind, title]) => (
                  <section className="panel" key={kind}>
                    <div className="section-head">
                      <h3>{title}</h3>
                      <button
                        aria-label={"Tambah " + title}
                        onClick={() => edit("categories", { kind })}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                    {!data.categories.some((c) => c.kind === kind) && (
                      <EmptyState message="Belum ada kategori di bagian ini." />
                    )}
                    {data.categories
                      .filter((c) => c.kind === kind)
                      .map((c) => (
                        <div className="category-row" key={c.id}>
                          <CategoryMark category={c as unknown as Row} />
                          {actions("categories", c)}
                        </div>
                      ))}
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
      {modal?.table === "documents" && (
        <VaultUpload
          data={extended}
          refresh={load}
          close={() => setModal(null)}
        />
      )}
      {modal && modal.table !== "documents" && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="panel modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-head">
              <h3 id="modal-title">
                {modal.record?.id ? "Edit" : "Tambah"}{" "}
                {modal.table === "transactions"
                  ? "transaksi"
                  : modal.table === "projects"
                    ? "proyek"
                    : modal.table === "documents"
                      ? "dokumen"
                      : "kategori"}
              </h3>
              <button
                aria-label="Tutup"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={save} key={String(modal.record?.id || "new")}>
              {modal.table === "categories" ? (
                <>
                  <label>
                    Nama kategori
                    <input
                      name="name"
                      required
                      maxLength={80}
                      defaultValue={String(modal.record?.name || "")}
                    />
                  </label>
                  <label>
                    Jenis
                    <select
                      name="kind"
                      defaultValue={String(modal.record?.kind || "income")}
                    >
                      <option value="income">Pemasukan</option>
                      <option value="expense">Pengeluaran</option>
                      <option value="status">Status proyek</option>
                      <option value="document">Dokumen</option>
                    </select>
                  </label>
                  <label>
                    Warna
                    <input
                      type="color"
                      name="color"
                      defaultValue={String(modal.record?.color || "#a1a1aa")}
                    />
                  </label>
                  <label>
                    Ikon
                    <select
                      name="icon"
                      defaultValue={String(modal.record?.icon || "Tag")}
                    >
                      {[
                        "Tag",
                        "Wallet",
                        "Briefcase",
                        "Book",
                        "Car",
                        "Coffee",
                        "Home",
                        "Star",
                        "Heart",
                        "ShoppingBag",
                      ].map((i) => (
                        <option key={i}>{i}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  {modal.table !== "documents" && (
                    <label>
                      {modal.table === "projects"
                        ? "Nama proyek"
                        : "Deskripsi transaksi"}
                      <input
                        name="title"
                        required
                        maxLength={200}
                        defaultValue={String(modal.record?.title || "")}
                      />
                    </label>
                  )}
                  <label>
                    {modal.table === "projects" ? "Status" : "Kategori"}
                    <select
                      name={
                        modal.table === "projects" ? "status_id" : "category_id"
                      }
                      required
                      defaultValue={String(
                        modal.record?.category_id ||
                          modal.record?.status_id ||
                          "",
                      )}
                    >
                      <option value="" disabled>
                        Pilih kategori
                      </option>
                      {data.categories
                        .filter((c) =>
                          modal.table === "projects"
                            ? c.kind === "status"
                            : modal.table === "documents"
                              ? c.kind === "document"
                              : ["income", "expense"].includes(c.kind),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {modal.table === "transactions"
                              ? ` · ${c.kind === "income" ? "Masuk" : "Keluar"}`
                              : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  {modal.table === "transactions" && (
                    <>
                      <label>
                        Akun
                        <select
                          name="account_id"
                          required
                          defaultValue={String(
                            modal.record?.account_id ||
                              extended.accounts[0]?.id ||
                              "",
                          )}
                        >
                          <option value="" disabled>
                            Pilih akun
                          </option>
                          {extended.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {String(a.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Jumlah (Rp)
                        <CurrencyField
                          aria-label="Jumlah (Rp)"
                          name="amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          max="99999999999999"
                          required
                          defaultValue={String(modal.record?.amount || "")}
                        />
                      </label>
                      <label>
                        Tanggal
                        <DateField
                          name="date"
                          type="date"
                          required
                          defaultValue={String(modal.record?.date || today())}
                        />
                      </label>
                    </>
                  )}
                  {modal.table === "projects" && (
                    <>
                      <label>
                        Progres (%)
                        <input
                          name="progress"
                          type="number"
                          min="0"
                          max="100"
                          required
                          defaultValue={String(modal.record?.progress || 0)}
                        />
                      </label>
                      <label>
                        Tenggat waktu
                        <DateField
                          name="deadline"
                          type="date"
                          required
                          defaultValue={String(
                            modal.record?.deadline || today(),
                          )}
                        />
                      </label>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          name="is_mwb"
                          defaultChecked={!!modal.record?.is_mwb}
                        />{" "}
                        Major Work Block (MWB)
                      </label>
                    </>
                  )}
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Menyimpan…" : "Simpan"}
                <ArrowRight size={16} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <EmptyState message={text} />;
}
