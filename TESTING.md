# Testing

## Stack
- Unit tests: Vitest
- E2E tests: Playwright (cross-device profiles)

## Support Matrix
- Primary (merge-blocking): iPhone Safari, Android Chrome
- Secondary (release candidate): iPad Safari, Desktop Chrome/Safari/Edge

## Environment
Create `.env.test` (or export vars in your shell):

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000
E2E_EMAIL=your_test_user_email
E2E_PASSWORD=your_test_user_password
PW_SKIP_WEBSERVER=0
NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true
NEXT_PUBLIC_AUTH_APPLE_ENABLED=false
```

`E2E_EMAIL` and `E2E_PASSWORD` are required only for authenticated smoke tests.
Unauthenticated guard tests run without them.
Set `PW_SKIP_WEBSERVER=1` if you already have the app running and want Playwright to reuse it.

## Install browser runtime
```bash
npx playwright install
```

## Run tests
```bash
npm run test:unit
npm run test:e2e
```

By default, `npm run test:e2e` skips in CI unless explicitly enabled.
- Force E2E in CI: `RUN_E2E=1 npm run test:e2e`
- Skip E2E anywhere: `SKIP_E2E=1 npm run test:e2e`

Watch mode for units:
```bash
npm run test:unit:watch
```

Interactive Playwright UI:
```bash
npm run test:e2e:ui
```

Run a specific device profile:
```bash
npx playwright test --project=iphone-safari
npx playwright test --project=android-chrome
npx playwright test --project=ipad-safari
```

## OAuth setup checklist (Supabase)
- Enable Google and Apple providers in `Supabase Dashboard -> Auth -> Providers`.
- Configure each provider's client credentials in Supabase.
- Add redirect URLs:
  - `http://127.0.0.1:3000/auth/callback`
  - `http://localhost:3000/auth/callback`
  - `https://<your-vercel-domain>/auth/callback`
- Set `Site URL` per environment so Supabase redirects correctly.

## Cross-Device Release Checklist
- Touch targets for primary actions are `>= 44px`.
- No horizontal overflow at: `360x800`, `390x844`, `768x1024`, `1366x768`.
- Bottom nav and sticky actions remain visible and tappable on phones.
- Form input modes are correct (email/numeric/time/date where applicable).
- Inline validation messages are visible without layout breakage.
- Primary matrix smoke tests pass:
  - `npx playwright test --project=iphone-safari`
  - `npx playwright test --project=android-chrome`
- Secondary matrix smoke sweep passes before release candidate:
  - `npx playwright test --project=ipad-safari`
  - `npx playwright test --project=desktop-chrome`
  - `npx playwright test --project=desktop-safari`
  - `npx playwright test --project=desktop-edge`
- Manual real-device quick pass (5-10 min):
  - iPhone Safari
  - Android Chrome
