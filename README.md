# Track Tuner

Track Tuner is a mobile-first setup logger for motorcycle and car track sessions. The app lets authenticated users manage vehicles and tracks, log modular session data, compare previous sessions, use small trackside tools, and experiment with a grounded RAG-based tuning assistant.

## Stack
- Next.js 15 App Router
- React 19
- TypeScript with `strict` mode
- Tailwind CSS 4
- Supabase Auth + Postgres
- Stripe subscriptions
- OpenAI-backed RAG spike
- Vitest + Playwright

## Quickstart
1. Install dependencies:

```bash
npm install
```

2. Copy the example env file and fill in the required values:

```bash
cp .env.example .env.local
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://127.0.0.1:3000`.

## Core Commands
```bash
npm run dev
npm run lint
npm run test:unit
npm run test:unit:coverage
npm run test:e2e
npm run build
npm run analyze
npm run rag:index
npm run rag:eval
```

## Environment
Required for the base app:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Required for billing flows:
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `NEXT_PUBLIC_APP_URL`

Optional public auth flags:
- `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED`
- `NEXT_PUBLIC_AUTH_APPLE_ENABLED`

Optional billing copy:
- `NEXT_PUBLIC_STRIPE_FOUNDER_PROMO_CODE`

Required for the RAG spike:
- `OPENAI_API_KEY`

Optional RAG tuning:
- `OPENAI_CHAT_MODEL`
- `OPENAI_EMBED_MODEL`
- `RAG_RATE_LIMIT_MAX_REQUESTS`
- `RAG_RATE_LIMIT_WINDOW_MS`
- `RAG_EVAL_BASE_URL`
- `RAG_EVAL_AUTH_COOKIE`

## Product Limits
Current enforced free-tier limits:
- 1 vehicle
- 3 custom tracks
- 10 sessions

These values are defined in [lib/plans.ts](/Users/codypjohnson/Desktop/trackday_tuner/lib/plans.ts) and are shared by server actions and UI copy.

## Testing
See [TESTING.md](/Users/codypjohnson/Desktop/trackday_tuner/TESTING.md) for:
- Playwright device coverage
- Supabase auth setup
- Stripe local webhook setup
- RAG indexing and eval workflow

## Repository Notes
- [docs/product/track-tuner-prd-v1.md](/Users/codypjohnson/Desktop/trackday_tuner/docs/product/track-tuner-prd-v1.md) contains the archived product requirements document.
- [docs/knowledge-base](/Users/codypjohnson/Desktop/trackday_tuner/docs/knowledge-base) and [data/session-logs](/Users/codypjohnson/Desktop/trackday_tuner/data/session-logs) feed the local RAG index.
- [.github/workflows/ci.yml](/Users/codypjohnson/Desktop/trackday_tuner/.github/workflows/ci.yml) runs lint, unit tests, and a production build on pushes and pull requests.
