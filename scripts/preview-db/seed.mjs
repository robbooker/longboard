#!/usr/bin/env node
// PREVIEW DATABASE ONLY. Seeds the `longboard-preview` Supabase project with fake members and
// chat history so Vercel preview deployments have something to test against.
//
// It refuses to run against production (ref qnwizieggisnbjqyxrjo) and, by default, against any
// project other than the preview one. It reads only PREVIEW_* variables, never the app's
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so a production .env.local cannot leak in.
//
// Usage:
//   PREVIEW_SUPABASE_URL=https://<preview-ref>.supabase.co \
//   PREVIEW_SUPABASE_SERVICE_ROLE_KEY=... \
//   PREVIEW_SEED_PASSWORD=...   # the shared sign-in password for every fake member
//   node scripts/preview-db/seed.mjs
//
// Safe to re-run: users, members, messages, reactions, pins and the DM are keyed
// deterministically, so a second run only fills in whatever is missing (and resets passwords).
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "qnwizieggisnbjqyxrjo";
const PREVIEW_REF = process.env.PREVIEW_SUPABASE_REF || "mtcxfsajnlpyxohkhofr";

function fail(message) {
  console.error(`preview seed: ${message}`);
  process.exit(1);
}

const url = process.env.PREVIEW_SUPABASE_URL || "";
const serviceKey = process.env.PREVIEW_SUPABASE_SERVICE_ROLE_KEY || "";
const password = (process.env.PREVIEW_SEED_PASSWORD || "").trim();
if (!url || !serviceKey || !password) fail("set PREVIEW_SUPABASE_URL, PREVIEW_SUPABASE_SERVICE_ROLE_KEY and PREVIEW_SEED_PASSWORD");
if (password.length < 12) fail("PREVIEW_SEED_PASSWORD must be at least 12 characters");

