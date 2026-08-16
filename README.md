# Family Calendar

**One parent sets the week in ten seconds. Each kid is reminded before every activity, ticks it off
when it's done, and can look ahead at what's coming.**

**Setup, once.** The parent opens the planning page, types the PIN, and copies one link per child.
Each child opens their link, adds it to their home screen, and taps 🔔 — no account, no app store,
no password. ([Details](#2-first-time-setup))

*The app calls that person the **family manager** — whoever holds the PIN. A parent, a grandparent,
a step-parent, a nanny. This document says "family manager" wherever it names the role, and "parent"
only where it means an actual parent.*

## The problem

Family logistics live in a parent's head. The transfer of that knowledge to the children is verbal,
repeated, and lossy: *"You have boxing at three"* — said four Tuesdays in a row, forgotten three of
them. The cost is not the calendar. The cost is the interruption, the nagging, and the child's
inability to plan their own afternoon.

Two distinct users, two irreconcilable needs:

| | Parent | Kid |
|---|---|---|
| Frequency | Bursts — sets a whole term of activities at once | Daily, many times |
| Device | Phone, often standing up | Their own phone |
| Needs | Enter a repeating activity in seconds; see the whole household | What's now, what's next, nothing else |
| Fails when | Entry takes more than ~15s, or recurrence needs a rules dialog | It looks like an adult calendar |

A single interface cannot serve both. Every family calendar app is built for the parent and hopes
the children adapt; every kids' visual schedule app is built for the child and has no way for a
parent to author anything. ([Six products, judged.](docs/project.md#1-competitive-landscape))

So: two apps, one database.

```
  PARENT  /parent           KID  /k/<token>
  ┌────────────────┐        ┌────────────────┐
  │ who · what     │        │ NOW  ▸ progress│
  │ when · ×4      │───────▶│ NEXT ▸ 25 min  │
  │ agenda         │        │ timeline       │
  └────────────────┘        └────────────────┘
        one D1 database · web push reminders
```

---

# 1. Set up the server

Three pieces, all on Cloudflare's free tier: a Worker running the app, a D1 database, and a second
fifteen-line Worker that holds the cron trigger.

## 1.1 Run it locally

No database to install. With no D1 binding present the app uses `node:sqlite`, Node's built-in
SQLite — the same dialect production runs, in-process.

```bash
npm install
cp .env.example .env.local     # PARENT_PIN and SESSION_SECRET are enough to start
npm run db:push                # create the tables
npm run db:seed                # add a first child, prints their link
npm run dev                    # http://localhost:3000/parent
npm test                       # 127 tests against an isolated database
```

## 1.2 Deploy to Cloudflare

**Authorise the toolchain.** `workerd` is Cloudflare's Workers runtime; npm blocks its install
script by default, because install scripts are the classic supply-chain vector. Approve that one
only — `sharp` is pulled in by Next.js for image optimisation this app never uses.

```bash
npm approve-scripts workerd
npx wrangler login
```

**Make your own deployment manifests.** Two files name your Worker, your database and your hostname.
They are gitignored, like `.env.local`, because they describe *your* deployment rather than the
project:

```bash
cp wrangler.example.jsonc wrangler.jsonc
cp workers/reminders/wrangler.example.jsonc workers/reminders/wrangler.jsonc
```

**Create the database.** It prints a `database_id` — paste it into `wrangler.jsonc`, replacing the
placeholder. The binding resolves by id, not by name.

```bash
npx wrangler d1 create family-calendar
npm run d1:push                # apply lib/schema.sql to the remote database
                               # upgrading an existing deployment? see lib/migrations/
```

**Generate credentials**, then put them in two places, because they are needed at two different
times:

```bash
npm run keys                   # VAPID pair, SESSION_SECRET, CRON_SECRET
```

| Where | What goes there | Why |
|---|---|---|
| `.env.local` (gitignored) | **all** of them, including `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `NEXT_PUBLIC_*` variables are inlined into the client bundle **at build time**. A value that exists only as a runtime secret never reaches the browser, and push subscription then fails silently |
| `npx wrangler secret put <NAME>` | `PARENT_PIN`, `SESSION_SECRET`, `CRON_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Runtime values for the Worker. Secrets are write-only: you can overwrite but never read one back |

Keep the two in sync. Anything under `vars` in `wrangler.jsonc` is plaintext on disk — correct for
`NEXT_PUBLIC_FAMILY_TZ`, wrong for a PIN.

**Ship it.**

```bash
npm run deploy                 # next build → repackage as a Worker → upload
```

**Then the scheduler**, a separate Worker so the schedule survives every application deploy. Put
your deployed URL into `workers/reminders/wrangler.jsonc`, then:

```bash
npx wrangler secret put CRON_SECRET --config workers/reminders/wrangler.jsonc
npm run deploy:cron
```

Its five-minute interval must stay at or below the **shortest** entry in `REMINDER_LEAD_MINUTES`
(default `60,5`), or that window can fall entirely between two runs and be missed silently. See
[the scheduler](docs/project.md#84-the-scheduler).

**Check it worked.** This should return `leadClaimed`, `leadSent` and an empty `errors`:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-app>/api/cron/reminders
```

### Optional: your own domain

`workers.dev` is a complete, free, HTTPS home and nothing requires you to leave it. If you want a
nicer address, the app serves from the root of whatever host it is bound to — there is no code
change and no environment variable, only DNS. Both shapes work identically:

```
calendar.example.com/parent      calendar.example.com/k/<token>     ← subdomain
example.com/parent               example.com/k/<token>              ← apex
```

Put the zone on Cloudflare, uncomment `routes` in `wrangler.jsonc` with your hostname, redeploy, and
**update `APP_URL` in `workers/reminders/wrangler.jsonc` to match** — the scheduler calls the app by
absolute URL, so leaving it pointing at the old address silently stops every reminder.

One caution if you pick a subdomain of a domain you already use. Browsers treat everything under one
registrable domain as the same site, so this app would sit inside the same cookie and same-site
boundary as whatever else lives there. The session cookie carries the `__Host-` prefix specifically
so it cannot be shadowed from a sibling, but the coupling is real and cannot be configured away — see
[access](docs/project.md#52-access-libauthts). A domain dedicated to the family avoids it entirely.

---

# 2. First-time setup

## 2.1 The parent's app

1. Open `https://<your-app>/parent` and enter the PIN. The session lasts 30 days per device.
   **Both parents can use it.** The PIN is one shared secret, not a per-person login, so each of
   you enters it on your own phone and gets your own session — and can install the app from
   **⋮ → Install app** like the children do.
2. Open the **☰** menu, add each child — a name, an animal, a colour — then tap their name to open
   their profile.
3. Press **Share link** on that profile. On a phone this opens the normal share sheet, so WhatsApp
   is one tap away. That link is the child's whole login.

Change the PIN from **☰ → Change PIN**. Doing so **signs out every device that is signed in**,
which is what makes it useful if the PIN has been seen by someone who shouldn't have it — a session
cookie owes nothing to the PIN, so without that a changed PIN would revoke nothing.

`PARENT_PIN` is only the initial value. Once a PIN has been set from the app it takes over, and the
environment variable is ignored.

## 2.2 Each child's phone

1. Open their link. **On iPhone this must be Safari** — a link tapped in a chat opens in that
   app's own browser, which has no *Add to Home Screen* at all, so choose **Open in Safari** from
   its menu first.
2. **Install it.** On Android, **⋮ → Install app** (older versions say *Add to Home screen*). On
   iPhone and iPad, the **Share** button — the square with an arrow — then scroll down to **Add to
   Home Screen**. Its position moves: bottom on a default iPhone, top on an iPad or with the
   address bar set to the top, which is why the app names the icon rather than a place. It installs
   under the child's own name and opens straight into their day.
3. Tap 🔔 once and allow notifications.

Step 2 is not optional on iOS: Web Push exists there only for home-screen installs, so the bell
hides itself in a plain Safari tab. See [platform support](#platform-support).

## 2.3 Testing it

**Test the child's app on a real phone and the parent's app in a desktop browser.** The child half is
the part that cannot be verified anywhere else — home-screen install, Web Push on real hardware,
swipe, haptics. The parent half is a form and a list; it behaves identically on a laptop and is far
easier to type into.

Installing both on the same phone works and corrupts nothing, but one thing gets in the way: both
apps carry the same icon, so the tiles are told apart only by their labels.

Reminders for two children on one device do now work: each child's app registers its own service
worker, and a push subscription belongs to a worker, so the two no longer overwrite each other.

To confirm push works at all, one child on one phone is enough — and it is the single thing worth
testing before handing the links out.

A short protocol for what only a person can check — notifications, home-screen install, the share
sheet — is in [the project doc](docs/project.md#61-what-only-a-person-can-test).

---

# 3. Everyday use

## 3.1 Parent

**Adding an activity** — one screen, no dialogs. Pick **who it's for — one person or several**,
type what it is, set the time, choose **Once** or **Every week**. The icon is inferred from the words, so you never open a picker;
the button states what it will do (*"Add every week"*). The end time auto-fills an hour after the
start.

A weekly activity has no end date and needs no renewing: it is written out a year ahead and the
server quietly extends it every night, so there is never a week thirteen where it silently stops.

The school run is *one* activity with a child and the adult driving on it — not two entries that
happen to coincide. It shows as a single line naming everyone, and reaches each of them the way
they receive things.

**The family** — ☰ opens **Manage family**, with three ways to add someone:

| | Gets | Reminders |
|---|---|---|
| **Child** | The web app on their phone | Push, an hour and five minutes before |
| **Adult · taking part** | A calendar to subscribe to, holding the activities they're on | None — their calendar app is the reminder |
| **Adult · watching** | A calendar holding everything the family has on | None |

An adult *watching* is never offered when you add an activity — they receive all of it anyway.

**Looking ahead** — the agenda covers a full year, five weeks at a time. **Show more** reaches
further out; it is instant, because the whole year is already loaded.

**Changing your mind** — the agenda below groups by day and filters per person. Tap ✕ on a row and
the choice appears in place: **Delete** for a one-off, **This event** or **All events** for part of
a weekly run. Tapping anywhere else, or pressing Escape, closes it without deleting. "All events"
only clears what is still to come — what already happened stays on the calendar. An activity shared
by several people is removed for all of them, because it is one activity.

**Sharing an adult's calendar** — their profile has the same **Share link** button as a child's.
It opens a page that asks for the family PIN, then offers four cards — Apple, Google, Outlook, any
other — each with the shortest route that app actually supports: one tap for Apple, copy-the-address
plus three steps for the rest.
Google's own "add by URL" deep link fails on external calendars, and Outlook for Mac cannot subscribe
at all — its "Import ICS" takes a one-off snapshot that never updates — so both are done once in
their web app.

Their profile then shows whether a calendar has ever fetched it. Until one has, nothing is reaching
them, and it says so.

**When a new device appears** — the dashboard says so: *"A new device opened Beatrix's link · 10
minutes ago."* Usually a new phone, a reinstall or a private window, so it offers **That was us** to
confirm it, and **Replace this link** for when it was not — which does mean sending the child a new
link. The first device never warns; it is the one you just handed the link to.

**Who has opened a link** — a profile shows how many browsers have opened it and when it was last
used, with **Start counting again** to zero the number. It answers whether anybody else has the
link, which rotation alone cannot tell you. It **revokes nothing** — only *Replace this link* stops
a link working.

**If a link goes astray** — a profile has **Replace this link**. The old one stops working
at once and everything behind it survives: their activities, what they have ticked off, their
colour, their registered devices. They will need to add the new link to their home screen and tap 🔔
again, because the old icon points at an address that no longer exists.

**Seeing whether it landed** — anything the child has ticked off shows `DONE` in your agenda.

## 3.2 Child

**Opening the app** shows today: a **HAPPENING NOW** card with a progress bar, or **NEXT UP** with a
live countdown, then the rest of the day as a timeline. Past items dim. Free days say *"Nothing
planned — enjoy your free day."*

**Ticking things off** — tap any row, or the large button on the hero card. It strikes through, and
the footer counts down (*"2 to go"* → *"All done for the day 🎉"*). The parent sees it.

**Other days** — swipe left or right, or tap a day pill. A dot marks days that have something. Four
weeks ahead are available.

**Making it theirs** — tapping the avatar opens any emoji their keyboard offers, plus six colours.
Picking one repaints the whole app.

**Adding their own** — a **+ Add your own** button takes one topic and one half-hour slot, and
assumes an hour. It lands in the day in order, rendered lighter than what a parent set, and only
they can remove it. It stays on their screen: the parent's agenda and the adults' calendars never
show it.

**Reminders** arrive three ways:

| | |
|---|---|
| **An hour before** | *"🥊 Boxing — Starts in 58 min · 15:00 · Sports club"* — time to finish up and pack |
| **Five minutes before** | The same activity again, as a last call |
| **Morning digest, 07:00** | One notification listing the whole day: *"Good morning Beatrix — 08:00 School · 15:00 Boxing · 17:00 Piano"*, or *"Nothing planned today 🎉"* |

The two lead reminders are checked every five minutes, so each arrives within a few minutes of its
mark. **Adding an activity that is already inside the hour window sends its reminder straight away**,
rather than waiting for the next check — otherwise something added three minutes before it starts
could be missed entirely. Anything further out is silent until that morning's digest.

---

## 3.3 Offline

Losing signal does not lose the calendar. A child's app keeps the month it last loaded, so the
schedule is there on the bus, in a basement, or on a school trip — including when they arrive by
tapping a reminder, which opens the day that reminder is about.

It never pretends to be live:

- **It says so** — *"You are offline. This is how your day looked two hours ago. It may have changed
  since."*
- **It withdraws what needs a server** — adding, removing and ticking off disappear rather than
  being offered and then failing.

Reading only. Nothing is queued to send later. When signal returns the app catches up on its own
within about half a minute.

Two conditions: the app must have been opened online at least once, and on iPhone it must be
installed to the home screen.

---

## Platform support

| | Android | iOS | Desktop |
|---|---|---|---|
| Schedule, swipe, check-off | ✅ Chrome | ✅ Safari | ✅ any browser |
| Install to home screen | ✅ ⋮ → Install app | ✅ Safari only: Share → Add to Home Screen | — |
| Push notifications | ✅ | ✅ **iOS 16.4+, home-screen install required** | ✅ |
| Works offline once opened | ✅ | ✅ home-screen install | ✅ |
| Haptic feedback on check-off | ✅ | ❌ not supported by iOS | — |
| 24-hour time pickers | follows device locale | follows device locale | ✅ |

Notifications require HTTPS on both platforms — a deployment satisfies this, a LAN IP will not.

## Known limitations

- **Edit covers who, what, when and where.** Tapping a row opens it; a repeat offers *this week* or
  *every week*, for the people on it as much as the time. Somebody added to one week of a repeat is
  on that week only, and can be promoted to every week later.
- **A repeat keeps its weekday.** *Every week* changes the times, the title and the place, never the
  day. Moving swimming from Tuesdays to Thursdays means deleting the repeat and adding it again —
  the panel withdraws the choice and says so rather than ignoring the date you typed. A week you
  corrected on its own is left alone by *every week*, and keeps what you gave it.
- **One timezone for the whole family.** Correct for a household, wrong for a child at boarding
  school abroad.
- **Weekly recurrence only, one weekday at a time.** "Tuesdays and Thursdays" is two entries. There
  is no "every second week" and no end date.
- **An adult's calendar is a subscription, not an invite.** So it sends no notification, does not
  make them look busy to anyone scheduling a meeting, and refreshes on their calendar's schedule —
  roughly hourly on Apple, about three hours on Outlook, and **12–24 hours on Google, which offers
  no setting to change it**. Fine for the person entering activities; weak for informing someone of
  a change today.
- **An adult who is not a parent has to be given the family PIN** to open their subscribe page,
  which also unlocks the admin app. Fine for two parents; wrong for a nanny.
- **The kid's link is a bearer token.** Anyone holding it sees that child's schedule, and can add
  entries to it — which appear on the child's screen and nowhere else, so nobody but the child would
  see something they did not add. The dashboard warns when a new device opens a link,
  which is the only signal that one is in unexpected hands; replacing it is the remedy.
- **An installed app still gives up its own address.** In the Android app, Chrome's menu offers the
  URL to copy and to share, so the credential is one tap away for whoever is holding the phone,
  including the child. This is browser UI and cannot be suppressed from our side. It matters where a
  phone is passed round or a link is forwarded for convenience; the remedy is again to replace it.
- **"Your own" is a display convention, not a guarantee.** A child's entries are hidden from the
  parent's screens by a query filter. They sit in the same database, and an export would include
  them. The child's interface is worded accordingly. Proportionate
  to the data; not appropriate if the model were ever extended to anything sensitive.
- **A missed scheduler run is a missed reminder.** The lead windows are not yet self-healing, so the
  cron interval must stay at or below the shortest lead. Nothing enforces it.
- **Cancelling does not notify.** If a reminder has already gone out and the activity is then
  removed, the child is holding an instruction that is no longer true.
- **The agenda lists every occurrence.** A weekly activity produces one row per week — five within
  the 35-day view. Series-level collapsing is unbuilt, so a household with several weekly
  commitments scrolls.
- **On Android with Family Link, the kid's app depends on Chrome.** A home-screen web app is a
  WebAPK: it appears as its own app in Family Link, but it renders through Chrome, so a Chrome time
  limit takes the calendar down too and marking the calendar "always allowed" does not override it.
  The fix is to restrict Chrome by *place* rather than by *time* — set it to only allow approved
  sites, approve this domain, and remove the Chrome time limit, which is stricter than a time limit
  rather than looser. Alternatives and their costs are in
  [the project doc](docs/project.md#511-android-family-link-and-the-chrome-dependency).
- **Reminders require the app to be installed, and on iPhone there is no way around it.** Web push
  does not exist in a Safari tab, so a child browsing to their link can never be reminded. The app
  says so and offers the install route, but it cannot do it for them.
- **Parents receive no notifications.** Subscriptions are keyed to a child, so a parent is never
  told that an activity was ticked off or missed.
- **Rate limiting is per address.** Two parents on the same home network share it, so eight failed
  PIN attempts between them locks both out for fifteen minutes.

## Roadmap

- [ ] [One-click install](docs/project.md#8-reaching-households-without-a-developer) — self-provisioning
      first run, so no terminal and no environment variables
- [ ] [Move a repeat to another weekday](docs/project.md#516-correcting-an-activity) without
      deleting and re-adding it
- [ ] Voice entry: *"Beatrix boxing 3 to 4 the next four Tuesdays"* → parsed event
- [ ] [Collapse a weekly run into one agenda row](docs/project.md#58-deferred-collapsing-a-weekly-run-into-one-agenda-row) that expands on tap
- [ ] Notify a parent — an activity ticked off, or one that passed untouched. Needs a second
      subscriber type, since push subscriptions are currently keyed to a child
- [ ] Let a kid signal "I'm running late" back to the parent
- [ ] A native Android wrapper (Capacitor over System WebView) to sever the Chrome dependency —
      note this needs a second, native push path, since System WebView has no Web Push API
- [ ] Sanity-check implausible times when adding — an AM/PM slip on the end time silently creates a
      13-hour event, because an end at or before the start is read as running past midnight
- [ ] Import the school calendar via ICS

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind v4 · Cloudflare Workers · D1 · Web Push. No UI kit, no
icon library, no client state library, and no push library — RFC 8291 encryption and RFC 8292 VAPID
are implemented directly on WebCrypto and verified against the specs' own test vectors. ~115 kB
first load.

## Documentation

[`docs/project.md`](docs/project.md) — how the six comparable products were judged, the architecture,
every design decision with the reasoning behind it, and how this could reach households that need it
but cannot deploy a server.

## Using it, and what to expect of me

Apache 2.0 — see [`LICENSE`](LICENSE). Fork it, deploy it, change it.

This is a working family's calendar, published because it may be useful to other families. There is
no support commitment and nothing on the roadmap is a promise. Issues and pull requests are welcome
and will be read; they may be read slowly. Security reports go through
[`SECURITY.md`](SECURITY.md) rather than the issue tracker.
