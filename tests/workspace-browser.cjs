const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const base = process.env.TEST_BASE_URL || "http://localhost:3300";
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Jakarta",
});
const pixels = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXu0AAAAASUVORK5CYII=",
  "base64",
);
const data = {
  categories: [
    {
      id: u(10),
      name: "Gaji",
      kind: "income",
      color: "#fafafa",
      icon: "Wallet",
    },
    {
      id: u(11),
      name: "Makanan",
      kind: "expense",
      color: "#a1a1aa",
      icon: "Coffee",
    },
    {
      id: u(12),
      name: "Berjalan",
      kind: "status",
      color: "#a1a1aa",
      icon: "Briefcase",
    },
    {
      id: u(13),
      name: "Selesai",
      kind: "status",
      color: "#a1a1aa",
      icon: "Star",
    },
    {
      id: u(14),
      name: "Sertifikasi",
      kind: "document",
      color: "#a1a1aa",
      icon: "Book",
    },
  ],
  accounts: [
    { id: u(1), name: "Kas", kind: "cash", opening_balance: 1000000 },
    { id: u(2), name: "Bank", kind: "bank", opening_balance: 500000 },
  ],
  transactions: Array.from({ length: 17 }, (_, i) => ({
    id: u(100 + i),
    title: i ? "Makan " + i : "Gaji bulanan",
    amount: i ? 50000 : 5000000,
    category_id: i ? u(11) : u(10),
    account_id: i ? u(1) : u(2),
    date,
  })),
  projects: [
    {
      id: u(30),
      title: "Portfolio",
      status_id: u(12),
      progress: 60,
      deadline: date,
      is_mwb: true,
    },
  ],
  documents: [
    {
      id: u(40),
      title: "Sertifikat.pdf",
      category_id: u(14),
      path: "certificate.pdf",
      size: 1024,
      tags: ["Karier"],
      expires_on: date,
      created_at: new Date().toISOString(),
      deletion_state: "active",
    },
  ],
  transfers: [],
  budgets: [],
  savings_goals: [],
  recurring_rules: [],
  mwbs: [
    {
      id: u(50),
      project_id: u(30),
      title: "Riset portfolio",
      deadline: date,
      done: false,
    },
  ],
  subtasks: [
    { id: u(51), mwb_id: u(50), title: "Kumpulkan referensi", done: false },
  ],
  focus_sessions: [],
  app_settings: [
    { key: "widgets", value: ["summary", "cashflow", "deadlines", "journal"] },
    { key: "mode", value: "dark" },
  ],
  activity_log: [],
};
let presets = [],
  rows = [],
  counter = 1000;
