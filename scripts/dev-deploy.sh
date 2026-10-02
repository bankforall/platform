#!/usr/bin/env bash
# Deploys the contracts to the local anvil chain (docker-compose.dev.yml) and writes apps/api/.env.
# Uses anvil's well-known PUBLIC test keys — never use them on a real network.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=${RPC_URL:-http://127.0.0.1:58545}
DEPLOYER=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil #0 (admin)
RELAYER=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d    # anvil #1
KEEPER=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a     # anvil #2
ATTESTER=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6   # anvil #3

(cd packages/contracts && ADMIN=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 ATTESTER=0x90F79bf6EB2c4f870365E785982E1f101E93b906 \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER" --broadcast >/dev/null)
DEPLOYMENT=packages/contracts/deployments/31337.json
FACTORY=$(node -p "require('./$DEPLOYMENT').factory")
FORWARDER=$(node -p "require('./$DEPLOYMENT').forwarder")
BLOCK=$(node -p "require('./$DEPLOYMENT').blockNumber")

cat > apps/api/.env <<ENV
NODE_ENV=development
PORT=4000
PUBLIC_URL=http://localhost:5173
DATABASE_URL=postgresql://bankforall:bankforall@127.0.0.1:54329/bankforall
REDIS_URL=redis://127.0.0.1:56379
SESSION_SECRET=dev-session-secret-change-me-0123456789abcdef
APP_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
HMAC_KEY=dev-hmac-key-change-me-0123456789abcdef0123
DEV_LOGIN=true
SMS_PROVIDER=console
S3_ENDPOINT=http://127.0.0.1:59000
S3_BUCKET=bankforall
S3_ACCESS_KEY=bankforall
S3_SECRET_KEY=bankforall-secret
S3_FORCE_PATH_STYLE=true
CHAIN_ID=31337
RPC_URL=$RPC
FACTORY_ADDRESS=$FACTORY
FORWARDER_ADDRESS=$FORWARDER
DEPLOY_BLOCK=$BLOCK
CONFIRMATIONS=0
RELAYER_PRIVATE_KEY=$RELAYER
KEEPER_PRIVATE_KEY=$KEEPER
ATTESTER_PRIVATE_KEY=$ATTESTER
WORKER_INTERVAL_MS=2000
ENV
echo "deployed factory=$FACTORY forwarder=$FORWARDER (block $BLOCK); wrote apps/api/.env"
