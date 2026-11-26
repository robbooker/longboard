-- #529 Booker Tube: a curated page of public YouTube videos under Pages in chat.
--
-- A "collection" is one person's list: the channels to read, the topics and their weights, and
-- the videos currently picked from those channels. One collection is seeded here, Rob's, shared
-- with every member (owner_member_id null, visibility 'members'). A member's own collection later
-- is one more row with their member id and visibility 'private'; nothing else changes shape.
--
--  * chat_video_collections: title, owner (null = the house collection), who may see it, the
--    scoring numbers, the areas (Trading, Building, ...), the penalty phrases, and how the last
--    refresh went.
--  * chat_video_channels: the YouTube channels a collection reads (UC... id, name, area, topics).
--  * chat_video_topics: a collection's topics with their weight and weighted phrases.
--  * chat_video_picks: the collection's current videos (replaced as a whole by each refresh).
--  * store_chat_video_refresh(collection, videos, stats): swaps a collection's videos for a new
--    list and records the refresh, in one step, so readers never see half a list.
--  * chat_pages.kind may now also be 'video-picks' (at most one such page). The page row itself is
--    NOT added here: the app adds it after the first refresh that stores videos, so the sidebar
--    never shows the page before there is something on it, and never while older code is live
--    (older code would show an unknown kind as a list of links).
--
-- Like the other chat tables: RLS on, no policies, nothing for anon/authenticated; only the
-- service role reads and writes, from routes that check the member (or the cron secret) first.
--
-- Production when written (2026-11-26): none of these tables or the function exist.
-- Safe to apply before the code ships: nothing reads the new tables, no page row is added, and
-- widening the kind check changes nothing for the existing pages.
-- Rollback: supabase/rollbacks/20261126130000_chat_video_picks.down.sql

create table public.chat_video_collections(
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
 owner_member_id uuid references public.longboard_chat_members(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 1 and 60),
 visibility text not null default 'private' check(visibility in ('members','private')),
 window_days integer not null default 90 check(window_days between 1 and 365),
 scoring jsonb not null default '{}'::jsonb check(jsonb_typeof(scoring)='object'),
 areas jsonb not null default '[]'::jsonb check(jsonb_typeof(areas)='array'),
 penalties jsonb not null default '[]'::jsonb check(jsonb_typeof(penalties)='array'),
 refreshed_at timestamptz,
 refresh_stats jsonb,
 created_at timestamptz not null default now(),
 -- The house collection is the only one without an owner, and a member's is never shared by default.
 constraint chat_video_collections_shared_or_owned check(owner_member_id is not null or visibility='members')
);
create unique index chat_video_collections_one_per_member on public.chat_video_collections(owner_member_id) where owner_member_id is not null;

