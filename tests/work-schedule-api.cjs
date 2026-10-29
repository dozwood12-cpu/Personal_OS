// Real Next.js route and Supabase client against a controlled PostgREST fixture.
const http = require("node:http");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const id = "00000000-0000-4000-8000-000000000001";
const records = {
  mwbs: {
    id,
    title: "MWB",
    project_id: null,
    done: false,
    deadline: "2026-10-29",
  },
  subtasks: { id, title: "Subtask", mwb_id: id, done: false, deadline: null },
};
let missingColumn = false,
  missingRow = false,
  wrongDate = false;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const table = url.pathname.split("/").at(-1);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const send = (body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "PATCH" || req.method === "POST") {
    if (missingColumn && table === "subtasks")
      return send(
        {
          code: "PGRST204",
          message:
            "Could not find the 'deadline' column of 'subtasks' in the schema cache",
        },
        400,
      );
    if (missingRow)
      return send(
        {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        },
        406,
      );
    const value = JSON.parse(Buffer.concat(chunks).toString());
    Object.assign(records[table], value);
    assert.match(req.headers.prefer, /return=representation/);
    return send({
      ...records[table],
      deadline: wrongDate ? "2000-01-01" : records[table].deadline,
    });
  }
  return send(records[table] ? [records[table]] : []);
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const fixtureBase = `http://127.0.0.1:${server.address().port}`;
  const base = "http://127.0.0.1:3711";
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3711",
    ],
    {
      env: {
        ...process.env,
        SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
        SUPABASE_URL: fixtureBase,
        SUPABASE_SERVICE_ROLE_KEY: "local-fixture-key",
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
    assert.ok(ready, "Next.js did not start");
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const post = (table, value) =>
      fetch(base + "/api/data", {
        method: "POST",
        headers: {
          Origin: base,
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          table,
          action: "update",
          id,
          data: { ...records[table], ...value },
        }),
      });
    for (const table of ["mwbs", "subtasks"]) {
      const r = await post(table, { deadline: "2026-11-21" });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).record.deadline, "2026-11-21");
      const read = await fetch(base + "/api/data", {
        headers: { Cookie: cookie },
      });
      assert.equal((await read.json())[table][0].deadline, "2026-11-21");
    }
    let r = await post("subtasks", { deadline: null });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).record.deadline, null);
    missingColumn = true;
    r = await post("subtasks", { deadline: "2026-11-07" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /202610290002_subtask_deadlines.sql/);
    missingColumn = false;
    missingRow = true;
    r = await post("mwbs", { deadline: "2026-11-07" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /tidak ditemukan/);
    missingRow = false;
    wrongDate = true;
    r = await post("mwbs", { deadline: "2026-11-07" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /berbeda/);
    wrongDate = false;
    r = await post("mwbs", { deadline: "2026-02-30" });
    assert.equal(r.status, 400);
    console.log(
      "PASS: real API persists MWB/subtask dates and returns saved records; GET roundtrip, clear date, missing migration guidance, missing row rejection, mismatched date rejection, invalid date validation.",
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
