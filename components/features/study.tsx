"use client";
import { useState, useEffect, useRef } from "react";
import { requestJson, type Dataset } from "@/lib/model";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { EmptyState } from "@/components/ui/empty-state";
const post = (b: unknown) =>
  requestJson("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
export default function Study({ data }: { data: Dataset }) {
  const [state, setState] = useState<any>({
      annotations: [],
      notes: [],
      cards: [],
      progress: [],
      reviews: [],
    }),
    [doc, setDoc] = useState(""),
    [pdf, setPdf] = useState<any>(null),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [tool, setTool] = useState("highlight"),
    [color, setColor] = useState("#b4b0a7"),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [summary, setSummary] = useState(""),
    [search, setSearch] = useState(""),
    [outline, setOutline] = useState<any[]>([]),
    [review, setReview] = useState(false),
    [answer, setAnswer] = useState(false),
    [filter, setFilter] = useState(""),
    [history, setHistory] = useState<any[]>([]),
    [redo, setRedo] = useState<any[]>([]);
  const [pdfQuery, setPdfQuery] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    surface = useRef<HTMLDivElement>(null),
    pdfRef = useRef<any>(null),
    readPages = useRef<number[]>([]),
    pageRef = useRef(1),
    zoomRef = useRef(1),
    draw = useRef<any>(null);
  const load = async () => {
    const s = await requestJson("/api/study");
    setState(s);
    return s;
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    const open = () => {
      const id = location.hash.match(/study=([^&]+)/)?.[1];
      if (id) setDoc(id);
    };
    open();
    window.addEventListener("orbit-study", open);
    return () => window.removeEventListener("orbit-study", open);
  }, []);
  useEffect(() => {
    pageRef.current = page;
    zoomRef.current = zoom;
  }, [page, zoom]);
  useEffect(() => {
    if (!doc) return;
    let dead = false;
    let task: any;
    setError("");
    setPdf(null);
    void (async () => {
      try {
        const s = await load();
        const p = s.progress.find((p: any) => p.document_id === doc);
        setPage(
          Number(location.hash.match(/page=(\d+)/)?.[1]) || p?.last_page || 1,
        );
        setZoom(p?.zoom || 1);
        readPages.current = p?.pages_read || [];
        setSummary(
          s.notes.find((n: any) => n.document_id === doc)?.summary || "",
        );
        const js = await import("pdfjs-dist");
        js.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        task = js.getDocument({
          url: "/api/files?id=" + doc + "&preview=1",
          rangeChunkSize: 65536,
          disableAutoFetch: true,
          disableStream: true,
        });
        const file = await task.promise;
        if (dead) {
          file.destroy();
          return;
        }
        pdfRef.current = file;
        setPdf(file);
        setOutline((await file.getOutline()) || []);
      } catch (e) {
        if (!dead)
          setError(
            "PDF tidak dapat dibuka. Periksa koneksi Drive, atau buka PDF tanpa password. " +
              (e as Error).message,
          );
      }
    })();
    return () => {
      dead = true;
      task?.destroy();
      pdfRef.current = null;
    };
  }, [doc]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let task: any,
      dead = false;
    void pdf
      .getPage(page)
      .then((p: any) => {
        if (dead) return;
        const v = p.getViewport({ scale: zoom });
        const c = canvas.current!;
        const ratio = Math.min(devicePixelRatio || 1, 2);
        c.width = v.width * ratio;
        c.height = v.height * ratio;
        c.style.width = v.width + "px";
        c.style.height = v.height + "px";
        task = p.render({
          canvasContext: c.getContext("2d"),
          viewport: v,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        return task.promise;
      })
      .catch(() => {});
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [pdf, page, zoom]);
  useEffect(() => {
    if (!pdf) return;
    const timer = setTimeout(() => {
      if (!readPages.current.includes(page)) readPages.current.push(page);
      setStatus("Menyimpan progres…");
      void post({
        kind: "progress",
        data: {
          document_id: doc,
          last_page: page,
          zoom,
          pages_read: [...readPages.current],
          total_pages: pdf.numPages,
        },
      })
        .then(() => setStatus("Tersimpan"))
        .catch((e) => setError(e.message));
    }, 3000);
    return () => clearTimeout(timer);
  }, [pdf, doc, page, zoom]);
  const annotations = state.annotations.filter(
      (a: any) => a.document_id === doc,
    ),
    cards = state.cards.filter((c: any) => !doc || c.document_id === doc),
    due = cards
      .filter((c: any) => new Date(c.due).getTime() <= Date.now())
      .slice(0, 20),
    card = due[0];
  async function change(b: any) {
    setError("");
    setStatus("Menyimpan…");
    try {
      await post(b);
      await load();
      setStatus("Tersimpan");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function add(a: any) {
    if (pdf && ["highlight", "underline", "strike"].includes(tool)) {
      const p = await pdf.getPage(page),
        v = p.getViewport({ scale: 1 }),
        content = await p.getTextContent();
      a.quote = content.items
        .filter((t: any) => {
          if (!t.transform) return false;
          const [x, y] = v.convertToViewportPoint(
            t.transform[4],
            t.transform[5],
          );
          const g = a.geometry;
          return (
            x / v.width < g.x + g.w &&
            (x + t.width) / v.width > g.x &&
            y / v.height > g.y &&
            (y - t.height) / v.height < g.y + g.h
          );
        })
        .map((t: any) => t.str)
        .join(" ");
    }
    await change({
      kind: "annotations",
      id: null,
      data: {
        document_id: doc,
        page,
        type: tool,
        color,
        quote: "",
        comment: "",
        tags: [],
        ...a,
      },
    });
    setHistory((h) => [...h, a]);
    setRedo([]);
  }
  async function flash(a: any) {
    const front = prompt(
      "Pertanyaan atau teks cloze {{...}}",
      a.quote || a.comment || "",
    );
    if (!front) return;
    const back = prompt("Jawaban", "");
    if (back === null) return;
    await change({
      kind: "cards",
      data: {
        document_id: doc,
        page: a.page || page,
        type: front.includes("{{") ? "cloze" : "qa",
        front,
        back,
        cloze: front,
        occlusion: {},
      },
    });
  }
  useEffect(() => {
    if (!pdf || !doc) return;
    const t = setTimeout(() => {
      void change({ kind: "notes", data: { document_id: doc, summary } });
    }, 800);
    return () => clearTimeout(t);
  }, [summary, pdf, doc]);
  useEffect(() => {
    if (!review) return;
    const handle = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setAnswer(true);
      }
      const n = Number(e.key);
      if (answer && card && n >= 1 && n <= 4) {
        void change({ action: "review", id: card.id, rating: n }).then(() =>
          setAnswer(false),
        );
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [review, answer, card]);
  async function findText() {
    if (!pdf || !search.trim()) return;
    setStatus("Mencari…");
    for (let n = page; n <= pdf.numPages + page - 1; n++) {
      const i = ((n - 1) % pdf.numPages) + 1;
      const p = await pdf.getPage(i),
        content = await p.getTextContent();
      if (
        content.items
          .map((v: any) => v.str)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      ) {
        setPage(i);
        setStatus("Ditemukan pada halaman " + i);
        return;
      }
    }
    setStatus(
      "Teks tidak ditemukan. PDF hasil scan mungkin tidak memiliki lapisan teks.",
    );
  }
  async function exportPDF() {
    try {
      setStatus("Menyiapkan PDF…");
      const r = await fetch("/api/files?id=" + doc + "&preview=1");
      if (!r.ok) throw new Error("File tidak tersedia.");
      const output = await PDFDocument.load(await r.arrayBuffer());
      const font = await output.embedFont(StandardFonts.Helvetica);
      const sticky = confirm("Sertakan catatan tempel?");
      for (const a of annotations) {
        if (a.type === "sticky" && !sticky) continue;
        const p = output.getPage(a.page - 1),
          g = a.geometry,
          w = p.getWidth(),
          h = p.getHeight();
        const hex = a.color;
        const c = rgb(
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        );
        if (["text", "sticky"].includes(a.type)) {
          p.drawText((a.comment || "").replace(/[^\x20-\x7e\n]/g, "?"), {
            x: g.x * w,
            y: h - g.y * h - 12,
            size: 12,
            font,
            color: c,
            maxWidth: Math.max(30, (g.w || 0.3) * w),
          });
        } else if (a.type === "pen" && g.points) {
          for (let i = 1; i < g.points.length; i++)
            p.drawLine({
              start: {
                x: g.points[i - 1][0] * w,
                y: h - g.points[i - 1][1] * h,
              },
              end: { x: g.points[i][0] * w, y: h - g.points[i][1] * h },
              color: c,
              thickness: 1,
            });
        } else if (["underline", "strike", "arrow"].includes(a.type)) {
          p.drawLine({
            start: {
              x: g.x * w,
              y: h - (g.y + (a.type === "underline" ? g.h : g.h / 2)) * h,
            },
            end: { x: (g.x + g.w) * w, y: h - (g.y + g.h / 2) * h },
            color: c,
            thickness: 1,
          });
        } else
          p.drawRectangle({
            x: g.x * w,
            y: h - (g.y + g.h) * h,
            width: g.w * w,
            height: g.h * h,
            color: a.type === "highlight" ? c : undefined,
            opacity: 0.35,
            borderColor: c,
            borderWidth: 1,
          });
      }
      const bytes = await output.save();
      const url = URL.createObjectURL(
        new Blob([bytes as any], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "orbit-beranotasi.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("PDF siap");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (review)
    return (
      <section className="panel study-review">
        <button onClick={() => setReview(false)}>Tutup review</button>
        {card ? (
          <>
            <p>Halaman {card.page}</p>
            <h2>
              {answer
                ? card.back
                : card.type === "cloze"
                  ? card.front.replace(/\{\{.*?\}\}/g, "[…]")
                  : card.front}
            </h2>
            <button onClick={() => setAnswer(true)}>Tampilkan jawaban</button>
            {answer && (
              <div className="toolbar">
                {["Lagi", "Sulit", "Baik", "Mudah"].map((s, i) => (
                  <button
                    key={s}
                    onClick={async () => {
                      await change({
                        action: "review",
                        id: card.id,
                        rating: i + 1,
                      });
                      setAnswer(false);
                    }}
                  >
                    {i + 1} · {s}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyState message="Tidak ada kartu yang jatuh tempo." />
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    );
  return (
    <>
      <div className="toolbar">
        <button
          onClick={() => {
            setDoc("");
            location.hash = "";
          }}
        >
          Daftar PDF
        </button>
        <button
          onClick={() => {
            setReview(true);
            setAnswer(false);
          }}
        >
          Review · {due.length}
        </button>
        <button
          onClick={() => {
            location.hash = "vault-upload";
            window.dispatchEvent(new Event("orbit-study-upload"));
          }}
        >
          Unggah PDF
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!doc && (
        <input
          aria-label="Cari PDF belajar"
          placeholder="Cari PDF belajar"
          value={pdfQuery}
          onChange={(e) => setPdfQuery(e.target.value)}
        />
      )}
      {!doc ? (
        <section className="document-grid">
          {data.documents
            .filter(
              (d) =>
                /\.pdf$/i.test(String(d.title)) &&
                String(d.title).toLowerCase().includes(pdfQuery.toLowerCase()),
            )
            .map((d) => {
              const p = state.progress.find((p: any) => p.document_id === d.id);
              const pct = p?.total_pages
                ? Math.round((p.pages_read.length / p.total_pages) * 100)
                : 0;
              return (
                <article className="panel" key={d.id}>
                  <h3>{String(d.title)}</h3>
                  <progress max={100} value={pct} />
                  <p>
                    {pct}% ·{" "}
                    {
                      state.cards.filter((c: any) => c.document_id === d.id)
                        .length
                    }{" "}
                    kartu
                  </p>
                  <button onClick={() => setDoc(d.id)}>Lanjutkan</button>
                </article>
              );
            })}
        </section>
      ) : (
        <>
          <div className="toolbar study-toolbar">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ←
            </button>
            <input
              aria-label="Halaman PDF"
              type="number"
              min={1}
              max={pdf?.numPages || 1}
              value={page}
              onChange={(e) =>
                setPage(
                  Math.max(
                    1,
                    Math.min(pdf?.numPages || 1, Number(e.target.value) || 1),
                  ),
                )
              }
            />
            <span>/ {pdf?.numPages || "…"}</span>
            <button
              disabled={!pdf || page >= pdf.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
            <select
              aria-label="Zoom PDF"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
                <option key={z} value={z}>
                  {z * 100}%
                </option>
              ))}
            </select>
            <button
              onClick={async () => {
                if (pdf) {
                  const p = await pdf.getPage(page);
                  setZoom(
                    Math.min(
                      3,
                      Math.max(
                        0.25,
                        (surface.current!.parentElement!.clientWidth - 32) /
                          p.getViewport({ scale: 1 }).width,
                      ),
                    ),
                  );
                }
              }}
            >
              Fit width
            </button>
            <button
              onClick={() =>
                surface.current?.parentElement?.requestFullscreen()
              }
            >
              Layar penuh
            </button>
            <input
              aria-label="Cari teks PDF"
              placeholder="Cari teks PDF"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button onClick={() => void findText()}>Cari</button>
            <button onClick={() => void exportPDF()}>
              Unduh PDF beranotasi
            </button>
          </div>
          <div className="study-layout">
            <section className="panel study-paper">
              <div className="toolbar">
                <select
                  aria-label="Alat anotasi"
                  value={tool}
                  onChange={(e) => setTool(e.target.value)}
                >
                  {[
                    "highlight",
                    "underline",
                    "strike",
                    "sticky",
                    "text",
                    "rectangle",
                    "arrow",
                    "pen",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select
                  aria-label="Warna anotasi"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                >
                  {["#f4f1ea", "#b4b0a7", "#68645d", "#44413b", "#d6442b"].map(
                    (c, i) => (
                      <option key={c} value={c}>
                        {i === 4 ? "Shu" : "Abu " + (i + 1)}
                      </option>
                    ),
                  )}
                </select>
                <button
                  disabled={!annotations.length}
                  onClick={async () => {
                    const a = annotations.at(-1);
                    setRedo((v) => [...v, a]);
                    await change({
                      action: "delete",
                      kind: "annotations",
                      id: a.id,
                    });
                  }}
                >
                  Undo
                </button>
                <button
                  disabled={!redo.length}
                  onClick={async () => {
                    const a = redo.at(-1);
                    await change({ kind: "annotations", data: a });
                    setRedo((v) => v.slice(0, -1));
                  }}
                >
                  Redo
                </button>
              </div>
              <div
                ref={surface}
                className="study-surface"
                style={{ width: "max-content", position: "relative" }}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  draw.current = {
                    x: (e.clientX - r.left) / r.width,
                    y: (e.clientY - r.top) / r.height,
                  };
                  draw.current.points = [[draw.current.x, draw.current.y]];
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (draw.current && tool === "pen") {
                    const r = e.currentTarget.getBoundingClientRect();
                    draw.current.points.push([
                      (e.clientX - r.left) / r.width,
                      (e.clientY - r.top) / r.height,
                    ]);
                  }
                }}
                onPointerUp={(e) => {
                  if (!draw.current) return;
                  const r = e.currentTarget.getBoundingClientRect(),
                    start = draw.current;
                  draw.current = null;
                  const x = (e.clientX - r.left) / r.width,
                    y = (e.clientY - r.top) / r.height;
                  const comment = ["sticky", "text"].includes(tool)
                    ? prompt("Catatan") || ""
                    : "";
                  void add({
                    geometry: {
                      points: tool === "pen" ? start.points : undefined,
                      x: Math.min(start.x, x),
                      y: Math.min(start.y, y),
                      w: Math.max(0.02, Math.abs(x - start.x)),
                      h: Math.max(0.015, Math.abs(y - start.y)),
                    },
                    comment,
                  });
                }}
              >
                <canvas ref={canvas} />
                <svg
                  className="study-ink"
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                >
                  {annotations
                    .filter((a: any) => a.page === page && a.type === "pen")
                    .map((a: any) => (
                      <polyline
                        key={a.id}
                        fill="none"
                        stroke={a.color}
                        strokeWidth="2"
                        points={(a.geometry.points || [])
                          .map((p: number[]) =>
                            p.map((v) => v * 1000).join(","),
                          )
                          .join(" ")}
                      />
                    ))}
                </svg>
                {annotations
                  .filter((a: any) => a.page === page && a.type !== "pen")
                  .map((a: any) => (
                    <button
                      title={a.comment || a.quote || a.type}
                      className="study-mark"
                      key={a.id}
                      style={{
                        left: a.geometry.x * 100 + "%",
                        top: a.geometry.y * 100 + "%",
                        width: a.geometry.w * 100 + "%",
                        height: a.geometry.h * 100 + "%",
                        background:
                          a.type === "highlight"
                            ? a.color + "66"
                            : "transparent",
                        borderColor: a.color,
                        borderWidth: ["underline", "strike"].includes(a.type)
                          ? "0 0 2px"
                          : "1px",
                        transform:
                          a.type === "strike" ? "translateY(-50%)" : undefined,
                      }}
                      onClick={() => {
                        const comment = prompt("Edit catatan", a.comment);
                        if (comment !== null)
                          void change({
                            kind: "annotations",
                            id: a.id,
                            data: { ...a, comment },
                          });
                      }}
                    >
                      {["text", "sticky"].includes(a.type) ? a.comment : ""}
                    </button>
                  ))}
              </div>
            </section>
            <aside className="panel study-notes">
              <h3>Catatan PDF</h3>
              <textarea
                aria-label="Ringkasan PDF"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onBlur={() =>
                  void change({
                    kind: "notes",
                    data: { document_id: doc, summary },
                  })
                }
              />
              <button onClick={() => void flash({ comment: summary })}>
                Buat kartu dari ringkasan
              </button>
              <input
                aria-label="Cari catatan"
                placeholder="Cari catatan / kutipan"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {annotations
                .filter((a: any) =>
                  (a.comment + " " + a.quote)
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .sort((a: any, b: any) => a.page - b.page)
                .map((a: any) => (
                  <div className="category-row" key={a.id}>
                    <div>
                      <button onClick={() => setPage(a.page)}>
                        Halaman {a.page} · {a.type}
                      </button>
                      <p>{a.comment || a.quote || "Anotasi area"}</p>
                      <button onClick={() => void flash(a)}>Buat kartu</button>
                      <button
                        onClick={() =>
                          void change({
                            action: "delete",
                            kind: "annotations",
                            id: a.id,
                          })
                        }
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              {outline.length > 0 && (
                <details>
                  <summary>Daftar isi</summary>
                  {outline.map((o: any, i: number) => (
                    <button
                      key={i}
                      onClick={async () => {
                        let dest =
                          typeof o.dest === "string"
                            ? await pdf.getDestination(o.dest)
                            : o.dest;
                        if (dest?.[0])
                          setPage((await pdf.getPageIndex(dest[0])) + 1);
                      }}
                    >
                      {o.title}
                    </button>
                  ))}
                </details>
              )}
              <small role="status">{status}</small>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
