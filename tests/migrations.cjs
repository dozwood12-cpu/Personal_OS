const { PGlite } = require("@electric-sql/pglite");
const fs = require("fs");
const assert = require("node:assert/strict");
const migration = fs.readFileSync(
  "supabase/migrations/202610290001_personal_os.sql",
  "utf8",
);
const deadlinesMigration = fs.readFileSync(
  "supabase/migrations/202610290002_subtask_deadlines.sql",
  "utf8",
);
async function setup() {
  const db = new PGlite();
  await db.exec(
    `create role service_role;create role anon;create role authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  return db;
}
(async () => {
  const fresh = await setup();
  await fresh.exec(migration);
  await fresh.exec(migration);
  assert.equal(
    (await fresh.query("select count(*)::int n from public.accounts")).rows[0]
      .n,
    1,
  );
  await fresh.exec(deadlinesMigration);
  await fresh.exec(deadlinesMigration);
  const driveMigration = fs.readFileSync(
    "supabase/migrations/202610290003_google_drive_vault.sql",
    "utf8",
  );
  await fresh.exec(driveMigration);
  await fresh.exec(driveMigration);
  for (const table of [
    "storage_connections",
    "storage_oauth_states",
    "vault_uploads",
    "storage_migrations",
    "storage_sync_reports",
  ]) {
    assert.equal(
      (
        await fresh.query(
          "select relrowsecurity from pg_class where oid=$1::regclass",
          ["public." + table],
        )
      ).rows[0].relrowsecurity,
      true,
    );
    assert.equal(
      (
        await fresh.query(
          "select has_table_privilege('anon',$1,'SELECT') as allowed",
          ["public." + table],
        )
      ).rows[0].allowed,
      false,
    );
  }
  const category = (
    await fresh.query("select id from categories where kind='document' limit 1")
  ).rows[0].id;
  const legacyDoc = (
    await fresh.query(
      "insert into documents(title,path,size,category_id) values('legacy.pdf','legacy.pdf',10,$1) returning id",
      [category],
    )
  ).rows[0].id;
  assert.equal(
    (
      await fresh.query("select storage_provider from documents where id=$1", [
        legacyDoc,
      ])
    ).rows[0].storage_provider,
    "supabase",
  );
  assert.equal(
    (await fresh.query("select * from claim_vault_migration()")).rows.length,
    1,
  );
  assert.equal(
    (await fresh.query("select * from claim_vault_migration()")).rows.length,
    0,
  );
  await fresh.exec(
    "update storage_migrations set lease_until=now()-interval '1 minute'",
  );
  assert.equal(
    (await fresh.query("select * from claim_vault_migration()")).rows.length,
    1,
  );
  await fresh.exec(
    `update app_settings set value='{"default_provider":"gdrive","max_upload_mb":50}' where key='vault_storage'`,
  );
  await fresh.exec(driveMigration);
  assert.equal(
    (
      await fresh.query(
        "select value from app_settings where key='vault_storage'",
      )
    ).rows[0].value.default_provider,
    "gdrive",
  );
  const uploadCategory = (
    await fresh.query(
      "insert into categories(name,kind) values('Staging only','document') returning id",
    )
  ).rows[0].id;
  const uploadSession = (
    await fresh.query(
      "insert into vault_uploads(provider,name,mime_type,size,category_id,path) values('supabase','staging.pdf','application/pdf',8,$1,'staging-only.pdf') returning id",
      [uploadCategory],
    )
  ).rows[0].id;
  await fresh.query("delete from categories where id=$1", [uploadCategory]);
  assert.equal(
    (
      await fresh.query("select category_id from vault_uploads where id=$1", [
        uploadSession,
      ])
    ).rows[0].category_id,
    null,
  );
  await fresh.exec(
    fs.readFileSync(
      "supabase/migrations/202610290004_folders_study.sql",
      "utf8",
    ),
  );
  await fresh.exec(
    fs.readFileSync(
      "supabase/migrations/202610290004_folders_study.sql",
      "utf8",
    ),
  );
  await fresh.close();
  const db = await setup();
  await db.exec(fs.readFileSync("tests/fixtures/legacy-schema.sql", "utf8"));
  const income = (
    await db.query("select id from categories where kind='income' limit 1")
  ).rows[0].id;
  const expense = (
    await db.query("select id from categories where kind='expense' limit 1")
  ).rows[0].id;
  await db.query(
    `insert into transactions(title,amount,category_id,date) values('Lama',100000,$1,'2026-01-01')`,
    [income],
  );
  const status = (
    await db.query("select id from categories where name='Selesai'")
  ).rows[0].id;
  await db.query(
    "insert into projects(title,status_id,progress,deadline,is_mwb) values('MWB lama',$1,10,'2026-12-01',true)",
    [status],
  );
  await db.exec(migration);
  assert.equal(
    (await db.query("select account_id from transactions")).rows[0].account_id,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    (await db.query("select count(*)::int n from mwbs")).rows[0].n,
    1,
  );
  await db.exec(migration);
  assert.equal(
    (await db.query("select count(*)::int n from mwbs")).rows[0].n,
    1,
  );
  await db.exec(
    `update app_settings set value='true' where key='auto_complete'`,
  );
  await db.exec("update projects set progress=20");
  assert.equal(
    (await db.query("select progress from projects")).rows[0].progress,
    100,
  );
  const account = "00000000-0000-4000-8000-000000000001";
  const row = {
    title: "Import",
    amount: 200,
    date: "2026-03-01",
    category_id: expense,
    account_id: account,
  };
  let r = await db.query("select import_transactions($1) result", [
    JSON.stringify([row, row]),
  ]);
  assert.deepEqual(r.rows[0].result, { inserted: 1, skipped: 1 });
  r = await db.query("select import_transactions($1) result", [
    JSON.stringify([row]),
  ]);
  assert.equal(r.rows[0].result.skipped, 1);
  await db.query(
    `insert into recurring_rules(title,amount,category_id,account_id,next_due,frequency,anchor_day) values('Gaji',1000,$1,$2,'2026-01-31','monthly',31)`,
    [income, account],
  );
  assert.equal(
    (await db.query("select run_recurring('2026-03-31') n")).rows[0].n,
    3,
  );
  assert.equal(
    (await db.query("select run_recurring('2026-03-31') n")).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select next_due::text from recurring_rules")).rows[0]
      .next_due,
    "2026-04-30",
  );
  const second = (
    await db.query(
      "insert into accounts(name,kind,opening_balance) values('Bank','bank',500) returning id",
    )
  ).rows[0].id;
  await db.query(
    `insert into transfers(from_account,to_account,amount,date) values($1,$2,20,'2026-01-01')`,
    [account, second],
  );
  assert.equal(
    (await db.query("select count(*)::int n from transactions")).rows[0].n,
    5,
  );
  const theme = {
    login: {
      overlay: 0.6,
      blur: 0,
      x: 50,
      y: 50,
      zoom: 1,
      opacity: 1,
      animation: "crossfade",
      speed: 8,
      intensity: 0.3,
      images: [{ path: "test.webp" }],
    },
  };
  const a = (
    await db.query("select save_theme(null,'A',$1,true) id", [
      JSON.stringify(theme),
    ])
  ).rows[0].id;
  const b = (
    await db.query("select save_theme(null,'B',$1,true) id", [
      JSON.stringify(theme),
    ])
  ).rows[0].id;
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from theme_presets where is_active",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select preset from personalization where is_active"))
      .rows[0].preset,
    b,
  );
  await db.query("select activate_theme($1)", [a]);
  assert.equal(
    (await db.query("select preset from personalization where is_active"))
      .rows[0].preset,
    a,
  );
  await db.query("select activate_theme(null)");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from personalization where is_active",
      )
    ).rows[0].n,
    0,
  );
  const other = (
    await db.query(
      "insert into categories(name,kind) values('Makan baru','expense') returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into budgets(category_id,month,amount) values($1,'2026-03-01',100),($2,'2026-03-01',200)",
    [expense, other],
  );
  await db.query("select move_category($1,$2)", [expense, other]);
  assert.equal(
    (await db.query("select amount::text from budgets")).rows[0].amount,
    "300.00",
  );
  assert.equal(
    (
      await db.query(
        "select category_id from transactions where title='Import'",
      )
    ).rows[0].category_id,
    other,
  );
  assert.ok(
    (await db.query("select count(*)::int n from activity_log")).rows[0].n > 0,
  );
  const m = (await db.query("select id from mwbs limit 1")).rows[0].id;
  const legacyTask = (
    await db.query(
      "insert into subtasks(mwb_id,title) values($1,'Ancien') returning id",
      [m],
    )
  ).rows[0].id;
  await db.exec(deadlinesMigration);
  await db.exec(deadlinesMigration);
  assert.equal(
    (await db.query("select deadline from subtasks where id=$1", [legacyTask]))
      .rows[0].deadline,
    null,
  );
  await db.query("update subtasks set deadline='2026-11-07' where id=$1", [
    legacyTask,
  ]);
  assert.equal(
    (
      await db.query("select deadline::text from subtasks where id=$1", [
        legacyTask,
      ])
    ).rows[0].deadline,
    "2026-11-07",
  );
  await db.query("update subtasks set done=true where id=$1", [legacyTask]);
  assert.equal(
    (
      await db.query("select deadline::text from subtasks where id=$1", [
        legacyTask,
      ])
    ).rows[0].deadline,
    "2026-11-07",
  );
  const focus = (
    await db.query(
      "insert into focus_sessions(mwb_id,started_at) values($1,now()-interval '60 seconds') returning id",
      [m],
    )
  ).rows[0].id;
  await db.query("select stop_focus($1)", [focus]);
  assert.ok(
    (await db.query("select seconds from focus_sessions")).rows[0].seconds >=
      59,
  );
  await db.query(
    "insert into projects(title,status_id,progress,deadline,is_mwb) values('MWB baru',$1,0,'2026-12-01',true)",
    [status],
  );
  assert.equal(
    (await db.query("select count(*)::int n from mwbs where title='MWB baru'"))
      .rows[0].n,
    1,
  );
  await db.exec(fs.readFileSync("supabase/seed_demo.sql", "utf8"));
  assert.equal(
    (await db.query("select count(*)::int n from transactions")).rows[0].n,
    5,
  );
  await db.exec(driveMigration);
  await db.exec(driveMigration);
  assert.equal(
    (await db.query("select count(*)::int n from storage_connections")).rows[0]
      .n,
    0,
  );
  await db.close();
  console.log(
    "PASS: fresh migration, legacy preservation, replay idempotence, account backfill, MWB backfill, nullable subtask dates and migration replay preservation, status auto-complete, duplicate-safe import, monthly recurring clamp/idempotence, transfer exclusion, theme save/activation/reset, category bulk move and budget merge, activity, focus duration, isolated demo seed.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
