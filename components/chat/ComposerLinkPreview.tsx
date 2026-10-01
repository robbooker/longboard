import { chatComposerLinks } from '@/lib/chatComposerLinks';
import styles from './ComposerLinkPreview.module.css';

export default function ComposerLinkPreview({ body }: { body: string }) {
  const links = chatComposerLinks(body);
  if (!links.length) return null;
  return <nav className={styles.preview} aria-label="Links in your draft">
    <span className={styles.label}>Links · open in a new tab</span>
    <ul className={styles.links}>
      {links.map(link => <li key={link.href}>
        <a href={link.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link.label}</a>
      </li>)}
    </ul>
  </nav>;
}
