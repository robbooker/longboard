// #330: makes or revokes Wren's API token. Not run by any migration or deploy.
//
//   node --env-file=.env.local scripts/chat-bots/wren-token.mjs mint            first token
//   node --env-file=.env.local scripts/chat-bots/wren-token.mjs mint --rotate   revoke the old one, make a new one
//   node --env-file=.env.local scripts/chat-bots/wren-token.mjs revoke          stop Wren at once
//
// The token goes only to ~/.config/company-dashboard/agents/wren-chat.token (mode 600), or to
// --out <path>. It is never printed. Only its SHA-256 is stored in the database.
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const EMAIL = "wren@bot.longboard.invalid";
const args = process.argv.slice(2);
const command = args[0];
const outAt = args.indexOf("--out");
const path = outAt >= 0 ? args[outAt + 1] : join(homedir(), ".config/company-dashboard/agents/wren-chat.token");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!["mint", "revoke"].includes(command) || !path) {
  console.error("Usage: wren-token.mjs mint [--rotate] [--out <path>] | revoke [--out <path>]");
  process.exit(1);
}
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

async function revokeAll(id) {
  const { tokens } = await must("list tokens", db.rpc("list_chat_api_tokens", { actor: id }));
  for (const token of tokens) await must("revoke token", db.rpc("revoke_chat_api_token", { actor: id, p_id: token.id }));
  return tokens.length;
}

async function main() {
  const profile = await must("read account", db.from("profiles").select("id").eq("email", EMAIL).maybeSingle());
  if (!profile) throw new Error("No Wren account yet. Run create-wren.mjs first.");
  const id = profile.id;
  if (command === "revoke") {
    const count = await revokeAll(id);
    await rm(path, { force: true });
    console.log(`Revoked ${count} token(s). Removed ${path}.`);
    return;
  }
  // Never mint a token for an account that isn't restricted: it would act as an ordinary member.
  const bot = await must("read bot row", db.from("chat_bot_accounts").select("allowed_rooms").eq("account_id", id).maybeSingle());
  if (!bot) throw new Error("This account isn't marked as a bot. Run create-wren.mjs first.");
  const { tokens } = await must("list tokens", db.rpc("list_chat_api_tokens", { actor: id }));
  if (tokens.length && !args.includes("--rotate"))
    throw new Error("Wren already has a token. Use --rotate to replace it, or revoke to stop it.");

  const token = "lbc_" + randomBytes(32).toString("base64url");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(token + "\n");
    await file.close();
    if (tokens.length) await revokeAll(id);
    const made = await must(
      "create token",
      db.rpc("create_chat_api_token", {
        actor: id,
        p_label: "Wren",
        p_hash: createHash("sha256").update(token).digest("hex"),
        p_hint: token.slice(-4),
      }),
    );
    if (made.status !== "created") throw new Error(`Token not created: ${made.status}`);
    await rename(temporary, path);
    await chmod(path, 0o600);
    console.log(`Token saved to ${path} (mode 600), rooms ${bot.allowed_rooms.join(", ")}.`);
  } finally {
    await rm(temporary, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
