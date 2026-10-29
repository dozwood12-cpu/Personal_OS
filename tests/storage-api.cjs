const http = require("node:http"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const secret = "fixture-private-refresh-ciphertext";
const tables = {
  storage_connections: [
    {
      provider: "gdrive",
      account_email: "owner@example.com",
      folder_id: "folder_fixture_12345",
      folder_name: "Vault",
      token_encrypted: secret,
      iv: "fixture-private-iv",
      tag: "fixture-private-tag",
      scope: "scope-private-fixture",
      status: "reconnect",
      connected_at: new Date().toISOString(),
    },
  ],
  app_settings: [
    {
      key: "vault_storage",
      value: { default_provider: "supabase", max_upload_mb: 100 },
    },
  ],
  categories: [{ id: id(1), kind: "document" }],
  documents: [
    {
      id: id(2),
      title: "legacy.pdf",
      path: "legacy/legacy.pdf",
      category_id: id(1),
      size: 8,
      deletion_state: "active",
    },
  ],
  vault_uploads: [],
  storage_oauth_states: [],
  storage_migrations: [],
};
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"),
      chunks = [];
    for await (const b of req) chunks.push(b);
    const body = Buffer.concat(chunks).toString();
    const send = (b, status = 200, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(req.method === "HEAD" ? "" : JSON.stringify(b));
    };
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/").at(-1);
      const rows = tables[table] || [];
      let data = rows.filter((row) =>
        [...u.searchParams].every(
          ([k, v]) => !v.startsWith("eq.") || String(row[k]) === v.slice(3),
        ),
      );
      if (req.method === "POST") {
        const b = JSON.parse(body);
        rows.push({
          ...b,
          ...(table === "vault_uploads"
            ? { expires_at: new Date(Date.now() + 604800000).toISOString() }
            : {}),
          ...(table === "documents" ? { deletion_state: "active" } : {}),
        });
        tables[table] = rows;
        data = [rows.at(-1)];
      }
      if (req.method === "PATCH")
        data.forEach((r) => Object.assign(r, JSON.parse(body)));
      const headers = {
        "Content-Range": `0-${Math.max(0, data.length - 1)}/${data.length}`,
      };
      return send(
        req.headers.accept?.includes("object") ? data[0] || null : data,
        200,
        headers,
      );
    }
    if (u.pathname.includes("/object/upload/sign/"))
      return send({
        url: u.pathname.replace("/storage/v1", "") + "?token=upload-fixture",
      });
    if (u.pathname.includes("/object/sign/") && req.method === "POST")
      return send({
        signedURL:
          u.pathname.replace("/storage/v1", "") + "?token=download-fixture",
      });
    if (u.pathname.includes("/object/sign/vault/")) {
      const bytes = Buffer.from("PDF12345");
      const range = req.headers.range;
      const h = { "Content-Type": "application/pdf", "Accept-Ranges": "bytes" };
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/);
        const from = Number(m[1]),
          to = m[2] ? Number(m[2]) : bytes.length - 1;
        res.writeHead(206, {
          ...h,
          "Content-Range": `bytes ${from}-${to}/${bytes.length}`,
          "Content-Length": String(to - from + 1),
        });
        res.end(req.method === "HEAD" ? "" : bytes.subarray(from, to + 1));
        return;
      }
      res.writeHead(200, { ...h, "Content-Length": String(bytes.length) });
      res.end(req.method === "HEAD" ? "" : bytes);
      return;
    }
    send({ error: "Unexpected fixture path" }, 404);
  } catch (e) {
    res.writeHead(500);
    res.end("Fixture failed");
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:3801";
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3801",
    ],
    {
      env: {
        ...process.env,
        SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
        TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
        GOOGLE_CLIENT_ID: "fixture-client",
        GOOGLE_CLIENT_SECRET: "fixture-secret",
        GOOGLE_REDIRECT_URI: base + "/api/storage/gdrive/callback",
      },
      stdio: "ignore",
    },
  );
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready);
    assert.equal((await fetch(base + "/api/storage")).status, 401);
    assert.equal((await fetch(base + "/api/files?id=" + id(2))).status, 401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const get = (path) => fetch(base + path, { headers: { Cookie: cookie } });
    const post = (path, b) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          Origin: base,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(b),
      });
    const status = await get("/api/storage");
    assert.equal(status.status, 200);
    const text = await status.text();
    assert.match(text, /owner@example.com/);
    assert.doesNotMatch(
      text,
      /fixture-private|scope-private|token_encrypted|"iv"|"tag"/,
    );
    for (const path of ["/api/data"]) {
      const r = await get(path);
      assert.doesNotMatch(
        await r.text(),
        /fixture-private|storage_connections|vault_uploads/,
      );
    }
    let r = await post("/api/actions", { action: "export" });
    assert.equal(r.status, 200);
    assert.doesNotMatch(
      await r.text(),
      /fixture-private|storage_connections|vault_uploads/,
    );
    r = await post("/api/storage", { action: "connect" });
    assert.equal(r.status, 200);
    const auth = new URL((await r.json()).url);
    assert.equal(auth.searchParams.get("access_type"), "offline");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(auth.searchParams.has("client_secret"), false);
    const oauthCookie = r.headers.get("set-cookie");
    assert.match(oauthCookie, /HttpOnly/);
    assert.match(oauthCookie, /SameSite=lax/i);
    assert.doesNotMatch(oauthCookie, /fixture-private/);
    r = await fetch(
      base + "/api/storage/gdrive/callback?state=forged&code=fake",
      { headers: { Cookie: oauthCookie.split(";")[0] }, redirect: "manual" },
    );
    assert.equal(r.status, 307);
    assert.match(r.headers.get("location"), /drive=failed/);
    r = await post("/api/files", {
      action: "prepare_upload",
      category_id: id(1),
      name: "new.pdf",
      type: "application/pdf",
      size: 8,
    });
    assert.equal(r.status, 200);
    const upload = await r.json();
    assert.equal(upload.provider, "supabase");
    assert.match(upload.path, /new.pdf$/);
    assert.ok(upload.id);
    r = await post("/api/files", {
      action: "finish_upload",
      id: upload.id,
      path: "foreign/file.exe",
      size: 999999,
      category_id: id(99),
    });
    assert.equal(r.status, 200);
    const docId = (await r.json()).id;
    assert.equal(
      tables.documents.find((d) => d.id === docId).category_id,
      id(1),
    );
    r = await fetch(base + "/api/files?id=" + id(2) + "&preview=1", {
      headers: { Cookie: cookie, Range: "bytes=1-3" },
    });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), "bytes 1-3/8");
    assert.equal(await r.text(), "DF1");
    assert.match(r.headers.get("content-disposition"), /inline/);
    assert.equal(r.headers.get("location"), null);
    r = await post("/api/files", { action: "finish_upload", id: upload.id });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).id, docId);
    r = await post("/api/files", {
      action: "prepare_upload",
      category_id: id(1),
      name: "bad.exe",
      type: "application/pdf",
      size: 8,
    });
    assert.equal(r.status, 400);
    r = await post("/api/files", {
      action: "prepare_upload",
      category_id: id(1),
      name: "too-large.pdf",
      type: "application/pdf",
      size: 101 * 1024 * 1024,
    });
    assert.equal(r.status, 400);
    console.log(
      "PASS: real storage endpoints enforce session, redact encrypted tokens, exclude private storage tables from exports, initialize one-use OAuth with secure cookie/PKCE, reject forged callback, enforce upload tickets/category/type/size, finalize idempotently, stream legacy Supabase files with Range and no public redirect.",
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
