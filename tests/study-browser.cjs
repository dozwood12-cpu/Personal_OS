const { chromium } = require("playwright-core"),
  { PDFDocument, StandardFonts } = require("pdf-lib"),
  assert = require("node:assert/strict");
const base = process.env.TEST_BASE_URL || "http://localhost:3900",
  id = "00000000-0000-4000-8000-000000000001";
(async () => {
  const out = await PDFDocument.create();
  out.addPage().drawText("Belajar ORBIT");
  out.addPage().drawText("Halaman dua");
  const bytes = Buffer.from(await out.save());
  const data = Object.fromEntries(
    [
      "categories",
      "documents",
      "vault_folders",
      "projects",
      "transactions",
      "accounts",
      "transfers",
      "budgets",
      "savings_goals",
      "recurring_rules",
      "mwbs",
      "subtasks",
      "focus_sessions",
      "app_settings",
      "activity_log",
    ].map((k) => [k, []]),
  );
  data.documents = [
    { id, title: "Belajar.pdf", deletion_state: "active", size: bytes.length },
  ];
  let state = {
    annotations: [],
    notes: [],
    cards: [],
    reviews: [],
    progress: [],
  };
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.route("**/api/data", (r) => r.fulfill({ json: data }));
    await page.route("**/api/personalize*", (r) =>
      r.fulfill({ json: { presets: [], rows: [] } }),
    );
    await page.route("**/api/files?*", (r) =>
      r.fulfill({ body: bytes, contentType: "application/pdf" }),
    );
    await page.route("**/api/study", (r) => {
      if (r.request().method() === "GET") return r.fulfill({ json: state });
      const b = r.request().postDataJSON();
      if (b.kind === "progress" || b.kind === "notes")
        state[b.kind] = [{ id: crypto.randomUUID(), ...b.data }];
      else if (b.kind)
        state[b.kind].push({ id: crypto.randomUUID(), ...b.data });
      return r.fulfill({ json: { ok: true } });
    });
    await page.goto(base);
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("admin");
    await page.getByRole("button", { name: "Masuk ke workspace" }).click();
    await page.getByRole("button", { name: "Belajar", exact: true }).click();
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".study-surface canvas")?.width > 0,
    );
    const box = await page.locator(".study-surface").boundingBox();
    await page.mouse.move(box.x + 20, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 60);
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelectorAll(".study-mark").length === 1,
    );
    assert.equal(state.annotations.length, 1);
    await page.getByLabel("Ringkasan PDF").fill("Ringkasan tersimpan");
    await page.getByLabel("Ringkasan PDF").blur();
    await page.waitForTimeout(1000);
    assert.equal(state.notes[0].summary, "Ringkasan tersimpan");
    await page.getByLabel("Halaman PDF").fill("2");
    await page.waitForTimeout(3500);
    assert.equal(state.progress[0].last_page, 2);
    await page.getByRole("button", { name: "Daftar PDF", exact: true }).click();
    await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[aria-label="Halaman PDF"]')?.value ===
        "2",
    );
    console.log(
      "PASS: actual pdf.js worker/canvas, area annotation persistence, summary persistence, read progress and last page restore.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
