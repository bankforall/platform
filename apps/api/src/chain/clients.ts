import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Redis } from "ioredis";
import type { Config } from "../config.js";

export interface Chain {
  publicClient: PublicClient;
  chainId: number;
  factory: Address;
  forwarder: Address;
  /** Only the accounts this process is configured with (see config.ts roles). */
  relayer?: Account;
  keeper?: Account;
  attester?: Account;
  sender: TxSender;
}

const account = (key?: string) => (key ? privateKeyToAccount(key as Hex) : undefined);

/** Narrows an optional account; a missing one is a deployment/config bug. */
export function need<T>(value: T | undefined, what: string): T {
  if (!value) throw new Error(`${what} is not configured for this process`);
  return value;
}

/** Current chain time (latest block timestamp). Deadlines checked on-chain must use this, not Date.now(). */
export async function chainNow(chain: Chain): Promise<number> {
  const block = await chain.publicClient.getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

export function createChain(config: Config, redis: Redis): Chain {
  const chain = defineChain({
    id: config.CHAIN_ID,
    name: `chain-${config.CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.RPC_URL] } },
  });
  const transport = http(config.RPC_URL, { retryCount: 3, timeout: 20_000 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  return {
    publicClient,
    chainId: config.CHAIN_ID,
    factory: config.FACTORY_ADDRESS as Address,
    forwarder: config.FORWARDER_ADDRESS as Address,
    relayer: account(config.RELAYER_PRIVATE_KEY),
    keeper: account(config.KEEPER_PRIVATE_KEY),
    attester: account(config.ATTESTER_PRIVATE_KEY),
    sender: new TxSender(publicClient, chain, transport, redis),
  };
}

/**
 * Sends transactions from server accounts. A Redis lock per account serialises nonce
 * allocation across API replicas and the worker, so concurrent sends never collide.
 */
export class TxSender {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly chain: ReturnType<typeof defineChain>,
    private readonly transport: ReturnType<typeof http>,
    private readonly redis: Redis,
  ) {}

  async send(account: Account, tx: { to: Address; data: Hex; gas?: bigint }): Promise<Hex> {
    const wallet = createWalletClient({ account, chain: this.chain, transport: this.transport });
    const lockKey = `lock:tx:${account.address.toLowerCase()}`;
    const token = `${process.pid}-${Math.random()}`;
    const started = Date.now();
    while (!(await this.redis.set(lockKey, token, "PX", 30_000, "NX"))) {
      if (Date.now() - started > 30_000) throw new Error(`timed out waiting for tx lock of ${account.address}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    try {
      const nonce = await this.publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
      return await wallet.sendTransaction({ to: tx.to, data: tx.data, gas: tx.gas, nonce, chain: this.chain });
    } finally {
      // release only if we still own the lock
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      );
    }
  }

  async wait(hash: Hex, timeoutMs = 60_000): Promise<TransactionReceipt> {
    return this.publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
  }
}
