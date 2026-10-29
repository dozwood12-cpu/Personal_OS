import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  consumeOAuthState,
  finishOAuth,
  oauthCookie,
} from "@/lib/storage/oauth";
import { googleConfig, ensureFolder } from "@/lib/storage/gdrive";
export const runtime = "nodejs";
export async function GET(req: Request) {
  // os_session is SameSite=Strict. The encrypted, one-use Lax OAuth cookie carries
  // the verified initiating session, so returning from Google does not weaken login cookies.
  const uri = new URL(req.url);
  let base: string;
  try {
    base = new URL(googleConfig().redirect).origin;
  } catch {
    return new Response("Konfigurasi OAuth Google belum lengkap.", {
      status: 400,
    });
  }
  const cookie = (await cookies()).get(oauthCookie)?.value;
  let result = "failed";
  try {
    if (!cookie || !uri.searchParams.get("state"))
      throw new Error("State hilang");
    const verifier = await consumeOAuthState(
      cookie,
      uri.searchParams.get("state")!,
    );
    if (uri.searchParams.get("error")) result = "cancelled";
    else {
      const code = uri.searchParams.get("code");
      if (!code) throw new Error("Code hilang");
      await finishOAuth(code, verifier);
      try {
        await ensureFolder();
        result = "connected";
      } catch {
        result = "folder_required";
      }
    }
  } catch {
    result = "failed";
  }
  const response = NextResponse.redirect(
    `${base}/?settings=storage&drive=${result}`,
  );
  response.cookies.set(oauthCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/storage/gdrive/callback",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
