# Sending Runner Risk Watch updates to the chat

For Jake, or whatever sends his "All Runner Risk Watch" report. One web request for each update.

## The address and the key

    POST https://www.longboardai.com/api/chat/runner-watch
    Authorization: Bearer <the secret key Rob gives you>
    Content-Type: application/json

Keep the key private. It only does this one thing. Anything sent without it is refused and nothing posts.
Use the `www` address as written.

## What to send

| Field | Needed? | What it is |
|---|---|---|
| `id` (or `dedupeKey`) | Recommended | Your own name for this update, up to about 190 characters. Send it again and it won't post twice. Left out, identical wording counts as the same update. |
| `tickers` | Optional | A list like `["SGRX"]`. Up to 20. Leave it out for a report about no one stock. |
| `summary` | Yes | Plain text, up to 1,000 characters. About the first 280 go in the chat, so lead with what matters. Web links are removed from the chat post but stay on the page. |
| `fullText` | Yes | The whole report, plain text, up to 50,000 characters. Links work if they are plain `https://...` addresses or written `[words](https://...)`. Only http and https count. HTML shows as plain characters. |
| `alert` | Optional | `true` when this update is an alert. Alerts also go to the main LB and SS rooms, up to 3 a day in each. Use it only for what those rooms should see. |
| `sentAt` | Optional | When it was written, like `2026-10-31T14:30:00Z`. |

## Example

    curl -X POST https://www.longboardai.com/api/chat/runner-watch \
      -H "Authorization: Bearer $RUNNER_WATCH_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "id": "2026-10-31-14-SGRX",
        "tickers": ["SGRX"],
        "summary": "New S-1 filed for up to 5M shares with warrants. Reverse split vote set for Nov 12.",
        "fullText": "Full report text here.\n\nFiling: https://www.sec.gov/Archives/example",
        "alert": true,
        "sentAt": "2026-10-31T14:30:00Z"
      }'

That posts something like this in the Runner Watch room, with "More about SGRX here" as a link to a page
only signed-in members can open. An alert also goes to LB and SS, starting "Runner Risk Watch alert:":

> Alert: New S-1 filed for up to 5M shares with warrants. Reverse split vote set for Nov 12.
>
> More about SGRX here
> AI-generated research from Jake's watchlist. Check it against the filings. Not trade advice.

## What comes back

| Answer | Means | What to do |
|---|---|---|
| 200 `posted` | It's in the room. | Nothing. |
| 200 `duplicate` | Already sent. Nothing new posted. | Nothing. |
| 200 `saved` | Rob has alerts-only on and this isn't an alert. Saved, not posted. | Nothing. |
| 429 `held` | Too many updates in a short time. Saved, not posted, and Rob has been told. | Slow down. Sending the same update again after an hour posts it if there's room. |
| 429 `refused` | Far too many. Not saved. | Stop and check the sender. |
| 400 | Something in the update is wrong; the answer says which, for example `summary_required`. | Fix it and resend. |
| 401 | The key is wrong or missing. | Check the key. |
| 413 | Over the size limit. | Shorten it. |
| 423 `room_paused` | The room is paused. | Send it again later. |
| 503 `feed_off` | Rob has the feed switched off. Nothing was saved. | Stop until he switches it on. |
| 503, other | A problem on our side. | Send it again later. The `id` keeps it from posting twice. |

The limits start at 12 posts an hour and 60 a day in Runner Watch, and 3 a day in each of LB and SS. A `posted` answer lists which main rooms got it in `mainRooms`, and any at their limit in `mainRoomsAtLimit`; those aren't sent later. Rob can change them, and can switch the feed off at any time.
