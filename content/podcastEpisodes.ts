export type PodcastEpisode = {
  number: number;
  title: string;
  spotifyId: string;
  durationMinutes: number;
};

export const SPOTIFY_SHOW_URL = "https://open.spotify.com/show/4vKn0gIDsPwwCryscEY9YB";

export const podcastEpisodes: PodcastEpisode[] = [
  { number: 1,  title: "The basic trade is against yourself.",                         spotifyId: "37TdVTeWIsZSbURm0afybb", durationMinutes: 14 },
  { number: 2,  title: "Never let a small loss become a huge one.",                    spotifyId: "4ragpPL4tleKwXRyoNKaA7", durationMinutes: 12 },
  { number: 3,  title: "Trade smaller than your ego likes.",                           spotifyId: "3UkjJjPXXN8ZcRWWUIVpr8", durationMinutes: 11 },
  { number: 4,  title: "You can't trade in the past.",                                 spotifyId: "1KOn9DHi4qX3vJ0uxKmfqQ", durationMinutes: 13 },
  { number: 5,  title: "Confidence is built, not declared.",                           spotifyId: "6LbC7pgCGKxO42s5FW79GW", durationMinutes: 12 },
  { number: 6,  title: "Your account should not be a democracy.",                      spotifyId: "4UGNKtVj6mr3YYcKTLtD2A", durationMinutes: 13 },
  { number: 7,  title: "Don't rent your conviction from other people.",                spotifyId: "5Dq6Iv04tWW4tmXr3HzhIJ", durationMinutes: 12 },
  { number: 8,  title: "Delegate the parts of trading that make you stupid.",          spotifyId: "2E7TODM3G8CESvO502H8mG", durationMinutes: 13 },
  { number: 9,  title: "The billion-dollar question, and what it actually answers.",   spotifyId: "6GkCctYbf5p0ETFTt3acvT", durationMinutes: 8 },
  { number: 10, title: "Average habits don't produce above-average returns.",          spotifyId: "72NSQ9rbMnsec77xEDX8rU", durationMinutes: 9 },
  { number: 11, title: "Turning pro mostly means cutting the amateur theater.",        spotifyId: "0WCyFdB0ipdeak2KxvctmD", durationMinutes: 13 },
  { number: 12, title: "Ambition is sacred, but it still needs a calendar.",           spotifyId: "4SELtJAQFtuOwLkdzlhXAN", durationMinutes: 11 },
];
