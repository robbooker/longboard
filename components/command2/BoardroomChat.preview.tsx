"use client";

import BoardroomChat from "@/components/command2/BoardroomChat";

const previewUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "preview@longboardai.com",
  role: "user" as const,
  boardroomCohorts: ["cohort-preview"],
};

export default function BoardroomChatPreview() {
  return (
    <div aria-label="Boardroom Chat interactive state preview">
      <BoardroomChat user={previewUser} />
    </div>
  );
}
