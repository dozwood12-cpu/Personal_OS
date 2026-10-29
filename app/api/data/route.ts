import { authorized, db, failure, sameOrigin } from "@/lib/server";
import { tables } from "@/lib/model";
import { inputs, type Editable } from "@/lib/validation";
import { z } from "zod";
async function allRows(table: string) {
  const c = db();
  const rows = [];
  let start = 0;
  while (true) {
    const r = await c
      .from(table)
      .select("*")
      .order(table === "app_settings" ? "key" : "id")
      .range(start, start + 999);
    if (r.error)
      throw new Error(
        `${table}: ${r.error.message}. Pastikan migrasi 202610290001 sudah dijalankan.`,
      );
    rows.push(...r.data);
    if (r.data.length < 1000) break;
    start += 1000;
  }
  return rows;
}
export async function GET() {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const data = await Promise.all(
      tables.map((t) =>
        t === "activity_log"
          ? db()
              .from(t)
              .select("*")
              .order("created_at", { ascending: false })
              .limit(100)
              .then((r) => {
                if (r.error) throw r.error;
                return r.data;
              })
          : allRows(t),
      ),
    );
    return Response.json(
      Object.fromEntries(tables.map((t, i) => [t, data[i]])),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const { table, action, id, data } = await req.json();
    if (!Object.hasOwn(inputs, table))
      throw new Error("Tabel tidak dapat diedit");
    const c = db();
    if (action === "delete") {
      z.uuid().parse(id);
      if (table === "documents") {
        const mark = await c
          .from(table)
          .update({ deletion_state: "pending" })
          .eq("id", id);
        if (mark.error) throw mark.error;
        const doc = await c
          .from(table)
          .select("path")
          .eq("id", id)
          .maybeSingle();
        if (doc.error) throw doc.error;
        if (doc.data) {
          const r = await c.storage.from("vault").remove([doc.data.path]);
          if (r.error)
            throw new Error(
              "Penghapusan ditunda; coba hapus lagi. " + r.error.message,
            );
        }
      }
      const r = await c.from(table).delete().eq("id", id);
      if (r.error) throw r.error;
      return Response.json({ ok: true });
    }
    if (
      !["create", "update"].includes(action) ||
      (table === "documents" && action === "create") ||
      (table === "focus_sessions" && action !== "create")
    )
      throw new Error("Aksi tidak valid");
    const value = inputs[table as Editable].parse(data) as Record<
      string,
      unknown
    >;
    const kind =
      table === "projects"
        ? "status"
        : table === "documents"
          ? "document"
          : table === "budgets"
            ? "expense"
            : ["transactions", "recurring_rules"].includes(table)
              ? "finance"
              : null;
    if (kind) {
      const r = await c
        .from("categories")
        .select("kind")
        .eq("id", value.category_id || value.status_id)
        .single();
      if (r.error) throw r.error;
      if (
        kind === "finance"
          ? !["income", "expense"].includes(r.data.kind)
          : r.data.kind !== kind
      )
        throw new Error("Jenis kategori tidak sesuai");
    }
    if (action === "update") {
      z.uuid().parse(id);
      if (table === "categories") {
        const old = await c.from(table).select("kind").eq("id", id).single();
        if (old.error) throw old.error;
        if (old.data.kind !== value.kind)
          throw new Error("Jenis kategori tidak dapat diubah");
      }
    }
    const r =
      action === "update"
        ? await c.from(table).update(value).eq("id", id)
        : await c.from(table).insert(value);
    if (r.error) {
      if (
        table === "subtasks" &&
        ["42703", "PGRST204"].includes(r.error.code) &&
        r.error.message.includes("deadline")
      )
        throw new Error(
          "Tanggal subtask belum tersedia. Jalankan migrasi 202610290002_subtask_deadlines.sql di Supabase SQL Editor.",
        );
      throw r.error;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
