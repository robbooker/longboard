import { afterEach, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarTile } from "@/components/chat/ChatAvatar";
import { MemberLinkProvider, renderMentions, resetMentionMembers } from "@/components/chat/MemberMention";
import { MemberPictureProvider, PictureName, pictureViewLabel } from "@/components/chat/MemberPictureView";
// #414: names and pictures in the chat are buttons that open the larger picture view. Outside a
// chat (no provider around them) they stay what they were: plain text and a decorative tile.
const person = { memberId: "m1", name: "Jammie O’Neil", colorKey: "m1" };
// (createElement's types want `children` among the props; they are passed the usual way, after them.)
const inChat = (children: ReactNode) => renderToStaticMarkup(createElement(MemberPictureProvider, { theme: "dark" } as never, children));
afterEach(() => resetMentionMembers());

it("labels the view with the person's name", () => {
  expect(pictureViewLabel("Jammie")).toBe("View Jammie’s profile picture");
});
it("draws a name as a real button in a chat and as plain text outside one", () => {
  const out = inChat(createElement(PictureName, { person, className: "author" }));
  expect(out).toMatch(/^<button type="button" class="[^"]*author" title="View Jammie O’Neil’s profile picture" data-picture-view="">Jammie O’Neil<\/button>$/);
  expect(renderToStaticMarkup(createElement(PictureName, { person, className: "author" }))).toBe('<span class="author">Jammie O’Neil</span>');
});
it("shows what it is given in place of the name, and keeps a hidden name out of the Tab order", () => {
  expect(inChat(createElement(PictureName, { person: { ...person, name: "Buddy" } }, "@Buddy"))).toContain(">@Buddy</button>");
  expect(inChat(createElement(PictureName, { person, hidden: true }))).toContain('tabindex="-1"');
  expect(inChat(createElement(PictureName, { person }))).not.toContain("tabindex");
});
it("draws a small picture as a button only where it is asked to open the view", () => {
  const tile = { name: person.name, colorKey: person.colorKey, memberId: person.memberId };
  const button = inChat(createElement(AvatarTile, { ...tile, view: true }));
  expect(button).toMatch(/^<button type="button"/);
  expect(button).toContain('aria-label="View Jammie O’Neil’s profile picture"');
  expect(button).toContain('data-avatar="initials"');
  expect(button).not.toContain("aria-hidden");
  for (const plain of [inChat(createElement(AvatarTile, tile)), renderToStaticMarkup(createElement(AvatarTile, { ...tile, view: true }))]) {
    expect(plain).toMatch(/^<span/);
    expect(plain).toContain('aria-hidden="true"');
    expect(plain).not.toContain("<button");
  }
});
it("a bot's tile opens the view too, still without a picture", () => {
  const out = inChat(createElement(AvatarTile, { name: "Booker Chat Updates", colorKey: "updates", path: "a/1", bot: true, view: true }));
  expect(out).toMatch(/^<button type="button"/);
  expect(out).toContain('data-avatar="initials"');
  expect(out).not.toContain("<img");
});
it("another member's @tag opens the view; your own still opens your profile", () => {
  const jammie = { id: "11111111-1111-4111-8111-111111111111", display_name: "Jammie" };
  const tags = (selfId: string) => inChat(createElement(MemberLinkProvider, { value: { selfId, open: () => {} } }, ...renderMentions("Hi @Jammie", new Map([["jammie", jammie]]))));
  expect(tags("me")).toContain('title="View Jammie’s profile picture"');
  expect(tags(jammie.id)).toContain('title="Your profile"');
});
it("stays closed until someone opens it", () => {
  expect(inChat(createElement("p", null, "room"))).toBe("<p>room</p>");
});
