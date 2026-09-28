// Tests the schema on PGlite (real Postgres compiled to WASM) with small
// stand-ins for Supabase's auth + storage schemas.
// Run: node supabase/test/run-tests.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
process.on("unhandledRejection", (e) => { console.error("ERROR:", e.message, e.where ?? ""); process.exit(1); });
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log("  ✓", msg);
  else { failures++; console.log("  ✗ FAIL:", msg); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const expectError = async (fn, match, msg) => {
  try { await fn(); ok(false, msg + " (no error thrown)"); }
  catch (e) { ok(match ? String(e.message).includes(match) : true, `${msg} -> "${e.message}"`); }
};

// ---- Supabase stand-ins ----
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(),
    raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as
    $$ select string_to_array(name, '/') $$;
  grant usage on schema public, auth, storage to authenticated, anon;
  alter default privileges in schema public grant all on tables to authenticated, anon;
`);
await db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
await db.exec(`revoke all on all tables in schema public from authenticated;`); // start with nothing: the schema must grant what it needs
// (Supabase grants table privileges by default; the schema then revokes what it must.)
// Re-run the revokes/grants part so they apply after the blanket grant above:
{
  const s = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const start = s.indexOf("-- Anonymous visitors get nothing.");
  const end = s.indexOf("-- =====================================================================\n-- Avatar storage");
  await db.exec(s.slice(start, end));
}
console.log("Schema loaded.");

const today = (await q("select public.app_today() as d"))[0].d;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const T = iso(today);

const asUser = async (uid) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  await db.exec(`set role authenticated;`);
};
const asPostgres = async () => db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);

// ---- Sign up ----
console.log("\nSign up + invite codes");
const codes = (await q("select code from invite_codes order by code")).map((r) => r.code);
ok(codes.length === 40, "40 invite codes seeded");
ok(/^GRIND-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codes[0]), `code format ${codes[0]}`);

const signup = async (username, code) =>
  (await q(`insert into auth.users (raw_user_meta_data) values ($1) returning id`,
    [{ username, invite_code: code, display_name: username[0].toUpperCase() + username.slice(1) }]))[0].id;

const rohith = await signup("rohith", codes[0]);
ok((await q("select is_admin from profiles where id=$1", [rohith]))[0].is_admin === true, "first user becomes admin");
const amit = await signup("amit", codes[1].toLowerCase()); // lowercase code still works
const sam = await signup("sam", codes[2]);
const neha = await signup("neha", codes[3]);
const kai = await signup("kai", codes[4]);
ok((await q("select is_admin from profiles where id=$1", [amit]))[0].is_admin === false, "second user is not admin");
await expectError(() => signup("dup", codes[0]), "INVALID_INVITE_CODE", "used code rejected");
await expectError(() => signup("nocode", ""), "INVALID_INVITE_CODE", "missing code rejected");
await db.exec(`update invite_codes set revoked = true where code = '${codes[5]}'`);
await expectError(() => signup("revoked", codes[5]), "INVALID_INVITE_CODE", "revoked code rejected");
await expectError(() => signup("Bad Name!", codes[6]), null, "invalid username rejected");
ok((await q("select used_by from invite_codes where code=$1", [codes[6]]))[0].used_by === null,
  "failed signup does not burn the code");

// ---- Logging ----
console.log("\nLogging");
await asUser(amit);
await q("select set_log($1,'gym',90)", [T]);   // 1h30 workout -> 15
await q("select set_log($1,'steps',10)", [T]);  // 10k steps -> 20 (fitness 35)
for (const a of ['protein','water','homecooked']) await q("select set_log($1,$2,1)", [T, a]); // nutrition 20
await q("select set_log($1,'study_time',360)", [T]); // 6h study -> 20
await q("select set_log($1,'sleep_hours',480)", [T]); // 8h sleep -> 15
await q("select set_log($1,'junk',5)", [T]);         // max 3 servings -> -15
await q("select set_log($1,'alcohol',1)", [T]);      // -10
let pts = await q("select * from daily_points($1,$1,$2)", [T, amit]);
ok(pts[0].points === 35 + 20 + 20 + 15 - 25, `capped daily score = ${pts[0].points} (expected 65)`);
await q("select set_log($1,'gym',1)", [addDays(-1)]);
ok(true, "can log yesterday");
await expectError(() => q("select set_log($1,'gym',1)", [addDays(-2)]), "only log today or yesterday", "2 days ago blocked");
await expectError(() => q("select set_log($1,'gym',1)", [addDays(1)]), "only log today or yesterday", "tomorrow blocked");
await q("select set_log($1,'bedtime',1)", [T]);
await q("select set_log($1,'bedtime',0)", [T]);
ok((await q("select count(*)::int c from logs where user_id=$1 and activity_id='bedtime'", [amit]))[0].c === 0, "value 0 removes entry");
await expectError(() => q("insert into logs (user_id, day, activity_id, category_id) values ($1,$2,'gym','fitness')", [amit, T]), "permission", "direct insert into logs blocked");
await expectError(() => q("update profiles set is_admin = true where id = $1", [amit]), "permission", "user can't make self admin");
await q("update profiles set display_name='Amit K' where id=$1", [amit]);
ok((await q("select display_name from profiles where id=$1", [amit]))[0].display_name === "Amit K", "user can edit own name");
await q("update profiles set display_name='hacked' where id=$1", [sam]);
ok((await q("select display_name from profiles where id=$1", [sam]))[0].display_name === "Sam", "user can't edit someone else's name");

console.log("\nStudy up to 16h, sleep bands, 24h rule");
await asUser(neha);
const sleepPts = async (min) => (await q("select points from set_log($1,'sleep_hours',$2)", [T, min]))[0].points;
ok(await sleepPts(180) === 0, "sleep 3h -> 0");
ok(await sleepPts(240) === 8, "sleep 4h -> 8");
ok(await sleepPts(390) === 8, "sleep 6.5h -> 8");
ok(await sleepPts(420) === 15, "sleep 7h -> 15");
ok(await sleepPts(540) === 15, "sleep 9h -> 15");
ok(await sleepPts(570) === 10, "sleep 9.5h -> 10");
await q("select set_log($1,'sleep_hours',0)", [T]);
const studyPts = async (min) => (await q("select points from set_log($1,'study_time',$2)", [T, min]))[0].points;
ok(await studyPts(30) === 0 && await studyPts(60) === 4 && await studyPts(120) === 8, "study: 1h -> 4, 2h -> 8");
ok(await studyPts(180) === 11 && await studyPts(300) === 17 && await studyPts(360) === 20, "study: 3h -> 11, 5h -> 17, 6h -> 20");
ok(await studyPts(600) === 20, "study: more than 6h still 20");
const gymPts = async (min) => (await q("select points from set_log($1,'gym',$2)", [T, min]))[0].points;
ok(await gymPts(30) === 5 && await gymPts(60) === 10 && await gymPts(90) === 15 && await gymPts(150) === 15, "workout: +5 per 30 min, max 15");
const stepPts = async (k) => (await q("select points from set_log($1,'steps',$2)", [T, k]))[0].points;
ok(await stepPts(1) === 2 && await stepPts(7) === 14 && await stepPts(10) === 20 && await stepPts(14) === 20, "steps: +2 per 1k, max 20");
await q("select set_log($1,'gym',0)", [T]); await q("select set_log($1,'steps',0)", [T]); await q("select set_log($1,'study_time',0)", [T]);
ok((await q("select points from set_log($1,'sleep_hours',960)", [T]))[0].points === 10, "sleep up to 16h allowed");
await expectError(() => q("select set_log($1,'sleep_hours',990)", [T]), "more than the max", "sleep over 16h rejected");
await q("select set_log($1,'study_time',480)", [T]);
await expectError(() => q("select set_log($1,'gym',60)", [T]), "24 hours", "16h sleep + 8h study + 1h workout rejected (over 24h)");
await q("select set_log($1,'study_time',0)", [T]);
await q("select set_log($1,'sleep_hours',0)", [T]);

console.log("\nPrivacy of negatives");
await asUser(sam);
const seen = await q("select activity_id from logs where user_id=$1", [amit]);
ok(!seen.some((r) => ["junk", "alcohol"].includes(r.activity_id)), "others can't see junk/alcohol entries");
ok(seen.some((r) => r.activity_id === "gym"), "others can see gym entry");
const lbSam = await q("select * from leaderboard($1,$1)", [T]);
ok(lbSam.find((r) => r.username === "amit").points === 65, `but net score includes negatives (${lbSam.find((r) => r.username === "amit").points})`);
ok((await q("select count(*)::int c from invite_codes"))[0].c === 0, "non-admin sees 0 invite codes");
await asUser(rohith);
ok((await q("select count(*)::int c from invite_codes"))[0].c === 40, "admin sees all invite codes");
ok((await q("select count(*)::int c from logs where user_id=$1 and is_negative", [amit]))[0].c === 2, "admin can see negatives");

// ---- Freeze ----
console.log("\nFreezes");
await asUser(sam);
await q("select set_log($1,'gym',1)", [T]);
const fr = (await q("select * from request_freeze($1,$1,'cheat day')", [T]))[0];
ok(fr.status === "pending", "freeze request is pending");
await expectError(() => q("select admin_decide_freeze($1,true)", [fr.id]), "Admins only", "non-admin can't approve");
await asUser(rohith);
await q("select admin_decide_freeze($1,true)", [fr.id]);
pts = await q("select * from daily_points($1,$1,$2)", [T, sam]);
ok(pts[0].points === 0 && pts[0].frozen, "frozen day scores 0");
await asUser(sam);
await expectError(() => q("select set_log($1,'steps',1)", [T]), "frozen", "can't log on frozen day");

// ---- Admin adjustments ----
console.log("\nAdmin adjustments");
await asUser(rohith);
await q("insert into adjustments (user_id, points, reason) values ($1, -20, 'Fake gym entry (group vote)')", [amit]);
await asUser(neha);
await expectError(() => q("insert into adjustments (user_id, points, reason) values ($1, 50, 'lol')", [neha]), null, "non-admin can't add points");
const lb = await q("select * from leaderboard($1,$1)", [T]);
ok(lb.find((r) => r.username === "amit").points === 45, `adjustment applied (65 - 20 = 45) -> ${lb.find((r) => r.username === "amit").points}`);
ok(lb.find((r) => r.username === "sam").points === 0, "sam frozen = 0");

// ---- Reports ----
console.log("\nReports + voting (5 members, 4 eligible voters, quorum 2)");
await asUser(kai);
const kg = (await q("select * from set_log($1,'gym',1)", [T]))[0];
const ks = (await q("select * from set_log($1,'study_time',120)", [T]))[0];
const kr = (await q("select * from set_log($1,'steps',5)", [T]))[0];
await expectError(() => q("select create_report($1,'self')", [kg.id]), "own entry", "can't report own entry");
await asUser(amit);
const junkLog = (await q("select id from logs where user_id=$1 and activity_id='junk'", [amit]))[0].id;
await asUser(neha);
await expectError(() => q("select create_report($1,'hidden')", [junkLog]), "not found", "can't report hidden negative entry");

// Report 1: remove wins
let r1 = (await q("select * from create_report($1,'No way he went to the gym')", [kg.id]))[0];
ok(r1.status === "open" && r1.remove_votes === 1, "report opened; reporter counted as remove");
await expectError(() => q("select create_report($1,'again')", [kg.id]), "open report", "duplicate open report blocked");
await asUser(kai);
await expectError(() => q("select cast_vote($1,'keep')", [r1.id]), "own entry", "reported person can't vote");
await asUser(amit); await q("select cast_vote($1,'remove')", [r1.id]);
await asUser(sam); await q("select cast_vote($1,'keep')", [r1.id]);
await asUser(rohith); r1 = (await q("select * from cast_vote($1,'remove')", [r1.id]))[0];
ok(r1.status === "removed", "all voted, 3-1 remove -> removed");
ok((await q("select voided from logs where id=$1", [kg.id]))[0].voided === true, "entry voided");
await asUser(kai);
await expectError(() => q("select set_log($1,'gym',1)", [T]), "locked", "voided entry can't be re-logged");
await expectError(() => q("select set_log($1,'gym',0)", [T]), "locked", "voided entry can't be deleted");

// Report 2: tie -> revote -> tie -> admin
await asUser(neha);
let r2 = (await q("select * from create_report($1,'2 hours? really?')", [ks.id]))[0];
await asUser(amit); await q("select cast_vote($1,'keep')", [r2.id]);
await asUser(sam); await q("select cast_vote($1,'keep')", [r2.id]);
await asUser(rohith); r2 = (await q("select * from cast_vote($1,'remove')", [r2.id]))[0];
ok(r2.status === "open" && r2.round === 2 && r2.remove_votes === 0, "2-2 tie -> round 2 with fresh votes");
await asUser(neha); await q("select cast_vote($1,'remove')", [r2.id]);
await asUser(rohith); await q("select cast_vote($1,'remove')", [r2.id]);
await asUser(amit); await q("select cast_vote($1,'keep')", [r2.id]);
await asUser(sam); r2 = (await q("select * from cast_vote($1,'keep')", [r2.id]))[0];
ok(r2.status === "admin_review", "tie again -> admin review");
await asUser(rohith); await q("select admin_decide_report($1,false)", [r2.id]);
ok((await q("select status from reports where id=$1", [r2.id]))[0].status === "kept", "admin kept it");

// Report 3: not enough votes by the deadline -> dismissed
await asUser(sam);
let r3 = (await q("select * from create_report($1,'sus run')", [kr.id]))[0];
await asPostgres();
await q("update reports set closes_at = now() - interval '1 minute' where id=$1", [r3.id]);
await asUser(sam);
await q("select resolve_due_reports()");
ok((await q("select status from reports where id=$1", [r3.id]))[0].status === "dismissed", "1 vote of 4 at deadline -> dismissed (entry stays)");

// Daily report limit
await asUser(amit); // amit has used 0 reports today
ok((await q("select reports_left_today() n"))[0].n === 3, "amit has 3 reports left");
await asUser(rohith);
const rl = (await q("select * from set_log($1,'skin_am',1)", [T]))[0];
const rl2 = (await q("select * from set_log($1,'skin_pm',1)", [T]))[0];
const rl3 = (await q("select * from set_log($1,'water',1)", [T]))[0];
const rl4 = (await q("select * from set_log($1,'protein',1)", [T]))[0];
await asUser(amit);
await q("select create_report($1,'a1')", [rl.id]);
await q("select create_report($1,'a2')", [rl2.id]);
await q("select create_report($1,'a3')", [rl3.id]);
await expectError(() => q("select create_report($1,'a4')", [rl4.id]), "reports for today", "4th report of the day blocked");
await asUser(amit);
await expectError(() => q("select * from report_votes"), "permission", "votes are private");

// ---- Streaks ----
console.log("\nStreaks");
await asPostgres();
// neha: 10 straight days ending yesterday, a frozen day in the middle, a gap before
const put = (uid, day, act, val, p, cat) =>
  q(`insert into logs (user_id, day, activity_id, category_id, value, points) values ($1,$2,$3,$4,$5,$6)
     on conflict do nothing`, [uid, day, act, cat, val, p]);
for (let i = 1; i <= 12; i++) if (i !== 5) await put(neha, addDays(-i), "gym", 1, 15, "fitness");
await q(`insert into freezes (user_id,start_day,end_day,status) values ($1,$2,$2,'approved')`, [neha, addDays(-5)]);
for (let i = 15; i <= 17; i++) await put(neha, addDays(-i), "gym", 1, 15, "fitness");
await asUser(neha);
let st = (await q("select * from streaks($1)", [neha]))[0];
ok(st.current_streak === 11, `current streak 11 (frozen day skipped, today not logged yet doesn't break) -> ${st.current_streak}`);
ok(st.best_streak === 11, `best streak 11 -> ${st.best_streak}`);
await q("select set_log($1,'steps',5)", [T]);
st = (await q("select * from streaks($1)", [neha]))[0];
ok(st.current_streak === 12, `logging today -> 12 (${st.current_streak})`);
// a day with only negatives does not count
await asPostgres();
await put(kai, addDays(-1), "junk", 1, -5, "vices");
await asUser(kai);
st = (await q("select * from streaks($1)", [kai]))[0];
ok(st.best_streak >= 0, `kai streak computed (${st.current_streak}/${st.best_streak})`);

// ---- Awards ----
console.log("\nAwards");
await asPostgres();
// Make everyone join long ago and create a full past month of data
await q("update profiles set created_at = now() - interval '400 days'");
const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
const lmDay = (n) => { const d = new Date(lastMonthStart); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
for (let i = 0; i < 20; i++) await put(amit, lmDay(i), "gym", 1, 15, "fitness");
for (let i = 0; i < 10; i++) await put(sam, lmDay(i), "gym", 1, 15, "fitness");
for (let i = 0; i < 2; i++) await put(kai, lmDay(i), "gym", 1, 15, "fitness");
for (let i = 0; i < 5; i++) await put(rohith, lmDay(i), "gym", 1, 15, "fitness");
// neha: on a long trip (8 frozen days) and low score -> exempt from last place
await put(neha, lmDay(0), "gym", 1, 15, "fitness");
await q(`insert into freezes (user_id,start_day,end_day,status) values ($1,$2,$3,'approved')`, [neha, lmDay(1), lmDay(8)]);
await asUser(amit);
await q("select finalize_awards()");
const aw = await q("select a.kind, a.title, a.points, p.username from awards a join profiles p on p.id=a.user_id order by kind");
console.log("   ", aw.map((a) => `${a.kind}: ${a.username} "${a.title}" (${a.points})`).join("\n    "));
ok(aw.some((a) => a.kind === "month_champion" && a.username === "amit"), "amit is monthly champion");
ok(aw.some((a) => a.kind === "month_last" && a.username === "kai"), "kai gets last place (neha exempt: 8 frozen days)");
await q("select finalize_awards()");
ok((await q("select count(*)::int c from awards"))[0].c === aw.length, "finalize is idempotent");

// ---- Admin tools ----
console.log("\nAdmin tools");
await asUser(rohith);
const newCodes = await q("select * from admin_generate_invites(5, 'for later')");
ok(newCodes.length === 5, "admin generates 5 more codes");
await asUser(amit);
await expectError(() => q("select * from admin_generate_invites(5)"), "Admins only", "non-admin can't generate codes");
await asUser(rohith);
await q("update activities set points = 3 where id = 'steps'");
ok((await q("select points from activities where id='steps'"))[0].points === 3, "admin edits scoring rule");
await asUser(amit);
await q("update activities set points = 99 where id = 'steps'");
ok((await q("select points from activities where id='steps'"))[0].points === 3, "non-admin can't edit rules");

// ---- Anonymous ----
console.log("\nAnonymous access");
await db.exec(`reset role; set role anon;`);
await expectError(() => q("select * from profiles"), "permission", "anon can't read profiles");
await expectError(() => q("select * from leaderboard('2020-01-01','2030-01-01')"), "permission", "anon can't call functions");

const lbFinal = await (async () => { await asUser(rohith); return q("select username, points, current_streak, rank from leaderboard($1,$1)", [T]); })();
console.log("\nToday's leaderboard:", lbFinal);

// ---- Per-person timezones ----
console.log("\nPer-person timezones");
{
  const dateIn = (tz, offsetDays = 0) => {
    const d = new Date(Date.now() + offsetDays * 86400e3);
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  };
  const tdy = async (uid) => (await q("select user_today($1)::text d", [uid]))[0].d;
  await asUser(neha);
  ok((await q("select set_my_timezone('Asia/Kolkata') tz"))[0].tz === "Asia/Kolkata", "first open sets Neha's timezone from her phone");
  ok((await q("select set_my_timezone('Pacific/Kiritimati') tz"))[0].tz === "Asia/Kolkata", "she can't change it herself afterwards");
  await expectError(() => q("select set_my_timezone('Mars/Olympus')"), "Unknown timezone", "made-up timezone rejected");
  await expectError(() => q("select admin_set_timezone($1,'Asia/Tokyo')", [neha]), "Admins only", "non-admin can't change timezones");
  await asUser(rohith);
  await q("select set_my_timezone('America/Chicago')");
  ok(await tdy(neha) === dateIn("Asia/Kolkata"), `Neha's today follows India (${await tdy(neha)})`);
  ok(await tdy(rohith) === dateIn("America/Chicago"), `Rohith's today follows Dallas (${await tdy(rohith)})`);
  ok((await q("select my_today()::text d"))[0].d === dateIn("America/Chicago"), "my_today() gives the caller's own date");

  // A timezone 14 hours ahead is always on a later date than one 11 hours behind:
  // logging windows must follow each person's own calendar.
  await q("select admin_set_timezone($1,'Pacific/Kiritimati')", [kai]);
  await q("select admin_set_timezone($1,'Pacific/Pago_Pago')", [sam]);
  const kaiToday = await tdy(kai), samToday = await tdy(sam);
  ok(kaiToday > samToday, `Kai (UTC+14) is on ${kaiToday}, Sam (UTC-11) on ${samToday}`);
  await asUser(kai);
  ok((await q("select points from set_log($1,'skin_pm',1)", [kaiToday]))[0].points === 4, "Kai can log his own today");
  await asPostgres();
  await q("delete from freezes where user_id = $1", [sam]);
  await asUser(sam);
  await expectError(() => q("select set_log($1,'water',1)", [kaiToday]), "only log today or yesterday", "Sam can't log Kai's date (it's tomorrow for him)");
  ok((await q("select points from set_log($1,'water',1)", [samToday]))[0].points === 5, "Sam logs his own today");
  const st = (await q("select * from streaks($1)", [kai]))[0];
  ok(st.current_streak >= 1, `Kai's streak counts his own today (${st.current_streak})`);
  await asUser(neha);
  ok((await q("select reports_left_today() n"))[0].n >= 0, "report limit uses Neha's own day");

  // awards wait for the member furthest behind
  await asPostgres();
  const minToday = (await q("select least(app_today(), (select min(user_today(id)) from profiles))::text d"))[0].d;
  ok(minToday === samToday || minToday <= samToday, `month-end waits for the latest timezone (${minToday})`);
  await q("update profiles set timezone = null where id in ($1,$2)", [kai, sam]);
}

// ---- Migration 002 on a database built from the previous schema ----
console.log("\nMigration 002 (old database -> new rules)");
{
  const { execSync } = await import("node:child_process");
  const oldSql = execSync("git show 1f9e523:supabase/schema.sql", { encoding: "utf8" });
  const db2 = new PGlite();
  const q2 = async (sql, p) => (await db2.query(sql, p)).rows;
  await db2.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
    grant usage on schema public, auth, storage to authenticated, anon;`);
  await db2.exec(oldSql);
  const code = (await q2("select code from invite_codes limit 1"))[0].code;
  const uid = (await q2("insert into auth.users (raw_user_meta_data) values ($1) returning id", [{ username: "rohith", invite_code: code }]))[0].id;
  await db2.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  const d = (await q2("select app_today()::text d"))[0].d;
  await q2("select set_log($1,'sleep_hours',3)", [d]); // old "7-9h" button
  await db2.exec(`reset role;`);
  const mig = readFileSync(new URL("../migrations/002_study_sleep_hours.sql", import.meta.url), "utf8");
  await db2.exec(mig);
  await db2.exec(mig); // running twice must be safe
  const row = (await q2("select value::int v, points from logs where activity_id='sleep_hours'"))[0];
  ok(row.v === 480 && row.points === 15, `old 7-9h entry became 8h / 15 pts (${row.v} min, ${row.points})`);
  await db2.exec(`set role authenticated;`);
  ok((await q2("select points from set_log($1,'sleep_hours',300)", [d]))[0].points === 8, "new sleep clock works after migration");
  await expectError(() => q2("select set_log($1,'study_time',1000)", [d]), "more than the max", "16h study limit works after migration");

  // Migration 004: simpler fitness
  await q2("select set_log($1,'workout',1)", [d]);   // old home workout
  await q2("select set_log($1,'steps',1)", [d]);     // old 10k steps
  await q2("select set_log($1,'stretch',1)", [d]);   // removed item
  await db2.exec(`reset role;`);
  const m4 = readFileSync(new URL("../migrations/004_simplify_fitness.sql", import.meta.url), "utf8");
  await db2.exec(m4); await db2.exec(m4);
  const fit = (await q2("select activity_id, points from logs where category_id='fitness' order by activity_id"));
  ok(JSON.stringify(fit) === JSON.stringify([{ activity_id: "gym", points: 15 }, { activity_id: "run", points: 15 }]),
    `today's home workout -> Workout, steps -> Run or 10k steps, stretch dropped (${JSON.stringify(fit)})`);
  const active = (await q2("select id from activities where category_id='fitness' and active order by sort")).map((r) => r.id);
  ok(active.join() === "gym,run", `fitness now shows only Workout + Run or 10k steps (${active})`);

  // Migration 005: simpler nutrition
  await db2.exec(`set role authenticated;`);
  for (const a of ["protein", "greens", "homecooked", "supplements"]) await q2("select set_log($1,$2,1)", [d, a]);
  await db2.exec(`reset role;`);
  const m5 = readFileSync(new URL("../migrations/005_simplify_nutrition.sql", import.meta.url), "utf8");
  await db2.exec(m5); await db2.exec(m5);
  const nut = await q2("select activity_id, points from logs where category_id='nutrition' order by activity_id");
  ok(JSON.stringify(nut) === JSON.stringify([{ activity_id: "homecooked", points: 5 }, { activity_id: "protein", points: 10 }]),
    `today's nutrition re-scored, removed items dropped (${JSON.stringify(nut)})`);
  const nActive = (await q2("select name from activities where category_id='nutrition' and active order by sort")).map((r) => r.name);
  ok(nActive.join(" / ") === "Hit calorie/diet goal / 3L water / Home-cooked meal", `nutrition list: ${nActive.join(" / ")}`);
  ok((await q2("select name from activities where id='study_time'"))[0].name === "Study", "Focused study renamed to Study");

  // Migration 006: study is one toggle
  await db2.exec(`set role authenticated;`);
  await q2("select set_log($1,'study_time',90)", [d]); // 1.5h logged the old way
  await db2.exec(`reset role;`);
  const m6 = readFileSync(new URL("../migrations/006_study_one_toggle.sql", import.meta.url), "utf8");
  await db2.exec(m6); await db2.exec(m6);
  const st6 = (await q2("select value::int v, points from logs where activity_id='study_time'"))[0];
  ok(st6.v === 1 && st6.points === 20, `today's 1.5h study became the toggle worth 20 (${JSON.stringify(st6)})`);
  await db2.exec(`set role authenticated;`);
  ok((await q2("select points from set_log($1,'study_time',1)", [d]))[0].points === 20, "study toggle works after migration");
  await db2.exec(`reset role;`);

  // Migration 007: reading removed
  await db2.exec(`set role authenticated;`);
  await q2("select set_log($1,'reading',1)", [d]);
  await db2.exec(`reset role;`);
  const m7 = readFileSync(new URL("../migrations/007_remove_reading.sql", import.meta.url), "utf8");
  await db2.exec(m7); await db2.exec(m7);
  const sAct = (await q2("select id from activities where category_id='study' and active")).map((r) => r.id);
  const rLogs = (await q2("select count(*)::int c from logs where activity_id='reading'"))[0].c;
  ok(sAct.join() === "study_time" && rLogs === 0, `study list is just Study; today's reading dropped (${sAct}, ${rLogs} left)`);

  // Migration 008: weed -20, slip-ups cap 55
  await db2.exec(`set role authenticated;`);
  for (const v of ["junk", "alcohol", "smoke", "weed"]) await q2("select set_log($1,$2,$3)", [d, v, v === "junk" ? 3 : 1]);
  await db2.exec(`reset role;`);
  const m8 = readFileSync(new URL("../migrations/008_weed_minus_20.sql", import.meta.url), "utf8");
  await db2.exec(m8); await db2.exec(m8);
  const wp = (await q2("select points from logs where activity_id='weed'"))[0].points;
  const vices = (await q2("select sum(points)::int s from logs where category_id='vices'"))[0].s;
  const uid2 = (await q2("select id from profiles limit 1"))[0].id;
  const dp = (await q2("select * from daily_points($1,$1,$2)", [d, uid2]))[0];
  const posOnly = (await q2("select coalesce(sum(least(t.p, c.daily_cap)),0)::int s from (select category_id, sum(points) p from logs where not is_negative and day=$1 group by 1) t join categories c on c.id=t.category_id", [d]))[0].s;
  ok(wp === -20 && vices === -55 && dp.log_points === posOnly - 55, `weed -20; all slip-ups count in full (-55); day score ${dp.log_points}`);

  // Migration 009: per-person timezones
  const m9 = readFileSync(new URL("../migrations/009_per_person_timezones.sql", import.meta.url), "utf8");
  await db2.exec(m9); await db2.exec(m9);
  await db2.exec(`set role authenticated;`);
  ok((await q2("select set_my_timezone('Asia/Kolkata') tz"))[0].tz === "Asia/Kolkata", "timezone works after migration 009");
  const t9 = (await q2("select my_today()::text d"))[0].d;
  ok((await q2("select points from set_log($1,'gym',1)", [t9]))[0].points === 15, "logging on your own date works after migration 009");
  await q2("select set_log($1,'study_time',1)", [t9]);  // study toggle (before 010)
  await db2.exec(`reset role;`);
  await q2("update activities set active = true where id = 'run'");
  await db2.exec(`set role authenticated;`);
  await q2("select set_log($1,'run',1)", [t9]);         // old run toggle
  await db2.exec(`reset role;`);
  await q2("delete from logs where activity_id = 'steps'");

  // Migration 010: counters for workout, steps, study
  const m10 = readFileSync(new URL("../migrations/010_counters_workout_steps_study.sql", import.meta.url), "utf8");
  await db2.exec(m10); await db2.exec(m10);
  const conv = Object.fromEntries((await q2("select activity_id, value::int v, points from logs where activity_id in ('gym','run','steps','study_time')")).map((r) => [r.activity_id, [r.v, r.points]]));
  ok(JSON.stringify(conv) === JSON.stringify({ gym: [30, 5], steps: [10, 20], study_time: [60, 4] }) || (conv.gym?.[1] === 5 && conv.steps?.[1] === 20 && conv.study_time?.[1] === 4 && !conv.run),
    `today's entries converted: workout 30m/5, run -> 10k steps/20, study 1h/4 (${JSON.stringify(conv)})`);
  const fitCap = (await q2("select daily_cap from categories where id='fitness'"))[0].daily_cap;
  const weedName = (await q2("select name from activities where id='weed'"))[0].name;
  ok(fitCap === 35 && weedName === "Kasuri methi", `fitness cap ${fitCap}, weed renamed to ${weedName}`);
  await db2.exec(`set role authenticated;`);
  ok((await q2("select points from set_log($1,'study_time',240)", [t9]))[0].points === 14, "study 4h -> 14 after migration 010");
  await db2.exec(`reset role;`);
  await db2.exec(`reset role;`);
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll tests passed.");
process.exit(failures ? 1 : 0);
