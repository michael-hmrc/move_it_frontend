# Move It

Move It is an invite-only monthly activity challenge. It converts exercise
activities into illustrative step equivalents and ranks both individuals and
teams on monthly scoreboards. It uses server-rendered, progressively enhanced
forms based on GOV.UK Design System conventions without GOV.UK branding.

The service header uses the official black Opencast logo on an Opencast lime
background with a purple accent. The logo asset is stored locally so rendering
does not depend on a third-party image request.

Approved users submit an activity through a one-question-per-page journey:
activity, intensity and duration, followed by a check-answers page. Journey
answers and the signed-in user are retained for 30 minutes in a signed,
HTTP-only cookie so the journey works across stateless Vercel functions and Back
links retain previous answers.

An official GOV.UK Frontend Service navigation component provides access to the
submission journey, conversion guide, monthly scoreboards and teams. An account
area lets users review their submitted activities and change their password.

The root URL is a landing page with the main service actions. Both the Opencast
logo and the centred Move It service name link back to this page. The conversion
starts at `/submit`.

The `/conversions` reference page uses the same activity-rate source as the
calculator and compares the estimated steps for 60 minutes at each intensity.

## Features

- Administrator-approved accounts restricted to a configured email domain
- Activity submission with standard activities and a free-text "Other" option
- Individual and team scoreboards for the current UTC calendar month
- Participant profiles with total exercise time, total estimated steps, most
  frequent activity, team membership and submitted activity history
- Teams of up to five members, with invitations, direct joining, leaving and
  disbanding
- Administrator tools to approve, deactivate, reactivate and delete accounts

## Technology

- Node.js 22 and TypeScript
- Express 5 and Nunjucks
- GOV.UK Frontend 6 and Sass
- Supabase Postgres for persistence
- Vercel for hosting
- Vitest and Supertest for tests

## Run locally

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

Open <http://localhost:3000>. The service starts without Supabase credentials,
but only public pages such as the home page, conversion guide and health check
are usable. Accounts, activity submissions, scoreboards and teams require a
configured Supabase project.

Useful checks:

```sh
npm run build
npm test
npm run typecheck
```

## Configure Supabase

1. Create a Supabase project.
2. Apply every SQL migration in `supabase/migrations` in filename order using
   the Supabase SQL editor or Supabase CLI.
3. Copy `.env.example` to `.env` and replace its example values.

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-server-only-secret-key
AUTH_ALLOWED_EMAIL_DOMAIN=opencastsoftware.com
ADMIN_ACCESS_TOKEN=a-separate-long-random-value
SESSION_SECRET=a-long-random-value
```

Generate separate values for `SESSION_SECRET` and `ADMIN_ACCESS_TOKEN` with
`openssl rand -base64 32`. Both variables are required in production. The
application only provides a fixed session-secret fallback outside production.

Never expose `SUPABASE_SECRET_KEY` in client-side code or give it a
`NEXT_PUBLIC_` prefix. The application tables have Row Level Security enabled
with no public policies. Express performs controlled writes and calls database
functions from the server.

The individual scoreboard groups records by user for the current UTC calendar
month, ranks total estimated steps, and shows the number of activities. The team
scoreboard combines the current members' activity, step and duration totals.
Display names and activity histories are visible to signed-in users, while
submissions are associated with a Supabase Auth user ID. Only email addresses at
`AUTH_ALLOWED_EMAIL_DOMAIN` can request access or sign in.

Approved users can create a team, invite other approved users by their unique
display name, browse existing teams and directly join a team with space. A user
can belong to one team. Each team can have up to five members, and pending
invitations reserve the remaining spaces when members invite people. Any member
can leave or disband their current team; a team is removed automatically when
its last member leaves.

## Configure invite-only accounts

Move It uses administrator-approved Supabase Auth accounts. Configure:

```dotenv
AUTH_ALLOWED_EMAIL_DOMAIN=opencastsoftware.com
ADMIN_ACCESS_TOKEN=a-separate-long-random-value
```

Set `ADMIN_ACCESS_TOKEN` to a separate long random value. Users request access
at `/request-access` and choose their own password. An administrator visits
`/admin/login` and approves pending requests. Only approved accounts can use the
activity journey, scoreboards, profiles and teams. Administrators can also
deactivate, reactivate and delete accounts. Do not enable public Supabase sign-up
for this application.

## Deploy to Vercel

1. Import this repository into Vercel.
2. Add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SESSION_SECRET`,
   `ADMIN_ACCESS_TOKEN` and `AUTH_ALLOWED_EMAIL_DOMAIN` as Vercel environment
   variables.
3. Deploy. Vercel detects the exported Express application in `src/index.ts`.

Use separate Supabase projects for preview and production environments once the
service stores real user data.

## Conversion rates

The initial rates in `src/domain/activities.ts` are illustrative product values,
not medical guidance. Replace them with agreed, cited conversion rules before
launch. The calculation is isolated in `src/domain/conversion.ts` and covered by
unit tests so it can be changed safely.
