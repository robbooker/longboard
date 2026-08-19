import { describe, expect, it } from "vitest";
import {
  hasPedroMention,
  limitPedroReply,
  MAX_PEDRO_REPLY_LENGTH,
  promptForPedro,
} from "@/lib/boardroomChatPedro";

describe("Boardroom @pedrobot mentions", () => {
  it.each([
    "@pedrobot quote AIXC",
    "Could you check this, @PedroBot?",
    "(@pedrobot) scanner",
  ])("recognizes %s", (message) => {
    expect(hasPedroMention(message)).toBe(true);
  });

  it.each([
    "pedrobot quote AIXC",
    "rob@pedrobot.example",
    "@pedrobotics scanner",
  ])("does not recognize %s", (message) => {
    expect(hasPedroMention(message)).toBe(false);
  });

  it("removes the mention while preserving the request", () => {
    expect(promptForPedro("@pedrobot, please quote AIXC")).toBe("please quote AIXC");
    expect(promptForPedro("Can you help, @PedroBot? scanner")).toBe("Can you help? scanner");
  });

  it("limits persisted replies to the database allowance", () => {
    const reply = limitPedroReply("x".repeat(MAX_PEDRO_REPLY_LENGTH + 50));
    expect(reply).toHaveLength(MAX_PEDRO_REPLY_LENGTH);
    expect(reply.endsWith("…")).toBe(true);
  });
});
