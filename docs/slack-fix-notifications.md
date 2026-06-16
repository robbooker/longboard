# Slack Fix Notifications

Use the `Notify Slack when a Longboard fix is live` GitHub Action after a Longboard fix has been merged and verified in production.

## One-time setup

1. Use the existing `#rob-liz` Slack channel in Buddyclaw and `#business-updates` in Longboard.
2. Create a Slack incoming webhook for each channel.
3. In GitHub, open `robbooker/longboard` repo settings.
4. Go to `Secrets and variables` -> `Actions` -> `New repository secret`.
5. Add the Buddyclaw `#rob-liz` webhook as `LONGBOARD_SLACK_WEBHOOK_URL`.
6. Add the Longboard `#business-updates` webhook as `LONGBOARD_BUSINESS_UPDATES_SLACK_WEBHOOK_URL`.

Both repository secrets were configured on June 16, 2026.

## Sending a notification

In GitHub:

1. Open `Actions`.
2. Choose `Notify Slack when a Longboard fix is live`.
3. Click `Run workflow`.
4. Fill in the fix summary, verified live URL, PR number or URL, and optional notes.

From the CLI:

```sh
gh workflow run notify-liz.yml \
  -f summary="Fixed the charts Ghost Pivot toggle persistence" \
  -f url="https://www.longboardai.com/charts" \
  -f pr="139" \
  -f notes="Verified on production after merge."
```

To mention Liz directly, use Slack's member ID format in the optional `liz_mention` field, for example `<@U12345678>`.