const requests = [];
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      timezoneId: "Asia/Jakarta",
    });
    const page = await context.newPage();
    const errors = [];
    const studyRequests = [];
    page.on("request", (request) => {
      if (/\/api\/study(?:[?\/]|$)|\/pdfjs\//.test(request.url()))
        studyRequests.push(request.url());
    });
    let failDateOnce = false;
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/fixture-*", (route) =>
      route.fulfill({ body: pixels, contentType: "image/png" }),
    );
    await page.route("**/api/data", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: data });
      const b = route.request().postDataJSON();
      requests.push(b);
      if (b.table === "subtasks" && failDateOnce) {
        failDateOnce = false;
        return route.fulfill({
          status: 400,
          json: {
            error:
              "Tanggal subtask belum tersedia. Jalankan migrasi 202610290002_subtask_deadlines.sql di Supabase SQL Editor.",
          },
        });
      }
      if (b.action === "create")
        data[b.table].push({ id: u(++counter), ...b.data });
      if (b.action === "update")
        Object.assign(
          data[b.table].find((r) => r.id === b.id),
          b.data,
        );
      if (b.action === "delete")
        data[b.table] = data[b.table].filter((r) => r.id !== b.id);
      await route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/actions", async (route) => {
      const b = route.request().postDataJSON();
      requests.push(b);
      if (b.action === "setting") {
        let r = data.app_settings.find((s) => s.key === b.key);
        if (!r) {
          r = { key: b.key };
          data.app_settings.push(r);
        }
        r.value = b.value;
      }
      if (b.action === "stop_focus") {
        const s = data.focus_sessions.find((s) => s.id === b.id);
        s.ended_at = new Date().toISOString();
        s.seconds = 1;
      }
      await route.fulfill({
        json: { ok: true, result: { inserted: 1, skipped: 0 } },
      });
    });
    await page.route("**/api/personalize", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { presets, rows } });
      const b = route.request().postDataJSON();
      requests.push(b);
      if (b.action === "prepare_upload")
        return route.fulfill({
          json: {
            path: "staging/" + u(++counter) + ".png",
            uploadUrl: base + "/fixture-upload",
          },
        });
      if (b.action === "finish_upload")
        return route.fulfill({
          json: {
            path: u(++counter) + ".webp",
            url: base + "/fixture-image?id=" + counter,
          },
        });
      if (b.action === "save") {
        const id = b.id || u(++counter);
        const old = presets.find((p) => p.id === id);
        presets = presets.filter((p) => p.id !== id);
        presets.push({
          id,
          name: b.name,
          is_active: b.activate || old?.is_active || false,
        });
        rows = rows.filter((r) => r.preset !== id);
        for (const [slot, v] of Object.entries(b.theme))
          v.images.forEach((im, i) =>
            rows.push({
              ...v,
              preset: id,
              slot,
              sort_order: i,
              path: im.path,
              url: im.url,
              is_active: b.activate || old?.is_active || false,
            }),
          );
        if (b.activate) {
          presets.forEach((p) => (p.is_active = p.id === id));
          rows.forEach((r) => (r.is_active = r.preset === id));
        }
        return route.fulfill({ json: { id } });
      }
      if (b.action === "reset") {
        presets.forEach((p) => (p.is_active = false));
        rows.forEach((r) => (r.is_active = false));
      }
      return route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/personalize/login", (route) =>
      route.fulfill({
        json: { rows: rows.filter((r) => r.is_active && r.slot === "login") },
      }),
    );
    await page.goto(base);
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("admin");
    await page.getByRole("button", { name: "Masuk ke workspace" }).click();
    await page
      .getByRole("heading", { name: "Jurnal Keuangan", exact: true })
      .waitFor();
    await page.getByText("Gaji bulanan", { exact: true }).waitFor();
    assert.equal(await page.locator("table tbody tr").count(), 15);
    await page.getByRole("button", { name: "Berikutnya", exact: true }).click();
    assert.equal(await page.locator("table tbody tr").count(), 2);
    await page.getByLabel("Cari transaksi dan kategori").fill("gaji");
    assert.equal(await page.locator("table tbody tr").count(), 1);
    await page.getByLabel("Cari transaksi dan kategori").fill("");
    await page.getByLabel("Periode grafik").selectOption("30");
    assert.equal(await page.locator(".cash-chart .chart-col").count(), 30);
    await page.getByLabel("Periode grafik").selectOption("12");
    assert.equal(await page.locator(".cash-chart .chart-col").count(), 12);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Excel", exact: true }).click();
    assert.equal((await dl).suggestedFilename(), "orbit-transaksi.xlsx");
    await page
      .getByRole("button", { name: "Akun & transfer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Transfer antar akun", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Nama", { exact: true })
      .fill("Pindah dana");
    await page.getByLabel("Dari akun", { exact: true }).selectOption(u(2));
    await page.getByLabel("Ke akun", { exact: true }).selectOption(u(1));
    await page.getByLabel("Jumlah (Rp)", { exact: true }).fill("200000");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(data.transfers.length, 1);

    await page.getByRole("button", { name: "Anggaran", exact: true }).click();
    await page.getByRole("button", { name: "Tambah", exact: true }).click();
    await page.getByLabel("Kategori", { exact: true }).selectOption(u(11));
    await page.getByLabel("Jumlah (Rp)", { exact: true }).fill("1000000");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(data.budgets.length, 1);
    await page
      .getByRole("button", { name: "Target tabungan", exact: true })
      .click();
    await page.getByRole("button", { name: "Tambah", exact: true }).click();
    await page.getByLabel("Nama", { exact: true }).fill("Dana darurat");
    await page.getByLabel("Target (Rp)", { exact: true }).fill("10000000");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(data.savings_goals.length, 1);
    await page
      .getByRole("button", { name: "Transaksi berulang", exact: true })
      .click();
    await page.getByRole("button", { name: "Tambah", exact: true }).click();
    await page.getByLabel("Nama", { exact: true }).fill("Langganan");
    await page.getByLabel("Jumlah (Rp)", { exact: true }).fill("50000");
    await page.getByLabel("Kategori", { exact: true }).selectOption(u(11));
    await page.getByLabel("Akun", { exact: true }).selectOption(u(1));
    await page.getByLabel("Frekuensi", { exact: true }).selectOption("monthly");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(data.recurring_rules.length, 1);
    await page.getByRole("button", { name: "Impor CSV", exact: true }).click();
    await page.getByLabel("File CSV", { exact: true }).setInputFiles({
      name: "bank.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "tanggal,deskripsi,jumlah\n" +
          date +
          ",Transaksi impor,150000\n" +
          date +
          ",Transaksi impor,150000",
      ),
    });
    await page.getByLabel("Kolom title").selectOption("deskripsi");
    await page.getByLabel("Kolom date").selectOption("tanggal");
    await page.getByLabel("Kolom amount").selectOption("jumlah");
    await page.getByLabel("Akun impor").selectOption(u(1));
    await page.getByLabel("Kategori impor").selectOption(u(11));
    assert.equal(
      await page.getByText("Duplikat · dilewati", { exact: true }).count(),
      1,
    );
    await page
      .getByRole("button", { name: "Konfirmasi impor", exact: true })
      .click();
    await page
      .getByText("1 dimasukkan, 0 duplikat dilewati", { exact: true })
      .waitFor();
    assert.equal(requests.find((r) => r.action === "import").rows.length, 1);
    await page
      .getByRole("button", { name: "Project & MWBs", exact: true })
      .click();
    // Stacks and MWB cards start collapsed, with keyboard-accessible disclosure controls.
    assert.equal(await page.locator("tr[data-work-key]").count(), 1);
    assert.equal(await page.locator(".mwb-card[open]").count(), 0);
    await page
      .getByRole("button", { name: "Buka rincian Portfolio", exact: true })
      .click();
    assert.equal(await page.locator("tr[data-work-key]").count(), 2);
    await page
      .getByRole("button", {
        name: "Buka rincian Riset portfolio",
        exact: true,
      })
      .click();
    assert.equal(await page.locator("tr[data-work-key]").count(), 3);
    await page
      .getByRole("button", { name: "Tutup rincian Portfolio", exact: true })
      .click();
    assert.equal(await page.locator("tr[data-work-key]").count(), 1);
    await page.getByRole("button", { name: "Buka semua", exact: true }).click();
    assert.equal(await page.locator("tr[data-work-key]").count(), 3);
    await page
      .getByRole("button", { name: "Tutup semua", exact: true })
      .click();
    assert.equal(await page.locator("tr[data-work-key]").count(), 1);
    await page.getByRole("button", { name: "Buka semua", exact: true }).click();
    await page
      .locator('summary[aria-label="Rincian MWB Riset portfolio"]')
      .focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".mwb-card[open]").count(), 1);
    // Inline MWB dates and date-write failures give feedback beside the affected field.
    await page
      .getByRole("button", { name: "Tanggal MWB Riset portfolio", exact: true })
      .click();
    await page.locator(`.date-popover [data-date="${date}"]`).click();
    await page
      .locator(".mwb-card-body > [role=status]")
      .filter({ hasText: "Tersimpan" })
      .waitFor();
    assert.equal(data.mwbs[0].deadline, date);
    failDateOnce = true;
    await page
      .getByRole("button", {
        name: "Tanggal subtask Kumpulkan referensi",
        exact: true,
      })
      .click();
    await page.locator(`.date-popover [data-date="${date}"]`).click();
    await page
      .locator(".mwb-subtask [role=alert]")
      .filter({ hasText: "202610290002" })
      .waitFor();
    assert.equal(data.subtasks[0].deadline, undefined);
    await page
      .getByRole("button", {
        name: "Tanggal subtask Kumpulkan referensi",
        exact: true,
      })
      .click();
    await page.locator(`.date-popover [data-date="${date}"]`).click();
    await page
      .locator(".mwb-subtask [role=status]")
      .filter({ hasText: "Tersimpan" })
      .waitFor();
    assert.equal(data.subtasks[0].deadline, date);
    // A dated MWB subtask is one record shared by the card, stack table and calendar.
    await page
      .getByRole("button", { name: "Tambah subtask", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Nama", { exact: true })
      .fill("Interview FGD");
    await page
      .getByRole("button", { name: "Tanggal subtask (opsional)", exact: true })
      .click();
    await page.locator(`.date-popover [data-date="${date}"]`).click();
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const task = data.subtasks.find((t) => t.title === "Interview FGD");
    assert.equal(task.deadline, date);
    const taskKey = `subtasks:${task.id}`;
    await page.locator(`tr[data-work-key="${taskKey}"]`).waitFor();
    const stackKeys = await page
      .locator("tr[data-work-key]")
      .evaluateAll((es) => es.map((e) => e.dataset.workKey));
    assert.ok(
      stackKeys.indexOf(`projects:${u(30)}`) <
        stackKeys.indexOf(`mwbs:${u(50)}`),
    );
    assert.ok(stackKeys.indexOf(`mwbs:${u(50)}`) < stackKeys.indexOf(taskKey));
    await page.getByRole("button", { name: "Bulanan", exact: true }).click();
    await page
      .locator(`.day[data-date="${date}"] button[data-work-key="${taskKey}"]`)
      .waitFor();
    await page.getByRole("button", { name: "Harian", exact: true }).click();
    assert.equal(await page.locator(".day").count(), 1);
    await page.locator(`.day button[data-work-key="${taskKey}"]`).waitFor();
    const previous = new Date(date + "T12:00:00");
    previous.setDate(previous.getDate() - 1);
    const prevDate = previous.toLocaleDateString("en-CA");
    await page
      .getByRole("button", { name: "Periode sebelumnya", exact: true })
      .click();
    assert.equal(
      await page.locator(".day").getAttribute("data-date"),
      prevDate,
    );
    await page
      .getByText("Belum ada jadwal pada tanggal ini.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Hari ini", exact: true }).click();
    assert.equal(await page.locator(".day").getAttribute("data-date"), date);
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await page.locator(`.agenda-item[data-work-key="${taskKey}"]`).click();
    await page
      .getByRole("dialog", { name: "Edit data", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Tutup", exact: true }).click();
    await page
      .getByRole("button", { name: "Lompat ke tanggal", exact: true })
      .click();
    await page.getByLabel("Tahun kalender").selectOption("2040");
    await page.getByLabel("Bulan kalender").selectOption("0");
    await page.locator('.date-popover [data-date="2040-01-15"]').click();
    await page
      .getByText("Belum ada jadwal pada bulan ini.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Hari ini", exact: true }).click();
    await page.locator(`.agenda-item[data-work-key="${taskKey}"]`).waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ["Harian", "Agenda"]) {
        await page.getByRole("button", { name, exact: true }).click();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `Overflow ${name} ${width}`,
        );
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Mingguan", exact: true }).click();
    await page.locator(`.day button[data-work-key="${taskKey}"]`).waitFor();
    const targetDate = await page
      .locator(".day")
      .last()
      .getAttribute("data-date");
    await page
      .locator(".day")
      .last()
      .evaluate((el, key) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", key);
        el.dispatchEvent(
          new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
        );
      }, taskKey);
    await page.waitForFunction(
      ({ id, date }) =>
        document.querySelector(
          `.day[data-date="${date}"] button[data-work-key="subtasks:${id}"]`,
        ),
      { id: task.id, date: targetDate },
    );
    assert.equal(task.deadline, targetDate);
    const cardTask = page
      .locator(".mwb-subtask")
      .filter({ hasText: "Interview FGD" });
    await cardTask.getByRole("checkbox").click();
    await page.waitForFunction(
      (key) =>
        document
          .querySelector(`.day button[data-work-key="${key}"]`)
          .classList.contains("work-done"),
      taskKey,
    );
    assert.equal(task.done, true);
    assert.equal(task.deadline, targetDate);
    await page
      .getByRole("button", {
        name: "Tanggal subtask Interview FGD",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Kosongkan", exact: true }).click();
    await page
      .locator(`.day button[data-work-key="${taskKey}"]`)
      .waitFor({ state: "detached" });
    assert.equal(task.deadline, null);
    await page.getByRole("button", { name: "Tabel", exact: true }).click();
    assert.match(
      await page.locator(`tr[data-work-key="${taskKey}"]`).innerText(),
      /Belum dijadwalkan/,
    );
    await page.getByLabel("Cari proyek", { exact: true }).fill("Interview FGD");
    assert.equal(await page.locator("tr[data-work-key]").count(), 3);
    await page.getByLabel("Cari proyek", { exact: true }).fill("");
    await page.getByRole("button", { name: "Buka semua", exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await cardTask.getByRole("button", { name: "Hapus", exact: true }).click();
    await page
      .locator(`tr[data-work-key="${taskKey}"]`)
      .waitFor({ state: "detached" });
    assert.equal(
      data.subtasks.some((t) => t.id === task.id),
      false,
    );
    await page.getByRole("button", { name: "Mingguan", exact: true }).click();
    assert.equal(await page.locator(".day").count(), 7);
    await page
      .locator(".day button")
      .getByText("Portfolio", { exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Tutup", exact: true }).click();
    await page
      .getByRole("button", { name: "Mulai fokus", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Hentikan sesi", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Hentikan sesi", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mulai fokus", exact: true })
      .waitFor();
    assert.equal(data.focus_sessions.length, 1);
    await page
      .getByRole("button", { name: "Arsip Dokumen", exact: true })
      .click();
    await page.getByText("Sertifikat.pdf", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Belajar", exact: true }).count(), 0);
    assert.equal(
      await page
        .getByText(
          "Kedaluwarsa " +
            new Date(date + "T12:00:00").toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
          { exact: true },
        )
        .count(),
      1,
    );
    await page.getByRole("button", { name: "Pratinjau", exact: true }).click();
    assert.equal(await page.locator("iframe").count(), 1);
    await page.getByRole("button", { name: "Tutup", exact: true }).click();
    await page
      .getByRole("button", { name: "Personalize", exact: true })
      .click();
    await page.getByLabel("Nama preset").fill("Monokrom");
    await page.getByLabel("Tambah gambar", { exact: true }).setInputFiles({
      name: "user.png",
      mimeType: "image/png",
      buffer: pixels,
    });
    await page.locator(".image-strip img").waitFor();
    await page
      .locator("details")
      .filter({
        has: page.locator("summary").getByText("Gerak", { exact: true }),
      })
      .evaluate((e) => {
        e.open = true;
      });
    await page.getByLabel("Animasi", { exact: true }).selectOption("crossfade");
    await page.getByLabel("Tambah gambar", { exact: true }).setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: pixels,
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".image-strip img").length === 2,
    );
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await page.getByText("Tema diaktifkan", { exact: true }).waitFor();
    assert.equal(rows.filter((r) => r.slot === "login").length, 2);
    await page
      .locator(".slot-list button")
      .filter({ hasText: "Avatar profil" })
      .click();
    await page
      .locator("details")
      .filter({
        has: page.locator("summary").getByText("Gerak", { exact: true }),
      })
      .evaluate((e) => {
        e.open = true;
      });
    await page.getByLabel("Animasi", { exact: true }).selectOption("glow");
    await page.getByLabel("Tambah gambar", { exact: true }).setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: pixels,
    });
    await page.locator(".image-strip img").waitFor();
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await page.getByText("Tema diaktifkan", { exact: true }).waitFor();
    await page.locator(".avatar .artwork").waitFor();
    await page.getByRole("button", { name: "Ganti mode warna" }).click();
    assert.equal(await page.locator("html").getAttribute("data-mode"), "light");
    await page.getByRole("button", { name: "Pencarian global" }).click();
    await page.getByLabel("Cari lintas workspace").fill("Portfolio");
    assert.equal(await page.locator(".global-results button").count(), 1);
    assert.deepEqual(studyRequests, [], "Removed study module must not make requests");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Widget", exact: true }).click();
    await page.getByLabel("Tenggat proyek", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Tutup", exact: true }).click();
    await page
      .getByRole("button", { name: "Jurnal Keuangan", exact: true })
      .click();
    assert.equal(await page.locator("[data-widget=deadlines]").count(), 0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const module of [
        "Jurnal Keuangan",
        "Project & MWBs",
        "Arsip Dokumen",
        "Settings",
        "Personalize",
      ]) {
        await page.getByRole("button", { name: module, exact: true }).click();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `Overflow ${module} ${width}: ${await page.evaluate(() =>
            JSON.stringify(
              [...document.querySelectorAll("*")]
                .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
                .slice(0, 6)
                .map((e) => ({
                  tag: e.tagName,
                  class: e.className,
                  right: e.getBoundingClientRect().right,
                })),
            ),
          )}`,
        );
      }
      await page.screenshot({
        path: `/tmp/orbit-expanded-${width}.png`,
        fullPage: true,
      });
    }
    await page
      .getByRole("button", { name: "Keluar workspace", exact: true })
      .click();
    await page.getByRole("heading", { name: "Login", exact: true }).waitFor();
    await page.locator(".login-shell .artwork").waitFor();
    assert.equal(
      await page
        .locator(".login-shell .artwork")
        .evaluate(
          (e) => getComputedStyle(e.querySelector("img")).animationName,
        ),
      "none",
    );

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(".effect-crossfade .art-current"),
        ).animationName === "artFade",
    );
    assert.equal(await page.locator(".effect-crossfade img").count(), 2);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector(".effect-crossfade .art-current"),
        ).animationPlayState === "paused",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const manifest = await (
      await page.request.get(base + "/manifest.webmanifest")
    ).json();
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.icons.length, 2);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.goto(base + "/offline-test");
    await page
      .getByText("Koneksi internet diperlukan untuk memuat data pribadi.", {
        exact: true,
      })
      .waitFor();
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: actual login/session, mock-data pagination/search, 30-day/12-month charts, XLSX download, transfer form, collapsible stacks/cards and expand-all, inline MWB date feedback and failed-date retry, daily/agenda navigation and empty state, dated subtask CRUD, hierarchical stacks, month/week sync, calendar drag reschedule, clear date, weekly calendar/edit, focus start/stop, document expiry/preview, direct upload flow, slideshow/preset/avatar, light mode, global search, widget visibility, all five modules at 390/320px, reduced motion, active animation / hidden-tab pause, PWA manifest and offline fallback, logout with public login art.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
