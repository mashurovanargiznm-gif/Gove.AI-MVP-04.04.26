import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

const FIXED_TRANSFER_LAMPORTS = 0.2 * LAMPORTS_PER_SOL; // Exactly 0.2 SOL

function getKeypair(): Keypair {
  const privateKeyStr = process.env["SOLANA_PRIVATE_KEY"];
  if (!privateKeyStr) throw new Error("SOLANA_PRIVATE_KEY must be set");

  try {
    const decoded = bs58.decode(privateKeyStr.trim());
    return Keypair.fromSecretKey(decoded);
  } catch {
    try {
      const arr = JSON.parse(privateKeyStr.trim());
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch {
      throw new Error(
        "SOLANA_PRIVATE_KEY is neither valid base58 nor a JSON byte array"
      );
    }
  }
}

async function ensureFunded(keypair: Keypair): Promise<void> {
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    const sig = await connection.requestAirdrop(
      keypair.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
  }
}

export async function executeTransfer(): Promise<string> {
  const creditorPubkeyStr = process.env["CREDITOR_PUBKEY"];
  if (!creditorPubkeyStr) throw new Error("CREDITOR_PUBKEY must be set");

  let senderKeypair: Keypair;
  try {
    senderKeypair = getKeypair();
  } catch (e) {
    throw new Error(`Keypair error: ${e instanceof Error ? e.message : String(e)}`);
  }

  let creditorPubkey: PublicKey;
  try {
    creditorPubkey = new PublicKey(creditorPubkeyStr.trim());
  } catch (e) {
    throw new Error(`Invalid CREDITOR_PUBKEY: ${creditorPubkeyStr} — ${e instanceof Error ? e.message : String(e)}`);
  }

  // Auto-fund from devnet faucet if balance is too low
  try {
    await ensureFunded(senderKeypair);
  } catch (e) {
    throw new Error(`Airdrop failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: senderKeypair.publicKey,
      toPubkey: creditorPubkey,
      lamports: FIXED_TRANSFER_LAMPORTS,
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [
    senderKeypair,
  ]);

  return signature;
}

/**
 * Simulates an incoming payment by requesting a 1 SOL airdrop to our own wallet.
 * This represents the debtor's counterparty sending funds TO the emulator account.
 */
export async function requestAirdropToWallet(): Promise<string> {
  const keypair = getKeypair();
  const sig = await connection.requestAirdrop(keypair.publicKey, 1 * LAMPORTS_PER_SOL);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latestBlockhash });
  return sig;
}

export async function getBalance(pubkey: string): Promise<number> {
  const pk = new PublicKey(pubkey);
  const balance = await connection.getBalance(pk);
  return balance / LAMPORTS_PER_SOL;
}

export function getSenderPublicKey(): string {
  try {
    return getKeypair().publicKey.toBase58();
  } catch {
    return "unknown";
  }
}
