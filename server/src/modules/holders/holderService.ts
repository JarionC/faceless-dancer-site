import { Connection, PublicKey } from "@solana/web3.js";
import { env } from "../../config/env.js";
import { getSiteSettings } from "../siteSettings/service.js";

const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");

export async function checkHolderEligibility(ownerPublicKey: string): Promise<boolean> {
  const tokenAddress = (await getSiteSettings()).tokenAddress.trim();
  if (!tokenAddress) {
    return false;
  }

  let owner: PublicKey;
  let holderMint: PublicKey;
  try {
    owner = new PublicKey(ownerPublicKey);
    holderMint = new PublicKey(tokenAddress);
  } catch {
    return false;
  }

  let accounts;
  try {
    accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: holderMint });
  } catch {
    return false;
  }

  const total = accounts.value.reduce((sum, account) => {
    const parsedAmount =
      account.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
    return sum + Number(parsedAmount);
  }, 0);

  return total >= env.HOLDER_MIN_BALANCE;
}
