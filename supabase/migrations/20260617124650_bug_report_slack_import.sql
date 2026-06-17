alter table bug_report_queue
  add column if not exists slack_channel_id text,
  add column if not exists slack_message_ts text,
  add column if not exists slack_thread_ts text,
  add column if not exists slack_user_id text,
  add column if not exists slack_permalink text;

create unique index if not exists bug_report_queue_slack_message_unique
  on bug_report_queue(slack_channel_id, slack_message_ts);

create index if not exists bug_report_queue_source_created_idx
  on bug_report_queue(source, created_at desc);