// --- Production guard: URL host, and the ref inside a legacy JWT key when there is one. ---
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
const urlRef = host.endsWith(".supabase.co") ? host.split(".")[0] : "";
if (url.includes(PRODUCTION_REF) || urlRef === PRODUCTION_REF) fail("refusing to run against the production project");
if (urlRef !== PREVIEW_REF) fail(`URL is not the preview project (${PREVIEW_REF}); refusing`);
if (serviceKey.startsWith("eyJ")) {
  try {
    const claims = JSON.parse(Buffer.from(serviceKey.split(".")[1], "base64url").toString("utf8"));
    if (claims.ref === PRODUCTION_REF) fail("service key belongs to the production project; refusing");
    if (claims.ref !== PREVIEW_REF) fail("service key is not for the preview project; refusing");
    if (claims.role !== "service_role") fail("PREVIEW_SUPABASE_SERVICE_ROLE_KEY is not a service_role key");
  } catch {
    fail("could not read the service key");
  }
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Deterministic UUID for a seed object, so re-runs never duplicate. */
function seedId(key) {
  const h = createHash("sha256").update(`longboard-preview-seed:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Small seeded PRNG so the same history comes out every time. */
let state = 20261015;
function rand() {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
}
const pick = (list) => list[Math.floor(rand() * list.length)];

async function check(label, promise) {
  const { data, error } = await promise;
  if (error) fail(`${label}: ${error.message}`);
  return data;
}

// --- Fake members. All addresses use the reserved .invalid TLD, so no mail can ever be delivered. ---
const MEMBERS = [
  { key: "avery", name: "Avery Admin", email: "avery.admin@preview.longboard.invalid", admin: true, cohort: "boardroom-cohort-1" },
  { key: "alice", name: "Alice Preview", email: "alice@preview.longboard.invalid", cohort: "boardroom-cohort-1" },
  { key: "bob", name: "Bob Preview", email: "bob@preview.longboard.invalid", cohort: "boardroom-cohort-2" },
  { key: "carol", name: "Carol Preview", email: "carol@preview.longboard.invalid", cohort: "boardroom-cohort-1" },
  { key: "dave", name: "Dave Preview", email: "dave@preview.longboard.invalid", cohort: "boardroom-cohort-2" },
  // No Boardroom tag: SOCIAL and GAINERS only, useful for access checks.
  { key: "mallory", name: "Mallory Outsider", email: "mallory@preview.longboard.invalid" },
];

const ROOMS = ["main", "social", "shortscout", "lb-announcements", "ss-announcements", "gainers", "lb-recordings", "ss-recordings", "whats-new"];

async function ensureUsers() {
  const existing = new Map();
  for (let page = 1; ; page++) {
    const data = await check("list users", db.auth.admin.listUsers({ page, perPage: 1000 }));
    for (const u of data.users) existing.set((u.email || "").toLowerCase(), u.id);
    if (data.users.length < 1000) break;
  }
  for (const m of MEMBERS) {
    let id = existing.get(m.email);
    if (!id) {
      const data = await check(
        `create ${m.key}`,
        db.auth.admin.createUser({ email: m.email, password, email_confirm: true, user_metadata: { preview_seed: true, name: m.name } }),
      );
      id = data.user.id;
    } else {
      await check(`password ${m.key}`, db.auth.admin.updateUserById(id, { password, email_confirm: true }));
    }
    m.userId = id;
  }
  // handle_new_user creates profiles; make sure they exist and carry the right role.
  for (const m of MEMBERS) {
    await check(
      `profile ${m.key}`,
      db.from("profiles").upsert({ id: m.userId, email: m.email, role: m.admin ? "admin" : "user" }, { onConflict: "id" }),
    );
    if (m.cohort)
      await check(`tag ${m.key}`, db.from("user_tags").upsert({ user_id: m.userId, tag: m.cohort }, { onConflict: "user_id,tag", ignoreDuplicates: true }));
    if (m.admin) await check("owner", db.from("longboard_chat_owners").upsert({ user_id: m.userId }, { onConflict: "user_id", ignoreDuplicates: true }));
    await check(`account ${m.key}`, db.from("chat_accounts").upsert({ id: m.userId, longboard_user_id: m.userId }, { onConflict: "id", ignoreDuplicates: true }));
    const member = await check(`member ${m.key}`, db.rpc("longboard_chat_link_member", { p_user_id: m.userId, p_name: m.name, p_token_hash: null }));
    m.memberId = member.id;
  }
}

async function ensureRooms() {
  await check(
    "rooms",
    db.from("longboard_chat_room_state").upsert(
      ROOMS.map((room_slug, i) => ({ id: i + 1, room_slug, is_open: true })),
      { onConflict: "room_slug", ignoreDuplicates: true },
    ),
  );
}

const TICKERS = ["AAPL", "TSLA", "NVDA", "AMD", "PLTR", "SOFI", "GME", "SPY", "QQQ", "MSFT", "HOOD", "RIVN"];
const LINES = [
  "Morning all. {T} gapping up on volume, watching the open.",
  "Anyone else see {T} reclaim VWAP? Looks strong.",
  "Took a starter in {T}, stop under the morning low.",
  "{T} fading hard after the first 15 minutes.",
  "Premarket range on {T} is tight today, waiting for a break.",
  "Good call on {T} yesterday.",
  "I'm sitting on my hands until 10am.",
  "Coffee number three. Market is choppy.",
  "Does anyone have a good read on the CPI print this week?",
  "{T} short interest is getting silly.",
  "Trimmed half of {T} into strength.",
  "Lunch chop, stepping away for a bit.",
  "Power hour. {T} pushing highs of day.",
  "Closed green today, small but I'll take it.",
  "What's everyone's plan for {T} into earnings?",
  "That was a nasty flush on {T}.",
  "Reminder: size down on Fridays.",
  "{T} holding the 50-day like a champ.",
  "Not chasing {T} here, too extended.",
  "Thanks for the heads up earlier!",
];
const SOCIAL = [
  "Happy Friday everyone!",
  "Anyone watching the game tonight?",
  "Just got back from a run, legs are toast.",
  "Recommend a good book? Finished my last one.",
  "My dog stole my sandwich again.",
  "Weather is perfect here today.",
  "Who's going to the meetup next month?",
  "Trying a new coffee place this morning.",
  "Weekend plans: absolutely nothing.",
  "Ha, that's great.",
  "Welcome to the new folks!",
  "Pizza or tacos for dinner? Need a ruling.",
];
const REPLIES = ["Agreed.", "Same here.", "Good point.", "Interesting, thanks.", "Ha!", "I'm in too.", "Not so sure about that one.", "Nice work.", "+1", "Following."];

function buildMessages() {
  const now = Date.now();
  const start = now - 3 * 24 * 3600 * 1000;
  const end = now - 10 * 60 * 1000;
  const rooms = [
    { room: "main", count: 140, writers: ["avery", "alice", "bob", "carol", "dave"], lines: LINES },
    { room: "social", count: 130, writers: ["avery", "alice", "bob", "carol", "dave", "mallory"], lines: SOCIAL },
    { room: "shortscout", count: 15, writers: ["avery"], lines: LINES },
  ];
  const all = [];
  for (const r of rooms) {
    const roomMessages = [];
    for (let i = 0; i < r.count; i++) {
      const author = pick(r.writers);
      const t = Math.round(start + ((end - start) * (i + rand() * 0.5)) / r.count);
      let reply = null;
      let body;
      // Roughly one in five is a reply; a few reply to a reply (nested thread).
      if (roomMessages.length > 5 && rand() < 0.2) {
        const recent = roomMessages.slice(-12).filter((m) => m.author !== author);
        if (recent.length) {
          reply = pick(recent);
          body = pick(REPLIES);
          if (rand() < 0.3) {
            const target = MEMBERS.find((m) => m.key === reply.author);
            body = `@${target.name} ${body}`;
          }
        }
      }
      if (!body) body = pick(r.lines).replaceAll("{T}", pick(TICKERS));
      const msg = { key: `${r.room}:${i}`, room: r.room, author, body, reply, at: t };
      roomMessages.push(msg);
    }
    all.push(...roomMessages);
  }
  // Announcements and recordings are admin-only and threads are not allowed in recordings.
  const day = 24 * 3600 * 1000;
  const extra = [
    ["lb-announcements", "Welcome to the preview environment. Everything here is fake test data."],
    ["lb-announcements", "Reminder: market holiday schedule is posted in the help center."],
    ["ss-announcements", "ShortScout preview: new scanner columns are live for testing."],
    ["lb-recordings", "Recording: Tuesday market review (preview placeholder)."],
    ["ss-recordings", "Recording: Mastermind session (preview placeholder)."],
  ];
  extra.forEach(([room, body], i) => all.push({ key: `${room}:${i}`, room, author: "avery", body, reply: null, at: start + (i + 1) * day * 0.4 }));
  return all.sort((a, b) => a.at - b.at);
}

async function insertMessages(messages) {
  const byKey = Object.fromEntries(MEMBERS.map((m) => [m.key, m]));
  const rows = messages.map((m) => {
    m.id = seedId(`message:${m.key}`);
    const author = byKey[m.author];
    return {
      id: m.id,
      guest_id: author.memberId,
      member_id: author.memberId,
      room_slug: m.room,
      author_label: author.name,
      body: m.body,
      reply_to_id: m.reply ? seedId(`message:${m.reply.key}`) : null,
      client_id: seedId(`client:${m.key}`),
      created_at: new Date(m.at).toISOString(),
    };
  });
  // Chronological batches; a reply's parent is always in an earlier or the same batch, earlier row.
  for (let i = 0; i < rows.length; i += 50)
    await check(`messages ${i}`, db.from("longboard_chat_messages").upsert(rows.slice(i, i + 50), { onConflict: "id", ignoreDuplicates: true }));
  return rows.length;
}

async function insertGainers() {
  const alerts = [
    "GAINERS (preview): ABCD +42% on 3.1M volume",
    "GAINERS (preview): WXYZ +28% after-hours, news pending",
    "GAINERS (preview): FAKE +65% halted, resumes 10:14",
  ];
  const base = Date.now() - 2 * 24 * 3600 * 1000;
  const channel = "-1000000000001";
  const seen = await check("gainers sources", db.from("chat_gainers_sources").select("source_message_id").eq("channel_id", channel));
  const done = new Set(seen.map((r) => Number(r.source_message_id)));
  for (const [i, body] of alerts.entries())
    if (!done.has(i + 1)) await check(
      `gainers ${i}`,
      db.rpc("ingest_chat_gainers_alert", { p_channel: channel, p_source_id: i + 1, p_posted_at: new Date(base + i * 3600 * 1000).toISOString(), p_body: body }),
    );
  return alerts.length;
}

async function addReactions(messages) {
  const byKey = Object.fromEntries(MEMBERS.map((m) => [m.key, m]));
  const emojis = ["like", "like", "heart", "laugh", "rob"];
  let count = 0;
  for (const m of messages.filter((x) => x.room === "main" || x.room === "social")) {
    if (rand() > 0.15) continue;
    const reactors = MEMBERS.filter((x) => x.key !== m.author && (m.room === "social" || x.cohort || x.admin));
    for (const r of reactors.slice(0, 1 + Math.floor(rand() * 3))) {
      await check(
        "reaction",
        db.rpc("set_chat_message_reaction", { p_actor: byKey[r.key].userId, p_room: m.room, p_conversation: null, p_message: m.id, p_emoji: pick(emojis), p_active: true }),
      );
      count++;
    }
  }
  return count;
}

async function addPins(messages) {
  const admin = MEMBERS.find((m) => m.admin);
  const pins = [messages.find((m) => m.room === "main" && !m.reply), messages.find((m) => m.room === "social" && !m.reply)];
  for (const m of pins) await check("pin", db.rpc("set_chat_room_message_pin", { p_actor: admin.userId, p_room: m.room, p_message: m.id, p_pin: true }));
  return pins.length;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function addDirectMessages() {
  const alice = MEMBERS.find((m) => m.key === "alice");
  const bob = MEMBERS.find((m) => m.key === "bob");
  const act = (who, action, target, body, key) =>
    check(
      `dm ${action}`,
      db.rpc("longboard_chat_dm_action", { p_user_id: who.userId, p_action: action, p_target: target, p_body: body, p_client_id: key ? seedId(`dm:${key}`) : null, p_value: null }),
    );
  const request = await act(alice, "request", bob.memberId, "Hey Bob, got a minute to compare notes on NVDA?", "request");
  const conversation = request.conversationId;
  const { data: convo } = await db.from("longboard_chat_conversations").select("status").eq("id", conversation).single();
  if (convo?.status === "pending") await act(bob, "accept", conversation, null, null);
  const thread = [
    [bob, "Sure, I'm watching the 140 level."],
    [alice, "Same. If it loses that I'm out."],
    [bob, "Sounds like a plan. Talk after the close?"],
    [alice, "Deal."],
  ];
  for (const [i, [who, body]] of thread.entries()) {
    await act(who, "send", conversation, body, `send:${i}`);
    await pause(1700);
  }
  return thread.length + 1;
}

await ensureRooms();
await ensureUsers();
const messages = buildMessages();
const roomCount = await insertMessages(messages);
const gainers = await insertGainers();
const reactions = await addReactions(messages);
const pins = await addPins(messages);
const dms = await addDirectMessages();
console.log(
  JSON.stringify({ project: PREVIEW_REF, members: MEMBERS.map((m) => `${m.name} <${m.email}>${m.admin ? " admin" : ""}`), roomMessages: roomCount, gainers, reactions, pins, directMessages: dms }, null, 1),
);
