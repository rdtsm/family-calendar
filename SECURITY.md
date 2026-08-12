# Security

## Reporting a vulnerability

Use GitHub's **[private vulnerability reporting](https://github.com/rdtsm/family-calendar/security/advisories/new)**
— the *Security* tab, *Report a vulnerability*. It opens a channel visible only to you and the
maintainer. Please do not open a public issue for anything exploitable.

There is no service to attack: every installation is somebody's own Cloudflare account, running from
their own deployment. A report here reaches whoever can fix the code, not an operator who can revoke
anything.

Expect a slow reply. This is a family's own app, published because it might be useful to other
families, and it is maintained in evenings.

## What is already known

These are design positions, documented rather than overlooked. They are not vulnerabilities, and a
report describing one will be closed with a pointer here.

- **A child's link is a bearer token.** Anyone holding the URL sees that child's schedule and can add
  entries to it. Tokens are 128 bits of randomness, never guessed — but they travel in a URL, so they
  can be forwarded, shoulder-read, or copied out of the installed app's own browser menu, which is
  platform UI we cannot suppress. The remedy is to replace the link, which also revokes that child's
  push subscriptions and device records.
- **One PIN guards the planning app**, not per-person accounts. Six digits, eight attempts per
  address per fifteen minutes, then a lockout. Two adults on one home network share that budget.
- **A child's own entries are hidden from the parent by a query filter**, not by encryption or a
  separate store. They are in the same database and an export would include them. Proportionate to
  what the data is; not a boundary to build anything sensitive on.
- **No audit log.** Nothing records who changed what.

[`docs/project.md`](docs/project.md) sets out the reasoning behind each, and the README's known
limitations list the operational consequences.

## What is worth reporting

Anything that breaks an assumption above rather than restating it: a way to derive one child's token
from another's, to reach the planning app without the PIN, to read a household's data from outside
it, to bypass the rate limiter, or to have the reminder endpoint send on someone else's behalf.
