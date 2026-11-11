// #436: the latest press release under a stock's first Gainers alert of the day: the headline as a
// link to the release (DilutionTracker's dilution.news link, a new tab), then its wire and Eastern
// time ("ACCESS Newswire · 7:02 AM ET"). Everything is React text; the link is checked as http(s)
// by the server before it gets here.
import { alertNewsMeta, type GainersAlertNews as News } from "@/lib/chatGainersAlertNews";
import styles from "./GainersAlertNews.module.css";
import chatStyles from "./PublicChat.module.css";

export default function GainersAlertNews({ news, alertAt }: { news: News; alertAt: string }) {
  const meta = alertNewsMeta(news, alertAt);
  return (
    <div className={styles.news} data-alert-news role="group" aria-label="Latest press release">
      <span className={styles.label} aria-hidden="true">
        PR
      </span>
      <span className={styles.text}>
        <a
          className={`${chatStyles.bodyLink} ${styles.link}`}
          href={news.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {news.title}
        </a>
        {meta && (
          <span className={styles.meta} data-alert-news-meta>
            {meta}
          </span>
        )}
      </span>
    </div>
  );
}