create table public.chat_video_channels(
 collection_id uuid not null references public.chat_video_collections(id) on delete cascade,
 channel_id text not null check(channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
 name text not null check(char_length(btrim(name)) between 1 and 120),
 area text not null check(area ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 topics text[] not null default '{}' check(cardinality(topics)<=6),
 note text check(note is null or char_length(note)<=300),
 position integer not null default 1000,
 added_by uuid references public.longboard_chat_members(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key(collection_id, channel_id)
);

create table public.chat_video_topics(
 collection_id uuid not null references public.chat_video_collections(id) on delete cascade,
 topic_id text not null check(topic_id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
 area text not null check(area ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 label text not null check(char_length(btrim(label)) between 1 and 60),
 weight numeric(5,2) not null default 1 check(weight>0 and weight<=10),
 keywords jsonb not null default '[]'::jsonb check(jsonb_typeof(keywords)='array'),
 position integer not null default 1000,
 primary key(collection_id, topic_id)
);

create table public.chat_video_picks(
 collection_id uuid not null references public.chat_video_collections(id) on delete cascade,
 video_id text not null check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
 channel_id text not null check(channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
 channel_name text not null check(char_length(channel_name) between 1 and 120),
 title text not null check(char_length(title) between 1 and 300),
 published_at timestamptz not null,
 area text not null check(area ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 primary_topic text,
 topics text[] not null default '{}',
 snippet text not null default '' check(char_length(snippet)<=400),
 score numeric(8,2) not null check(score>=0),
 primary key(collection_id, video_id)
);
create index chat_video_picks_channel on public.chat_video_picks(collection_id, channel_id);

-- A refresh hands over the whole new list; the old one is replaced in the same transaction.
create function public.store_chat_video_refresh(p_collection uuid, p_videos jsonb, p_stats jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_videos is null or jsonb_typeof(p_videos)<>'array' then raise exception 'chat_video_videos_not_a_list' using errcode='22023'; end if;
 perform 1 from public.chat_video_collections c where c.id=p_collection for update;
 if not found then raise exception 'chat_video_collection_not_found' using errcode='P0002'; end if;
 delete from public.chat_video_picks p where p.collection_id=p_collection;
 insert into public.chat_video_picks(collection_id,video_id,channel_id,channel_name,title,published_at,area,primary_topic,topics,snippet,score)
 select p_collection,v->>'id',v->>'channelId',v->>'channel',v->>'title',(v->>'published')::timestamptz,v->>'area',v->>'primaryTopic',
  coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v->'topics')='array' then v->'topics' else '[]'::jsonb end)),'{}'),
  coalesce(v->>'snippet',''),(v->>'score')::numeric
 from jsonb_array_elements(p_videos) v;
 get diagnostics v_count=row_count;
 update public.chat_video_collections c set refreshed_at=now(),refresh_stats=p_stats where c.id=p_collection;
 return v_count;
end $$;
revoke all on function public.store_chat_video_refresh(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.store_chat_video_refresh(uuid,jsonb,jsonb) to service_role;

alter table public.chat_video_collections enable row level security;
alter table public.chat_video_channels enable row level security;
alter table public.chat_video_topics enable row level security;
alter table public.chat_video_picks enable row level security;
revoke all on public.chat_video_collections,public.chat_video_channels,public.chat_video_topics,public.chat_video_picks from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.chat_video_collections,public.chat_video_channels,public.chat_video_topics,public.chat_video_picks to service_role;

-- Pages: one more kind. The old check is found by what it says, whatever it was named.
do $$
declare v_name text;
begin
 for v_name in select c.conname from pg_constraint c where c.conrelid='public.chat_pages'::regclass and c.contype='c'
   and pg_get_constraintdef(c.oid) like '%my-links%' and pg_get_constraintdef(c.oid) not like '%embed_url%' loop
  execute format('alter table public.chat_pages drop constraint %I', v_name);
 end loop;
end $$;
alter table public.chat_pages add constraint chat_pages_kind_check check(kind in ('embed','links','my-links','video-picks'));
create unique index chat_pages_one_video_picks on public.chat_pages(kind) where kind='video-picks';

-- The Booker Tube collection (Rob's picks): the channels and topics from the approved prototype (41 channels, 24 topics,
-- 5 areas, 11 penalty phrases). Its videos arrive with the first refresh.
insert into public.chat_video_collections(slug,title,visibility,window_days,scoring,areas,penalties) values
 ('booker-tube','Booker Tube','members',90,
  '{"titleMultiplier":2.4,"descriptionMultiplier":1.0,"channelTopicPrior":3.5,"recencyHalfLifeDays":30,"recencyMaxBonus":3.0,"minScoreToInclude":1.0}'::jsonb,
  '[{"id":"trading","label":"Trading","tagline":"Low-float tape, parabolic fades, filings, and calm execution under pressure"},{"id":"building","label":"Building","tagline":"Coding agents, creative shaders, live production, Linux craft, and bench electronics"},{"id":"business","label":"Business","tagline":"Tech strategy, off-social distribution, webinars, interviewing, and documenting the work"},{"id":"ideas","label":"Ideas","tagline":"Stoics, Emerson, first-principles science, long-form interviews, and the craft of attention"},{"id":"fun","label":"Fun","tagline":"Science fiction, birds in the wild, and editorial typography"}]'::jsonb,
  '[{"phrase":"guaranteed returns","penalty":8.0},{"phrase":"100x","penalty":5.0},{"phrase":"buy alert","penalty":7.0},{"phrase":"signal group","penalty":7.0},{"phrase":"discord signals","penalty":7.0},{"phrase":"to the moon","penalty":5.0},{"phrase":"get rich quick","penalty":6.0},{"phrase":"destroyed","penalty":2.5},{"phrase":"drama","penalty":3.0},{"phrase":"exposed","penalty":2.0},{"phrase":"clickbait","penalty":2.0}]'::jsonb);

insert into public.chat_video_topics(collection_id,topic_id,area,label,weight,keywords,position)
select c.id,v.topic_id,v.area,v.label,v.weight,v.keywords::jsonb,v.position from public.chat_video_collections c,(values
 ('low-float-day-trading','trading','Low-float day trading',1.2,'[{"phrase":"low float","weight":3.5},{"phrase":"low-float","weight":3.5},{"phrase":"small cap","weight":2.5},{"phrase":"small-cap","weight":2.5},{"phrase":"small caps","weight":2.5},{"phrase":"micro-cap","weight":2.4},{"phrase":"microcap","weight":2.4},{"phrase":"gainer","weight":2.2},{"phrase":"gappers","weight":2.6},{"phrase":"gapper","weight":2.6},{"phrase":"day trading","weight":1.8},{"phrase":"pre-market","weight":1.8},{"phrase":"premarket","weight":1.8},{"phrase":"tape reading","weight":2.5},{"phrase":"level 2","weight":2.2},{"phrase":"vwap","weight":2.0},{"phrase":"halt","weight":1.8},{"phrase":"float rotation","weight":3.2}]',10),
 ('shorting-parabolic-runners','trading','Shorting parabolic runners',1.25,'[{"phrase":"parabolic","weight":3.2},{"phrase":"shorting","weight":2.8},{"phrase":"short seller","weight":3.0},{"phrase":"short selling","weight":3.0},{"phrase":"short squeeze","weight":2.8},{"phrase":"backside","weight":2.8},{"phrase":"frontside","weight":2.6},{"phrase":"blowoff top","weight":3.0},{"phrase":"first red day","weight":3.0},{"phrase":"exhaustion","weight":2.2},{"phrase":"fade","weight":1.8},{"phrase":"runner","weight":2.0},{"phrase":"locates","weight":2.6},{"phrase":"borrow fee","weight":2.6},{"phrase":"scam","weight":2.0}]',20),
 ('dilution-offerings','trading','Dilution & offerings',1.25,'[{"phrase":"dilution","weight":3.5},{"phrase":"offering","weight":2.8},{"phrase":"secondary offering","weight":3.2},{"phrase":"registered direct","weight":3.2},{"phrase":"atm offering","weight":3.2},{"phrase":"s-1","weight":2.6},{"phrase":"s-3","weight":2.8},{"phrase":"shelf","weight":2.2},{"phrase":"warrants","weight":2.8},{"phrase":"warrant","weight":2.5},{"phrase":"convertible","weight":2.4},{"phrase":"sec filing","weight":3.0},{"phrase":"sec filings","weight":3.0},{"phrase":"reverse split","weight":2.8},{"phrase":"toxic financing","weight":3.2},{"phrase":"424b","weight":3.0}]',30),
 ('chinese-hk-small-caps','trading','Chinese & HK small caps',1.2,'[{"phrase":"chinese small cap","weight":4.0},{"phrase":"china small cap","weight":3.8},{"phrase":"hong kong","weight":2.8},{"phrase":"hk small cap","weight":3.8},{"phrase":"chinese adr","weight":3.5},{"phrase":"china adr","weight":3.5},{"phrase":"chinese stocks","weight":2.8},{"phrase":"cayman","weight":2.2},{"phrase":"ipo pump","weight":3.0},{"phrase":"f-1","weight":2.4},{"phrase":"f-3","weight":2.4}]',40),
 ('live-trading-camera','trading','Live trading on camera',1.1,'[{"phrase":"live trading","weight":3.2},{"phrase":"trading live","weight":3.2},{"phrase":"live tape","weight":2.8},{"phrase":"market open","weight":2.2},{"phrase":"trade review","weight":2.4},{"phrase":"trade recap","weight":2.2},{"phrase":"order flow","weight":2.5},{"phrase":"prop desk","weight":2.5},{"phrase":"playbook","weight":2.2},{"phrase":"execution","weight":1.8}]',50),
 ('trading-psychology-flow','trading','Trading psychology & flow',1.2,'[{"phrase":"trading psychology","weight":3.5},{"phrase":"steenbarger","weight":3.5},{"phrase":"mental game","weight":3.0},{"phrase":"tilt","weight":2.6},{"phrase":"fomo","weight":2.2},{"phrase":"revenge trading","weight":2.8},{"phrase":"under pressure","weight":2.6},{"phrase":"flow state","weight":2.8},{"phrase":"drawdown","weight":2.5},{"phrase":"risk management","weight":2.4},{"phrase":"discipline","weight":1.8},{"phrase":"mistakes","weight":1.8},{"phrase":"blowing up","weight":2.6}]',60),
 ('ai-coding-agents','building','AI coding agents',1.25,'[{"phrase":"claude code","weight":3.8},{"phrase":"coding agent","weight":3.5},{"phrase":"coding agents","weight":3.5},{"phrase":"agentic coding","weight":3.5},{"phrase":"agent workflow","weight":3.2},{"phrase":"agent workflows","weight":3.2},{"phrase":"sub-agent","weight":3.0},{"phrase":"sub agent","weight":3.0},{"phrase":"context engineering","weight":3.2},{"phrase":"mcp","weight":2.8},{"phrase":"model context protocol","weight":3.2},{"phrase":"ai agents","weight":2.8},{"phrase":"agentic","weight":2.5},{"phrase":"tool use","weight":2.4},{"phrase":"cursor","weight":2.0},{"phrase":"aider","weight":2.4},{"phrase":"llm","weight":1.6}]',70),
 ('threejs-creative-coding','building','Three.js & creative coding',1.2,'[{"phrase":"three.js","weight":3.8},{"phrase":"threejs","weight":3.8},{"phrase":"creative coding","weight":3.5},{"phrase":"webgl","weight":3.2},{"phrase":"glsl","weight":3.2},{"phrase":"shader","weight":2.8},{"phrase":"shaders","weight":2.8},{"phrase":"perlin noise","weight":3.0},{"phrase":"flow field","weight":3.0},{"phrase":"p5.js","weight":2.8},{"phrase":"procedural","weight":2.4},{"phrase":"ray tracing","weight":2.6},{"phrase":"generative art","weight":3.0},{"phrase":"coding challenge","weight":2.4},{"phrase":"coding adventure","weight":2.6}]',80),
 ('live-streaming-production','building','Live streaming & studio craft',1.15,'[{"phrase":"obs studio","weight":3.5},{"phrase":"obs","weight":2.6},{"phrase":"live stream","weight":2.6},{"phrase":"livestream","weight":2.6},{"phrase":"streaming setup","weight":2.8},{"phrase":"capture card","weight":2.8},{"phrase":"webinar","weight":2.8},{"phrase":"audio interface","weight":2.6},{"phrase":"microphone","weight":2.2},{"phrase":"xlr","weight":2.4},{"phrase":"studio lighting","weight":2.6},{"phrase":"atem","weight":2.8},{"phrase":"nvenc","weight":2.4},{"phrase":"broadcast","weight":2.0}]',90),
 ('linux-desktop-hyprland','building','Linux, Omarchy & Hyprland',1.25,'[{"phrase":"omarchy","weight":4.2},{"phrase":"hyprland","weight":4.0},{"phrase":"wayland","weight":2.8},{"phrase":"arch linux","weight":2.8},{"phrase":"tiling window manager","weight":3.2},{"phrase":"dotfiles","weight":2.8},{"phrase":"neovim","weight":2.6},{"phrase":"ghostty","weight":2.8},{"phrase":"tmux","weight":2.4},{"phrase":"linux desktop","weight":3.0},{"phrase":"fixed linux","weight":3.0},{"phrase":"linux","weight":1.6}]',100),
 ('hobby-electronics','building','Hobby electronics',1.2,'[{"phrase":"breadboard","weight":3.5},{"phrase":"8-bit","weight":3.2},{"phrase":"6502","weight":3.2},{"phrase":"pcb","weight":2.8},{"phrase":"oscilloscope","weight":3.0},{"phrase":"microcontroller","weight":2.8},{"phrase":"esp32","weight":2.8},{"phrase":"arduino","weight":2.4},{"phrase":"transistor","weight":2.6},{"phrase":"logic gate","weight":2.8},{"phrase":"soldering","weight":2.6},{"phrase":"circuit","weight":2.2},{"phrase":"electronics","weight":2.2}]',110),
 ('webinars-that-sell','business','Webinars that sell',1.2,'[{"phrase":"webinar","weight":3.5},{"phrase":"webinars","weight":3.5},{"phrase":"live workshop","weight":3.0},{"phrase":"sales presentation","weight":2.8},{"phrase":"conversion","weight":2.2},{"phrase":"pitch","weight":1.8},{"phrase":"email launch","weight":2.8},{"phrase":"course launch","weight":2.6},{"phrase":"offer","weight":1.6}]',120),
 ('marketing-without-social','business','Marketing without social media',1.25,'[{"phrase":"without social media","weight":4.0},{"phrase":"seo","weight":2.8},{"phrase":"organic search","weight":3.2},{"phrase":"email list","weight":3.0},{"phrase":"email marketing","weight":2.8},{"phrase":"newsletter","weight":2.6},{"phrase":"owned audience","weight":3.2},{"phrase":"search traffic","weight":2.8},{"phrase":"word of mouth","weight":2.6},{"phrase":"distribution","weight":2.2},{"phrase":"content marketing","weight":2.4},{"phrase":"keyword research","weight":2.6}]',130),
 ('youtube-document-style','business','YouTube & documenting the work',1.2,'[{"phrase":"document, don''t create","weight":4.0},{"phrase":"document don''t create","weight":4.0},{"phrase":"youtube channel","weight":2.8},{"phrase":"creator","weight":2.0},{"phrase":"storytelling","weight":2.4},{"phrase":"retention","weight":2.2},{"phrase":"youtube growth","weight":3.0},{"phrase":"build in public","weight":2.8},{"phrase":"channel growth","weight":2.8},{"phrase":"documentary","weight":2.2}]',140),
 ('podcast-interviewing','business','Podcast interviewing',1.2,'[{"phrase":"podcast","weight":2.6},{"phrase":"podcasting","weight":3.0},{"phrase":"interviewing","weight":3.2},{"phrase":"great interview","weight":3.0},{"phrase":"start a podcast","weight":3.0},{"phrase":"host","weight":1.6},{"phrase":"conversation","weight":1.8},{"phrase":"guest","weight":1.6}]',150),
 ('tech-strategy','business','Tech strategy',1.25,'[{"phrase":"stratechery","weight":4.0},{"phrase":"aggregation theory","weight":3.8},{"phrase":"tech strategy","weight":3.5},{"phrase":"semiconductor","weight":3.0},{"phrase":"tsmc","weight":3.2},{"phrase":"asml","weight":3.2},{"phrase":"lithography","weight":3.0},{"phrase":"euv","weight":2.8},{"phrase":"moat","weight":2.6},{"phrase":"business model","weight":2.6},{"phrase":"platform","weight":1.8},{"phrase":"supply chain","weight":2.4},{"phrase":"antitrust","weight":2.4},{"phrase":"pricing power","weight":2.6}]',160),
 ('stoics-emerson','ideas','Stoics & Emerson',1.25,'[{"phrase":"stoicism","weight":3.6},{"phrase":"stoic","weight":3.2},{"phrase":"marcus aurelius","weight":3.8},{"phrase":"seneca","weight":3.6},{"phrase":"epictetus","weight":3.8},{"phrase":"emerson","weight":3.8},{"phrase":"self-reliance","weight":3.6},{"phrase":"meditations","weight":2.8},{"phrase":"enchiridion","weight":3.5},{"phrase":"transcendentalism","weight":3.4},{"phrase":"virtue","weight":2.0},{"phrase":"philosophy","weight":1.8}]',170),
 ('feynman-science','ideas','Feynman-style science',1.25,'[{"phrase":"feynman","weight":3.8},{"phrase":"quantum mechanics","weight":3.2},{"phrase":"information theory","weight":3.2},{"phrase":"neural network","weight":2.8},{"phrase":"entropy","weight":3.0},{"phrase":"first principles","weight":2.8},{"phrase":"physics","weight":2.2},{"phrase":"mathematics","weight":2.4},{"phrase":"compression","weight":2.4},{"phrase":"intuition","weight":2.2},{"phrase":"experiment","weight":2.0},{"phrase":"relativity","weight":2.6}]',180),
 ('derek-sivers-ethos','ideas','Independent living & Sivers',1.15,'[{"phrase":"derek sivers","weight":4.2},{"phrase":"sivers","weight":3.8},{"phrase":"hell yeah or no","weight":3.8},{"phrase":"anything you want","weight":3.2},{"phrase":"independent","weight":1.8},{"phrase":"minimalism","weight":2.4},{"phrase":"solitude","weight":2.4}]',190),
 ('long-form-interviews','ideas','Long-form interviews',1.2,'[{"phrase":"dwarkesh","weight":3.6},{"phrase":"karpathy","weight":3.2},{"phrase":"grant sanderson","weight":3.4},{"phrase":"robert caro","weight":3.5},{"phrase":"frontier labs","weight":2.8},{"phrase":"mindscape","weight":3.0},{"phrase":"long-form","weight":2.4},{"phrase":"deep dive","weight":2.0},{"phrase":"interview","weight":1.8},{"phrase":"history","weight":1.6}]',200),
 ('attention-craft','ideas','Attention & craft',1.25,'[{"phrase":"deep work","weight":3.8},{"phrase":"digital minimalism","weight":3.6},{"phrase":"slow productivity","weight":3.6},{"phrase":"attention","weight":2.4},{"phrase":"craftsmanship","weight":3.2},{"phrase":"craft","weight":2.2},{"phrase":"pirsig","weight":4.0},{"phrase":"motorcycle maintenance","weight":4.0},{"phrase":"zen","weight":2.6},{"phrase":"focus","weight":2.0},{"phrase":"deliberate practice","weight":3.0},{"phrase":"distraction","weight":2.2}]',210),
 ('science-fiction-dcc','fun','Sci-fi & Dungeon Crawler Carl',1.3,'[{"phrase":"dungeon crawler carl","weight":5.0},{"phrase":"matt dinniman","weight":4.2},{"phrase":"princess donut","weight":4.0},{"phrase":"litrpg","weight":3.2},{"phrase":"science fiction","weight":3.0},{"phrase":"sci-fi","weight":2.8},{"phrase":"dune","weight":2.8},{"phrase":"hyperion","weight":3.0},{"phrase":"three-body","weight":3.0},{"phrase":"frank herbert","weight":3.0},{"phrase":"book review","weight":2.2},{"phrase":"worldbuilding","weight":2.4},{"phrase":"fermi paradox","weight":2.8},{"phrase":"megastructure","weight":2.8}]',220),
 ('birds','fun','Birds',1.25,'[{"phrase":"bird","weight":2.8},{"phrase":"birds","weight":2.8},{"phrase":"birding","weight":3.6},{"phrase":"ornithology","weight":3.6},{"phrase":"hummingbird","weight":3.6},{"phrase":"owl","weight":3.2},{"phrase":"hawk","weight":3.2},{"phrase":"falcon","weight":3.2},{"phrase":"eagle","weight":3.0},{"phrase":"osprey","weight":3.4},{"phrase":"warbler","weight":3.6},{"phrase":"migration","weight":2.6},{"phrase":"plumage","weight":3.4},{"phrase":"nest cam","weight":3.4},{"phrase":"avian","weight":3.2},{"phrase":"feather","weight":2.8}]',230),
 ('editorial-type-design','fun','Editorial type & design',1.25,'[{"phrase":"typography","weight":3.8},{"phrase":"typeface","weight":3.6},{"phrase":"editorial design","weight":3.8},{"phrase":"editorial layout","weight":3.8},{"phrase":"grid system","weight":3.4},{"phrase":"baseline grid","weight":3.6},{"phrase":"kerning","weight":3.4},{"phrase":"leading","weight":2.2},{"phrase":"serif","weight":3.2},{"phrase":"lettering","weight":2.8},{"phrase":"book design","weight":3.5},{"phrase":"magazine layout","weight":3.4},{"phrase":"hierarchy","weight":2.4},{"phrase":"indesign","weight":3.0},{"phrase":"graphic design","weight":2.4}]',240)
) as v(topic_id,area,label,weight,keywords,position) where c.slug='booker-tube';

insert into public.chat_video_channels(collection_id,channel_id,name,area,topics,note,position)
select c.id,v.channel_id,v.name,v.area,v.topics::text[],v.note,v.position from public.chat_video_collections c,(values
 ('UCg3B_joekBGJ1s_4fRjsMKA','SMB Capital','trading','{low-float-day-trading,shorting-parabolic-runners,trading-psychology-flow}','NYC proprietary trading desk sharing real intraday playbooks, tape reading, and Dr. Brett Steenbarger psychology sessions.',10),
 ('UCmq93bRnn9vD0dUPTutSkgQ','David Capablanca','trading','{shorting-parabolic-runners,dilution-offerings,chinese-hk-small-caps}','Dedicated small-cap short seller dissecting toxic dilution, locate mechanics, and micro-cap fades alongside working traders.',20),
 ('UCdnzT5Tl6pAkATOiDsPhqcg','Chat With Traders','trading','{shorting-parabolic-runners,trading-psychology-flow,low-float-day-trading}','Long-form interviews with working traders—including small-cap short sellers and risk managers—focused on process rather than alerts.',30),
 ('UCn75vF3UxwWeWPAY4-5Z6HQ','TraderTV Live','trading','{live-trading-camera,low-float-day-trading}','Prop-desk traders executing live equities on camera every session with real-time tape reading, entries, and risk limits.',40),
 ('UCcIvNGMBSQWwo1v3n-ZRBCw','Humbled Trader','trading','{low-float-day-trading,shorting-parabolic-runners,chinese-hk-small-caps,dilution-offerings}','Small-cap day trader breaking down low-float runners, Chinese ADR risk, and offerings with blunt talk about losses and sizing.',50),
 ('UCfO2yCpx6_XU-xovhpJuaYw','Bear Bull Traders','trading','{live-trading-camera,low-float-day-trading,trading-psychology-flow}','Active equities traders publishing market-open live recaps, order-flow analysis, and structured mental-game reviews.',60),
 ('UCLJiSMXJ9K-1AOTqIqdXJgQ','tastylive','trading','{live-trading-camera,trading-psychology-flow,dilution-offerings}','Daily live market broadcasts grounded in quantitative mechanics, volatility, and calm decision-making under live tape pressure.',70),
 ('UC_x36zCEGilGpB1m-V4gmjg','IndyDevDan','building','{ai-coding-agents}','Practitioner building daily with Claude Code, MCP, sub-agents, and repeatable context-engineering workflows.',80),
 ('UCrDwWp7EBBv4NwvScIpBDOA','Anthropic','building','{ai-coding-agents}','First-party engineering talks and walkthroughs on Claude Code, tool use, and reliable agent architectures.',90),
 ('UCvjgXvBlbQiydffZU7m1_aw','The Coding Train','building','{threejs-creative-coding}','Daniel Shiffman live-coding generative art, WebGL, shaders, and interactive JavaScript simulations from scratch.',100),
 ('UCmtyQOKKmrMVaKuRXz02jbQ','Sebastian Lague','building','{threejs-creative-coding}','Patient, luminous creative-coding explorations of procedural worlds, ray tracing, fluid dynamics, and custom renderers.',110),
 ('UCRBHiacaQb5S70pljtJYB2g','EposVox','building','{live-streaming-production}','Deep technical engineering on OBS Studio, hardware capture pipelines, encoding, and live webinar studio builds.',120),
 ('UCvOU-zTlankT-JjN3ZzvuKA','Podcastage','building','{live-streaming-production,podcast-interviewing}','Rigorous, repeatable microphone and audio-interface testing for clean live-stream, webinar, and podcast sound.',130),
 ('UCo71RUe6DX4w-Vd47rFLXPg','typecraft','building','{linux-desktop-hyprland}','Hands-on developer walkthroughs of Omarchy, Hyprland, Arch Linux, Neovim, and keyboard-first terminal workflows.',140),
 ('UCld68syR8Wi-GY_n4CaoJGA','Brodie Robertson','building','{linux-desktop-hyprland}','Daily Linux desktop practitioner tracking Wayland, Hyprland, Omarchy releases, and open-source desktop craftsmanship.',150),
 ('UCS0N5baNlQWJCUrhCEo8WlA','Ben Eater','building','{hobby-electronics}','First-principles bench electronics: building 8-bit breadboard computers, clock circuits, and video signals from raw logic gates.',160),
 ('UC6mIxFTvXkWQVEHPsEdflzQ','GreatScott!','building','{hobby-electronics}','Practical hobby electronics builds, oscilloscope debugging, PCB design, and component-level circuit explanations.',170),
 ('UC1LpsuAUaKoMzzJSEt5WImw','Asianometry','business','{tech-strategy}','Deep semiconductor and tech-strategy video essays from Jon Yu, published within the Stratechery Plus network.',180),
 ('UC6t1O76G0jYXOAoYCm153dA','Lenny''s Podcast','business','{tech-strategy,podcast-interviewing}','Structured, practitioner-led interviews with product builders and strategists on distribution, moats, and durable growth.',190),
 ('UCcefcZRL2oaA_uBNeo5UOWg','Y Combinator','business','{tech-strategy,marketing-without-social}','Direct startup and tech-strategy talks from operators who build and fund software companies.',200),
 ('UCWquNQV8Y0_defMKnGKrFOQ','Ahrefs','business','{marketing-without-social}','Evidence-based organic search and intent-driven marketing taught by a bootstrapped software team that lives off search.',210),
 ('UCamLstJyCa-t5gfZegxsFMw','Colin and Samir','business','{youtube-document-style,podcast-interviewing}','Thoughtful craft interviews with working creators on documentary YouTube storytelling, pacing, and interviewing.',220),
 ('UCGk1LitxAZVnqQn0_nt5qxw','Pat Flynn','business','{webinars-that-sell,marketing-without-social,podcast-interviewing}','Practical teaching on live workshops, email lists, and podcasting built around generosity rather than hype.',230),
 ('UCF2v8v8te3_u4xhIQ8tGy1g','Noah Kagan','business','{youtube-document-style,webinars-that-sell,marketing-without-social}','AppSumo founder documenting real business experiments, email launches, and direct customer conversations.',240),
 ('UCXl4i9dYBrFOabk0xGmbkRA','Dwarkesh Patel','ideas','{long-form-interviews}','Unusually well-prepared, multi-hour interviews with historians, scientists, and AI researchers.',250),
 ('UCYO_jab_esuFRV4b17AJtAw','3Blue1Brown','ideas','{feynman-science}','Grant Sanderson''s intuition-first visual explainers of math, physics, and information theory in the Feynman spirit.',260),
 ('UCHnyfMqiRRG1u-2MsSQLbXA','Veritasium','ideas','{feynman-science}','Experiment-driven science and physics investigations that start from genuine puzzles and work from first principles.',270),
 ('UCEIwxahdLz7bap-VDs9h35A','Steve Mould','ideas','{feynman-science}','Hands-on mechanical and physical demonstrations that uncover surprising mechanics in everyday objects.',280),
 ('UCRhV1rWIpm_pU19bBm_2RXw','Sean Carroll','ideas','{feynman-science,long-form-interviews}','Theoretical physicist pairing clear foundational science talks with unhurried long-form Mindscape interviews.',290),
 ('UCEtxsMx4qsoitFwjBdLU_gA','Gregory B. Sadler','ideas','{stoics-emerson}','Philosophy professor giving patient, primary-text readings of Epictetus, Seneca, Marcus Aurelius, and Emerson.',300),
 ('UCybBViio_TH_uiFFDJuz5tg','Einzelgänger','ideas','{stoics-emerson,attention-craft,derek-sivers-ethos}','Quiet, reflective video essays on Stoicism, Emersonian self-reliance, Zen, and living deliberately.',310),
 ('UCIhJnsJ0IHlVNnYfp-gw_5Q','Cal Newport','ideas','{attention-craft,marketing-without-social,derek-sivers-ethos}','Computer science professor examining deep work, cognitive craft, and building serious output without social feeds.',320),
 ('UC1rFmaGLYr0Ve_Y_soxZNWQ','Quinn''s Ideas','fun','{science-fiction-dcc}','Calm, deeply read science fiction essays exploring Dune, Hyperion, The Three-Body Problem, and classic speculative worlds.',330),
 ('UChWX1yxVym2kNXMBD1oKo8Q','Media Death Cult','fun','{science-fiction-dcc}','Dedicated science fiction book reviewer offering sharp, spoiler-aware reviews including Dungeon Crawler Carl.',340),
 ('UCw--xPGVVxYzRsWyV1nFqgg','Daniel Greene','fun','{science-fiction-dcc}','Long-form SFF and LitRPG literary reviews, including thoughtful critiques of Matt Dinniman''s Dungeon Crawler Carl.',350),
 ('UCZFipeZtQM5CKUjx6grh54g','Isaac Arthur','fun','{science-fiction-dcc}','Hard science fiction worldbuilding and physics-grounded futurism delivered at an unhurried documentary pace.',360),
 ('UCZXZQxS3d6NpR-eH_gdDwYA','Cornell Lab Bird Cams','fun','{birds}','Live nest cams, raptor behavior highlights, and ornithology field notes from the Cornell Lab of Ornithology.',370),
 ('UC-3SbfTPJsL8fJAPKiVqBLg','Deep Look','fun','{birds}','KQED/PBS macro cinematography capturing avian anatomy, hummingbird flight, and natural history up close.',380),
 ('UCoeJKtPJLoIBqWq4o8TDLpA','Satori Graphics','fun','{editorial-type-design}','Analytical, structured breakdowns of editorial grids, typographic hierarchy, whitespace, and print composition.',390),
 ('UC-b3c7kxa5vU-bnmaROgvog','The Futur','fun','{editorial-type-design,youtube-document-style}','Working art directors critiquing real editorial typography, layout systems, and creative craft.',400),
 ('UCT_of6HCtVZFpnnnLUeAGYA','Yes I''m a Designer','fun','{editorial-type-design}','Practical editorial layout, baseline grids, and InDesign typography craft from a seasoned design educator.',410)
) as v(channel_id,name,area,topics,note,position) where c.slug='booker-tube';
