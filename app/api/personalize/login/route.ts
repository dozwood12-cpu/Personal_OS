import { masterDb } from "@/lib/server";
// Public surface is limited to optimized active login artwork; no bucket listing or arbitrary paths.
export async function GET(req: Request) {
  try {
    const c = masterDb();
    const image = new URL(req.url).searchParams.get("image");
    let q = c
      .from("personalization")
      .select("*")
      .eq("slot", "login")
      .eq("is_active", true)
      .order("sort_order")
      .limit(5);
    if (image) q = q.eq("id", image);
    const r = await q;
    if (r.error) throw r.error;
    if (image) {
      const row = r.data[0];
      if (!row) return new Response(null, { status: 404 });
      const file = await c.storage.from("personalize").download(row.path);
      if (file.error) throw file.error;
      return new Response(await file.data.arrayBuffer(), {
        headers: {
          "Content-Type": "image/webp",
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    return Response.json(
      {
        rows: r.data.map(
          ({
            id,
            overlay,
            blur,
            x,
            y,
            zoom,
            opacity,
            animation,
            speed,
            intensity,
            sort_order,
          }) => ({
            overlay,
            blur,
            x,
            y,
            zoom,
            opacity,
            animation,
            speed,
            intensity,
            sort_order,
            url: "/api/personalize/login?image=" + id,
          }),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { rows: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
