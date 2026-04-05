import { Router, type IRouter } from "express";
import { requestAirdropToWallet } from "../lib/solana.js";
import { sendTelegramNotification } from "../lib/telegram.js";

const router: IRouter = Router();

const WITHHOLDING_PERCENT = 15;

router.post("/inflow", async (req, res) => {
  try {
    const grossAmount = Number(req.body?.amount_kzt);
    const counterparty = String(req.body?.counterparty ?? "Контрагент АО");
    if (!grossAmount || grossAmount <= 0) {
      res.status(400).json({ error: "amount_kzt must be a positive number" });
      return;
    }
    const withheldAmount = Math.round(grossAmount * WITHHOLDING_PERCENT / 100);
    const netAmount = grossAmount - withheldAmount;

    // Request 1 SOL airdrop to our wallet (simulates incoming Solana from counterparty)
    let solanaSignature = "";
    let solanaError = "";
    try {
      solanaSignature = await requestAirdropToWallet();
    } catch (err) {
      solanaError = err instanceof Error ? err.message : String(err);
      req.log.warn({ solanaError }, "Airdrop failed, continuing without Solana sig");
    }

    // Telegram notification about incoming funds and withholding
    const solanaLine = solanaSignature
      ? `\n🔗 Solana (Devnet): <code>${solanaSignature}</code>`
      : solanaError
      ? `\n⚠️ Solana airdrop: ${solanaError.slice(0, 80)}`
      : "";

    try {
      await sendTelegramNotification(
        `💳 <b>Gove.AI | Входящий платёж — удержание 15%</b>\n\n` +
        `📥 Поступление от: <b>${counterparty}</b>\n` +
        `💰 Gross сумма: <b>${grossAmount.toLocaleString("ru-RU")} KZT</b>\n\n` +
        `🏦 <b>Удержание ЧСИ (15%)</b>: <b>${withheldAmount.toLocaleString("ru-RU")} KZT</b>\n` +
        `✅ Зачислено на счёт должника: <b>${netAmount.toLocaleString("ru-RU")} KZT</b>\n\n` +
        `📌 Основание: ст. 96 Закона РК «Об исполнительном производстве» — ` +
        `15% входящих средств удерживается автоматически на уровне банка в пользу взыскателя.` +
        solanaLine
      );
    } catch (tgErr) {
      req.log.warn({ tgErr }, "Telegram inflow notification failed");
    }

    res.json({
      success: true,
      gross_amount: grossAmount,
      withheld_amount: withheldAmount,
      net_amount: netAmount,
      withholding_percent: WITHHOLDING_PERCENT,
      solana_signature: solanaSignature || null,
      solana_error: solanaError || null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Inflow error");
    res.status(500).json({ error: "Inflow processing failed", details: message });
  }
});

export default router;
