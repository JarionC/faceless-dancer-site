import { useEffect, useState } from "preact/hooks";
import bs58 from "bs58";
import { api } from "../lib/api";
import {
  detectConnectedWalletPublicKey,
  getPreferredWallet,
  getProvider,
  setPreferredWallet,
  type SupportedWallet
} from "../lib/walletConnection";

interface Props {
  onVerified: (session: { authenticated: boolean; publicKey: string; isHolder: boolean; isAdmin: boolean }) => void;
}

const walletLabels: Record<SupportedWallet, string> = {
  phantom: "Phantom",
  solflare: "Solflare",
  backpack: "Backpack",
  metamask: "MetaMask",
};

export function WalletAuthCard({ onVerified }: Props) {
  const [status, setStatus] = useState("Disconnected");
  const [wallet, setWallet] = useState<SupportedWallet>(() => getPreferredWallet() ?? "phantom");

  useEffect(() => {
    const key = detectConnectedWalletPublicKey();
    if (key) {
      setStatus(`Connected: ${key}`);
    }
  }, []);

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
    setPreferredWallet(wallet);

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
        <select
          value={wallet}
          onInput={(event) => {
            const nextWallet = (event.target as HTMLSelectElement).value as SupportedWallet;
            setWallet(nextWallet);
            setPreferredWallet(nextWallet);
          }}
        >
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
