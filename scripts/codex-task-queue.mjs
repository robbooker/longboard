#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const command = process.argv[2] ?? "next";
const id = process.argv[3];
const outcome = process.argv.slice(4).join(" ").trim();

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listOpen() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("codex_task_queue")
    .select("id, list, title, notes, status, source, created_at")
    .eq("list", "longboard")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) throw error;
  return data ?? [];
}

async function claimTask(taskId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("codex_task_queue")
    .update({
      status: "in_progress",
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .in("status", ["open", "in_progress"])
    .select("id, list, title, notes, status, source, created_at")
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function completeTask(taskId, text) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("codex_task_queue")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      completed_by: "codex",
      outcome: text || "Completed by Codex.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select("id, status, title, completed_at, outcome")
    .maybeSingle();

  if (error) throw error;
  return data;
}

if (command === "next") {
  const tasks = await listOpen();
  console.log(JSON.stringify({ activeCount: tasks.length, task: tasks[0] ?? null }, null, 2));
} else if (command === "claim") {
  if (!id) throw new Error("Usage: codex-task-queue.mjs claim <id>");
  console.log(JSON.stringify(await claimTask(id), null, 2));
} else if (command === "complete") {
  if (!id) throw new Error("Usage: codex-task-queue.mjs complete <id> <outcome>");
  console.log(JSON.stringify(await completeTask(id, outcome), null, 2));
} else {
  throw new Error(`Unknown command: ${command}`);
}
