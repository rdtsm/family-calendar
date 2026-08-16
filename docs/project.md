# Family Calendar — project description

The reasoning behind the product. The problem it solves, what it deliberately does not do,
installation and deployment all live in the [README](../README.md).

---

## 1. Competitive landscape

| Product | Model | Kid-facing view | Why it fails here |
|---|---|---|---|
| [Cozi](https://textconcierge.ai/blog/articles/best-family-calendar-apps-2026/) | Free / Gold $39/yr | None | Adult agenda UI with ads; since 2024 the free tier caps the calendar at 30 days and puts calendar views behind Gold |
| [Skylight Calendar](https://www.nestifyapp.org/blog/skylight-alternative) | Hardware + $79/yr | Wall display only | Excellent *shared* view, but the schedule stays in the kitchen — a child away from home cannot check it |
| [FamilyWall](https://heynori.com/blog/best-shared-family-calendar-apps) | Free / $4.99/mo | None | Bundles location tracking, document storage and chat; the calendar is the least considered part |
| [TimeTree](https://www.growmaple.com/blog-posts/best-family-calendar-app) | Free | Partial | Still a month grid — kids must parse an adult mental model |
| [Google Calendar](https://www.morgen.so/blog-posts/digital-family-calendar) | Free | None | Fastest sync, worst affordance for a child; recurrence entry is a dialog |
| [Tiimo](https://www.tiimoapp.com/resource-hub/visual-schedules-autistic-kids) / Choiceworks | $/mo | **Best in class** | Genuinely excellent now/next visual schedules — but built for a single user, with no parent-side authoring and no multi-child household model |

The gap is stated in the [README](../README.md#the-problem). What the table adds is that it holds at
every price point — free, subscription and hardware — so it is a design blind spot rather than a
cost constraint. Nobody ships both halves against one database.

The child-development literature is consistent that kids need *now / next* rather than a grid:
[a visual schedule gives autonomy precisely because the child can see what's next and check it off
without asking](https://www.tiimoapp.com/resource-hub/visual-schedules-autistic-kids), which reduces
anxiety and builds time awareness. That is the kid app's entire specification.

**Our position:** parent authoring in ~10 seconds *and* a kid-owned now/next view, on free tiers.

## 2. High-level design

```
        PARENT                                    KID
   ┌──────────────────┐                    ┌──────────────────┐
   │  /parent  (PIN)  │                    │  /k/<token>      │
   │                  │                    │                  │
   │  who · what ·    │                    │  NOW  ▸ progress │
   │  when · weekly?  │                    │  NEXT ▸ countdown│
   │  ── agenda ──    │                    │  ── timeline ──  │
   │  ── kid links ── │                    │  swipe → days    │
   └────────┬─────────┘                    └────────┬─────────┘
            │  server actions                       │  server action (done)
            └───────────────┬───────────────────────┘
                            ▼
                    ┌───────────────┐
                    │   Postgres    │  children · events · push_subscriptions
                    │               │  notifications_sent
                    └───────┬───────┘
                            ▲
                    ┌───────┴────────────────┐
                    │ /api/cron/reminders    │ → Web Push → device notification
                    │ 30-min heads-up        │
                    │ 07:00 morning digest   │
                    └────────────────────────┘
```

Three decisions carry the whole design:

1. **Recurrence is expanded at write time and topped up by the scheduler.** "Every Tuesday" becomes
   52 concrete rows sharing a `series_id`, and the nightly job appends a week as time passes, so the
   series never runs out and nobody has to remember to renew it. No RRULE engine, no expansion at
   read time, no timezone drift on the 47th occurrence. Deleting one occurrence or the rest of the
   series is a one-line query.
2. **The kid's URL is the credential.** No login screen ever appears on a child's phone. An
   unguessable token in the path identifies the child; every write is scoped server-side by the
   `child_id` that token resolves to.
3. **One timezone for the family.** Wall-clock input is converted to a UTC instant on write and
   rendered back in the family timezone. Nothing downstream has to think about it.

## 3. Data model (`lib/schema.sql`)

```
children            id, name, color, emoji, token (unique), kind,
                    feed_token (unique), last_fetched_at, sort_order
events              id, child_id → children, title, emoji, location,
                    starts_at, ends_at, series_id, group_id, created_by, done_at
series              id, child_id → children, title, emoji, location,
                    start_time, end_time, materialised_through, group_id, active
push_subscriptions  id, child_id → children, endpoint (unique), p256dh, auth
link_opens          device_id (pk), child_id → children, first_seen, last_seen,
                    acknowledged_at
notifications_sent  key (pk), sent_at
```

- `children.kind` is `child`, `participant` or `observer`. The table still holds everyone, because
  every foreign key in the schema points at it; only the kind decides how a person receives their
  schedule. `children.token` is the link you share — the kid's app for a child, the handover page for
  an adult — and `feed_token` is the separate secret that page reveals.
- `events.series_id` is null for one-offs and shared across a weekly run. `events.group_id` is null
  for one member and shared across the rows of one multi-member activity.
- `series` holds the *rule* a weekly run was created from — the wall-clock times plus
  `materialised_through`, the last date already written out. A unique index on
  `(series_id, starts_at)` backs an `on conflict do nothing` insert, so a top-up cannot double-write
  even if two run at once.
- `events.done_at` is the child's acknowledgement — surfaced to the parent as `DONE`.
- `notifications_sent.key` is `lead:<event_id>` or `digest:<child_id>:<day>`. An
  `insert … on conflict do nothing … returning` makes send-once atomic even if the scheduler
  double-fires.
- All timestamps are ISO-8601 UTC text. Fixed-width and always written via `Date.toISOString()`, so
  lexicographic ordering is chronological ordering and the range queries need no date functions.
- Ids come from `crypto.randomUUID()` in application code, keeping the schema free of any
  dialect-specific function — which is what lets it run unmodified on D1 and on `node:sqlite`.

### 3.1 Why there are migrations as well as a schema

`schema.sql` builds a database that does not exist yet. Every statement in it is
`create … if not exists`, so it is safe to re-run and **cannot change a table that is already there**
— and SQLite has no `add column if not exists`. So every change to a table holding real data gets a
one-shot file instead:

```
lib/migrations/001-adults-and-groups.sql   adult roles, shared activities
lib/migrations/002-kid-entries.sql         a child's own entries
lib/migrations/003-device-alert.sql        acknowledging a new device
```

A **fresh deployment needs none of them** — `schema.sql` already contains everything. They exist only
for a deployment that is already running, and the order is load-bearing:

> **Migration first, deploy second.** Deploy code that reads a column the live database does not have
> yet and every parent page fails until the migration catches up. The reverse is safe, because old
> code ignores a column it does not know about.

Each file carries its own `wrangler d1 execute` line in a comment. Re-running one errors on the
duplicate column, which is the intended signal that it has already been applied.

## 4. Time (`lib/time.ts`)

The single source of truth is `NEXT_PUBLIC_FAMILY_TZ`.

- `wallToInstant(day, time)` — what the parent typed → the real instant.
- `dayKeyOf(instant)` — which local day an instant belongs to. This is *not* the UTC date: 07:00 in
  a household at +8 on the 5th is 23:00 UTC on the 4th, and the kid must see it on the 5th.
- `dayWindow(day)` — the half-open `[local midnight, next local midnight)` range used by every query.

A `DayKey` names a calendar day, not an instant, so every function that shifts or renders one anchors
at midnight UTC **and formats in UTC**. Mixing the two — a UTC-built anchor rendered by a local-time
formatter — returns the previous day everywhere west of Greenwich while reading correctly at +8 and
on Workers, which is exactly how it shipped: `shiftDay(today, 0)` gave yesterday, so the "Today" chip
set the wrong date and every relative label drifted with it. The suite now runs with
`TZ=America/Los_Angeles` against a family timezone of `Asia/Singapore`, so the runtime and the
family deliberately disagree and this class of error cannot pass unnoticed again.

Unit-tested including the UTC-boundary case and month/year rollovers. The one deliberate limitation:
a single family timezone, not per-child. See
[known limitations](../README.md#known-limitations).

## 5. Detailed design

### 5.1 Recurrence (`lib/recurrence.ts`)

The parent chooses **Once** or **Every week**. There is no count, no end date, and no rules
language — a weekly activity in a family simply continues until it stops.

`expand(day, start, end, weekly, today)` returns concrete occurrences: one row for a one-off, or
every seventh day out to the horizon for a repeat. An end time at or before the start is read as
running past midnight, and each occurrence converts its own wall-clock time, so 15:00 stays 15:00
across a daylight-saving change.

**The horizon and the top-up.** `horizonDay(today)` is 52 weeks out, and creation and the scheduler
share that one definition — which is why a freshly created series is already at the horizon and the
next top-up correctly finds nothing to do. Each night the scheduler asks for series whose
`materialised_through` has fallen behind the horizon and appends the weeks in between:

```
weeklyDays(materialised_through + 7 days, horizonDay(today))  →  insert  →  update materialised_through
```

Three properties make this safe to run at any frequency, in any order, after any outage:

- **Generation only ever appends after `materialised_through`.** A deleted occurrence is inside the
  materialised range, so it is never resurrected. This is the whole reason the marker exists rather
  than deriving the next date from the newest row.
- **The insert is idempotent.** `on conflict (series_id, starts_at) do nothing`, so a repeated or
  concurrent run writes nothing twice. Rows go in chunks of ten (80 bound parameters), well inside
  D1's statement limit.
- **A missed run is self-healing.** The window is computed from dates, not from how long the
  scheduler slept. Fifty-two weeks of runway means the calendar keeps working even if the job stops
  for months — long enough that a parent notices for some other reason first.

**Deleting is forward-looking.** "All events" removes occurrences from *now* onward and deactivates
the series; everything already past stays, because a calendar that erased what a child actually did
would be destroying history to accomplish a scheduling change. To remove a past occurrence, delete
that one row.

### 5.2 Access (`lib/auth.ts`)

- **Parent:** a PIN exchanged for an HMAC-signed, httpOnly, 30-day cookie. Comparisons are
  constant-time. Every mutating server action re-checks the session.
- **Kid:** a 96-bit `base64url` token in the path. `/k/*` is `noindex, nofollow`. A leaked link
  exposes one child's after-school schedule, and can mark items done or change that child's emoji
  and colour — nothing else. Every kid-side write resolves the token to a `child_id` server-side, so
  a token can never reach a sibling. A leaked link is replaced from the child's profile: a new token
  is issued and the old one dies immediately, while everything else — activities, what has been
  ticked off, the colour, the registered devices — is keyed to the child's id and survives. The old
  link is not kept alive for a grace period, because a rotation happens precisely when someone holds
  a link they should not. **Rotation also deletes that child's push subscriptions and device
  records** — without that it revoked only the address, and the phone whose link had just been taken
  away carried on receiving every reminder, because subscriptions are keyed to the child rather than
  to the token. The one control this app has for a leaked link was doing half its job. The cost is on the child's phone: a home-screen app has `start_url` baked
  in at install, so the old icon dies with the token and the link must be added again.

Deliberately proportionate. The alternative — accounts and passwords for children — would not
survive first contact.

**Changing the PIN revokes sessions, and that is the whole point.** Sessions are signed with
`SESSION_SECRET` and owe nothing to the PIN, so the obvious implementation — swap the PIN, leave
sessions alone — would look like a lockout and be none, which is worse than not offering it. A
`session_epoch` in `settings` is embedded in every cookie and bumped whenever the PIN changes, so a
correctly signed cookie from a superseded epoch is refused. The person making the change is issued a
fresh session so they are not signed out by their own action, and the current PIN is required, or an
unattended signed-in device could be used to lock its owner out. The stored PIN is an HMAC keyed
with `SESSION_SECRET` rather than a slow hash: 900k candidates would fall to anyone holding the
database, and keying with a secret that is not in it is both stronger here and affordable inside a
Worker's CPU budget.

Two hardening measures follow from where this is hosted rather than from what it stores. Failed
logins are rate limited per client address in D1 — eight in fifteen minutes locks that address out
for fifteen — because a six-digit PIN is only 900k guesses and Workers keep no state between
requests. And the session cookie carries the **`__Host-` prefix** in production, which forbids a
`Domain` attribute and therefore cannot be set or shadowed by a sibling subdomain.

That second one points at a choice the deployer makes, not the code. Browsers treat everything under
one registrable domain as the same site, so hosting this under a domain already used for something
else places it inside that domain's cookie and same-site boundary: cookies scoped to the parent
domain are transmitted here, and `SameSite=Lax` protections between the two disappear. No header
fixes it. A domain dedicated to the family, or the free `workers.dev` hostname, avoids it entirely —
which is why the README presents a custom domain as optional rather than as the goal.

### 5.3 A link, not a code

The common alternative — and what KIN, the nearest comparable product, does — is the other way round:
everyone installs from one generic address, and a member shares a short code that the others type in.
Worth setting out properly, because it is a different shape rather than a worse one.

**Here, the link is the credential.** Bearer, permanently valid, and it stays in whatever message
carried it. **There, the code is an invitation.** Redeemed once, exchanged for a device-bound session,
and then spent.

**What a code buys**

- **The credential stops being the message.** After redemption a forwarded chat is inert. Ours stays
  live in a WhatsApp thread for years.
- **It is speakable.** *"Go to the site, code BELL-4K7Q"* crosses a kitchen, a phone call or a piece
  of paper. No URL here can be said aloud, which means the product has no surface that survives
  leaving a screen.
- **Finer revocation.** Drop one device, rather than rotating a token and forcing the legitimate
  holder to reinstall alongside whoever leaked it.

**What it costs**

- **Sessions.** A code is redeemed *into* something: issuance, a device registry, revocation. None of
  that exists here.
- **A step for the child.** Tap-and-you-are-in becomes open, find "join", type it correctly. That
  step lands on a nine-year-old, and zero-friction entry is the most-liked property this app has.
- **A typed secret.** Small keyspace, so expiry, single use, rate limiting, and an alphabet without
  `0`/`O` and `1`/`l`.

**Why it does not simply transfer.** KIN leans on an app store for install, identity and an account.
On the web there is no such layer, so a code would have to carry more weight here than it does there.
Their design is better *given a store*, which is not an argument that it is better.

**The transferable idea is redemption, not codes.** Keep the link — one tap, no typing, nothing
changes for the child — but let the **first open bind it to that device**, and make later devices
something the parent sees and approves. `link_opens` already records exactly that and today only
counts it. This would convert a permanently leaked URL into a one-shot invitation **without adding a
login**.

**Two things constrain it, and both matter.**

First, **the adult subscribe feeds cannot be bound at all.** They are fetched by Google, Apple and
Microsoft servers with no cookies and no browser, so any binding covers the kid app and the parent
app only. The `/feed/*` tokens stay pure bearer credentials whatever else is decided.

Second — and this is the real trade — **leak-resistance and recovery cannot both improve without
identity.** Binding makes a leaked link inert and makes a lost or wiped device fatal, because the
link alone no longer suffices. With no email and no account there is no third option; the choice is
which of the two risks to hold.

**Decided: not built here. Build the alerting half instead.**

The scenarios settle it. A **parent opening a child's link to check it works before sending it** —
done repeatedly during this build — would claim the device and lock the child out. A **replaced phone
or cleared browser data** locks a child out at the school gate. **Private browsing mints a new
identity every session**, so a gate built on a cookie produces false lockouts by design: a cookie is a
browser-profile identity, not a device identity. Two parents sharing the parent link, which the README
encourages, would break. And against the threat that matters most — somebody holding the child's
actual phone — binding does nothing, because they hold the bound device.

So it buys partial coverage against a low threat, at a cost paid by children. In a single household
every link is held by people who live together. The calculation inverts entirely for a hosted service
with strangers, which is where the idea belongs.

**Built.** What follows is what shipped, not a proposal.

**Turn the count into an event.** `link_opens` already records every open and
the profile shows a number nobody reads. A *new* device should surface on the parent dashboard, beside
the existing "reminders off" warning — visible only while true, as that one is.

**The call to action, and what it must not claim.** There is no per-device revocation, because nothing
is bound. The only revocation that exists is rotating the token, which kills the link for the child
as well. A button marked *Revoke* would imply precision the system does not have — the same error as
labelling a counter reset "Forget these devices". So the honest pair is:

> **A new device opened Beatrix's link** · 10 minutes ago
> Usually a new phone, a reinstall, or a private window. If you were not expecting it, replace the link.
> [ That was us ] [ Replace Beatrix's link ]

*That was us* acknowledges the device so it never alerts again — the useful half of a device registry
without the gate. *Replace* links to the child's profile, where the existing rotation and its
confirmation already live, and the copy names the cost before the tap rather than after.

**The first device never alerts.** It is acknowledged the moment it is recorded, because it is the
phone the link was just handed to. Warning a parent about the device they are looking at would teach
them to ignore the warning, which is how a signal becomes noise.

**The cost is on the child, and it is real.** A rotation leaves the old home-screen icon pointing at
a dead address, because `start_url` is fixed at install, and the child taps 🔔 again.

The reason for that second step: the worker is registered as `/sw.js` with `{ scope: "/k/<token>" }`,
so a rotation moves the scope and the new link needs its own registration and its own subscription.
Rotation does not invalidate the old subscription either; **rotation deliberately deletes it**, along
with the child's device records, because revoking an address while leaving the old phone receiving
every reminder is not a revocation. The child re-subscribes when they open the new link.

That scope was origin-wide until 2026-08-09, which cost two things: a device could remind only one
child, and Android would not credit a reminder to the installed app — a worker outside the app's
scope produces a Chrome-branded notification carrying an *Unsubscribe* button one tap from a child.
`registerWorker.ts` migrates a device by retiring any root-scoped registration, **unsubscribing it
before unregistering**; leaving that endpoint alive would deliver every reminder twice until a failed
send pruned it.

Migrating a phone is therefore two acts, not one: open the app, then tap 🔔 again. Between them the
family screen still shows reminders **on**, because the stale row is deleted only when a send returns
410 (`lib/push.ts`). The indicator a parent would check is stale for exactly the window they would
check it in — so do both taps rather than trusting the screen.

Their activities, history, colour and emoji all survive, being keyed to the child's id. On Android a
replacement no longer leaves a second icon either — the manifest now carries a stable `id`, so the
browser updates the installed app rather than creating a new one. The handover is necessarily manual — the
old app cannot be told the new address without defeating the rotation.

One refinement worth noting rather than building: a replaced link currently answers **404**, and a
child meeting a raw error where their schedule used to be deserves better. Saying *"this link has been
replaced — ask for the new one"* needs the retired token remembered, which is a column and a small
information leak to anyone holding a dead link. Probably worth it; not yet done.

### 5.4 Notifications

**Four parties, all of which must work for one notification to land.**

| Party | Owns | Notes |
|---|---|---|
| The kid's **browser** | The subscription | It generates the P-256 keypair and `auth` secret and registers with its own vendor's push service. We are handed a delivery address, never the means to reach the device unaided |
| The **scheduler** | Timing | Our server has no timer. `/api/cron/reminders` is passive and does nothing until pinged. See §8.4 |
| Our **server** | Sending | Picks events, claims them in the ledger, signs a VAPID JWT, encrypts the payload, POSTs to the endpoint. Only the server can send |
| The **service worker** | Displaying | The server ships JSON; `sw.js` decides what appears. Only the client can display |

The consequential asymmetry is between the two failure modes. A bad VAPID signature returns 401 and
nothing is delivered to anyone — loud, and noticed within a day. A bad *encryption* returns **201
Created**, because the push service cannot read the payload it is relaying; the server records a
success, the send-once ledger closes the event, and the child gets a notification the browser could
not decrypt. `sw.js` therefore says *"Reminder couldn't be read"* rather than showing a blank one,
and `sendToChild` reports `{sent, failed, errors}` so 401s, 413s and transport failures surface in
the endpoint's own response instead of only in a child's disappointment. Endpoints returning 404 or
410 are pruned — that is the browser saying the subscription is gone for good.

**One worker per child, and therefore one subscription per child.** A push subscription belongs to a
service worker registration, so scoping the worker to `/k/<token>` (§5.2a) gives siblings sharing a
tablet a distinct endpoint each. `push_subscriptions.endpoint` stays unique with `on conflict do
update set child_id`: distinct endpoints no longer collide, and the constraint still does the job it
was there for, which is to stop a device that changes hands reminding the child who had it before.

**What we send, and what we deliberately do not.**

| Kind | Trigger | Built | Reasoning |
|---|---|---|---|
| **Lead reminders** | Event starts within one of `REMINDER_LEAD_MINUTES` (default `60,5`) and is not done. Two per activity: an hour ahead to finish up and pack, five minutes ahead as a last call | ✅ | The intervention that changes behaviour. Only the closest due lead fires in any run, so an activity added twenty minutes before it starts produces one notification rather than one per lead |
| **Morning digest** | Local `DIGEST_HOUR` (default 07:00), one per child per day | ✅ | The planning aid. Also the only thing that survives a once-daily scheduler |
| **Imminent addition** | An activity is created whose first occurrence is already inside the outermost lead | ✅ | The scheduler alone is not enough: something added three minutes before it starts may never see a tick before it begins. Shares one ledger with the scheduler, so whichever runs first claims the key and the other does nothing |
| **Parent cancelled** | — | ❌ | Removed with *added*. The asymmetry remains real: if a lead reminder has already fired, the child holds an instruction that is now wrong and nothing corrects it |
| **Kid → parent** ("running late") | — | ❌ | Blocked structurally, not by effort: `push_subscriptions` is keyed to `child_id`, so **the parent has no subscription at all**. Needs a second subscriber type before the feature is even expressible |
| **Parent nudge** ("leave now") | — | ❌ | This is messaging, not scheduling. A different product with a different failure mode, and it invites exactly the interruption the calendar exists to remove |
| **Evening preview of tomorrow** | — | ❌ | Cheap — the digest query with a shifted window — but it competes with the morning digest for the same attention. Worth measuring before adding |
| **All-done celebration** | — | ❌ | The in-app footer already says it. Spending the notification budget on congratulation devalues the reminders |

Two structural properties follow. Notifications flow **parent → child only**, and until *added* and
*cancelled* existed, **nothing a human did caused one** — only the clock did. Both parent-driven
kinds run through `lib/announce.ts`, which enforces the two rules that keep them from becoming
noise: one message per action however many rows it wrote, and nothing announced beyond a week out,
because a term planned in advance is what the digest is for. They are dispatched with `after()` so
the parent's form never waits on a push service, and a failed announcement can never fail the write
that caused it.

### 5.5 Icons

Two entirely separate systems, neither of them a third-party library.

**App icon.** `public/icon.svg` is hand-authored — a violet gradient rounded square with three
timeline rows fading out. It is rasterised with macOS `sips` into four PNGs: 192px and 512px for the
manifest, a 512px **maskable** variant with extra padding so Android's circle/squircle mask does not
crop it, and a 180px Apple variant. No CDN, no licence, no attribution.

**Activity icons** (🥊 ⚽ 🎹 🦷) are **Unicode emoji** — characters, not images. Each device renders
them in its own font: Apple Color Emoji on iOS and macOS, Noto Color Emoji on Android. Zero bytes
shipped, zero network requests, nothing that can 404. The trade-off is genuine: the same boxing glove
looks different on an iPhone than on an Android phone.

*How one is chosen.* `emojiFor(title)` in `lib/emoji.ts` runs ~30 ordered regular expressions against
the event title and takes the first match. Order encodes specificity — `/tuition|tutor|study|
homework|exam/` sits above `/school|class|lesson/`, so "study class" resolves to 📚 rather than 🎒.
Matching is case-insensitive and substring-based, so "Boxing", "boxing class" and "Thai boxing" all
resolve to 🥊. The eight quick-pick chips carry an explicit emoji rather than relying on inference.

*When nothing matches.* The function returns 📌, a neutral pin. There is no failure mode to handle:
the glyph is a text character, so there is no image request that can fail and no layout that can
shift. An unmatched event renders identically to a matched one — only the icon is generic. This is
covered by a unit test (`emojiFor("Zzzblah") === "📌"`).

*Why it is stored, not computed.* The resolved emoji is written to `events.emoji` at insert time
rather than derived on read. Editing the rules later therefore never retro-changes events the family
has already seen — an icon that silently changed under them would be worse than a generic one. Every
emoji used is from Unicode 6.0–9.0, universally supported; no device should render a tofu box.

### 5.6 Interface

A shared dark surface, one accent colour per child, `ui-rounded` type, oversized tap targets.

**Kid** — avatar and greeting; a horizontal day strip with a dot marking days that have something; a
**NOW** card with an elapsed-progress bar, or a **NEXT UP** card with a live countdown; then the day
as a timeline — the whole day, including whatever the highlight is showing. Leaving it out made the
list read as though an hour were missing, which is a worse error than repeating a line; the
highlighted row is ringed so the two are visibly the same thing. Tapping a row checks it off, with
haptic feedback where the platform supports it.
Swipe left/right to change day. Empty days say *"Nothing planned — enjoy your free day."* A free day
should feel like a reward, not like a bug.

Tapping the avatar opens a small panel with a one-character text input and the six accent swatches.
The input opens the child's own emoji keyboard, so the choice is every emoji their phone has rather
than a shortlist we picked; `firstGrapheme` keeps exactly one, and the colour repaints the entire
app immediately. Both write optimistically and revert if the server rejects them. The parent still
sets the initial pair when adding the child — this only lets the child overrule it, which is the
cheapest available purchase on the ownership the kid app is built around.

**Parent** — one form, top to bottom: who (child chips) · what (text plus eight quick-picks) · when
(date, start, end auto-filling +1h) · Once or Every week · where. The submit button states what it
will do — *"Add every week"*. Below it: the agenda grouped by day, filterable
per child. Tapping ✕ on a row opens the choice inline: **Delete** for a one-off, or **This event** /
**All events** for part of a series, always alongside a dismiss that also fires on a tap outside or
Escape. Below that: each child's link with
copy-to-clipboard.

Time-dependent UI (the NOW card, countdowns) renders only after mount, so server and client markup
agree and there is no hydration mismatch.

**Measurements, not preferences.** The layout was reviewed against a photograph of a real phone in
August 2026, and the two obvious conclusions were both wrong — worth recording, because the same
reasoning will present itself again.

The complaint was that the app wasted space at the edges and that this was why the *Who* chips wrapped
onto three rows. Measured at 360px, the width in common use and the one the photograph turned out to
show, the card gave 280px of content. Reclaiming the outer padding bought 16px, and **the third row
stayed** — the first three chips need 327px between them. Only narrower chips crossed the threshold.
Widening was worth doing on its own merits; it was not the fix.

The second was that the two time fields overlapped. They did not: 136px each with an 8px gap and no
overflow. Two pills of identical fill eight pixels apart simply read as one control with a stray
second number in it. The fix was a caption on each, not geometry.

The settled rules, applied everywhere: one outer gutter of 16px, one card radius of 24px, controls at
16px, and a form field is a full-width pill whose input sits at its own intrinsic width — which puts
each browser's picker chevron beside the value rather than at the far edge, and makes it irrelevant
whether that browser stretches the input. It once did not, and the date field ended halfway across
the card on Android while measuring full-width in Chromium.

### 5.7 Platform behaviour

Coverage is summarised in the [README](../README.md#platform-support). The parts worth recording:

- **iOS needs 16.4+ and a home-screen install** for Web Push — in a plain Safari tab the `Notification`
  and `PushManager` globals are absent, so the bell button detects this and renders nothing rather
  than offering something that cannot work.
- **`navigator.vibrate` does not exist on iOS.** The check-off handler is guarded, so iOS simply gets
  no haptic rather than an error.
- **Native date and time pickers follow the device locale**, not the document's `lang`. A phone set
  to US English shows a 12-hour picker against the app's 24-hour agenda. Fighting the native control
  would cost more than the inconsistency does.
- **Per-child manifests.** `/k/<token>/manifest.webmanifest` is generated per child, so the installed
  app is named after that child and its `start_url` opens straight into their day. iOS reads
  `apple-mobile-web-app-title` instead, which is set to the same name.
- Deleting a home-screen app drops its push subscription silently on both platforms; the kid re-taps
  🔔 to restore it.

### 5.8 Deferred: collapsing a weekly run into one agenda row

**What it is.** A parent-facing alternative to grouping the agenda purely by day. Because the agenda
groups by day, an open-ended weekly activity necessarily appears once per week — five rows inside
the 35-day window. Three weekly commitments in a household therefore produce fifteen rows carrying
three facts, and finding next Thursday means scrolling past four Swimmings already known about.

```
EVERY WEEK
  🏊 Swimming   Tuesdays 15:00 · Beatrix      ⌄
  🥊 Boxing     Thursdays 16:00 · Rex         ⌄
  🇩🇪 German     Saturdays 10:00 · Beatrix     ⌄

COMING UP
  Tue 4 Aug     🏊 Swimming 15:00
  Wed 5 Aug     🩺 Doctor   09:00
```

The rule gets one row; ⌄ expands it to its occurrences. One-offs stay where they are.

**Parent only.** The child's screen shows a single day, so a weekly activity already appears exactly
once there. Collapsing has nothing to collapse.

**Why it was deferred.** It is a display problem, not a data one, and it only became visible once
repeats stopped being a small fixed count. It also forces two design decisions that are easy to get
wrong and hard to reverse once a parent has learned the layout:

1. **Do weekly occurrences still appear under their day?** If they do not, the agenda stops
   answering *"what does Thursday actually look like"*, which is its whole purpose. The summary
   should almost certainly be an addition with controls attached, not a replacement.
2. **Where does delete live?** Today every row carries its own ✕ offering *This event* / *All
   events*. Collapsing splits that in two — *All events* belongs on the rule, *This event* on an
   expanded occurrence. Conceptually cleaner, but it puts deletion in two places instead of one.

**What it would take.** No schema work: the `series` table added for auto-prolongation is already
exactly the rule this view renders. The parent page needs the active series returned alongside the
events, and `Agenda.tsx` needs a second grouping and an expand/collapse — roughly 60–90 lines.

**Where it sits.** On the [roadmap](../README.md#roadmap), below the views that answer questions the
agenda cannot answer at all.

### 5.9 Roles, shared activities and subscribe feeds

**Three roles.** A **child** uses the web app and gets push reminders. A **participant** is picked
when an activity is added and subscribes to a feed of just those. An **observer** is never picked —
they receive the whole household — so offering them in the picker would only invite a pointless
choice, and they are filtered out of it and of the agenda's filter chips.

**One activity, several members.** The school run is one event with a child and the adult driving,
not two events that happen to coincide. It is stored as **one row per member sharing a `group_id`**,
which is the same expand-at-write-time choice recurrence already makes: reads stay dumb, and
reminders, push, done-state, the kid's day and the feeds all keep working untouched. A join table
would be purer and would have rewritten every query in the app. The agenda collapses a group back
into one line naming everyone; an observer's feed collapses it too, or they would see it several
times. Deleting removes it for every member — the rows are the same activity seen from each side,
so removing one would leave the others holding an appointment with nobody.

A multi-member repeat creates one `series` row per member, sharing a `group_id`. One row cannot
serve several members because the unique index that makes top-ups idempotent is
`(series_id, starts_at)`.

**Why a feed rather than emailed invites.** An invite is instant and lands in the primary calendar,
but it needs a mail provider, DKIM and SPF records, byte-perfect iCalendar in a `multipart/alternative`
part, a `UID`/`SEQUENCE` lifecycle, and a second message on every deletion that can independently
fail. A subscribed feed needs none of that: **cancellation solves itself**, because the calendar is
replaced wholesale on each poll, so a deleted activity simply stops being there. What it gives up is
real and stated in the README: no notification, no free/busy blocking, and a refresh the recipient's
client controls — roughly hourly on Apple, about three hours on Outlook, and 12–24 hours on Google
with no setting to change it.

**The handover page.** `/cal/<token>` is what gets shared. Subscribing by hand means finding a
settings screen most people have never opened, so the page offers each client the shortest route it
actually supports: one tap for Apple via `webcal:`, and copy-plus-steps for Google and Outlook.

It is laid out as **four equal cards** — Apple, Google, Outlook, any other — each holding its own
action. The first version gave Apple a full-width primary button and left the others as grey text
beneath a floating "Copy the address", which read as a ranking rather than a choice and left nothing
connecting the copy button to the steps that needed it. Every card that needs the address has its
own copy button, duplicating the control to remove the ambiguity, and the address itself appears
once beneath them for anyone whose clipboard is blocked.

All three were verified against real accounts in August 2026, and the results are not what a reading
of the docs would predict — which is why they are written down rather than inferred:

| Client | One-tap route | Verdict |
|---|---|---|
| Apple Calendar | `webcal://` | **Works.** The scheme is handled by the OS, which hands the tap straight to Calendar |
| Google Calendar | `r?cid=<url>` | **Fails** — opens the calendar, then *"Unable to add calendar, check the URL"* |
| Outlook | none exists | Mac client cannot subscribe at all |

The pattern is that an OS-level scheme handler is a far more dependable contract than a web app
parsing a query parameter.

There is deliberately **no Google button**. Google's `r?cid=<url>` deep link opens Google Calendar and
then fails with *"Unable to add calendar, check the URL"*, while the same address pasted into
Add calendar → From URL works — confirmed on a real account. A button that reliably fails is worse
than no button, because it moves the blame onto the address. Outlook's Mac client cannot subscribe at
all: its "Import ICS" takes a one-off snapshot that never updates, so the steps say to do it once at
outlook.office.com.

The response headers are deliberately the same shape as Google's own published feeds —
`text/calendar; charset=utf-8` and `no-cache, no-store, max-age=0, must-revalidate`, with no
`Content-Disposition`, since a filename invites a client to treat the response as a download rather
than a calendar.

The page is behind the family PIN, and that is only meaningful because **the feed token is a second,
independent secret**. With one token, appending `.ics` to a leaked share link would walk straight
past the gate and the PIN would be decorative. The gate reuses the ordinary parent session rather
than a bespoke one: the PIN *is* the parent credential, so anyone who can pass this screen could
sign in at `/parent` anyway, and a separate cookie would imply a separation that does not exist.

The consequence to know: an adult who is not a parent — a nanny, a grandparent — can only be given
the PIN that also unlocks the admin app. A per-person code is the fix when that case arrives.

**Knowing whether they subscribed.** There is no registration handshake as there is for push, so on
the face of it nothing would tell you whether a link was ever used. But the recipient's calendar
provider fetches the feed on a schedule, and `children.last_fetched_at` records it — turning "did
they ever subscribe?" from unanswerable into a line on their profile.

**The feed is not protected by anything but its token.** Google's, Apple's and Microsoft's servers
fetch it unattended: no browser, no session, no human to type anything. Any interactive gate would
return 401 and the calendar would silently never sync. So the endpoint is `noindex`,
`Cache-Control: private, no-store`, and rotation is the revocation mechanism — replacing a link
changes both tokens together, because rotating only the share link would leave a leaked feed still
syncing into somebody's calendar.

### 5.10 A year in the agenda

The parent agenda loads a full year, matching how far a weekly repeat is materialised, and reveals
it five weeks at a time. Measured with six weekly series across three children — 312 events, a
heavier household than most:

| | |
|---|---|
| Response | 146 KB raw, **17 KB gzipped** |
| Rows in the DOM before "Show more" | 36 |

So no second round trip is needed: the data is small once compressed, and it is the *rendering* that
had to be chunked, not the loading. Each "Show more" reveals the next five weeks from data already
in the page, so it is instant and cannot fail.

### 5.11 Android, Family Link and the Chrome dependency

**The constraint.** A home-screen web app on Android is a *WebAPK*. It gets its own icon, its own
name and its own entry in Family Link — but it renders through Chrome. So a Chrome time limit takes
the calendar down with it, and marking the calendar itself "always allowed" does not override that,
because the dependency is on Chrome's engine rather than on Chrome's icon. Confirmed on a real
supervised device: the app is listed separately, and still only works while Chrome does.

This matters because the households this is built for are exactly the ones running parental
controls.

**What we do: restrict Chrome by place, not by time.** Family Link is set to *only allow approved
sites*, the family domain is approved, and the Chrome time limit is removed. The calendar then works
whenever the child opens it, and Chrome reaches nothing else.

The counter-intuitive part is that this is **stricter** than what it replaces. A time limit permits
the entire web for as long as it lasts; an allowlist permits one domain indefinitely. The cost is
that it is Chrome-wide, so anything the child legitimately needs — school sites — has to be named.

**The alternatives, and why they lose:**

| Option | Verdict |
|---|---|
| Mark the calendar "always allowed" in Family Link | **Tested, does not work.** The app is listed, but blocking Chrome still stops it |
| Install it from a second browser that is not limited | Moves the problem. Any browser that can render this can render anything |
| Wrap it as a Trusted Web Activity | **No.** A TWA is Chrome-backed, so it inherits the same dependency |
| Wrap it natively over Android System WebView | The real fix, and the expensive one — see below |
| Accept the time limit | The calendar is unavailable exactly when the child is out and needs it |

**The native wrapper, costed honestly.** A Capacitor shell renders through Android System WebView, a
system component Family Link does not time-limit, so the Chrome dependency disappears. The web app
itself would not change.

The trap is notifications. **Android System WebView does not implement the Web Push API**, so the
dependency-free RFC 8291 implementation in `lib/webpush.ts` — the part of this codebase that took
the most care to get right — would not run there. A wrapper needs native Firebase Cloud Messaging
and a second delivery path on the server, kept in step with the first. That is the actual cost, and
it is considerably more than wrapping.

So the wrapper is worth building only if the allowlist proves inadequate — if a child needs many
sites, or if a second family adopting this cannot maintain an allowlist. Until then it stays on the
roadmap, and the allowlist is the answer.

**iOS is unaffected.** A home-screen web app there is backed by WebKit, which is the system engine
rather than an app, so Screen Time controls it as its own thing.

### 5.12 Getting the app onto the phone

**Reminders need the app installed, and on iPhone that is absolute.** `PushManager` does not exist
in a Safari tab: web push is available only once the calendar is on the Home Screen. So a child
reading their calendar in a browser can never be reminded — and the bell that would fix it was
hidden precisely *because* it could not work, leaving a blank corner and a child who concluded
reminders were broken. An absence teaches nobody anything.

The screen now carries a hint whenever it is not running installed, saying what is wrong and what to
do. Chrome hands over a real install prompt through `beforeinstallprompt`, so Android gets a button;
Safari has no equivalent, so iOS gets steps.

**Those steps were audited against the browsers rather than written from memory, and most of them
were wrong for somebody.** *"Tap the share button below"* holds only on an iPhone with the default
bottom address bar — it is at the top on an iPad, and at the top for anyone who moved the address
bar — so the button is now named by its icon, the square with an arrow, and never by a position.
*Add to Home Screen* sits well down a share sheet the user can reorder, so the instruction says to
scroll. Chrome labels the action *Install app* about as often as *Add to Home screen*, so both are
given.

Two findings were more than wording. **A link arriving in a chat opens in that app's own browser,
which has no Add to Home Screen at all** — the commonest way this app is first opened is a dead end,
and the first step now says to choose *Open in Safari* from that browser's menu. Anyone already in
Safari reads past it, so no detection is needed. And **iPadOS Safari reports itself as Macintosh**,
so the obvious `/iphone|ipad|ipod/` test missed every iPad and served it the Android instructions;
touch points separate a real Mac from an iPad claiming to be one.

One correction of substance: the Android copy promised that installing was what made reminders work.
It is not — web push works in the browser there, and only iOS requires the home screen. Installing on
Android buys an icon, a window without browser chrome, and offline, which is what it now says. It removes
itself the moment the app is installed, which is why it has no dismiss control — dismissing it would
hide the only route to the feature the app exists for.

**And "on" has to look on.** After enabling reminders the bell showed a tick that faded after a
moment, leaving only a faint background tint to distinguish on from off. A tick that appears and
disappears is indistinguishable from nothing having happened, so re-tapping felt like failure. The
bell now carries a small permanent tick badge while reminders are on.

### 5.13 Offline, read-only

**Why it is small.** The child's page already carries a month of events in the document, so one
cached response covers everything they can scroll to.

**A revoked page must not outlive the revocation.** A non-`ok` answer from the network — the token
replaced, or the child removed — deletes the cached copy. Without that, a rotated link kept rendering
from cache the moment the network was slow enough for the three-second fallback, or absent entirely,
which quietly made rotation optional. No data layer, no IndexedDB, no JSON endpoint.

**Why it cannot break the online app.** Every branch of the fetch handler either serves a request or
returns without calling `respondWith`, which leaves the browser to do exactly what it does now.
Non-GET requests, other origins, `/api/*` and React payload requests (`?_rsc=`) are all untouched, so
no write and no refresh passes through it. Documents are **network-first**: the cache is consulted
only after the network has already failed, so no cached page can reach an online user. The parent app
is deliberately out of scope.

Content-hashed assets are cache-first, which has a bonus: a device keeps the exact chunks its cached
page refers to, removing the stale-HTML-meets-purged-asset breakage that exists today with no worker
at all.

**Rollback, written before the feature.** `public/sw-killswitch.js` deletes every cache and
unregisters. A service worker outlives the deploy that introduced it, so a faulty one can serve
broken content long after the server is fixed; copying that file over `sw.js` and deploying is the
way out. `skipWaiting` and `clients.claim` are deliberate for the same reason — without them a bad
worker persists until every tab closes, which on iOS can be days.

**Detecting offline needed two signals.** `navigator.onLine` answers "is there a network interface",
not "can I reach the server": a phone on wifi with no internet reports online. So the age of the
document is also checked. The page re-renders on every poll while the server is reachable and stops
the moment it is not, so past three missed polls what is on screen is a snapshot whatever the browser
believes.

**The banner is the feature.** A cached schedule that looks live is worse than the browser's offline
page: a child could act on something cancelled hours ago with nothing to say so. So it states an age
— *"This is how your day looked two hours ago"* — and the controls that need a server are withdrawn
rather than offered and failed. Marking done optimistically and then reverting when the request fails
reads as the app ignoring the tap.

**One bug this surfaced, worth more than the feature.** The service worker was registered by the
notifications button, behind two checks that have nothing to do with offline: that push exists, and
that permission is not denied. On an iPhone in a Safari tab `PushManager` does not exist, and any
child who declines notifications trips the second — so the children least likely to get reminders
would also never have got their calendar offline. Registration now happens on the page itself.

**Four refinements, taken after checking the implementation against current guidance.** The first
was a genuine failure, not a polish item:

- **Cached under the path, with the query dropped.** Every reminder deep-links to the day it is
  about — `/k/<token>?d=2026-08-09` — and keying the cache on the full URL made the commonest way a
  child opens this app offline, tapping a notification, always a miss. It also bounds the cache to
  one entry per child instead of one per day ever viewed. A test now opens the app offline *through
  a deep link*, which is the assertion whose absence let this through.
- **A three-second network ceiling.** A slow network is commoner than no network, and network-first
  with no timeout makes a child on a weak signal wait for a request to fail — potentially half a
  minute — rather than see yesterday's copy at once. The race only runs when there is something
  cached to fall back to; with nothing stored there is nothing to gain by giving up early.
- **Precache at install.** Caching only on the first controlled fetch meant installing and
  immediately losing signal left nothing stored. The icons are precached in the worker, and the page
  stores itself as soon as the worker is ready.
- **`navigator.storage.persist()`.** Requests exemption from automatic eviction. Safari grants it
  only where notification permission exists, which a child who tapped the bell already has — so it
  tends to succeed for exactly the ones who depend on it.

Platform notes. Safari caps cache storage for a web app at about 50 MB, against the 1–2 MB this
uses. It also caps unused script-writable storage at seven days *in a tab*; home-screen apps are
widely reported to be exempt, but Apple does not document it, so that stays a manual check rather
than an assumption. Background Sync does not exist on Safari at all, which is what settles offline
as read-only rather than write-and-replay. Android needs nothing special.

Deliberately not adopted: Workbox, which would add a dependency to replace eighty lines already
written and understood, and Navigation Preload, which saves 50–200 ms of worker boot and is worth
having only when something else brings us back into this file.

#### Offline was decided by subtracting one clock from another

*Fixed 2026-08-13.* The banner was inferred from the age of the document: `Date.now()` minus
`renderedAt`. But `renderedAt` is stamped by the Worker and `Date.now()` is the child's phone, and a
phone four minutes fast therefore reported every freshly rendered page as four minutes stale. It
showed the banner on a live page, on every load, and **could never clear** — a home-screen app has
no pull-to-refresh and no reload button, so there was no way out from inside it. While the banner
was up, ticking off, removing and *Add your own* were all withdrawn: the app was gone, not merely
mislabelled.

Three things kept it hidden. The failure is asymmetric — `ageOf` clamps a negative age to zero, so a
phone running *slow* was already safe and only a fast one broke. It is per-device, so it looked like
one child's network. And **no test could have caught it**, because a test runs the browser and the
server on one clock; the guard now gives the browser its own, via an `addInitScript` that shifts
`Date` forward four minutes.

The fix measures instead of inferring, which is this project's recurring lesson in a new place. A
request to the child's own manifest returns the server's `Date` header, giving the offset between
the two clocks; the staleness comparison then happens in one frame of reference. The same request
doubles as the reachability test the age check was always a proxy for — no reply is what offline
means — and it carries the worker's own three-second ceiling, for the worker's own reason. Until
that first measurement lands, no verdict is given at all: `navigator.onLine === false` still shows
the banner immediately, but a clock nobody has checked decides nothing.

Two refinements not taken: `Age` in the skew formula, which matters only if an intermediary caches
the manifest; and correcting the app's own `now`, so a mis-set clock cannot shift *HAPPENING NOW* or
the countdown either. Both small, neither load-bearing now the banner is measured rather than
guessed.

### 5.14 A child's own entries, and who has opened their link

**What a child can add.** One topic and one time, on the day they are looking at. No end time, no
repeat, no location, nobody else on it: an hour is assumed. The narrow shape is deliberate. This app
is good because it is *not* an adult calendar, and a create form with four fields is the first step
back into being one. The topics are one-tap chips in a child's own words, with a free-text field
beside them, and the time is a vertical list of half hours from 06:00 to 22:00 — which incidentally
sidesteps the AM/PM problem the parent's native time input still has.

**They stay on the child's screen.** `allEventsInRange` filters to `created_by = 'parent'`, and both
the parent agenda and every adult feed read through it, so a child's entry cannot reach either by
someone forgetting a filter at a call site. One rule, one place.

Be honest about what that privacy is: **a display convention, not a guarantee.** The rows sit in the
same table and the parent holds the database. The child's interface says "your own", not "private",
because the architecture does not keep the stronger promise.

**One chronological list, weighted by author.** A parent's entry keeps the filled card and the heavy
type; a child's own renders as an outline with lighter type and a smaller icon. Splitting the day
into two sections was considered and rejected: the screen's whole value is that it reads as a day in
order, and sorting by author destroys that to convey something a colour weight conveys anyway.

**Permissions are two conditions in one query.** `delete from events where id = ? and child_id = ?
and created_by = 'child'` — a token can neither reach a sibling nor remove what a parent set. Ten
entries a day, forty characters a title.

**Reminders treat them like any other activity**, because to the child they are.

#### Which devices have opened the link

A random id in a year-long cookie, and a row with two timestamps. The parent's profile reads
*"Opened on 2 devices. Last used 20 minutes ago."*, with a button to forget them all.

It is **not a control**. It blocks nothing and identifies nobody; it answers the one question
rotation cannot, which is whether anyone *else* has the link. It earns its place because a new
device is a rare event where a new IP address happens several times a day on mobile data — so the
number is quiet enough to be worth reading. Deliberately no address, no user agent, no country: the
count and the last-used time carry nearly all the information, and a number readable at a glance
beats a table that needs studying.

The honest weakness is drift. Private browsing mints a new id every session, and a new phone adds
one, so the count creeps up through ordinary use. That is what **Start counting again** is for:
zero it, and the next number means something again.

That control was first labelled *"Forget these devices"*, which was the worst kind of wrong. It
reads as revocation and is not: every link keeps working, and only rotation stops one. A parent
could have tapped it believing a leaked link was dead. The label now describes what it does, and the
sentence beside it names what actually revokes.

**Two counts, adjacent, measuring different things** — browsers that opened the link, and phones that
asked for reminders. They contradicted each other on their face: after a reset the page read
*"Nobody has opened this link yet"* directly above *"2 devices are set up to remind Beatrix"*. Both
true.

The first fix renamed them — browsers here, phones there — and added a sentence to each explaining
it was not the other. That sentence was worse than the problem. Read with reminders *off*, it
pointed at a count that was not on the screen at all, so it referred to nothing. **A block that has
to explain its relationship to another block is the wrong shape.** The rule now is that each block
answers one question and mentions no other: the link block says how many browsers and what to do
about a number too high; the reminder block says on or off, and carries the caveat about silent
phones only in the state where a caveat applies.

**Where it had to live.** Recording the device runs in a server action called once per tab session,
not during the page render. Next only permits writing a cookie from an action or a route handler;
attempting it while rendering throws — and because the attempt was wrapped in a `try/catch` so a
child's calendar could never fail over bookkeeping, the count silently stayed at zero. A swallowed
error in exactly the feature built to stop silent failures.

### 5.15 Not built: hosting this for other families

What it would take to open the server so other families could sign up — pricing, trust and safety,
an operator's cockpit, and how it would be wound down — has been thought through at length and
deliberately kept out of this repository, because it is commercial intent rather than a fact about
the code. **Nothing is built, and this section is the whole of what the code needs to know.**

Worth recording here because it is a fact about *this* schema: the change is much smaller than
"multi-tenancy" suggests, since everything already hangs off `child_id`. One `families` table, one
`children.family_id` column, and four queries that currently read across all children. The scheduler
needs nothing at all.

### 5.16 Correcting an activity

*Added 2026-08-13.* Until now the answer to a wrong time was to delete and re-add. That is fine for
the rare case and wrong for the common one: the entry a parent most wants back is the one they just
typed with the wrong number in it.

**One occurrence, and only what, when and where.** Not who, and not the repeat. Both of those are
structural — who means adding and removing rows of a group, the repeat means creating or ending a
series — and both keep working through delete-and-re-add, which already handles them. Excluding them
is most of the reason this feature is small. A repeat is corrected one week at a time, and the panel
says so above the fields rather than after the fact.

**It opens in the row, not in the form at the top.** Turning the *New activity* card into an edit
form would have cost nothing to build, but tapping a row half a screen down would then throw the
page to the top — away from the thing being corrected. The delete confirmation already expands in
place, so the gesture is one the screen has taught once already.

**The whole line is the way in.** A ✎ beside the ✕ would be more discoverable and would cost the
title about 36px on a 360px phone, which is the width the layout guard exists to protect. The trade
was made in favour of the title. Note the consequence: a tap means *edit* on the parent's screen and
*mark done* on the child's. Different apps, different people, no better gesture free on either.

**Three things the correction has to do that the form never shows:**

- **Clear the send-once claim.** `notifications_sent` is keyed `lead<n>:<event id>`, and an id does
  not change when a time does. Left standing, a reminder already sent silences the new time — the
  move reaches the parent's screen and never reaches the child's. The claim is deleted whenever the
  start moves, and the same immediate-send path creation uses then re-announces it if the new time is
  already inside a lead window.
- **Un-tick it.** What the child ticked off was the old slot.
- **Move the whole group.** The rows of a multi-member activity are one activity seen from each
  member, so the correction follows `group_id` exactly as deletion does.

**Two guards, not one.** `allEventsInRange` filters to `created_by = 'parent'`, so a child's own
entry never appears on the parent's screen and offers nothing to tap; `updateEventGroup` carries the
same condition in its `where`, the mirror of `deleteOwnEvent`'s `created_by = 'child'`. The test
forges the hidden id in the browser to prove the second one matters — and finding a way to write that
test taught something worth keeping: **a controlled input cannot be tampered with and then left
alone.** Changing any other field re-renders the form and React restores the value, so the forgery
has to be the last thing that happens before submit.

**The one collision a single-occurrence edit can produce** is moving a week of a repeat exactly onto
another week of the same repeat, which the unique `(series_id, starts_at)` index refuses. It is
reported as *"There is already one at that time"* rather than surfacing as a 500.

#### Correcting the whole repeat

*Added 2026-08-13, once single-occurrence editing was in use.* A repeat now offers the same two
scopes deletion does — *this week* or *every week* — and **every week keeps the weekday**.

**Why not delete and recreate the series, as a parent would by hand.** It was the obvious algorithm
and it is genuinely cheaper: the creation path already exists, and a weekday change would come free,
because generating a fresh series from `expand()` cannot collide with the unique
`(series_id, starts_at)` index and sets `materialised_through` correctly by construction. It was
rejected on what the new event ids cost:

- **The ICS `UID` is the event id** (`lib/ics.ts`). Subscribed feeds are full-state documents with
  `METHOD:PUBLISH`, so a changed UID is a removal plus an addition rather than a modification.
  Apple and Google reconcile that correctly; Outlook is documented as unreliable at propagating
  removals from an internet calendar, which is the one client an in-place update never asks to
  remove anything.
- **The send-once ledger inverts.** New ids carry no claims, so the *scheduler* re-announces
  anything inside a lead window whether or not the time changed — a second buzz for a corrected
  typo, arriving from cron rather than from the action.
- **Reusing the old ids does not rescue it.** It can be done — ids are application-generated — but
  it forces ordinal pairing of old occurrences to new, which is the in-place update rewritten; and
  the primary key makes create-before-delete impossible, so the safe failure ordering (worst case a
  visible duplicate) is lost with it.

Without the free weekday change, the trade reverses: in-place is ~45 lines more and buys a stable
UID, no Outlook exposure, and exception preservation for nearly nothing. So the weekday stays put,
and the form withdraws *every week* the moment the date is changed rather than ignoring it.

**A week corrected on its own is left alone, and it costs no schema.** Every occurrence is created
from its series row, so an occurrence whose title, place or wall-clock time no longer matches that
row *is* the record of a deliberate correction. Comparing the two is the whole detection. Wall clock
rather than the instant, because `wallToInstant` preserves local time across a daylight-saving
change and only the wall clock is stable.

**`group_id` names the activity, not the occurrence — and that was a live bug.** A shared weekly
repeat carries one group id across all fifty-two weeks, because creation assigns it once and stamps
every row with it. `deleteEvent` matched on `group_id` alone, so **"delete this event" on one week
of a shared repeat deleted the entire term for both children.** Shipped, live, and found only
because a series test finally combined *shared* with *weekly* — each had been tested alone. Both
delete and update now match `group_id` **and** `starts_at`, which is what identifies one occurrence.
The lesson is the ordinary one about coverage: two independent flags need a test where both are set.

**A server action does not receive the submit button's `name` and `value`.** The scope was going to
ride on `<button name="scope" value="series">`, and every save silently behaved as *this week*.
React state cannot carry it either — the click that sets the state is the click that submits. What
works is an *uncontrolled* hidden input written through a ref in the click handler; `defaultValue`
is what stops React restoring it. Note the symmetry with the forged-id test above: **a controlled
input is restored on every render, an uncontrolled one is not**, and both facts are the same fact.

Still deferred: moving a repeat to another weekday.

**One asymmetry left standing.** Editing an activity to a date beyond the 52-week horizon is
refused, because past it the agenda simply stops loading and the move would read as a deletion.
*Creating* a one-off out there is still allowed and has exactly that effect. It predates the edit
work and needs a parent to type a date more than a year out, so it was left rather than widened into
a change about something else — one line in `addEventAction` whenever it is worth taking.

#### Changing who is on it

*Added 2026-08-15.* The Who pills now open the edit panel, in the same order the create form
uses — Who, What, When, Where — and both scopes govern membership as well as time. Five rules,
each a sentence:

1. Membership is written only if the pills were touched. Otherwise correcting a time from a week
   somebody guested on would apply a membership nobody chose and silently drop them everywhere.
2. *This week* changes this occurrence.
3. *All weeks* changes every occurrence still to come.
4. Never retroactive — past weeks keep whoever was on them.
5. At least one member; removing the activity is still the ✕.

**Addition mirrors, it does not regenerate.** A new member is given the instants of the member whose
row was tapped, rather than fresh ones computed from the pattern, so a week corrected on its own is
joined at the time it actually has. `materialised_through` is copied from the reference series, so
the scheduler tops both up in step. Removal is two statements — delete their future rows in the
group, deactivate their series — which covers a regular, a guest, or somebody who is both.

**Delete-and-recreate was reconsidered and again declined**, for the reasons in the previous
section: the ICS UID is the event id, and Outlook is the client documented as unreliable at removals.

**Adding somebody for one week leaves them without a series**, which is the point — they came on a
Tuesday, they did not join the repeat. Two consequences had to be closed, and both were closed by
following the group rather than the series: `updateSeriesGroup` walks one member's occurrences and
writes to everyone present at each instant, so a guest is not stranded at the old time; and
`endSeriesGroup` sweeps the group after ending every series, so a guest is not orphaned holding an
activity nobody else is at.

**Two live bugs surfaced while building it, both the same mistake in different clothes** — treating
`group_id` as though it named the occurrence:

- **An observer's feed collapsed a whole term into one entry.** `feedEvents` deduped on `group_id`
  alone, and a shared weekly repeat wears one group id across all fifty-two weeks. Keyed on the group
  *and the instant* now. Third instance of this after `deleteEvent` and `updateSeriesGroup`; the
  schema comment on `group_id` now says so where it is defined.
- **A save that succeeded left the panel open.** Moving an activity to another day moves its row into
  a different day's list, so React unmounts it — and `useActionState` went with it, discarding the
  result. The outcome is handled in the submit closure now, calling the agenda's own `onDone`, which
  outlives the row. It hid because it only reproduces when the shift crosses midnight: the suite
  passed all morning and failed at seven in the evening.

**A trick worth keeping.** When a second person joins an activity that had none, the group id minted
for them is *the first member's own event id* rather than a fresh one. The agenda keys a collapsed
row on `group_id ?? id`, so any other value would change that key at exactly that moment and remount
the row — the same unmount, arriving by a different route.

## 6. Testing

127 tests, all green. **One convention worth keeping:** every test uses an activity title no other test uses. The suite
shares a single database within a run, so a reused name silently doubles a count and the failure
looks like a bug in the feature rather than in the fixture. It has cost time three times.

`npm test` wipes `.data-test` and starts a dedicated server against it, so runs
are deterministic and the development database is never touched.

- `tests/unit.spec.ts` — 34 tests: timezone conversion, UTC-boundary day mapping, day windows,
  weekly expansion to the horizon and the forward-only top-up window, day arithmetic proven
  independent of the runtime's zone, past-midnight events, emoji inference and its fallback,
  zero-padded time formatting, countdown phrasing, grapheme handling for the kid's chosen emoji
  (ZWJ sequences and regional-indicator flags must survive as one character), and the wording and
  seven-day horizon of parent-driven announcements, iCalendar output — CRLF endings, 75-octet
  folding that never splits an emoji, and escaping — and the push crypto — including a byte-for-byte
  reproduction of the RFC 8291 §5 example, which is the only real proof the encryption path is
  correct given that a wrong one is accepted with 201 Created and fails silently on the device.
- `tests/e2e.spec.ts` — 47 tests on an emulated Pixel 7: PIN rejection, weekly creation reaching the
  child's phone, single versus series delete and the past occurrences a series delete must keep,
  the three roles, participant versus observer feed contents, a shared activity appearing once,
  the PIN gate and that a share token cannot be turned into a feed token, a child's own entry
  appearing on their day and on neither the parent agenda nor an observer's feed, per-child isolation, done-state round-tripping to the
  parent's agenda, the kid's chosen emoji and colour persisting to the parent's view, one kid's
  restyling leaving their sibling untouched, empty days, unknown tokens returning 404.
- `tests/notifications.spec.ts` — 9 tests: the reminder endpoint refuses to run without the shared
  secret, announces an upcoming event exactly once across repeated calls, and counts a device the
  push service rejects rather than swallowing it; the subscribe route rejects malformed and
  unknown-child payloads while upserting a device by endpoint.
- `tests/layout.spec.ts` — 6 tests at a viewport pinned to 360px, the narrowest width in common use.
  These measure rather than assert behaviour: that a family of five fits two rows of chips, that
  nothing in the form runs past the card, that the date pill spans the row while the input inside it
  does not, that start and end are two separated fields, that a chip stays 44px tall, and that the
  kid app's five hand-painted gutters are the same 16px as the parent app's one.

  **Why the category exists.** Ninety behavioural tests passed while five people wrapped onto three
  rows on the commonest Android phone and two time fields read as a single control. Nothing in the
  suite could have caught either: every test asserted what a control *does*, none how much room it
  takes. This is the third instance of the same blind spot — after the copy defects and the install
  instructions — and the first one with a guard against it.

  **A trap worth recording.** The obvious assertion, counting rows on screen, fails in the full run
  and passes alone: the specs share one database, so by the time this one runs the household is
  whatever the earlier specs left behind. The second attempt — rows against the theoretical minimum —
  fails legitimately, because greedy wrapping cannot always reach it. What works is measuring the
  five chips individually and packing them the way flex-wrap does. A layout assertion has to be
  written against data it controls, or against no data at all.

  **And the same trap once more, from the other side.** The chip guard read its gap from the
  distance between the first two chips it had measured — which is only the gap while those two are
  neighbours. Adding one fixture to an unrelated test put another child between them, so it measured
  92px instead of 6px and failed a layout that was correct. It now reads `columnGap` off the
  container. **A measurement must not infer its own units from the fixture set**, for the same reason
  the row count could not be read off the screen.

  **And a trap in checking one.** A layout guard is only worth what its negative case proves, so it
  gets checked by reverting the change and confirming it fails. That check was itself wrong once:
  Next's `.next` cache served a stylesheet compiled before the class names were edited, so the
  supposedly *wider* chips rendered with no horizontal padding at all and came out narrower than the
  real ones. The guard looked defused when it was intact. **Clear `.next` before verifying a layout
  test against edited classes**, or the thing under test is not what is on screen.

### 6.1 What only a person can test

The suite covers logic, crypto and flows in an emulated browser. It cannot press a real phone, and
everything below has already produced a bug that no test caught. Run it after any change to
notifications, the service worker, the manifest, or the domain.

**On the child's phone — five minutes**

| # | Do | Expect |
|---|---|---|
| 1 | Open the child's link, **⋮ / Share → Add to Home screen** | Installs under the child's own name, opens with no browser chrome |
| 2 | Tap 🔔 once, allow | Bell turns solid. Tap again — a ✓ flashes, meaning the device re-registered |
| 3 | On the parent app, add an activity starting in ~40 minutes | Phone buzzes within seconds. Status bar shows the schedule glyph, not a grey square |
| 4 | Tap that notification | Opens **that activity's day**, not today |
| 5 | Tap a row | Strikes through, buzzes faintly (Android only — iOS has no haptics), and the parent's agenda shows `DONE` |
| 6 | Swipe left and right | Moves a day at a time; a dot marks days with something on them |
| 7 | Leave the app open, have the parent add and then delete an activity | Both appear and disappear within about thirty seconds, without touching the page |

**On the parent's phone — three minutes**

| # | Do | Expect |
|---|---|---|
| 8 | Open `/parent`, enter the PIN, **Add to Home screen** | Installs as "Family Calendar"; only one install prompt, not two |
| 9 | A child's profile → **Share link** | The native share sheet opens with WhatsApp in it |
| 10 | Send that link to yourself in WhatsApp | Preview card shows the violet graphic, the child's name, and one line of description |
| 11 | ☰ → **Change PIN**, then check the other parent's phone | The other device is signed out and must enter the new PIN |
| 12 | Add an activity **Every week**, then scroll the agenda | One row per week to the edge of the 35-day view |
| 13 | Tap ✕ on the *second* of those rows → **All events** | That row and every later one go; the first one — already past by then, or not — behaves per row 14 |
| 14 | Tap ✕ on a row, then tap anywhere else on the screen | The choice closes and nothing is deleted |

**A child adding their own — three minutes**

| # | Do | Expect |
|---|---|---|
| 15 | On the child's phone, **+ Add your own** → a topic → a time → Add | Appears in the day in time order, lighter than what a parent set |
| 16 | Look at the parent's agenda and any adult's calendar | It is not there, and never will be |
| 17 | Tap ✕ beside it | Gone. A parent's activity on the same day has no ✕ at all |
| 18 | Add eleven in one day | The eleventh is refused |
| 19 | Open the child's link on a second browser, then check their profile | The browser count goes up, and the time updates |
| 20 | Tap **Start counting again**, then reopen the child's app | The count is zero and **the app still works** — this control clears a number, it does not revoke |

**Adults and their calendars — the part no test can reach**

The suite proves the feed is correct iCalendar and that the right events are in it. Whether a real
calendar client accepts it is only knowable by subscribing.

| # | Do | Expect |
|---|---|---|
| 21 | Add an adult, **Share link**, open it on another device | Asks for the family PIN before showing anything |
| 22 | Append `.ics` to that share link | 404 — the feed token is a different secret |
| 23 | Tap **Add to Apple Calendar** on an iPhone or Mac | Subscribe dialog opens; events appear as their own calendar |
| 24 | Follow the Google steps — copy the address, then Other calendars → + → From URL | Calendar appears under Other calendars. The one-tap deep link is deliberately absent; it fails |
| 25 | On `outlook.office.com` → Add calendar → Subscribe from web, paste the address | Appears within a few hours, and then also in Outlook for Mac |
| 26 | Go back to that adult's profile | Says **Subscribed**, with the time their calendar last checked |
| 27 | Add an activity with a child **and** that adult selected | One row in the agenda naming both; it reaches the child's phone and the adult's calendar |
| 28 | Delete that shared activity | Gone for the child immediately, and out of the adult's calendar at their next refresh |
| 29 | **Replace this link** on an adult, then wait for their calendar to refresh | The old subscription stops updating and eventually errors |

**Only time can test these**

| # | When | Expect |
|---|---|---|
| 30 | ~60 minutes before an activity | *"Starts in 58 min"* |
| 31 | ~5 minutes before the same one | A second reminder, and only one |
| 32 | 07:00 local | One digest per child listing the day, or *"Nothing planned today"* |
| 33 | The morning after adding a weekly activity | It still runs 52 weeks out — `select materialised_through from series` has moved on by a week, and no occurrence is duplicated |

**Offline — two minutes, and one check a fortnight later**

The suite proves the worker caches, serves and withdraws the right controls. It cannot prove any of
that on Safari, which is the platform where the rules differ.

| # | Do | Expect |
|---|---|---|
| 34 | Open a child's calendar, then turn on airplane mode and reopen it | The month is there, with **You are offline** and how old the snapshot is |
| 35 | While offline, look for **+ Add your own** and the ✕ on their own entries | Both gone. Tapping a row does not tick it |
| 36 | Turn airplane mode off and reopen | The banner clears within about half a minute, and the controls return |
| 37 | On an iPhone that has *declined* notifications, open the calendar then go offline | Still works. The worker no longer depends on notifications being available or allowed |
| 38 | Two weeks later, on an iPhone, open the home-screen app in airplane mode | Should still work. Apple caps unused storage at seven days in a Safari **tab** and exempts installed apps — this is the check that confirms it |

**If a notification does not arrive**

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-app>/api/cron/reminders
npx wrangler tail family-calendar-reminders
```

`leadSent: 0` with `leadFailed: 1` and a status code in `errors` means it was attempted and refused.
`leadClaimed: 0` means the scheduler saw nothing due. Both are more useful than the phone's silence.

## 7. Why D1

The application talks to SQLite through a four-line adapter, so the database is a swappable
dependency. What we needed: a store that is free at family scale, does not idle-shut-down when the
calendar goes quiet over a school holiday, and adds no second vendor to an estate already running
on Cloudflare.

| Option | Verdict | Reasoning |
|---|---|---|
| **D1** | **Chosen** | Cloudflare's SQLite. Same account, same dashboard, same bill as everything else here. No connection pooling to reason about — the hardest part of reaching Postgres from a Worker simply does not arise. Free at this scale by a wide margin |
| Neon + Hyperdrive | Viable second | Real Postgres, pooled for Workers. Lower migration risk, but it keeps a second vendor and a second account — which is what choosing Cloudflare was meant to remove |
| Neon over direct TCP | Rejected | Works without Hyperdrive, but opens a fresh connection per invocation: slower cold starts and a real risk of exhausting the connection limit |
| Turso / libSQL | Rejected | Also SQLite, also good. D1 wins only on being in the same account |
| Workers KV / R2 | Rejected | Not relational. The queries here are date-range scans with a join; a key-value store would mean hand-rolling indexes |

**What the move from Postgres cost.** Timestamps became ISO-8601 UTC text rather than `timestamptz`.
That is sound precisely because the format is fixed-width and every write goes through
`Date.toISOString()`, so lexicographic ordering *is* chronological ordering and the range queries are
unchanged. Ids moved from `gen_random_uuid()` to `crypto.randomUUID()` in application code, which
leaves the schema free of dialect-specific functions. Both changes were covered by the existing
suite — nothing needed a new test to prove the migration was safe.

**Local/production parity.** With no D1 binding present the same queries run against `node:sqlite`,
Node's built-in SQLite, in-process. A contributor clones the repository and runs `npm run dev` with
no database to install, no container, and — because both sides are SQLite — no dialect that can
diverge. This is stronger parity than the Postgres arrangement it replaced, where local ran one
engine and production another.

One difference is worth recording because it cost an afternoon: `node:sqlite` returns rows with a
**null prototype**, which React Server Components refuse to serialise across the client boundary,
while D1 returns plain objects. The local backend copies each row so the two behave identically.

## 8. Reaching households without a developer

**The barrier is not hosting. It is that the app expects to be configured from a terminal.**
One-click deployment already exists and is free; this codebase simply is not shaped to use it. Make
the app provision itself on first boot and the eight environment variables collapse to near zero, at
which point a deploy button turns a 45-minute developer task into a five-minute web flow. That is
the intervention. §8.2 is what it costs to build, §8.3 what it costs to own, and §8.4 the one
constraint that no amount of installer polish removes.

### 8.1 What actually blocks a parent today

| Step | Hard for a non-developer? | Why |
|---|---|---|
| Create a Cloudflare account | No | Ordinary web signup |
| Provision the database | **Yes** | `wrangler d1 create` is a terminal command, and its output must be pasted into a config file |
| Generate VAPID keys | **Yes — the hard blocker** | `npm run keys` requires Node and a terminal. There is no web path |
| Set eight environment variables | **Yes** | Meaningless strings pasted into a dashboard, with no feedback if one is wrong |
| Apply the schema | **Yes** | `npm run db:push` is a terminal command |
| Wire the reminder scheduler | **Yes** | A second service, a URL and a secret. See §8.4 |
| Choose a PIN, add children | No | This is the actual product, and it is already a web UI |

Only one of these is a hosting problem. The rest are configuration handed to the wrong person at the
wrong moment: we ask for secrets *before* first run, when the user has nothing to orient them,
instead of *during* first run, when the app could simply ask.

### 8.2 The fix: let the app configure itself

Each change removes a required environment variable, and none needs new infrastructure.

| Change | Removes | Effort |
|---|---|---|
| **First-run setup screen.** With no parent credential stored, `/parent` offers *"choose a PIN"* instead of *"enter your PIN"*, and writes the hash to a `settings` table. | `PARENT_PIN` | ~2h |
| **Auto-generate the session secret** on first boot into the same table. | `SESSION_SECRET` | ~30min |
| **Auto-generate the VAPID keypair** on first boot — a P-256 pair from `node:crypto`, exactly what `npm run keys` does — and serve the public key from a small endpoint the client fetches at runtime. | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | ~3h |
| **Apply `schema.sql` on boot**, as already happens against `node:sqlite`. It is idempotent, so it is safe on every cold start. | the `d1:push` step | ~1h |
| **Pick the timezone from the browser** during setup, storing it rather than reading it from the build. | `NEXT_PUBLIC_FAMILY_TZ` | ~1h |
| **Generate `CRON_SECRET`** on first boot and show the ready-made scheduler URL on the setup screen. | `CRON_SECRET` | ~30min |
| **A deploy button** in the README, pre-wiring the database integration. | the clone-and-push step | ~1h |

Roughly a day and a half. Installation then reads: click **Deploy**, sign in, wait ninety seconds,
open the URL, choose a PIN, add your children.

Two of these are correctness improvements rather than conveniences. **`NEXT_PUBLIC_*` variables are
inlined at build time**, which makes them actively hostile to one-click deployment: a value the user
has not chosen yet cannot be baked into a build that has already run, and fixing a typo means a
rebuild. And **secrets generated on the server are better secrets** — today the security of every
deployment rests on a parent pasting a long random string correctly, where a generated value cannot
be weakened by the person installing it, or leaked through a clipboard.

### 8.3 What it costs to own

The effort table above is the cheap part. Three of these risks are larger than the build.

**Secrets move from the environment into the database, and the blast radius changes.** Today a
leaked database exposes data. Afterwards it exposes the session-signing key and the VAPID
private key: the first forges a parent session, the second **sends push notifications to the
children that appear to come from their parent**. Those keys currently sit in an encrypted
environment store, absent from every database dump and backup. There is no way to have both zero
configuration and secrets outside the database — this is a trade to make deliberately, not an
oversight to fix later.

**The first-run land grab.** Between deployment and the parent choosing a PIN, the setup screen is
open to whoever arrives first. This is not theoretical: every new hostname appears in public
certificate transparency logs within minutes, so an attacker can watch for fresh deployments and
claim the household before its owner opens the tab. The cheapest real defence is to require a value
visible only in the owner's hosting dashboard — the deployment ID — which the parent reads in two
seconds and an attacker cannot see at all.

**Boot-time writes race.** Serverless cold starts run concurrently. Two instances generating a VAPID
keypair simultaneously can both write, after which subscriptions signed by the loser's key fail
*silently* — push simply stops for one child, with no error anywhere. Solvable with a unique
constraint and a re-read, but it is the bug class that passes every test and surfaces weeks later.

**Migrations become a distributed problem.** `create table if not exists` on boot is fine. Altering
a table across hundreds of unattended instances, with no version tracking and no way to observe
failures, is a materially harder problem than the one deployment we have today.

**Support without diagnostics.** Non-technical users mean *"it doesn't work"* arriving with no logs
we can see and no reproduction. Not a technical risk — a time one, and the one that most often ends
projects of this size.

**Sequencing.** Split by risk, not by feature. Phase 1 is the safe half — schema-on-boot, generated
`CRON_SECRET` and `SESSION_SECRET`, deploy button — taking eight variables to about three while
adding no meaningful attack surface. Phase 2 is the setup screen and VAPID generation with the
deployment-ID check. Throughout, an explicitly set environment variable must win over a generated
one, so an operator can always pin a secret.

**And a cheaper alternative that should be exhausted first.** For the first twenty households,
deploying it for them by hand takes ten minutes each and costs no engineering and no permanent
support surface. Build the installer when people are asking and doing it manually has become
tiresome. That is the signal; a hypothesis about demand is not.

### 8.4 The scheduler

Web Push requires a *server* to send the message — a browser cannot reliably promise "wake me at
15:30" on its own. Our reminder endpoint is stateless and idempotent, so it only needs pinging often
enough. **On Cloudflare that is a solved problem**: Cron Triggers are free and minute-level, and
`workers/reminders` is a five-line Worker that pokes the endpoint every ten minutes. It is deployed
separately from the application, so the schedule survives every release.

The constraint is recorded because it drove the hosting decision, and because the reasoning still
governs what the reminders are for. On a plan permitting only one cron a day, the morning digest
survives and the 30-minute heads-up effectively does not, which costs three things in order of
severity:

1. **The parent believes she has told the child, and she has not.** An event added at 14:00 for
   16:00 misses the morning digest and has nothing to catch it. Silent at both ends: no signal it
   failed to land, no idea there was anything to receive. This is what *parent added* in §5.4 exists
   to close, and it closes it independently of the scheduler.
2. **The reminder that changes behaviour is the one that is lost.** The digest is a planning aid;
   the heads-up is an intervention — what gets a nine-year-old to stop gaming and pack the kit bag.
3. **Intermittent notifications are worse than none.** A child who learns reminders sometimes arrive
   starts checking manually, and the notification budget has been spent for nothing.

**A trap that survives the move, and is still unfixed.** The lead query selects events starting
within the next `REMINDER_LEAD_MINUTES`. Ping less often than that window and an event at 14:45 is
invisible at 14:00 and past at 15:00 — **missed entirely, silently**. The rule *ping interval ≤ lead
window* is honoured by the ten-minute trigger and noted in its config, but nothing enforces it.

The proper fix is to record the last successful run, widen the lookback to cover the elapsed gap,
and phrase the message from the real clock (*"starts in 4 min"*, *"starting now"*). The idempotency
ledger already prevents duplicates, so a missed ping would degrade to a *late* reminder rather than
no reminder. Roughly five lines, and on the roadmap.

### 8.5 Why one-click self-host rather than a hosted service

| Model | Time to first event | Who pays | Who holds the data | Verdict |
|---|---|---|---|---|
| **Developer self-host** (today) | 45 min, terminal required | Nobody — free tiers | The family | The current state. Serves developers only |
| **One-click self-host** (§8.2) | ~5 min, no terminal | Nobody — free tiers | The family | **Recommended.** Same economics, hundredfold wider reach |
| **Hosted multi-tenant service** | ~1 min, an email address | The operator | The operator | Rejected — see below |
| **One technical person hosts for many families** | ~5 min for the operator, zero per family | The operator, marginally | The operator | Worth building toward. Needs a `households` table the schema does not yet have — an extended family, a class or a scout troop is a natural unit |

**Why not simply run it as a service.** Not cost: one Postgres instance with household-scoped rows
would serve thousands of families for roughly the price of a weekly coffee, and Web Push is free.
The objection is custody. Running it centrally makes the operator a data controller for a live feed
of *where several thousand named children will be, and when* — the most scrutinised category of
personal data under GDPR and its equivalents, and an unusually attractive target irrespective of
regulation. The security posture in §5.2 is justified by the data staying inside one household.
Centralising it does not merely add compliance work; it invalidates the reasoning that made the
simple design acceptable.

That is a real trade of reach against risk, and it should be made deliberately rather than drifted
into. The one-click path widens reach without touching the risk.

**One distribution advantage already banked:** because the kid app is a PWA rather than a native
app, there is no store review, no $99/year Apple developer fee, no separate Android and iOS builds,
and no wait for a release to reach a device. Installation is a URL. Whatever else changes, that
should not.

### 8.6 What stays unsolved

**Nobody updates a family's deployment.** A household that installs this in August runs August's code
in perpetuity. The exposure is small — one PIN, per-child bearer tokens, and a dependency tree kept
deliberately thin with no UI kit, icon library or client state library — but a framework CVE would
sit unpatched indefinitely, and there is no honest way to tell a parent to `git pull`.

Two partial answers. Auto-syncing the fork from upstream keeps instances current, at the cost of
shipping unreviewed code into a stranger's family, which is a meaningful thing to do quietly. Or the
setup screen checks the upstream release feed and offers *"an update is available"* with a one-button
redeploy, keeping a human in the loop but relying on someone reading it.

The second is the better default, and it is also the strongest argument for the
host-for-your-community model above: one person who understands updates, covering thirty families
who do not, beats thirty unattended deployments.
