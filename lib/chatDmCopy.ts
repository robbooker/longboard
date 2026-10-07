/** Copy the canonical body, never rendered link labels, previews or message metadata. */
export async function copyDirectMessageText(
  body: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
) {
  if (!body.trim()) throw new Error("Media message — no text to copy.");
  if (!clipboard?.writeText) throw new Error("Copy is unavailable. Select the message text to copy it.");
  try {
    await clipboard.writeText(body);
  } catch {
    throw new Error("Could not copy. Try again, or select the message text to copy it.");
  }
}
