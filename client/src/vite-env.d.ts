/// <reference types="vite/client" />

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: () => Promise<{ publicKey?: { toString: () => string } }>;
      signMessage: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array }>;
    };
  }
}

export {};
