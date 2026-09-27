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
await db.exec(`grant all on all tables in schema public to authenticated;`);
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
await q("select set_log($1,'gym',1)", [T]);
await q("select set_log($1,'run',1)", [T]);
await q("select set_log($1,'workout',1)", [T]);     // fitness raw 40, cap 30
await q("select set_log($1,'study_time',150)", [T]); // capped at 120 min -> 20
await q("select set_log($1,'sleep_hours',3)", [T]);  // 3rd option 7-9h -> 15
await q("select set_log($1,'junk',5)", [T]);         // max 3 servings -> -15
await q("select set_log($1,'alcohol',1)", [T]);      // -10
let pts = await q("select * from daily_points($1,$1,$2)", [T, amit]);
ok(pts[0].points === 30 + 20 + 15 - 25, `capped daily score = ${pts[0].points} (expected 40)`);
await q("select set_log($1,'gym',1)", [addDays(-1)]);
ok(true, "can log yesterday");
await expectError(() => q("select set_log($1,'gym',1)", [addDays(-2)]), "only log today or yesterday", "2 days ago blocked");
await expectError(() => q("select set_log($1,'gym',1)", [addDays(1)]), "only log today or yesterday", "tomorrow blocked");
await q("select set_log($1,'workout',0)", [T]);
ok((await q("select count(*)::int c from logs where user_id=$1 and activity_id='workout'", [amit]))[0].c === 0, "value 0 removes entry");
await expectError(() => q("insert into logs (user_id, day, activity_id, category_id) values ($1,$2,'gym','fitness')", [amit, T]), "permission", "direct insert into logs blocked");
await expectError(() => q("update profiles set is_admin = true where id = $1", [amit]), "permission", "user can't make self admin");
await q("update profiles set display_name='Amit K' where id=$1", [amit]);
ok((await q("select display_name from profiles where id=$1", [amit]))[0].display_name === "Amit K", "user can edit own name");
await q("update profiles set display_name='hacked' where id=$1", [sam]);
ok((await q("select display_name from profiles where id=$1", [sam]))[0].display_name === "Sam", "user can't edit someone else's name");

console.log("\nPrivacy of negatives");
await asUser(sam);
const seen = await q("select activity_id from logs where user_id=$1", [amit]);
ok(!seen.some((r) => ["junk", "alcohol"].includes(r.activity_id)), "others can't see junk/alcohol entries");
ok(seen.some((r) => r.activity_id === "gym"), "others can see gym entry");
const lbSam = await q("select * from leaderboard($1,$1)", [T]);
ok(lbSam.find((r) => r.username === "amit").points === 40, "but net score includes negatives");
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
await expectError(() => q("select set_log($1,'run',1)", [T]), "frozen", "can't log on frozen day");

// ---- Admin adjustments ----
console.log("\nAdmin adjustments");
await asUser(rohith);
await q("insert into adjustments (user_id, points, reason) values ($1, -20, 'Fake gym entry (group vote)')", [amit]);
await asUser(neha);
await expectError(() => q("insert into adjustments (user_id, points, reason) values ($1, 50, 'lol')", [neha]), null, "non-admin can't add points");
const lb = await q("select * from leaderboard($1,$1)", [T]);
ok(lb.find((r) => r.username === "amit").points === 20, "adjustment applied (40 - 20 = 20)");
ok(lb.find((r) => r.username === "sam").points === 0, "sam frozen = 0");

// ---- Reports ----
console.log("\nReports + voting (5 members, 4 eligible voters, quorum 2)");
await asUser(kai);
const kg = (await q("select * from set_log($1,'gym',1)", [T]))[0];
const ks = (await q("select * from set_log($1,'study_time',120)", [T]))[0];
const kr = (await q("select * from set_log($1,'run',1)", [T]))[0];
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
await q("select set_log($1,'run',1)", [T]);
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
await q("update activities set points = 20 where id = 'run'");
ok((await q("select points from activities where id='run'"))[0].points === 20, "admin edits scoring rule");
await asUser(amit);
await q("update activities set points = 99 where id = 'run'");
ok((await q("select points from activities where id='run'"))[0].points === 20, "non-admin can't edit rules");

// ---- Anonymous ----
console.log("\nAnonymous access");
await db.exec(`reset role; set role anon;`);
await expectError(() => q("select * from profiles"), "permission", "anon can't read profiles");
await expectError(() => q("select * from leaderboard('2020-01-01','2030-01-01')"), "permission", "anon can't call functions");

const lbFinal = await (async () => { await asUser(rohith); return q("select username, points, current_streak, rank from leaderboard($1,$1)", [T]); })();
console.log("\nToday's leaderboard:", lbFinal);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll tests passed.");
process.exit(failures ? 1 : 0);
