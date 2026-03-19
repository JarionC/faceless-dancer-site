import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "../../config/env.js";
import { getSiteSettings } from "../siteSettings/service.js";

const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");

export async function checkHolderEligibility(ownerPublicKey: string): Promise<boolean> {
  const owner = new PublicKey(ownerPublicKey);
  const holderMint = new PublicKey(getSiteSettings().tokenAddress);
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: holderMint });

  const total = accounts.value.reduce((sum, account) => {
    const parsedAmount =
      account.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
    return sum + Number(parsedAmount);
  }, 0);

  return total >= env.HOLDER_MIN_BALANCE;
}
