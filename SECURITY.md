# Security Policy

Bank For All coordinates real people's money. Please help us keep it safe.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
[**Security → Report a vulnerability**](https://github.com/bankforall/platform/security/advisories/new).

Please include what an attacker can do, the affected component (contracts, API, web, infrastructure),
steps to reproduce, and any proof of concept. Reports in Thai or English are welcome.

We aim to acknowledge reports within **3 business days** and to agree on a fix and disclosure timeline
with you. Please give us reasonable time to fix the issue before disclosing it publicly.

## Scope

| In scope | Out of scope |
| --- | --- |
| Smart contracts in `packages/contracts` (once deployed, the deployed addresses) | Third-party services (LINE, SMS providers, Base, RPC providers) |
| API, worker and web app in this repository | Findings that require a compromised user device or stolen recovery code |
| Deployment configuration in `deploy/` | Denial of service by volume, spam, social engineering |
| | Missing best-practice headers without a demonstrated impact |

Never test against other users' data or real circles. Use a local stack
(`docker-compose.dev.yml` + `scripts/dev-deploy.sh`) — it contains everything needed, including a local chain.

## Security model (short)

- The platform never holds money; contracts record obligations and evidence only (no `payable` functions).
- Users sign every action with a key generated on their own device; the server only relays.
- The backend's attester key signs KYC statements; its compromise allows fake members but not moving money.
- See `docs/v2/architecture.md` (Security) and `docs/v2/deployment.md` (keys, incident response).

## Supported versions

Only the latest release on `main` receives security fixes.
