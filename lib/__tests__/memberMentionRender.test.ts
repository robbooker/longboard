import { afterEach, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageBody from "@/components/chat/ChatMessageBody";
import { MemberLinkProvider, rememberMentionMember, renderComposerTags, renderMentions, resetMentionMembers } from "@/components/chat/MemberMention";
// #317: tags of real members render as links; anything else stays plain text.
const jammie = { id: "11111111-1111-4111-8111-111111111111", display_name: "Jammie" };
const members = new Map([["jammie", jammie]]);
const html = (nodes: unknown) => renderToStaticMarkup(createElement(Fragment, null, nodes as never));
afterEach(() => resetMentionMembers());
it("draws a member's tag as a profile button and leaves unknown tags as text", () => {
  const out = renderToStaticMarkup(createElement(MemberLinkProvider, { value: { selfId: "me", open: () => {} } }, ...renderMentions("Hi @Jammie and @Nobody", members)));
  expect(out).toContain(`<button type="button"`);
  expect(out).toContain(`data-member-tag="${jammie.id}"`);
  expect(out).toContain(">@Jammie</button>");
  expect(out).toContain(" and @Nobody");
  expect(out).not.toContain("<mark");
  expect(out.match(/<button/g)).toHaveLength(1);
});
it("keeps the Buddy highlight and leaves text without tags untouched", () => {
  expect(html(renderMentions("ask @Buddy", new Map(), ["Buddy"]))).toMatch(/^ask <mark[^>]*>@Buddy<\/mark>$/);
  expect(renderMentions("no tags here", members)).toEqual(["no tags here"]);
});
it("without a chat around it a tag is still styled but not a button", () => {
  expect(html(renderMentions("@Jammie", members))).toMatch(/^<span[^>]*>@Jammie<\/span>$/);
});
it("renders older messages' tags as links at display time, in any case", () => {
  rememberMentionMember(jammie);
  const out = renderToStaticMarkup(createElement(MemberLinkProvider, { value: { open: () => {} } }, createElement(ChatMessageBody, { body: "thanks @jammie, and @Ghost https://example.com" })));
  expect(out).toContain(">@jammie</button>");
  expect(out).toContain("@Ghost");
  expect(out).not.toContain(">@Ghost<");
  expect(out).toContain(`href="https://example.com"`);
});
it("marks tags in the message box copy", () => {
  expect(html(renderComposerTags("hey @Jammie ", members))).toBe("hey <mark>@Jammie</mark> ");
});
