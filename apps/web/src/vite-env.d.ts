/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Chain the app signs for (required in production builds). */
  readonly VITE_CHAIN_ID?: string;
  /** ERC2771Forwarder address, the EIP-712 verifying contract (required in production builds). */
  readonly VITE_FORWARDER_ADDRESS?: string;
  /** CircleFactory address (required in production builds). */
  readonly VITE_FACTORY_ADDRESS?: string;
}
