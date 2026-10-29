import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { seal, unseal } from "../lib/storage/crypto";
import { folderId, mimeFor } from "../lib/storage/shared";
import {
  oauthStart,
  consumeOAuthState,
  finishOAuth,
  disconnectDrive,
} from "../lib/storage/oauth";
import {
  accessToken,
  clearAccessTokens,
  driveFile,
  driveRequest,
  DriveError,
} from "../lib/storage/gdrive";
import {
  prepareUpload,
  finishUpload,
  resumeUpload,
  documentResponse,
  removeDocumentFile,
  type VaultDocument,
} from "../lib/storage/vault";
import {
  migrateOne,
  scanStorage,
  applySync,
  testDrive,
} from "../lib/storage/maintenance";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
process.env.SUPABASE_URL = "https://storage.fixture.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-only-key";
process.env.GOOGLE_CLIENT_ID = "client-fixture";
process.env.GOOGLE_CLIENT_SECRET = "secret-fixture";
process.env.GOOGLE_REDIRECT_URI =
  "https://orbit.example/api/storage/gdrive/callback";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cat = id(1),
  folder = "folder_fixture_12345";
const tables: Record<string, any[]> = {
  categories: [{ id: cat, kind: "document" }],
  documents: [],
  app_settings: [
    {
      key: "vault_storage",
      value: { default_provider: "supabase", max_upload_mb: 100 },
    },
  ],
  storage_connections: [],
  storage_oauth_states: [],
  vault_uploads: [],
  storage_sync_reports: [],
  storage_migrations: [],
};
const files = new Map<string, any>(),
  sources = new Map<string, Buffer>(),
  sessions = new Map<
    string,
    { id: string; offset: number; size: number; bytes: Buffer }
  >();
let counter = 0,
  refreshes = 0,
  invalidGrant = false,
  failDelete = false,
  interrupt = false,
  quota = false,
  rateOnce = false;
