export type SupportedWallet = "phantom" | "solflare" | "backpack" | "metamask";

export interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isMetaMask?: boolean;
  isConnected?: boolean;
  publicKey?: { toString(): string };
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } }>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
}

export function getInjectedProviders(): SolanaProvider[] {
  const anyWindow = window as any;
  const providers = [
    anyWindow.phantom?.solana,
    anyWindow.solflare,
    anyWindow.backpack?.solana,
    anyWindow.solana,
    ...(Array.isArray(anyWindow.solana?.providers) ? anyWindow.solana.providers : []),
  ].filter(Boolean) as SolanaProvider[];

  return Array.from(new Set(providers));
}

export function getProvider(wallet: SupportedWallet): SolanaProvider | undefined {
  const providers = getInjectedProviders();
  switch (wallet) {
    case "phantom":
      return providers.find((provider) => provider.isPhantom);
    case "solflare":
      return providers.find((provider) => provider.isSolflare);
    case "backpack":
      return providers.find((provider) => provider.isBackpack);
    case "metamask":
      return providers.find((provider) => provider.isMetaMask);
    default:
      return undefined;
  }
}

export function detectConnectedWalletPublicKey(): string {
  for (const provider of getInjectedProviders()) {
    const key = provider.publicKey?.toString?.() ?? "";
    if (key) {
      return key;
    }
  }
  return "";
}

export async function refreshWalletConnectionStatus(): Promise<string> {
  const existingKey = detectConnectedWalletPublicKey();
  if (existingKey) {
    return existingKey;
  }

  const providers = getInjectedProviders();
  for (const provider of providers) {
    try {
      await provider.connect({ onlyIfTrusted: true });
    } catch {
      // Ignore providers that reject silent reconnect.
    }
    const key = provider.publicKey?.toString?.() ?? "";
    if (key) {
      return key;
    }
  }

  return "";
}

