import { expect, it } from "vitest";
import { memberMentionQuery, insertMemberMention, splitMemberMentions } from "../publicChatMentions";
it("finds multi-word and Unicode member names without treating email addresses as mentions", () => {
 expect(memberMentionQuery("Hello @John J",13)?.query).toBe("John J");
 expect(memberMentionQuery("@José",5)?.query).toBe("José");
 expect(memberMentionQuery("a@example.com",13)).toBeNull();
 expect(memberMentionQuery("@Bob\nhello",10)).toBeNull();
});
it("inserts a selected name without removing the rest of the message", () => {
 expect(insertMemberMention("Hi @Jo, thanks",{start:3,end:6},"John Johnson")).toEqual({value:"Hi @John Johnson , thanks",cursor:17});
});
it("matches complete names, preserves text, and avoids name-prefix and regex collisions", () => {
 const text="Hi @John Johnson! @John. @Johnny @A.B";
 const parts=splitMemberMentions(text,["John","John Johnson","A.B"]);
 expect(parts.map(p=>p.text).join("")).toBe(text);
 expect(parts.filter(p=>p.mention).map(p=>p.text)).toEqual(["@John Johnson","@John","@A.B"]);
});
