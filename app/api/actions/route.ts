import { authorized, db, failure, sameOrigin } from "@/lib/server";
import { dateToday, tables } from "@/lib/model";
import { transactionInput } from "@/lib/validation";
import { z } from "zod";
import { removeDocumentFile, type VaultDocument } from "@/lib/storage/vault";
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    const b = await req.json(),
      c = (await db());
    let r;
    if (b.action === "move_category")
      r = await c.rpc("move_category", {
        p_from: z.uuid().parse(b.from),
        p_to: z.uuid().parse(b.to),
      });
    else if (b.action === "recurring")
      r = await c.rpc("run_recurring", { p_today: dateToday() });
    else if (b.action === "stop_focus")
      r = await c.rpc("stop_focus", { p_id: z.uuid().parse(b.id) });
    else if (b.action === "import") {
      const rows = z.array(transactionInput).min(1).max(2000).parse(b.rows);
      r = await c.rpc("import_transactions", { p_rows: rows });
    } else if (b.action === "setting") {
      const key = z
        .enum(["auto_complete", "widgets", "mode", "notifications"])
        .parse(b.key);
      let v = b.value;
      if (key === "auto_complete" || key === "notifications")
        v = z.boolean().parse(v);
      if (key === "mode") v = z.enum(["dark", "light"]).parse(v);
      if (key === "widgets")
        v = z
          .array(z.enum(["summary", "cashflow", "deadlines", "journal"]))
          .max(4)
          .refine((a) => new Set(a).size === a.length)
          .parse(v);
      r = await c.from("app_settings").upsert({ key, value: v });
    } else if (b.action === "retry_deletions") {
      const docs = await c
        .from("documents")
        .select("*")
        .eq("deletion_state", "pending");
      if (docs.error) throw docs.error;
      for (const d of docs.data) {
        await removeDocumentFile(d as VaultDocument);
        const del = await c.from("documents").delete().eq("id", d.id);
        if (del.error) throw del.error;
      }
      return Response.json({ ok: true, count: docs.data.length });
    } else if (b.action === "export") {
      const snapshot: Record<string, unknown> = {
        version: 1,
        exported_at: new Date().toISOString(),
      };
      for (const table of [...tables, "theme_presets", "personalization"]) {
        let start = 0;
        const rows = [];
        while (true) {
          const q = await c
            .from(table)
            .select("*")
            .order(table === "app_settings" ? "key" : "id")
            .range(start, start + 999);
          if (q.error) throw q.error;
          rows.push(...q.data);
          if (q.data.length < 1000) break;
          start += 1000;
        }
        snapshot[table] = rows;
      }
      return Response.json(snapshot);
    } else throw new Error("Aksi tidak valid");
    if (r.error) throw r.error;
    return Response.json({ ok: true, result: r.data });
  } catch (e) {
    return failure(e);
  }
}
