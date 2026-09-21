import { membershipLabels } from '@/lib/chatMemberships';
import styles from './MembershipBadges.module.css';
const names = { LB: 'Longboard', SS: 'ShortScout' };
export default function MembershipBadges({ memberships }: { memberships?: unknown }) {
  const labels = membershipLabels(memberships);
  if (!labels.length) return null;
  return <span className={styles.badges}>{labels.map(label => <span key={label} className={styles.badge} data-membership={label} title={names[label]} aria-label={`${names[label]} member`}>{label}</span>)}</span>;
}
