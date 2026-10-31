import { authorized, db, failure } from "@/lib/server";
import { tables } from "@/lib/model";
import JSZip from "jszip";
import { Readable } from "node:stream";
import { openDocument, type VaultDocument } from "@/lib/storage/vault";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    const c = (await db()),
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
    const docs = snapshot.documents as VaultDocument[];
    for (const doc of docs) {
      if (doc.deletion_state === "pending") continue;
      total += Number(doc.size);
      if (total > 100 * 1024 * 1024)
        throw new Error(
          "Ekspor ZIP dibatasi 100 MB per permintaan. Unduh dokumen besar secara terpisah melalui Arsip Dokumen.",
        );
      const response = await openDocument(doc);
      if (!response.body)
        throw new Error("Dokumen tidak dapat dibaca untuk ekspor.");
      zip.file(
        "vault/" + doc.path,
        Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        ),
        { binary: true },
      );
    }
    const paths = [
      ...new Set(
        (snapshot.personalization as { path: string }[]).map((f) => f.path),
      ),
    ];
    for (const path of paths) {
      const r = await c.storage.from("personalize").download(path);
      if (r.error) throw r.error;
      total += r.data.size;
      if (total > 100 * 1024 * 1024)
        throw new Error(
          "Ekspor ZIP dibatasi 100 MB per permintaan. Unduh dokumen besar secara terpisah.",
        );
      zip.file("personalize/" + path, await r.data.arrayBuffer());
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
