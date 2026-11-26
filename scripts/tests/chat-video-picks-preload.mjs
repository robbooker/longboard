// #529 Booker Tube browser test: a fake YouTube for the Next server. Every request the app makes to
// youtube.com is answered here, from memory, so the test never touches the network:
//  - a channel feed (https://www.youtube.com/feeds/videos.xml?channel_id=UC...) for each seeded
//    channel: ten of them carry the videos in chat-video-picks-feeds.json, SMB Capital carries the
//    hand-made checks below (a kept "shorting" video, two Shorts, an old video, a hype title), one
//    channel always fails, and the rest are empty feeds;
//  - a channel the admin adds in the test (by id and by @handle), and one that does not exist.
// VIDEO_PICKS_FULL=<path to a videos.json> serves that file's videos instead (for screenshots).
import { readFileSync } from 'node:fs';
const HOUR = 3_600_000, SMB = 'UCg3B_joekBGJ1s_4fRjsMKA', BROKEN = 'UCmq93bRnn9vD0dUPTutSkgQ', ADDED = 'UCtestKitchen0000000001A';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let channels = JSON.parse(readFileSync(new URL('./chat-video-picks-feeds.json', import.meta.url), 'utf8')).channels;
if (process.env.VIDEO_PICKS_FULL) {
  const full = JSON.parse(readFileSync(process.env.VIDEO_PICKS_FULL, 'utf8')), made = Date.parse(full.generatedAt);
  channels = {};
  for (const v of full.videos) (channels[v.channelId] ??= { name: v.channel, videos: [] }).videos.push({ id: v.id, title: v.title, description: v.descriptionSnippet, ageHours: Math.round((made - Date.parse(v.published)) / HOUR) });
} else {
  channels[SMB] = { name: 'SMB Capital', videos: [
    { id: 'SHORTINGok1', title: 'Shorting Parabolic Runners Without Blowing Up', description: 'Tape reading and level 2 on low float small cap gappers when shorting the frontside.', ageHours: 30 },
    { id: 'SHORTSurl01', title: 'Quick tape clip on a low float open', description: 'A clip.', ageHours: 20, shorts: true },
    { id: 'SHORTStag01', title: 'One rule for risk management #shorts', description: 'A clip.', ageHours: 22 },
    { id: 'TOOOLDvid01', title: 'Low float day trading recap from the spring', description: 'Small cap gappers.', ageHours: 24 * 120 },
    { id: 'HYPEvideo01', title: '100x Guaranteed Returns Buy Alert To The Moon', description: 'Join our signal group for discord signals. Get rich quick.', ageHours: 12 },
  ] };
  channels[ADDED] = { name: 'Test Kitchen & Co', videos: [{ id: 'ADDEDvideo1', title: 'A three.js scene from scratch', description: 'Creative coding with shaders.', ageHours: 5 }] };
}
const entry = (channelId, name, v) => `<entry><id>yt:video:${v.id}</id><yt:videoId>${v.id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${esc(v.title)}</title>
<link rel="alternate" href="https://www.youtube.com/${v.shorts ? 'shorts/' : 'watch?v='}${v.id}"/><author><name>${esc(name)}</name></author>
<published>${new Date(Date.now() - v.ageHours * HOUR).toISOString()}</published><updated>${new Date(Date.now() - v.ageHours * HOUR).toISOString()}</updated>
<media:group><media:title>${esc(v.title)}</media:title><media:thumbnail url="https://i4.ytimg.com/vi/${v.id}/hqdefault.jpg" width="480" height="360"/><media:description>${esc(v.description ?? '')}</media:description></media:group></entry>`;
const feed = (channelId, c) => `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
<id>yt:channel:${channelId}</id><yt:channelId>${channelId}</yt:channelId><title>${esc(c.name)}</title><author><name>${esc(c.name)}</name></author>
${c.videos.map(v => entry(channelId, c.name, v)).join('\n')}</feed>`;
const real = globalThis.fetch;
globalThis.videoPicksRequests = [];
globalThis.fetch = async (url, init) => {
  const address = String(url?.url ?? url);
  if (!/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|ytimg\.com|youtu\.be)\//.test(address)) return real(url, init);
  const parsed = new URL(address);
  globalThis.videoPicksRequests.push({ address, agent: new Headers(init?.headers).get('user-agent') });
  if (parsed.hostname === 'www.youtube.com' && parsed.pathname === '/@testkitchen')
    return new Response(`<!doctype html><html><head><link rel="canonical" href="https://www.youtube.com/channel/${ADDED}"><title>Test Kitchen</title></head><body></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  if (parsed.hostname !== 'www.youtube.com' || parsed.pathname !== '/feeds/videos.xml') return new Response('Not found', { status: 404 });
  const id = parsed.searchParams.get('channel_id');
  if (process.env.VIDEO_PICKS_FULL ? false : id === BROKEN) return new Response('Service unavailable', { status: 503 });
  // An id the collection was never given, and that the test doesn't add: YouTube says 404.
  if (!channels[id] && !/^UC[A-Za-z0-9_-]{22}$/.test(id ?? '') || id === 'UCnoSuchChannel000000000') return new Response('Not found', { status: 404 });
  return new Response(feed(id, channels[id] ?? { name: 'A quiet channel', videos: [] }), { status: 200, headers: { 'content-type': 'text/xml; charset=UTF-8' } });
};
