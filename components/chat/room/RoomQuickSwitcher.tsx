"use client";
import { CHAT_ROOMS, type ChatRoom } from "@/lib/publicChat";
import { useEffect, useState } from "react";
import QuickSwitcher, { type QuickSwitchItem } from "../QuickSwitcher";

// The DM list (owned by DirectInbox in the outer component) for the quick switcher.
type DmListRow = { id: string; name: string; unread: number };
let latestDmList: DmListRow[] = [];
export function publishDmList(rows: DmListRow[]) {
  latestDmList = rows;
  window.dispatchEvent(new CustomEvent("chat-dm-list", { detail: rows }));
}

/** Ctrl/⌘K quick switcher over the rooms this member can open and their DMs (QUICK-SWITCH). */
export default function RoomQuickSwitcher({
  allowedRooms,
  roomCounts,
  onClose,
  onSelectRoom,
  onSelectDm,
}: {
  allowedRooms: ChatRoom[];
  roomCounts: Partial<Record<ChatRoom, number>> | undefined;
  onClose: () => void;
  onSelectRoom: (room: ChatRoom) => void;
  onSelectDm: (conversationId: string) => void;
}) {
  const [dmList, setDmList] = useState<DmListRow[]>(() => latestDmList);
  useEffect(() => {
    const onList = (event: Event) => setDmList((event as CustomEvent<DmListRow[]>).detail);
    window.addEventListener("chat-dm-list", onList);
    return () => window.removeEventListener("chat-dm-list", onList);
  }, []);
  return (
    <QuickSwitcher
      onClose={onClose}
      items={[
        ...CHAT_ROOMS.filter((option) => allowedRooms.includes(option.slug)).map(
          (option): QuickSwitchItem => ({
            key: `room:${option.slug}`,
            label:
              option.slug === "social"
                ? "Social"
                : option.slug === "gainers"
                  ? "Gainers"
                  : option.slug === "whats-new"
                    ? option.label
                    : option.label.split(" ")[0],
            hint: option.slug.endsWith("-announcements")
              ? "Announcements"
              : option.slug.endsWith("-recordings")
                ? "Recordings"
                : option.slug === "whats-new"
                  ? "Updates"
                  : "Room",
            unread: roomCounts?.[option.slug] ?? 0,
            onSelect: () => onSelectRoom(option.slug),
          }),
        ),
        ...dmList.map((dm): QuickSwitchItem => ({
          key: `dm:${dm.id}`,
          label: dm.name,
          hint: "Direct message",
          unread: dm.unread,
          onSelect: () => onSelectDm(dm.id),
        })),
      ]}
    />
  );
}
