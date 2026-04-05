import { Router, type IRouter } from "express";
import { insertTransaction, updateTransaction, getStrikeCount, getRecentHistory } from "../lib/db.js";
import { analyzeWithGemini } from "../lib/gemini.js";
import { sendTelegramNotification } from "../lib/telegram.js";
import { executeTransfer } from "../lib/solana.js";
import { AnalyzePaymentBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/analyze", async (req, res) => {
  try {
    const body = AnalyzePaymentBody.parse(req.body);

    const previous_strikes = getStrikeCount(body.debtor_bin);
    const recent_history = getRecentHistory(body.debtor_bin, 10).map((t) => ({
      ai_decision: t.ai_decision,
      knp_code: t.knp_code,
      description: t.description,
      amount_kzt: t.amount_kzt,
    }));

    const geminiResult = await analyzeWithGemini({
      amount: body.amount,
      description: body.description,
      knp_code: body.knp_code,
      oked_code: body.oked_code,
      receiver_iin: body.receiver_iin,
      debtor_bin: body.debtor_bin,
      previous_strikes,
      recent_history,
    });

    // ── Сразу определяем начальный статус ──────────────────────────────────
    // ALLOW → auto-approved; BLOCK → auto-blocked; GREY → pending (ждёт ЧСИ)
    const initialStatus =
      geminiResult.decision === "allow" ? "approved" :
      geminiResult.decision === "block" ? "blocked" :
      "pending";

    const aiReasonStructured = JSON.stringify({
      analysis: geminiResult.analysis ?? "",
      schemes: geminiResult.schemes ?? "",
      connections: geminiResult.connections ?? "",
      conclusion: geminiResult.conclusion ?? geminiResult.reason,
    });

    const tx = insertTransaction({
      debtor_bin: body.debtor_bin,
      amount_kzt: body.amount,
      description: body.description,
      knp_code: body.knp_code,
      oked_code: body.oked_code ?? "",
      receiver_iin: body.receiver_iin,
      ai_decision: geminiResult.decision,
      withheld_percent: geminiResult.percent,
      ai_reason: aiReasonStructured,
      strike_count: geminiResult.strike_count,
      solana_signature: null,
      status: initialStatus,
    });

    const tgReason = geminiResult.conclusion ?? geminiResult.reason;

    const isCritical = geminiResult.strike_count >= 3;
    const strikeNote = isCritical
      ? `\n🚨 <b>CRITICAL_RISK</b> — ${geminiResult.strike_count} нарушений. Рекомендована полная блокировка счёта.`
      : geminiResult.strike_count > 0
      ? `\n⚡ Нарушений у компании: ${geminiResult.strike_count}`
      : "";

    // ── ALLOW: Solana-трансфер сразу, без участия ЧСИ ─────────────────────
    if (geminiResult.decision === "allow") {
      let solanaSignature = "";
      try {
        solanaSignature = await executeTransfer();
        updateTransaction(tx.id, { solana_signature: solanaSignature });
      } catch (solanaErr) {
        req.log.warn({ solanaErr }, "Solana transfer failed on auto-allow");
      }

      try {
        await sendTelegramNotification(
          `🟢 <b>Gove.AI | Платёж исполнен автоматически</b>\n\n` +
          `🏢 Должник БИН: <code>${body.debtor_bin}</code>\n` +
          `💰 Сумма: <b>${body.amount.toLocaleString("ru-RU")} KZT</b>\n` +
          `📋 КНП: <b>${body.knp_code}</b> — Защищённый платёж\n` +
          `📝 Назначение: ${body.description}\n\n` +
          `🤖 <b>Обоснование ИИ:</b>\n${tgReason.slice(0, 300)}\n\n` +
          `✅ Транзакция пропущена системой автоматически. Подтверждение ЧСИ не требуется.\n` +
          `⚠️ Удержание 15% не применяется: исходящие защищённые платежи проходят в полном объёме.\n\n` +
          (solanaSignature ? `🔗 Блокчейн-чек: <code>${solanaSignature}</code>` : `⚠️ Solana: трансфер не выполнен (нет баланса).`)
        );
      } catch (tgErr) {
        req.log.warn({ tgErr }, "Telegram allow notification failed");
      }
    }

    // ── BLOCK: немедленная блокировка, Strike уже в geminiResult ──────────
    if (geminiResult.decision === "block") {
      try {
        await sendTelegramNotification(
          `🔴 <b>Gove.AI | Транзакция ЗАБЛОКИРОВАНА автоматически</b>\n\n` +
          `🏢 Должник БИН: <code>${body.debtor_bin}</code>\n` +
          `💰 Сумма: <b>${body.amount.toLocaleString("ru-RU")} KZT</b>\n` +
          `📋 КНП: <b>${body.knp_code}</b>\n` +
          `📝 Назначение: ${body.description}\n` +
          `${strikeNote}\n\n` +
          `🤖 <b>Обоснование ИИ:</b>\n${tgReason.slice(0, 300)}\n\n` +
          `🛑 Транзакция заблокирована системой без участия ЧСИ. Деньги удержаны.`
        );
      } catch (tgErr) {
        req.log.warn({ tgErr }, "Telegram block notification failed");
      }
    }

    // ── GREY: уведомление ЧСИ, ожидание ручного подтверждения ─────────────
    if (geminiResult.decision === "grey") {
      try {
        await sendTelegramNotification(
          `🟡 <b>Gove.AI | Серая зона — Требует подтверждения ЧСИ</b>\n\n` +
          `🏢 Должник БИН: <code>${body.debtor_bin}</code>\n` +
          `💰 Сумма: <b>${body.amount.toLocaleString("ru-RU")} KZT</b>\n` +
          `📋 КНП: <b>${body.knp_code}</b>\n` +
          `📝 Назначение: ${body.description}\n` +
          `👤 Получатель ИИН: <code>${body.receiver_iin}</code>\n` +
          `${strikeNote}\n\n` +
          `🤖 <b>Обоснование ИИ:</b>\n${tgReason.slice(0, 300)}\n\n` +
          `⏳ Транзакция заморожена. Инспектор ЧСИ должен вручную нажать «Подтвердить» или «Отклонить».`
        );
      } catch (tgErr) {
        req.log.warn({ tgErr }, "Telegram grey notification failed");
      }
    }

    const decisionMessages: Record<string, string> = {
      allow: `Транзакция исполнена автоматически. Защищённый платёж (КНП ${body.knp_code}).`,
      grey: `Серая зона — транзакция заморожена, ожидает подтверждения ЧСИ. Уведомление отправлено.`,
      block: `Транзакция заблокирована автоматически. Признаки мошенничества. Страйков: ${geminiResult.strike_count}${isCritical ? " — CRITICAL_RISK" : ""}.`,
    };

    res.json({
      success: true,
      transaction_id: tx.id,
      decision: geminiResult.decision,
      percent: geminiResult.percent,
      reason: geminiResult.reason,
      strike_count: geminiResult.strike_count,
      critical_risk: isCritical,
      message: decisionMessages[geminiResult.decision] ?? `Решение: ${geminiResult.decision}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Analyze error");
    res.status(500).json({ error: "Analysis failed", details: message });
  }
});

export default router;
