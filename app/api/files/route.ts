import { authorized, sameOrigin } from "@/lib/server";
import { z } from "zod";
import {
  documentResponse,
  finishUpload,
  getDocument,
  prepareUpload,
  resumeUpload,
} from "@/lib/storage/vault";
import { storageFailure } from "@/lib/storage/config";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  if (!sameOrigin(req) || !(await authorized()))
    return new Response("Forbidden", { status: 403 });
  try {
    if (!req.headers.get("content-type")?.includes("application/json"))
      throw new Error(
        "Unggah file langsung melalui sesi unggah. Isi file tidak boleh melewati fungsi Vercel.",
      );
    const b = await req.json();
    if (b.action === "prepare_upload")
      return Response.json(
        await prepareUpload(b, new URL(req.headers.get("origin")!).origin),
      );
    if (b.action === "resume_upload")
      return Response.json(await resumeUpload(z.uuid().parse(b.id)));
    if (b.action === "finish_upload")
      return Response.json(await finishUpload(z.uuid().parse(b.id)));
    throw new Error("Aksi unggah tidak valid.");
  } catch (e) {
    return storageFailure(e);
  }
}
export async function GET(req: Request) {
  if (!(await authorized()))
    return new Response("Unauthorized", { status: 401 });
  try {
    return await documentResponse(
      await getDocument(new URL(req.url).searchParams.get("id") || ""),
      req,
    );
  } catch (e) {
    return storageFailure(e);
  }
}
export const HEAD = GET;