const removals: string[] = [];
const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
function matches(row: any, u: URL) {
  for (const [k, v] of u.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k))
      continue;
    const [op, ...parts] = v.split(".");
    const val = parts.join(".");
    if (op === "eq" && String(row[k]) !== val) return false;
    if (op === "neq" && String(row[k]) === val) return false;
    if (op === "is" && val === "null" && row[k] != null) return false;
    if (op === "gt" && !(String(row[k]) > val)) return false;
  }
  return true;
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init: any = {}) => {
  const u = new URL(
      typeof input === "string" ? input : input.url || input.toString(),
    ),
    h = new Headers(init.headers),
    method = init.method || "GET";
  if (u.hostname === "oauth2.googleapis.com") {
    const form = new URLSearchParams(init.body);
    if (u.pathname === "/revoke") return json({});
    if (form.get("grant_type") === "authorization_code") {
      assert.ok(form.get("code_verifier"));
      return json({
        access_token: "access-from-code",
        refresh_token: "refresh-secret-fixture",
        scope: "https://www.googleapis.com/auth/drive",
        expires_in: 3600,
      });
    }
    refreshes++;
    return invalidGrant
      ? json({ error: "invalid_grant" }, 400)
      : json({ access_token: "access-refreshed-fixture", expires_in: 3600 });
  }
  if (u.pathname.startsWith("/upload/drive/")) {
    if (method === "POST") {
      assert.equal(h.get("Origin"), "https://orbit.example");
      const meta = JSON.parse(init.body);
      files.set(meta.id, {
        ...meta,
        size: "0",
        trashed: false,
        _complete: false,
      });
      const url =
        "https://www.googleapis.com/upload/drive/v3/session_" + meta.id;
      sessions.set(url, {
        id: meta.id,
        offset: 0,
        size: Number(h.get("X-Upload-Content-Length")),
        bytes: Buffer.alloc(0),
      });
      return json({}, 200, { Location: url });
    }
    const session = sessions.get(u.toString());
    assert.ok(session);
    const content = h.get("Content-Range") || "";
    if (content.startsWith("bytes */"))
      return session.offset === session.size
        ? json({ id: session.id })
        : new Response(null, {
            status: 308,
            headers: session.offset
              ? { Range: `bytes=0-${session.offset - 1}` }
              : {},
          });
    const body = Buffer.from(await new Response(init.body).arrayBuffer());
    if (interrupt) {
      interrupt = false;
      const part = body.subarray(0, Math.max(1, Math.floor(body.length / 2)));
      session.bytes = Buffer.concat([session.bytes, part]);
      session.offset += part.length;
      return new Response(null, {
        status: 308,
        headers: { Range: `bytes=0-${session.offset - 1}` },
      });
    }
    session.bytes = Buffer.concat([session.bytes, body]);
    session.offset += body.length;
    assert.equal(session.offset, session.size);
    Object.assign(files.get(session.id), {
      size: String(session.size),
      _complete: true,
    });
    return json({ id: session.id, size: String(session.size) });
  }
  if (u.hostname === "www.googleapis.com") {
    assert.match(h.get("Authorization") || "", /^Bearer /);
    if (quota) {
      quota = false;
      return json(
        { error: { errors: [{ reason: "storageQuotaExceeded" }] } },
        403,
      );
    }
    if (rateOnce) {
      rateOnce = false;
      return json({ error: "rate limited" }, 429);
    }
    if (u.pathname.endsWith("/about"))
      return json({
        user: { emailAddress: "owner@example.com" },
        storageQuota: { limit: "15000000000", usage: "1000" },
      });
    if (u.pathname.endsWith("/generateIds"))
      return json({
        ids: ["drive_file_" + String(++counter).padStart(8, "0")],
      });
    if (u.pathname.endsWith("/files") && method === "POST") {
      const meta = JSON.parse(init.body);
      const f = {
        id: folder,
        ...meta,
        capabilities: { canAddChildren: true },
        trashed: false,
        _complete: true,
      };
      files.set(f.id, f);
      return json(f);
    }
    if (u.pathname.endsWith("/files"))
      return json({
        files: [...files.values()].filter(
          (f) =>
            f._complete && !f.trashed && (f.parents || []).includes(folder),
        ),
      });
    const fileId = u.pathname.split("/").at(-1)!;
    const f = files.get(fileId);
    if (!f || !f._complete)
      return json({ error: { message: "not found" } }, 404);
    if (method === "PATCH") {
      Object.assign(f, JSON.parse(init.body));
      return json(f);
    }
    if (method === "DELETE") {
      files.delete(fileId);
      return new Response(null, { status: 204 });
    }
    if (u.searchParams.get("alt") === "media") {
      const body = Buffer.from("PDF12345");
      const range = h.get("Range");
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/)!;
        const start = Number(match[1]),
          end = match[2] ? Number(match[2]) : body.length - 1;
        return new Response(body.subarray(start, end + 1), {
          status: 206,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Range": `bytes ${start}-${end}/${body.length}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
      return new Response(body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(body.length),
        },
      });
    }
    return json(f);
  }
  if (u.hostname === "storage.fixture.test") {
    if (u.pathname.includes("/rpc/claim_vault_migration")) {
      for (const d of tables.documents.filter(
        (d) =>
          d.storage_provider === "supabase" && d.deletion_state === "active",
      ))
        if (!tables.storage_migrations.some((j) => j.document_id === d.id))
          tables.storage_migrations.push({
            document_id: d.id,
            source_path: d.path,
            status: "queued",
          });
      const job = tables.storage_migrations.find(
        (j) => j.status !== "done" && !j.lease_until,
      );
      if (job) job.lease_until = new Date(Date.now() + 300000).toISOString();
      return json(job ? [{ ...job }] : []);
    }
    if (u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.split("/").at(-1)!;
      const rows = tables[table];
      assert.ok(rows, "unexpected table " + table);
      let selected = rows.filter((r) => matches(r, u));
      if (method === "POST") {
        const b = JSON.parse(init.body);
        const key =
          table === "app_settings"
            ? "key"
            : table === "storage_connections"
              ? "provider"
              : table === "storage_oauth_states"
                ? "state_hash"
                : table === "storage_migrations"
                  ? "document_id"
                  : "id";
        const existing = rows.find((r) => r[key] === b[key]);
        if (existing && h.get("Prefer")?.includes("merge-duplicates"))
          Object.assign(existing, b);
        else
          rows.push({
            ...b,
            ...(table === "vault_uploads"
              ? { expires_at: new Date(Date.now() + 604800000).toISOString() }
              : {}),
            ...(table === "storage_sync_reports"
              ? { expires_at: new Date(Date.now() + 3600000).toISOString() }
              : {}),
            ...(table === "documents" ? { deletion_state: "active" } : {}),
          });
        selected = [existing || rows.at(-1)];
      }
      if (method === "PATCH") {
        const value = JSON.parse(init.body);
        selected.forEach((r) => Object.assign(r, value));
      }
      if (method === "DELETE")
        tables[table] = rows.filter((r) => !selected.includes(r));
      const headers = {
        "Content-Range": `0-${Math.max(0, selected.length - 1)}/${selected.length}`,
      };
      if (method === "HEAD") return json(null, 200, headers);
      if (h.get("Accept")?.includes("object"))
        return selected.length === 1
          ? json(selected[0], 200, headers)
          : json({ code: "PGRST116", message: "not found" }, 406);
      return json(selected, 200, headers);
    }
    if (u.pathname.includes("/object/upload/sign/"))
      return json({
        url: u.pathname.replace("/storage/v1", "") + "?token=upload-fixture",
      });
    if (u.pathname.includes("/object/sign/") && method === "POST")
      return json({
        signedURL:
          u.pathname.replace("/storage/v1", "") + "?token=download-fixture",
      });
    if (u.pathname === "/storage/v1/object/vault" && method === "DELETE") {
      const b = JSON.parse(init.body);
      if (failDelete) {
        failDelete = false;
        return json(
          { statusCode: "500", message: "fixture delete failure" },
          500,
        );
      }
      for (const path of b.prefixes) {
        const d = tables.documents.find((d) => d.path === path);
        if (d)
          assert.equal(
            d.storage_provider,
            "gdrive",
            "source removed before metadata switch",
          );
        removals.push(path);
        sources.delete(path);
      }
      return json([]);
    }
    if (u.pathname.includes("/object/sign/vault/")) {
      const path = decodeURIComponent(
        u.pathname.split("/object/sign/vault/")[1],
      );
      const body = sources.get(path);
      if (!body) return new Response(null, { status: 404 });
      const headers = {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.length),
      };
      if (method === "HEAD") return new Response(null, { headers });
      const range = h.get("Range");
      if (range) {
        const offset = Number(range.match(/bytes=(\d+)/)?.[1]);
        return new Response(body.subarray(offset), {
          status: 206,
          headers: {
            ...headers,
            "Content-Length": String(body.length - offset),
            "Content-Range": `bytes ${offset}-${body.length - 1}/${body.length}`,
          },
        });
      }
      return new Response(body, { headers });
    }
  }
  throw new Error("Unexpected fixture request " + u.origin + u.pathname);
};
(async () => {
  try {
    const encrypted = seal("refresh-secret");
    assert.equal(unseal(encrypted), "refresh-secret");
    assert.ok(!JSON.stringify(encrypted).includes("refresh-secret"));
    assert.throws(() =>
      unseal({ ...encrypted, tag: Buffer.alloc(16).toString("base64") }),
    );
    assert.throws(() => unseal(encrypted, "wrong-aad"));
    for (const value of [
      folder,
      `https://drive.google.com/drive/folders/${folder}?usp=sharing`,
      `https://drive.google.com/open?id=${folder}`,
    ])
      assert.equal(folderId(value), folder);
    assert.equal(folderId(""), null);
    assert.throws(() => folderId("https://evil.example/?id=" + folder));
    assert.throws(() => mimeFor("bad.exe", "application/pdf"));
    const session = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    const started = await oauthStart(session, "https://orbit.example");
    const auth = new URL(started.url);
    assert.equal(auth.searchParams.get("access_type"), "offline");
    assert.equal(auth.searchParams.get("prompt"), "consent");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      auth.searchParams.get("scope"),
      "https://www.googleapis.com/auth/drive",
    );
    await assert.rejects(() => consumeOAuthState(started.cookie, "bad-state"));
    const verifier = await consumeOAuthState(
      started.cookie,
      auth.searchParams.get("state")!,
    );
    await assert.rejects(() =>
      consumeOAuthState(started.cookie, auth.searchParams.get("state")!),
    );
    await finishOAuth("code-fixture", verifier);
    assert.equal(
      tables.storage_connections[0].account_email,
      "owner@example.com",
    );
    assert.ok(
      !JSON.stringify(tables.storage_connections).includes(
        "refresh-secret-fixture",
      ),
    );
    files.set(folder, {
      id: folder,
      name: "ORBIT Vault",
      mimeType: "application/vnd.google-apps.folder",
      capabilities: { canAddChildren: true },
      trashed: false,
      _complete: true,
    });
    Object.assign(tables.storage_connections[0], {
      folder_id: folder,
      folder_name: "ORBIT Vault",
    });
    await Promise.all([accessToken(), accessToken()]);
    assert.equal(refreshes, 1);
    rateOnce = true;
    await driveRequest("about?fields=user");
    quota = true;
    await assert.rejects(
      () => driveRequest("about"),
      (e: any) => e instanceof DriveError && e.code === "QUOTA",
    );
    // Large Drive upload verifies only metadata on the server; no file buffer crosses the API.
    const ticket = await prepareUpload(
      {
        name: "large.pdf",
        type: "application/pdf",
        size: 55 * 1024 * 1024,
        category_id: cat,
      },
      "https://orbit.example",
    );
    assert.equal(ticket.provider, "gdrive");
    const file = files.get(tables.vault_uploads[0].drive_file_id);
    Object.assign(file, { _complete: true, size: String(54 * 1024 * 1024) });
    await assert.rejects(() => finishUpload(ticket.id));
    Object.assign(file, { size: String(55 * 1024 * 1024) });
    const parent = file.parents;
    file.parents = ["wrong-folder"];
    await assert.rejects(() => finishUpload(ticket.id));
    file.parents = parent;
    const finished = await finishUpload(ticket.id);
    assert.equal((await finishUpload(ticket.id)).id, finished.id);
    assert.equal((await resumeUpload(ticket.id)).id, ticket.id);
    assert.equal(tables.documents.length, 1);
    const doc = tables.documents[0] as VaultDocument;
    const response = await documentResponse(
      doc,
      new Request("https://orbit.example/api/files?preview=1", {
        headers: { Range: "bytes=1-3" },
      }),
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 1-3/8");
    assert.equal(await response.text(), "DF1");
    assert.match(response.headers.get("Content-Disposition")!, /inline/);
    await removeDocumentFile(doc);
    assert.equal(file.trashed, true);
    const unknown = "unknown_fixture_0000";
    files.set(unknown, {
      id: unknown,
      name: "unknown.pdf",
      mimeType: "application/pdf",
      size: "10",
      parents: [folder],
      _complete: true,
      trashed: false,
    });
    const orphan = id(88);
    tables.documents.push({
      id: orphan,
      title: "orphan.pdf",
      path: "gdrive/orphan.pdf",
      storage_provider: "gdrive",
      drive_file_id: "missing_fixture_0000",
      size: 10,
      deletion_state: "active",
    });
    const report = await scanStorage();
    assert.ok(report.missing.some((d) => d.document_id === orphan));
    assert.ok(report.untracked.some((f) => f.file_id === unknown));
    assert.equal(files.get(unknown).trashed, false);
    await assert.rejects(() => applySync(report.id, [], ["not-in-report"]));
    const applied = await applySync(report.id, [orphan], [unknown]);
    assert.equal(applied.removed, 1);
    assert.equal(applied.trashed, 1);
    assert.equal(files.get(unknown).trashed, true);
    await testDrive("https://orbit.example");
    assert.equal(
      [...files.values()].filter((f) => f.name === ".orbit-connection-test.txt")
        .length,
      0,
    );
    // Interrupted migration resumes after acknowledged bytes, then cleanup retries safely.
    tables.documents = [];
    tables.storage_migrations = [];
    tables.vault_uploads = [];
    const sourcePath = "legacy/source.pdf",
      sourceBytes = Buffer.from("migration-pdf-content");
    sources.set(sourcePath, sourceBytes);
    const legacy = {
      id: id(99),
      title: "source.pdf",
      path: sourcePath,
      size: sourceBytes.length,
      category_id: cat,
      storage_provider: "supabase",
      deletion_state: "active",
    };
    tables.documents.push(legacy);
    interrupt = true;
    await assert.rejects(() => migrateOne("https://orbit.example"));
    assert.equal(legacy.storage_provider, "supabase");
    assert.ok(sources.has(sourcePath));
    failDelete = true;
    await assert.rejects(() => migrateOne("https://orbit.example"));
    assert.equal(legacy.storage_provider, "gdrive");
    assert.ok(sources.has(sourcePath));
    assert.equal(tables.storage_migrations[0].status, "cleanup");
    const migrated = await migrateOne("https://orbit.example");
    assert.equal(migrated.completed, 1);
    assert.equal(migrated.remaining, 0);
    assert.equal(sources.has(sourcePath), false);
    assert.equal(removals.length, 1);
    const sessionData = [...sessions.values()].find(
      (s) => s.id === tables.storage_migrations[0].drive_file_id,
    )!;
    assert.deepEqual(sessionData.bytes, sourceBytes);
    // Deleting a migrated document also completes a pending source cleanup first.
    tables.storage_migrations[0].status = "cleanup";
    sources.set(sourcePath, sourceBytes);
    await removeDocumentFile(legacy as unknown as VaultDocument);
    assert.equal(sources.has(sourcePath), false);
    assert.equal(tables.storage_migrations[0].status, "done");
    assert.equal(
      files.get(tables.storage_migrations[0].drive_file_id).trashed,
      true,
    );
    // Supabase remains available when selected explicitly and retains legacy file access.
    tables.app_settings[0].value.default_provider = "supabase";
    const supa = await prepareUpload(
      { name: "small.pdf", type: "application/pdf", size: 8, category_id: cat },
      "https://orbit.example",
    );
    assert.equal(supa.provider, "supabase");
    sources.set(supa.path, Buffer.from("PDF12345"));
    const small = await finishUpload(supa.id);
    assert.ok(small.id);
    assert.equal(
      tables.documents.find((d) => d.id === small.id)?.storage_provider,
      "supabase",
    );
    const saved = tables.storage_connections[0];
    clearAccessTokens();
    invalidGrant = true;
    await assert.rejects(() => accessToken(saved), /Hubungkan ulang/);
    assert.equal(tables.storage_connections[0].status, "reconnect");
    invalidGrant = false;
    const filesBeforeDisconnect = files.size;
    await disconnectDrive();
    assert.equal(tables.storage_connections.length, 0);
    assert.equal(files.size, filesBeforeDisconnect);
    console.log(
      "PASS: AES-GCM tamper/context protection; folder URLs; OAuth offline/PKCE/state one-use; encrypted refresh tokens and in-memory single-flight refresh; backoff/quota/invalid_grant; large upload metadata/folder verification and idempotence; private Range streaming; hybrid providers; trash deletion; approval-only sync; resumable migration with verified copy and retryable source cleanup; revocation without file deletion.",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
