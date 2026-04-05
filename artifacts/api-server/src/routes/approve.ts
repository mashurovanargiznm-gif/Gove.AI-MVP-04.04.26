import { Router, type IRouter } from "express";
import { getTransaction, updateTransaction } from "../lib/db.js";
import { executeTransfer } from "../lib/solana.js";
import { sendTelegramNotification } from "../lib/telegram.js";
import { ApproveTransactionBody } from "@workspace/api-zod";

const router: IRouter = Router();

// ЧСИ подтверждает ТОЛЬКО серые (GREY) транзакции.
// ALLOW исполняется автоматически при анализе.
// BLOCK блокируется автоматически при анализе.
router.post("/approve", async (req, res) => {
  try {
    const body = ApproveTransactionBody.parse(req.body);
    const tx = getTransaction(body.transaction_id);

    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    if (tx.status !== "pending") {
      res.status(400).json({ error: "Transaction already processed", status: tx.status });
      return;
    }

    if (tx.ai_decision !== "grey") {
      res.status(400).json({
        error: "Only GREY transactions require ЧСИ confirmation. ALLOW is auto-approved, BLOCK is auto-blocked.",
        ai_decision: tx.ai_decision,
      });
      return;
    }

    // ── GREY: ЧСИ подтверждает → Solana-трансфер ──────────────────────────
    let solanaSignature = "";
    try {
      solanaSignature = await executeTransfer();
    } catch (solanaErr) {
      const msg = solanaErr instanceof Error ? solanaErr.message : String(solanaErr);
      req.log.error({ solanaErrMsg: msg }, "Solana transfer failed on grey approval");

      const isInsufficientFunds =
        msg.toLowerCase().includes("insufficient") ||
        msg.toLowerCase().includes("0x1") ||
        msg.toLowerCase().includes("lamports") ||
        msg.toLowerCase().includes("airdrop");

      if (isInsufficientFunds) {
        res.status(402).json({
          error: "INSUFFICIENT_SOL",
          details: `Ошибка блокчейна: ${msg}`,
          faucet_url: "https://faucet.solana.com",
        });
      } else {
        res.status(500).json({ error: "Solana transfer failed", details: msg });
      }
      return;
    }

    updateTransaction(tx.id, { status: "approved", solana_signature: solanaSignature });

    try {
      await sendTelegramNotification(
        `🟡✅ <b>Gove.AI | ЧСИ подтвердил серую транзакцию</b>\n\n` +
        `🏢 Должник БИН: <code>${tx.debtor_bin}</code>\n` +
        `💰 Сумма: <b>${tx.amount_kzt.toLocaleString("ru-RU")} KZT</b>\n` +
        `📋 КНП: <b>${tx.knp_code}</b>\n` +
        `📝 Назначение: ${tx.description}\n\n` +
        `🤖 <b>Обоснование ИИ (почему была серая зона):</b>\n${tx.ai_reason.slice(0, 300)}\n\n` +
        `✅ Инспектор ЧСИ вручную одобрил транзакцию после проверки. Деньги отправлены.\n\n` +
        `🔗 Блокчейн-чек: <code>${solanaSignature}</code>`
      );
    } catch (tgErr) {
      req.log.warn({ tgErr }, "Telegram grey-approve notification failed");
    }

    res.json({
      success: true,
      status: "approved",
      solana_signature: solanaSignature,
      withheld_amount: 0,
      percent: 0,
      message: `ЧСИ подтвердил серую транзакцию. Блокчейн-чек записан.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Approve error");
    res.status(500).json({ error: "Approval failed", details: message });
  }
});

export default router;
