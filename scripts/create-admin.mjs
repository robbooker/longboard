import { createClient } from "@supabase/supabase-js";
import { Command } from "commander";

const program = new Command();

program
  .requiredOption("--email <email>")
  .requiredOption("--password <password>")
  .option("--confirm-email", "Mark email as confirmed", true)
  .parse(process.argv);

const opts = program.opts();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = String(opts.email).trim().toLowerCase();
const password = String(opts.password);

async function main() {
  const { data: created, error: createErr } = await supabase.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: Boolean(opts.confirmEmail),
    }
  );
  if (createErr) throw createErr;
  if (!created?.user?.id) throw new Error("createUser returned no user");

  const userId = created.user.id;

  const { error: promoteErr } = await supabase
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", userId);
  if (promoteErr) throw promoteErr;

  console.log(JSON.stringify({ ok: true, userId, email }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
