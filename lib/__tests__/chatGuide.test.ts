import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHAT_ROOMS } from "@/lib/publicChat";
import { guideForDrafting, loadChatGuide } from "@/lib/chatGuide";

// #344: the guide the FAQ AI reads. Its gaps and its notes for admins stay out; its rooms stay in step with the code.
const raw = readFileSync(path.join(process.cwd(), "content/chat-guide.md"), "utf8");

describe("guideForDrafting", () => {
  it("leaves out comments and any section still marked NEEDS ADMIN, and keeps its neighbours", () => {
    const out = guideForDrafting("<!-- note -->\n# Title\n\n## Rooms\n\n### One\nFine.\n\n### Two\nNEEDS ADMIN: say what this is\n\n### Three\nAlso fine.\n\n## Next\nMore.\n");
    expect(out).not.toContain("note");
    expect(out).not.toContain("Two");
    expect(out).not.toContain("NEEDS ADMIN");
    for (const kept of ["# Title", "## Rooms", "### One", "### Three", "## Next", "More."]) expect(out).toContain(kept);
  });
});

describe("the guide", () => {
  const guide = loadChatGuide();
  it("has a section for every room in the code", () => {
    for (const room of CHAT_ROOMS) expect(raw, room.label).toContain(`### ${room.label}\n`);
  });
  it("sends the AI no gap and no note to admins, and a gap is out of what it reads", () => {
    expect(raw).toContain("NEEDS ADMIN:");
    expect(guide).not.toContain("NEEDS ADMIN");
    expect(guide).not.toContain("Merging a change");
    expect(guide).not.toContain("### LB Recordings");
    expect(guide).not.toContain("### SS Recordings");
  });
  it("gives pin steps for rooms and DMs, on a computer and on a phone", () => {
    for (const steps of ["To pin a room on a computer:", "To pin a room on a phone:", "To pin a DM on a computer:", "To pin a DM on a phone:", "To unpin:"]) expect(guide).toContain(steps);
  });
  it("describes Gainers as the code does", () => {
    expect(guide).toMatch(/### Gainers\nA read-only channel of live alerts/);
  });
  it("names only controls the code really has", () => {
    const code = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    expect(code("components/chat/ChatPins.tsx")).toContain('{selected ? "Unpin" : "Pin"} {label}');
    expect(code("components/chat/room/PhoneInfoSheet.tsx")).toContain("<ChatPins");
    expect(code("components/chat/DirectInbox.tsx")).toContain('target={{ kind: "dm", conversationId: active.id }}');
    expect(code("components/chat/StartDirectMessage.tsx")).toContain("Start New DM");
    expect(code("lib/chatMessageReactions.ts")).toContain('laugh: "Laughing"');
    expect(code("lib/publicChat.ts")).toContain('room === "gainers"; }');
  });
});
