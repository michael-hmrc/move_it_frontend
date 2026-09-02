# Move It

Move It converts exercise activities into an illustrative step equivalent and
shows a monthly scoreboard. It uses server-rendered, progressively enhanced
forms based on GOV.UK Design System conventions without GOV.UK branding.

The service header uses the official black Opencast logo on an Opencast lime
background with a purple accent. The logo asset is stored locally so rendering
does not depend on a third-party image request.

The conversion journey asks one question per page: display name, activity,
intensity and duration. Answers are retained for 30 minutes in a signed,
HTTP-only cookie so the journey works across stateless Vercel functions and Back
links retain previous answers.

An official GOV.UK Frontend Service navigation component provides access to the
conversion journey, monthly scoreboard and an explanation of how the estimates
work. The conversion itself remains a linear one-question-per-page journey.

The root URL is a landing page with the main service actions. Both the Opencast
logo and the centred Move It service name link back to this page. The conversion
starts at `/convert`.

The `/conversions` reference page uses the same activity-rate source as the
calculator and compares the estimated steps for 60 minutes at each intensity.

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

Open <http://localhost:3000>. The service works without Supabase credentials,
but conversions are not retained and the scoreboard remains empty.

Useful checks:

```sh
npm run build
npm test
npm run typecheck
```

## Configure Supabase

1. Create a Supabase project.
2. Run the SQL in
   `supabase/migrations/20260828000000_create_conversion_records.sql` using the
   Supabase SQL editor, or apply it with the Supabase CLI.
3. Copy `.env.example` to `.env` and add the project URL and server-only secret
   key.

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-server-only-secret-key
SESSION_SECRET=a-long-random-value
```

Generate a session secret with `openssl rand -base64 32`. Vercel must have this
variable in production; the application only uses a fixed development fallback
outside production.

Never expose `SUPABASE_SECRET_KEY` in client-side code or give it a
`NEXT_PUBLIC_` prefix. The table has Row Level Security enabled with no public
policies. Express performs controlled writes and calls the monthly aggregation
function from the server.

The scoreboard groups records by display name for the current UTC calendar
month, ranks total estimated steps, and shows the number of activities. Display
names are public, but submissions are associated with a verified Supabase Auth
user ID. Only email addresses at `AUTH_ALLOWED_EMAIL_DOMAIN` can sign in.

## Configure invite-only accounts

Move It uses administrator-approved Supabase Auth accounts. Add the following values:

```dotenv
AUTH_ALLOWED_EMAIL_DOMAIN=opencastsoftware.com
ADMIN_ACCESS_TOKEN=a-separate-long-random-value
```

Set `ADMIN_ACCESS_TOKEN` to a separate long random value. Users request access
at `/request-access` and choose their own password. An administrator visits
`/admin/login` and approves verified requests. Only approved accounts can use
the activity journey. Do not enable public Supabase sign-up for this application.

## Deploy to Vercel

1. Import this repository into Vercel.
2. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as Vercel environment variables.
3. Deploy. Vercel detects the exported Express application in `src/index.ts`.

Use separate Supabase projects for preview and production environments once the
service stores real user data.

## Conversion rates

The initial rates in `src/domain/activities.ts` are illustrative product values,
not medical guidance. Replace them with agreed, cited conversion rules before
launch. The calculation is isolated in `src/domain/conversion.ts` and covered by
unit tests so it can be changed safely.
