import { useState } from "preact/hooks";
import bs58 from "bs58";
import { api } from "../lib/api";

interface Props {
  onVerified: (session: { authenticated: boolean; publicKey: string; isHolder: boolean; isAdmin: boolean }) => void;
}

type SupportedWallet = "phantom" | "solflare" | "backpack" | "metamask";

interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  isMetaMask?: boolean;
  publicKey?: { toString(): string };
  connect: () => Promise<{ publicKey?: { toString(): string } }>;
  signMessage: (message: Uint8Array, display?: string) => Promise<{ signature: Uint8Array }>;
}

const walletLabels: Record<SupportedWallet, string> = {
  phantom: "Phantom",
  solflare: "Solflare",
  backpack: "Backpack",
  metamask: "MetaMask",
};

function getInjectedProviders() {
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

function getProvider(wallet: SupportedWallet) {
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

export function WalletAuthCard({ onVerified }: Props) {
  const [status, setStatus] = useState("Disconnected");
  const [wallet, setWallet] = useState<SupportedWallet>("phantom");

  const signAndVerify = async () => {
    const provider = getProvider(wallet);
    if (!provider) {
      throw new Error(`${walletLabels[wallet]} wallet not found. Install or unlock it before signing.`);
    }

    const connectResult = await provider.connect();
    const publicKey = connectResult.publicKey?.toString();
    if (!publicKey) {
      throw new Error("Missing public key");
    }

    setStatus("Requesting nonce...");
    const noncePayload = await api.nonce(publicKey);

    setStatus("Signing message...");
    const encoded = new TextEncoder().encode(noncePayload.message);
    const signed = await provider.signMessage(encoded, "utf8");
    const signatureBase58 = bs58.encode(signed.signature);

    setStatus("Verifying signature...");
    const verified = await api.verify({
      publicKey,
      nonce: noncePayload.nonce,
      message: noncePayload.message,
      signature: signatureBase58,
    });

    setStatus("Verified");
    onVerified(verified);
  };

  return (
    <section className="card">
      <h2>Wallet Verification</h2>
      <p className="small">Sign a server nonce to prove your wallet and unlock holder actions.</p>
      <p className="small">Supported wallets: Phantom, Solflare, Backpack, MetaMask (Solana).</p>
      <label>
        Wallet
        <select value={wallet} onInput={(event) => setWallet((event.target as HTMLSelectElement).value as SupportedWallet)}>
          <option value="phantom">Phantom</option>
          <option value="solflare">Solflare</option>
          <option value="backpack">Backpack</option>
          <option value="metamask">MetaMask</option>
        </select>
      </label>
      <button type="button" onClick={() => signAndVerify().catch((error) => setStatus(error.message))}>
        Connect + Verify
      </button>
      <div className="small">Status: {status}</div>
    </section>
  );
}
