const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const base = process.env.TEST_BASE_URL || "http://localhost:3800";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const data = {
  categories: [
    {
      id: uid(1),
      name: "Modul",
      kind: "document",
      icon: "Book",
      color: "#999999",
    },
  ],
  documents: [],
  projects: [],
  transactions: [],
  accounts: [],
  transfers: [],
  budgets: [],
  savings_goals: [],
  recurring_rules: [],
  mwbs: [],
  subtasks: [],
  focus_sessions: [],
  app_settings: [],
  activity_log: [],
};
const status = {
  configured: true,
  config: { default_provider: "gdrive", max_upload_mb: 100 },
  connection: {
    email: "owner@example.com",
    folder_id: "folder_fixture_12345",
    folder_name: "ORBIT Vault",
    status: "connected",
    connected_at: new Date().toISOString(),
    last_synced_at: null,
  },
  quota: { limit: "15000000000", used: "1000", remaining: "14999999000" },
  migration: { remaining: 2, completed: 0, cleanup: 0 },
};
let offset = 0,
  total = 55 * 1024 * 1024,
  chunkCount = 0,
  finishes = 0,
  applies = 0,
  migrations = 0;
const ticket = {
  id: uid(9),
  provider: "gdrive",
  path: "gdrive/large.pdf",
  size: total,
  name: "large.pdf",
  mime_type: "application/pdf",
  uploadUrl: "https://www.googleapis.com/upload/drive/v3/fixture-session",
};
const uploadServer = require("node:http").createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": base,
    "Access-Control-Allow-Methods": "PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Content-Range",
    "Access-Control-Expose-Headers": "Range",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  try {
    const range = req.headers["content-range"];
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    if (range.startsWith("bytes */")) {
      res.writeHead(offset === total ? 200 : 308, {
        ...headers,
        ...(offset ? { Range: `bytes=0-${offset - 1}` } : {}),
      });
      res.end();
      return;
    }
    const m = range.match(/bytes (\d+)-(\d+)\/(\d+)/);
    assert.ok(m);
    assert.equal(Number(m[1]), offset);
    const length = Number(m[2]) - Number(m[1]) + 1;
    assert.equal(Buffer.concat(buffers).length, length);
    assert.ok(length <= 8 * 1024 * 1024);
    if (Number(m[2]) + 1 < total) assert.equal(length % (256 * 1024), 0);
    offset += length;
    chunkCount++;
    await new Promise((r) => setTimeout(r, chunkCount === 1 ? 1800 : 300));
    res.writeHead(offset === total ? 200 : 308, {
      ...headers,
      Range: `bytes=0-${offset - 1}`,
    });
    res.end();
  } catch (e) {
    if (!req.destroyed) {
      res.writeHead(500, headers);
      res.end();
    }
  }
});
(async () => {
  await new Promise((r) => uploadServer.listen(0, "127.0.0.1", r));
  ticket.uploadUrl = `http://127.0.0.1:${uploadServer.address().port}/drive-upload`;
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/data", (r) => r.fulfill({ json: data }));
    await page.route("**/api/personalize", (r) =>
      r.fulfill({ json: { presets: [], rows: [] } }),
    );
    await page.route("**/api/personalize/login", (r) =>
      r.fulfill({ json: { rows: [] } }),
    );
    await page.route("**/api/storage", async (r) => {
      if (r.request().method() === "GET") return r.fulfill({ json: status });
      const b = r.request().postDataJSON();
      if (b.action === "folder") status.connection.folder_id = b.folder;
      if (b.action === "config") status.config = b.config;
      if (b.action === "test")
        return r.fulfill({
          json: { ok: true, message: "Unggah dan hapus file uji berhasil." },
        });
      if (b.action === "migrate") {
        migrations++;
        await new Promise((r) => setTimeout(r, 250));
        status.migration = {
          remaining: Math.max(0, 2 - migrations),
          completed: migrations,
          cleanup: 0,
        };
        return r.fulfill({ json: { ...status.migration, idle: false } });
      }
      if (b.action === "scan")
        return r.fulfill({
          json: {
            id: uid(20),
            missing: [{ document_id: uid(30), name: "Hilang.pdf" }],
            untracked: [
              {
                file_id: "untracked_fixture_1",
                name: "Tanpa metadata.pdf",
                size: "8",
              },
            ],
          },
        });
      if (b.action === "apply_sync") {
        applies++;
        assert.deepEqual(b.missing, [uid(30)]);
        assert.deepEqual(b.untracked, ["untracked_fixture_1"]);
        return r.fulfill({ json: { removed: 1, trashed: 1 } });
      }
      if (b.action === "disconnect") {
        status.connection = null;
        status.config.default_provider = "supabase";
      }
      if (b.action === "connect")
        return r.fulfill({
          json: {
            url: "https://accounts.google.com/o/oauth2/v2/auth?fixture=true",
          },
        });
      return r.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/files", async (r) => {
      assert.ok(
        (r.request().postData() || "").length < 4096,
        "File contents crossed application API",
      );
      const b = r.request().postDataJSON();
      if (b.action === "prepare_upload") {
        assert.equal(b.size, total);
        return r.fulfill({ json: ticket });
      }
      if (b.action === "resume_upload") return r.fulfill({ json: ticket });
      if (b.action === "finish_upload") {
        assert.equal(offset, total);
        finishes++;
        data.documents.push({
          id: uid(10),
          title: "large.pdf",
          category_id: uid(1),
          path: ticket.path,
          size: total,
          storage_provider: "gdrive",
          deletion_state: "active",
          created_at: new Date().toISOString(),
        });
        return r.fulfill({ json: { ok: true, id: uid(10) } });
      }
      throw new Error("Unknown upload action");
    });
    await page.goto(base);
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("admin");
    await page.getByRole("button", { name: "Masuk ke workspace" }).click();
    await page
      .getByRole("button", { name: "Arsip Dokumen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Upload dokumen", exact: true })
      .click();
    await page.getByLabel("Kategori", { exact: true }).selectOption(uid(1));
    async function pickFile() {
      await page.locator("input[type=file]").evaluate((input, size) => {
        const file = new File([new Uint8Array(size)], "large.pdf", {
          type: "application/pdf",
          lastModified: 1700000000000,
        });
        const d = new DataTransfer();
        d.items.add(file);
        input.files = d.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, total);
    }
    await pickFile();
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector(".vault-upload-progress progress")?.value,
        ) > 0,
    );
    await page
      .getByRole("button", { name: "Jeda", exact: true })
      .click({ force: true });
    await page.getByText(/Unggahan dijeda/).waitFor();
    assert.ok(offset < total);
    await page.getByRole("button", { name: "Tutup", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Arsip Dokumen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Upload dokumen", exact: true })
      .click();
    await page.getByText(/Sesi tersimpan: large.pdf/).waitFor();
    await pickFile();
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Upload dokumen" })
      .waitFor({ state: "hidden" });
    await page
      .getByRole("heading", { name: "large.pdf", exact: true })
      .waitFor();
    assert.equal(finishes, 1);
    assert.equal(chunkCount, 7);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("orbit-vault-upload-v1")),
      null,
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByText("owner@example.com", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Uji koneksi", exact: true })
      .click();
    await page
      .getByText("Unggah dan hapus file uji berhasil.", { exact: true })
      .waitFor();
    await page
      .getByLabel("Link folder Google Drive", { exact: true })
      .fill("folder_fixture_67890");
    await page
      .getByRole("button", { name: "Simpan folder", exact: true })
      .click();
    await page.getByText("Folder tersimpan.", { exact: true }).waitFor();
    await page
      .getByRole("button", {
        name: "Pindahkan file lama ke Google Drive",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Hentikan setelah batch", exact: true })
      .click();
    await page.getByText(/Migrasi dijeda setelah batch/).waitFor();
    assert.equal(migrations, 1);
    await page
      .getByRole("button", { name: "Lanjutkan migrasi", exact: true })
      .click();
    await page.getByText("Migrasi selesai.", { exact: true }).waitFor();
    assert.equal(migrations, 2);
    await page.getByRole("button", { name: "Sinkronkan", exact: true }).click();
    await page
      .getByRole("heading", { name: "Laporan sinkronisasi", exact: true })
      .waitFor();
    assert.equal(applies, 0);
    assert.ok(
      await page
        .getByRole("button", { name: "Setujui tindakan terpilih", exact: true })
        .isDisabled(),
    );
    await page
      .getByLabel("Lepas metadata: Hilang.pdf", { exact: true })
      .check();
    await page
      .getByLabel("Pindahkan ke sampah Drive: Tanpa metadata.pdf", {
        exact: true,
      })
      .check();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Setujui tindakan terpilih", exact: true })
      .click();
    await page
      .getByText("1 metadata dilepas, 1 file dipindahkan ke sampah.", {
        exact: true,
      })
      .waitFor();
    assert.equal(applies, 1);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.locator(".storage-help summary").click();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.locator(".storage-help summary").click();
    }
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Putuskan koneksi", exact: true })
      .click();
    await page
      .getByText("Koneksi diputuskan. File tetap tersimpan.", { exact: true })
      .waitFor();
    assert.equal(data.documents.length, 1);
    await page.route("https://accounts.google.com/**", (r) =>
      r.fulfill({ body: "OAuth fixture", contentType: "text/html" }),
    );
    await page
      .getByRole("button", { name: "Hubungkan Google Drive", exact: true })
      .click();
    await page.waitForURL("https://accounts.google.com/**");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: 55 MiB direct cross-origin upload in 8 MiB chunks, pause/reload/reselect/resume, small API payloads, finalization, folder/test controls, stoppable migration, approval-only sync, mobile Settings, disconnect preserves files, connect redirect. Controlled fixtures.",
    );
  } finally {
    await browser.close();
    uploadServer.closeAllConnections();
    await new Promise((r) => uploadServer.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  uploadServer.closeAllConnections();
  uploadServer.close();
});
