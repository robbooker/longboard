import { membershipLabels } from "@/lib/chatMemberships";
import styles from "./MembershipBadges.module.css";
const names = { LB: "Longboard member", SS: "ShortScout member", bot: "Bot account" };
export default function MembershipBadges({ memberships }: { memberships?: unknown }) {
  const labels = membershipLabels(memberships);
  if (!labels.length) return null;
  return (
    <span className={styles.badges}>
      {labels.map((label) => (
        <span
          key={label}
          className={styles.badge}
          data-membership={label}
          title={names[label]}
          aria-label={names[label]}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
/** #330: on messages only the "bot" badge shows; LB/SS stay in the Member List (D-218). */
export function BotBadge({ memberships }: { memberships?: unknown }) {
  return membershipLabels(memberships).includes("bot") ? <MembershipBadges memberships={["bot"]} /> : null;
}
