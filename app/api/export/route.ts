import { authorized, db, failure } from "@/lib/server";
import { tables } from "@/lib/model";
import JSZip from "jszip";
import { Readable } from "node:stream";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const c = db(),
      zip = new JSZip(),
      snapshot: Record<string, unknown> = {
        version: 1,
        exported_at: new Date().toISOString(),
      };
    let total = 0;
    for (const table of [...tables, "theme_presets", "personalization"]) {
      let start = 0;
      const rows = [];
      while (true) {
        const r = await c
          .from(table)
          .select("*")
          .order(table === "app_settings" ? "key" : "id")
          .range(start, start + 999);
        if (r.error) throw r.error;
        rows.push(...r.data);
        if (r.data.length < 1000) break;
        start += 1000;
      }
      snapshot[table] = rows;
    }
    const files = [
      ...(snapshot.documents as { path: string }[]).map((d) => ({
        path: d.path,
        bucket: "vault",
      })),
      ...(snapshot.personalization as { path: string }[]).map((d) => ({
        path: d.path,
        bucket: "personalize",
      })),
    ];
    for (const f of [
      ...new Map(files.map((f) => [f.bucket + "/" + f.path, f])).values(),
    ]) {
      const r = await c.storage.from(f.bucket).download(f.path);
      if (r.error) {
        if (
          (
            snapshot.documents as { path: string; deletion_state: string }[]
          ).some((d) => d.path === f.path && d.deletion_state === "pending")
        )
          continue;
        throw r.error;
      }
      total += r.data.size;
      if (total > 100 * 1024 * 1024)
        throw new Error(
          "Ekspor ZIP dibatasi 100 MB per permintaan di serverless. Unduh arsip besar melalui dashboard Supabase.",
        );
      zip.file(f.bucket + "/" + f.path, await r.data.arrayBuffer());
    }
    zip.file("workspace.json", JSON.stringify(snapshot, null, 2));
    return new Response(
      Readable.toWeb(
        zip.generateNodeStream({
          type: "nodebuffer",
          streamFiles: true,
          compression: "DEFLATE",
        }) as Readable,
      ) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="orbit-workspace.zip"',
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return failure(e);
  }
}
