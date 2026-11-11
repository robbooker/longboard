import { afterEach, expect, it } from "vitest";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChatMessageBody from "@/components/chat/ChatMessageBody";
import { MemberLinkProvider, rememberMentionMember, rememberMessageTags, renderComposerTags, renderMentions, resetMentionMembers } from "@/components/chat/MemberMention";
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
// #439: a stored tag holds the person: typed under an earlier name, it shows who they are now.
const robert = { id: "22222222-2222-4222-8222-222222222222", display_name: "Robert Bobson" };
const MESSAGE = "33333333-3333-4333-8333-333333333333";
it("draws a tag typed under an earlier name with the current name, linked to the same person", () => {
  const out = renderToStaticMarkup(createElement(MemberLinkProvider, { value: { selfId: "me", open: () => {} } }, ...renderMentions("@Bob can you share your notes?", new Map([["bob", robert]]))));
  expect(out).toContain(`data-member-tag="${robert.id}"`);
  expect(out).toContain(`data-tagged-as="@Bob"`);
  expect(out).toContain(">@Robert Bobson</button> can you share your notes?");
});
it("a tag typed as the name is now keeps its own spelling and no earlier-name mark", () => {
  const out = html(renderMentions("hi @robert bobson", new Map([["robert bobson", robert]])));
  expect(out).toContain(">@robert bobson</span>");
  expect(out).not.toContain("data-tagged-as");
});
it("a room message's stored tags win over current names, and only for that message's text", () => {
  // Someone else is called Bob now; the stored tag still points to the person who was Bob then.
  rememberMentionMember({ id: "44444444-4444-4444-8444-444444444444", display_name: "Bob" });
  const body = "@Bob can you share your notes?";
  rememberMessageTags(MESSAGE, body, new Map([["bob", robert]]));
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(MemberLinkProvider, { value: { open: () => {} } }, createElement(ChatMessageBody, { body, ...props })));
  expect(render({ messageId: MESSAGE })).toContain(`data-member-tag="${robert.id}"`);
  expect(render({ messageId: MESSAGE })).toContain(">@Robert Bobson</button>");
  // Without the id (a DM), or after an edit (new text), the current name is used.
  expect(render({})).toContain(">@Bob</button>");
  expect(render({})).toContain('data-member-tag="44444444-4444-4444-8444-444444444444"');
});
it("the message box copy keeps the text exactly as typed", () => {
  expect(html(renderComposerTags("hey @Robert Bobson ", new Map([["robert bobson", robert]])))).toBe("hey <mark>@Robert Bobson</mark> ");
});
