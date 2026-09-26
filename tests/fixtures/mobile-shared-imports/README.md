Fixture repositories for `tests/unit/mobile-shared-imports.test.ts`.

Each directory is a stand-in repository root with a `mobile/` app and the `lib/`
modules it shares. `clean` must pass; every other one must fail with the exact
violation the test names, which is what shows the guard can fail at all.

The `mobile/` files import through `@/lib`, which only resolves against the
fixture root, and from `react-native`, which the website does not install, so
they are excluded from the root typecheck and lint. The `lib/`
files are ordinary TypeScript and are checked like any other.
