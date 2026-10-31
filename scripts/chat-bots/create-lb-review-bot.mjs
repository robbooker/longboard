// #340: creates the bot account that posts the daily gainers page to LB Review. Same shape as Wren (#330).
// Creates the account (safe to run again). Not run by any migration or deploy.
//
//   node --env-file=.env.local scripts/chat-bots/create-lb-review-bot.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and migration
// 20261031120000_chat_lb_review.sql applied. The login has no password and an address that can't
// receive mail, so nobody can sign in as it; it only works through the token from lb-review-token.mjs.
// The member row comes before the bot row because the member-link function needs Social access,
// which a bot doesn't have. No token exists until after this script, so that moment is harmless.
import { createClient } from "@supabase/supabase-js";

const BOT = { email: "lb-review@bot.longboard.invalid", name: "Gainers Review", rooms: ["lb-review"] };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = async (what, query) => {
  const { data, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function main() {
  let profile = await must(
    "read profile",
    db.from("profiles").select("id,role").eq("email", BOT.email).maybeSingle(),
  );
  if (!profile) {
    const { data, error } = await db.auth.admin.createUser({ email: BOT.email, email_confirm: true });
    if (error || !data?.user?.id) throw new Error(`create login: ${error?.message ?? "no user returned"}`);
    await must("save profile", db.from("profiles").upsert({ id: data.user.id, email: BOT.email }, { onConflict: "id" }));
    profile = { id: data.user.id, role: "user" };
  }
  if (profile.role === "admin") throw new Error("This account has the admin role. Remove it first.");
  const id = profile.id;
  await must("save account", db.from("chat_accounts").upsert({ id, longboard_user_id: id }, { onConflict: "id" }));

  let member = await must(
    "read member",
    db.from("longboard_chat_members").select("id,display_name").eq("user_id", id).maybeSingle(),
  );
  if (!member) {
    const taken = await must(
      "check name",
      db.from("longboard_chat_members").select("id").ilike("display_name", BOT.name).maybeSingle(),
    );
    if (taken) throw new Error(`Another member is already named ${BOT.name}. Nothing was changed for them.`);
    // Only after a failed earlier run; no message or DM can depend on it without a member row.
    await must("clear partial bot row", db.from("chat_bot_accounts").delete().eq("account_id", id));
    member = await must(
      "create member",
      db.rpc("longboard_chat_link_member", { p_user_id: id, p_name: BOT.name, p_token_hash: null }),
    );
  } else if (member.display_name !== BOT.name) {
    throw new Error(`The member row is named ${member.display_name}, not ${BOT.name}.`);
  }
  await must(
    "restrict account",
    db.from("chat_bot_accounts").upsert({ account_id: id, allowed_rooms: BOT.rooms }, { onConflict: "account_id" }),
  );
  await must(
    "close message requests",
    db.from("longboard_chat_members").update({ accepts_requests: false }).eq("user_id", id),
  );
  await must(
    "allow API tokens",
    db.from("chat_api_access").upsert({ account_id: id, note: "Gainers Review: bot account (#340)" }, { onConflict: "account_id" }),
  );
  console.log(`Gainers Review is ready: account ${id}, rooms ${BOT.rooms.join(", ")}. Next: lb-review-token.mjs mint`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
