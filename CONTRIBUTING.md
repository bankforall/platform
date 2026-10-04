# Contributing to Bank For All

ขอบคุณที่สนใจร่วมพัฒนา! Thank you for contributing! Issues and pull requests in Thai or English are welcome.

## Before you start

- Read [`docs/v2/README.md`](docs/v2/README.md), especially the [rules spec](docs/v2/rules-spec.md) —
  the circle rules are implemented twice (`packages/shared/src/circle-math.ts` and `packages/contracts/src/Circle.sol`)
  and must stay identical.
- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security issues: see [SECURITY.md](SECURITY.md) — never in public issues.

## Development setup

See the [README](README.md#พัฒนาในเครื่อง): Node 24 LTS, pnpm 12, Docker and Foundry; one command brings up
Postgres, Redis, S3 and a local chain.

## Pull request checklist

- [ ] `pnpm -r typecheck` and the tests of the packages you touched pass
      (`forge test`, `pnpm --filter <pkg> test`; API/browser end-to-end tests for flow changes)
- [ ] Changing circle rules? Update **both** implementations and add a case to
      `packages/shared/test-vectors/circle-math.json`
- [ ] Changing contracts? Run `forge fmt` and `pnpm --filter @bankforall/contracts build` (regenerates ABIs)
- [ ] Changing the database? Add a Prisma migration (`prisma migrate dev --name <change>`)
- [ ] No personal data on-chain; amounts stay in satang (bigint)
- [ ] User-facing text in Thai; no crypto jargon in the UI

## Commit style

Short imperative subject (`api: verify slip hash before relaying`), body explaining *why*.
By contributing you agree that your contributions are licensed under the [AGPL-3.0](LICENSE).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
