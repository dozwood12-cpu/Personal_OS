// Local HTTP contract checks; Supabase Storage/REST is represented by a controlled fixture server.
const http = require("node:http"),
  fs = require("node:fs"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process"),
  sharp = require("sharp");
const objects = new Map();
let activePath = "",
  pending = false,
  removeFails = false,
  metadataDeleted = false;
const docId = "00000000-0000-4000-8000-000000000040";
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"),
      p = decodeURIComponent(u.pathname);
    const chunks = [];
    for await (const b of req) chunks.push(b);
    const bytes = Buffer.concat(chunks);
    const send = (data, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (p.startsWith("/rest/v1/categories"))
      return send(
        req.headers.accept?.includes("object")
          ? { id: "00000000-0000-4000-8000-000000000014", kind: "document" }
          : [],
      );
    if (p.startsWith("/rest/v1/documents")) {
      if (req.method === "PATCH") {
        pending = true;
        return send([]);
      }
      if (req.method === "DELETE") {
        metadataDeleted = true;
        return send([]);
      }
      const doc = {
        id: docId,
        path: "document.pdf",
        title: "Document.pdf",
        deletion_state: pending ? "pending" : "active",
      };
      return send(
        req.headers.accept?.includes("object")
          ? doc
          : u.searchParams.has("id")
            ? [doc]
            : [],
      );
    }
    if (p.startsWith("/rest/v1/personalization")) {
      const id = u.searchParams.get("id");
      return send(
        activePath && (!id || id === "eq.image-1")
          ? [
              {
                id: "image-1",
                path: activePath,
                preset: "secret-preset-id",
                slot: "login",
                is_active: true,
                overlay: 0.6,
                blur: 0,
                x: 50,
                y: 50,
                zoom: 1,
                opacity: 1,
                animation: "none",
                speed: 8,
                intensity: 0.3,
                sort_order: 0,
              },
            ]
          : [],
      );
    }
    if (p.startsWith("/rest/v1/")) return send([]);
    if (
      p.startsWith("/storage/v1/object/upload/sign/") &&
      req.method === "POST"
    ) {
      return send({ url: p.replace("/storage/v1", "") + "?token=fixture" });
    }
    if (p.startsWith("/storage/v1/object/sign/"))
      return send({
        signedURL: p.replace("/storage/v1", "") + "?token=fixture",
      });
    if (p === "/storage/v1/object/personalize" && req.method === "DELETE") {
      const b = JSON.parse(bytes);
      for (const path of b.prefixes || []) objects.delete(path);
      return send([]);
    }
    if (p === "/storage/v1/object/vault" && req.method === "DELETE") {
      if (removeFails)
        return send(
          { message: "fixture storage unavailable", statusCode: "500" },
          500,
        );
      return send([]);
    }
    if (
      req.method === "GET" &&
      (p.startsWith("/storage/v1/object/authenticated/personalize/") ||
        p.startsWith("/storage/v1/object/personalize/"))
    ) {
      const key = p.split("/personalize/")[1],
        blob = objects.get(key);
      if (!blob) return send({ message: "not found" }, 404);
      res.writeHead(200, {
        "Content-Type": key.endsWith(".webp") ? "image/webp" : "image/png",
      });
      return res.end(blob);
    }
    if (
      p.startsWith("/storage/v1/object/personalize/") &&
      req.method === "POST"
    ) {
      const key = p.split("/personalize/")[1];
      objects.set(key, bytes);
      return send({ Key: "personalize/" + key });
    }
    return send({ message: "unhandled " + req.method + " " + p }, 404);
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ message: e.message }));
  }
});
(async () => {
  await new Promise((r) => server.listen(4300, "127.0.0.1", r));
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3301",
    ],
    {
      env: {
        ...process.env,
        SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
        SUPABASE_URL: "http://127.0.0.1:4300",
        SUPABASE_SERVICE_ROLE_KEY: "local-fixture-key",
      },
      stdio: "ignore",
    },
  );
  const base = "http://127.0.0.1:3301";
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(base)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const post = (path, data) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          Origin: base,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
    assert.equal((await fetch(base + "/api/personalize")).status, 401);
    const blank = new FormData();
    blank.append("file", new Blob([], { type: "image/png" }), "empty.png");
    let r = await fetch(base + "/api/personalize", {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
      body: blank,
    });
    assert.equal(r.status, 400);
    const invalid = new FormData();
    invalid.append(
      "file",
      new Blob(["not an image"], { type: "image/png" }),
      "fake.png",
    );
    r = await fetch(base + "/api/personalize", {
      method: "POST",
      headers: { Origin: base, Cookie: cookie },
      body: invalid,
    });
    assert.equal(r.status, 400);
    r = await post("/api/personalize", {
      action: "prepare_upload",
      type: "image/png",
      size: 5 * 1024 * 1024 + 1,
    });
    assert.equal(r.status, 400);
    r = await post("/api/personalize", {
      action: "prepare_upload",
      type: "image/png",
      size: 500,
    });
    assert.equal(r.status, 200);
    const prep = await r.json();
    assert.match(prep.path, /^staging\//);
    assert.match(prep.uploadUrl, /token=fixture/);
    objects.set(
      prep.path,
      await sharp({
        create: { width: 3200, height: 1600, channels: 3, background: "#555" },
      })
        .png()
        .toBuffer(),
    );
    r = await post("/api/personalize", {
      action: "finish_upload",
      path: prep.path,
    });
    assert.equal(r.status, 200, await r.clone().text());
    const optimized = await r.json();
    assert.match(optimized.path, /\.webp$/);
    assert.equal(objects.has(prep.path), false);
    const meta = await sharp(objects.get(optimized.path)).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 1920);
    assert.equal(meta.height, 960);
    activePath = optimized.path;
    r = await fetch(base + "/api/personalize/login");
    assert.equal(r.status, 200);
    const pub = await r.json();
    assert.equal(pub.rows.length, 1);
    assert.equal("path" in pub.rows[0], false);
    assert.equal("preset" in pub.rows[0], false);
    assert.equal(pub.rows[0].url, "/api/personalize/login?image=image-1");
    r = await fetch(base + pub.rows[0].url);
    assert.equal(r.headers.get("content-type"), "image/webp");
    assert.equal(r.status, 200);
    r = await fetch(base + "/api/personalize/login?image=unknown");
    assert.equal(r.status, 404);
    removeFails = true;
    r = await post("/api/data", {
      table: "documents",
      action: "delete",
      id: docId,
    });
    assert.equal(r.status, 400);
    assert.equal(pending, true);
    assert.equal(metadataDeleted, false);
    removeFails = false;
    r = await post("/api/data", {
      table: "documents",
      action: "delete",
      id: docId,
    });
    assert.equal(r.status, 200);
    assert.equal(metadataDeleted, true);
    const exported = await fetch(base + "/api/export", {
      headers: { Cookie: cookie },
    });
    assert.equal(exported.status, 200);
    const zip = await require("jszip").loadAsync(await exported.arrayBuffer());
    assert.ok(zip.file("workspace.json"));
    assert.ok(zip.file("personalize/" + activePath));
    const snapshot = JSON.parse(
      await zip.file("workspace.json").async("string"),
    );
    assert.equal(snapshot.personalization.length, 1);
    console.log(
      "PASS: streaming ZIP export, real API session checks, empty/invalid/oversized image rejection, signed upload preparation, image optimization to 1920px WebP, raw cleanup, public login scope and image fallback, retryable two-phase document deletion. Uses local Storage fixture.",
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  server.close();
});
