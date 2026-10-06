# SS in search options

Approved request `7a88abd4-df1a-4791-95c3-f7b63701b5d7`, revision 2, based on published `bb2be3598f08f15e8b484d291b383fa2e050323c`.

Search offers **LB**, **SS**, **SOCIAL**, **LB + SOCIAL**, and **SS + SOCIAL**. Each option requires current access to every included conversation room. A Longboard account without the Boardroom cohort does not imply LB access; paid non-mastermind ShortScout membership does not imply SS access. Existing Longboard-authenticated site administrators retain their existing room permissions; an SS-only cookie remains independently authorized.

Opening search defaults to the current searchable room, otherwise the first authorized option. Selecting a scope after a search immediately reruns the last submitted query using the current search method. Unsubmitted edits to the query remain a draft until Search is pressed. Keyword results retain 20-row keyset pagination; meaning results retain the existing bounded 20-result hybrid ranking, 30-query hourly budget and provider-error behavior. Pagination always uses the submitted query/scope/method. No three-room “all” option is added.

The new explicit `lb-social` and `ss-social` API scopes require every constituent room and never silently narrow. Legacy `all` remains LB + SOCIAL; its existing SOCIAL-only fallback remains for callers without LB access. Authorization runs before query budget, embeddings or search RPCs. Context still verifies current access and returns only neighboring messages in the exact target room. DMs, announcements, recordings and Gainers remain outside the searchable/indexed corpus.

Changing the selected search scope aborts and clears old result/context requests. PublicChat keys the search component by account, member, current room and current allowed rooms, so identity, navigation and entitlement changes remount it and discard stale state. Query inputs use React IDs, avoiding repeated labels across mounted Quad searches. Existing Quad entry points are retained; this ticket does not add new Quad navigation controls. No chat drafts, unread markers, notifications, pin navigation or send behavior is changed.

## Database compatibility

CLI-generated `supabase/migrations/20261006134004_chat_shortscout_search.sql` replaces existing invoker functions without changing arguments or return shapes. It adds SS to both keyword and semantic retrieval, extends the existing embedding trigger, and inserts only existing live/nonremoved SS messages into the same queue. There are no new tables, policies, keys, schedulers or provider/model changes. Existing SQL callers keep their LB/SOCIAL semantics. The migration runs before the app through the sole release service; old app readers continue to exclude SS.

The worker remains service-only and claims at most 32 eligible rows per batch with the existing five-minute leases and eight-attempt ceiling. Claims filter current room eligibility, deletion/removal and content hash. Updates/deletions revoke stale embeddings and leases; existing conditional hash+lease writes prevent old completions from restoring content. The migration itself makes no provider calls. Historical SS meaning coverage becomes available as the existing bounded index worker drains the queue; keyword search works immediately. The coordinator’s read-only pre-release snapshot on October 6 found 1,152 eligible live SS messages not yet in the embeddings table. That count can change and is not a completion-time promise. Direct authenticated SQL reads retain source-table RLS.

Migration SHA256: `a4996ef1b5ee42b8d2ad7a53d1830001d060bad77d58e86b06ebd4afdff92e17`. Release plan: `.release/7a88abd4-df1a-4791-95c3-f7b63701b5d7.json`.

## Local evidence

Synthetic current-schema PGlite/pgvector/Auth/membership fixture on 54574; production Next on 3374. The local preload redirects only the fixed membership destination and embeddings endpoint; vectors are deterministic synthetic values. No production credentials/data or paid provider calls were used. The installed agent-browser CLI was unavailable, so browser verification uses the repository's installed Puppeteer/Chromium workflow.

- 1009 unit tests / 120 files pass, including exact options, all entitlement combinations in both modes, strict combination denial before provider/budget work, legacy compatibility and unchanged pagination/budget failures.
- 45 SQL assertions pass: lexical and vector-only exact room sets, SS historical backfill, keyset ties/pages, retained/deleted/removed exclusions, stale hash/lease guards, service-only bounded claims and direct RLS denial. These are sequential local SQL tests, not a concurrent production PostgreSQL load test.
- TypeScript, production build and lint pass (zero errors, ten existing warnings). All 71 mocked release-service tests pass. React component/accessibility/request-cleanup checklist applied.
- Production browser verifies real keyword and semantic routes/results, precise scope pairs, automatic selector refresh with pending query draft preserved, combined pagination and same-room context. It checks LB cohort restrictions, actual SS-cookie meaning budget, legacy fallback, live annual downgrade, held scope/context responses and room navigation cancellation.
- Browser presentation checks cover 320/390px portrait and 844px landscape, plus independent mounted Quad search inputs through existing empty-room entry points. Chromium emulation does not establish physical iOS/Android behavior or real embedding relevance.

Evidence: `/tmp/chat-ss-search-{unit,focused,database,tsc,lint,build,release,browser}.log`; screenshots `/tmp/chat-ss-search-mobile-{320,390,844}.png` and `/tmp/chat-ss-search-quad.png`. Reproducible fixture, preload, database and browser scripts are under `scripts/tests/chat-ss-search-*`. The login release probe is unauthenticated smoke coverage, not authenticated search verification.
