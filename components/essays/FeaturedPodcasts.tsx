import { podcastEpisodes, SPOTIFY_SHOW_URL } from "@/content/podcastEpisodes";
import type { PodcastEpisode } from "@/content/podcastEpisodes";

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function PodcastCard({ episode }: { episode: PodcastEpisode }) {
  return (
    <div className="podcast-card">
      <p className="podcast-card-kicker">
        Episode {pad3(episode.number)} · {episode.durationMinutes} min
      </p>
      <h3 className="podcast-card-title">{episode.title}</h3>
      <div className="podcast-card-embed">
      <iframe
        src={`https://open.spotify.com/embed/episode/${episode.spotifyId}?utm_source=generator&theme=0`}
        width="100%"
        height="152"
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        style={{ borderRadius: 2 }}
      />
      </div>
    </div>
  );
}

/** Picks the two featured episodes: episode 001 (pinned) + the episode
 *  matching the lead essay. Dedupes if both would be 001. */
function pickFeatured(leadIssue: number): PodcastEpisode[] {
  const ep1 = podcastEpisodes.find((ep) => ep.number === 1)!;
  const matchLead = podcastEpisodes.find((ep) => ep.number === leadIssue);

  if (matchLead && matchLead.number !== 1) {
    return [ep1, matchLead];
  }

  // Lead is episode 1 or has no matching podcast — dedupe by picking
  // the highest-numbered episode instead.
  const fallback = [...podcastEpisodes].sort((a, b) => b.number - a.number)[0];
  if (fallback.number !== 1) {
    return [ep1, fallback];
  }

  // Only one episode exists — single card.
  return [ep1];
}

export default function FeaturedPodcasts({ leadIssue }: { leadIssue: number }) {
  const featured = pickFeatured(leadIssue);

  return (
    <section className="featured-podcasts" aria-labelledby="featured-podcasts-heading">
      <div className="featured-podcasts-head">
        <h2 id="featured-podcasts-heading" className="featured-podcasts-kicker">
          § Listen · featured episodes
        </h2>
        <a href={SPOTIFY_SHOW_URL} className="featured-podcasts-all">
          All 12 on Spotify →
        </a>
      </div>
      <div className={`podcast-grid ${featured.length === 1 ? "podcast-grid-single" : ""}`}>
        {featured.map((ep) => (
          <PodcastCard key={ep.number} episode={ep} />
        ))}
      </div>
    </section>
  );
}
