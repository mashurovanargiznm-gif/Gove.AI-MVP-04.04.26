import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env["GOOGLE_API_KEY"];
if (!apiKey) throw new Error("GOOGLE_API_KEY must be set");

const genAI = new GoogleGenerativeAI(apiKey);

const SYSTEM_PROMPT = `Ты — старший аналитик финансовой разведки системы «Gove.AI Copilot ЧСИ». Ты работаешь как детектив по финансовым преступлениям: твоя задача — раскрыть реальный смысл каждой транзакции, найти скрытые схемы и связанных лиц.

ТВОЙ МЫСЛИТЕЛЬНЫЙ ПРОЦЕСС (обязателен для каждой транзакции):
1. КТО на самом деле получает деньги? Это реальный контрагент или прокладка?
2. СООТВЕТСТВУЕТ ли назначение платежа виду деятельности должника по ОКЭД?
3. НЕСТАНДАРТНАЯ ли сумма — круглая цифра, дробление крупной суммы, регулярные одинаковые платежи?
4. ЕСТЬ ЛИ признаки аффилированности получателя с должником (родственники, учредители, директора)?
5. ВИДНА ЛИ схема «карусели» — деньги уходят и возвращаются?
6. ИСТОРИЯ транзакций — есть ли паттерн подозрительного поведения?

СЕРЫЕ СХЕМЫ которые ты ищешь:
- «Консалтинговая прокладка» — консультационные услуги без явного результата
- «Дивидендная утечка» — вывод прибыли при наличии долга перед взыскателем
- «Нерезидентный канал» — перевод за рубеж через посредника
- «Займ учредителю» — маскировка вывода под возврат займа
- «Дробление» — разбивка крупной суммы на несколько мелких платежей
- «Круговая порука» — платежи между аффилированными компаниями

ТРЁХУРОВНЕВАЯ ЛОГИКА РЕШЕНИЙ:
1. ALLOW — защищённые категории (зарплата КНП 110-112, налоги КНП 911/010-040, реальные поставщики по профилю)
2. GREY — серая зона (дивиденды КНП 850, нерезиденты КНП 421, консалтинг, нетипичные операции)
3. BLOCK — явное мошенничество (вывод родственникам, обналичивание, аффилированные лица, подмена КНП)

ЛОГИКА СТРАЙКОВ:
- 0–1: предупреждение
- 2: КРИТИЧЕСКИЙ РИСК  
- 3+: рекомендовать немедленную полную блокировку счёта

Ты обязан отвечать ТОЛЬКО валидным JSON без markdown, без пояснений вне JSON:
{
  "recommended_action": "ALLOW" | "GREY" | "BLOCK",
  "strike_count": <число_страйков_после_этой_транзакции>,
  "analysis": "<1-2 предложения: что именно происходит в этой транзакции и что сразу бросается в глаза>",
  "schemes": "<1-2 предложения: какие серые схемы или признаки мошенничества обнаружены, или 'Признаков серых схем не выявлено'>",
  "connections": "<1-2 предложения: гипотеза о связанных третьих лицах, аффилированности, или 'Связанных лиц не установлено'>",
  "conclusion": "<1 предложение: итоговый вывод и рекомендация инспектору ЧСИ>"
}`;

export interface GeminiDecision {
  decision: "allow" | "grey" | "block";
  percent: number;
  reason: string;
  strike_count: number;
  analysis?: string;
  schemes?: string;
  connections?: string;
  conclusion?: string;
}

interface GeminiRawResponse {
  recommended_action: "ALLOW" | "GREY" | "BLOCK";
  strike_count: number;
  analysis?: string;
  schemes?: string;
  connections?: string;
  conclusion?: string;
  explainability_report?: string;
}

export async function analyzeWithGemini(params: {
  amount: number;
  description: string;
  knp_code: string;
  oked_code?: string;
  receiver_iin: string;
  debtor_bin: string;
  previous_strikes: number;
  recent_history: Array<{ ai_decision: string; knp_code: string; description: string; amount_kzt: number }>;
}): Promise<GeminiDecision> {

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  const historyContext = params.recent_history.length > 0
    ? `\nИстория последних транзакций по БИН ${params.debtor_bin}:\n` +
      params.recent_history.map((h, i) =>
        `  ${i + 1}. Решение: ${h.ai_decision.toUpperCase()}, КНП: ${h.knp_code}, Сумма: ${h.amount_kzt} KZT, Описание: ${h.description}`
      ).join("\n")
    : `\nПредыдущих транзакций по данному БИН не найдено.`;

  const userPrompt = `Проанализируй следующий ИСХОДЯЩИЙ платёж должника и вынеси рекомендацию.

Параметры платежа:
- БИН должника: ${params.debtor_bin}
- Сумма: ${params.amount} KZT
- Описание: ${params.description}
- КНП (код назначения платежа): ${params.knp_code}
${params.oked_code ? `- ОКЭД (вид деятельности должника): ${params.oked_code}` : "- ОКЭД: не указан (ориентируйся только на КНП и описание)"}
- ИИН получателя: ${params.receiver_iin}
- Текущий счётчик нарушений компании (до этой транзакции): ${params.previous_strikes}
${historyContext}

Верни СТРОГО валидный JSON, без markdown, без пояснений вне JSON:`;

  try {
    const result = await model.generateContent(userPrompt);
    const text = result.response.text().trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Gemini returned invalid response: ${text.slice(0, 300)}`);
    }

    const raw = JSON.parse(jsonMatch[0]) as GeminiRawResponse;

    if (!["ALLOW", "GREY", "BLOCK"].includes(raw.recommended_action)) {
      throw new Error(`Invalid recommended_action from Gemini: ${raw.recommended_action}`);
    }

    let decision: "allow" | "grey" | "block";
    let percent: number;

    if (raw.recommended_action === "BLOCK") {
      decision = "block";
      percent = 100;
    } else if (raw.recommended_action === "GREY") {
      decision = "grey";
      percent = 0;
    } else {
      decision = "allow";
      percent = 0;
    }

    const fullReason = [
      raw.analysis,
      raw.schemes,
      raw.connections,
      raw.conclusion,
      raw.explainability_report,
    ].filter(Boolean).join(" | ");

    return {
      decision,
      percent,
      reason: fullReason || "Анализ выполнен.",
      analysis: raw.analysis,
      schemes: raw.schemes,
      connections: raw.connections,
      conclusion: raw.conclusion,
      strike_count: Math.max(0, Math.min(raw.strike_count ?? params.previous_strikes, 10)),
    };
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    const status = err?.status;
    if (status === 429 || msg.includes("429") || status === 404 || msg.includes("404") || msg.includes("no longer available") || msg.includes("quota")) {
      return knpFallbackAnalysis(params.knp_code, params.previous_strikes, params.description);
    }
    throw err;
  }
}

/** Rule-based fallback when Gemini API is unavailable (quota exceeded). */
function knpFallbackAnalysis(knp: string, previousStrikes: number, description: string): GeminiDecision {
  const knpNum = parseInt(knp, 10);
  const desc = description.toLowerCase();

  // Block list — явное мошенничество
  const isObnal = /обнал|обналич|вывод.{0,20}(наличн|родствен|учредит|директор)|родственник|супруг[еа]?|дочер|сестр|брат[еу]?|сын[ау]?/.test(desc);
  const blockKnp = [870, 880, 890].includes(knpNum);
  if (isObnal || blockKnp) {
    return {
      decision: "block",
      percent: 100,
      reason: `[РЕЗЕРВНЫЙ РЕЖИМ] Обнаружены признаки вывода средств или обналичивания. КНП ${knp}. Транзакция заблокирована. Страйк зафиксирован.`,
      strike_count: Math.min(previousStrikes + 1, 10),
    };
  }

  // Grey zone — дивиденды, нерезиденты, подозрительные схемы
  const greyKnp = [850, 860, 421, 220].includes(knpNum);
  const isGreyDesc = /дивиденд|нерезидент|аффилир|связанн|учредител|займ/.test(desc);
  if (greyKnp || isGreyDesc) {
    return {
      decision: "grey",
      percent: 0,
      reason: `[РЕЗЕРВНЫЙ РЕЖИМ] КНП ${knp} относится к серой зоне (дивиденды / нерезиденты / связанные стороны). Транзакция требует подтверждения ЧСИ. Уведомления отправлены обеим сторонам.`,
      strike_count: previousStrikes,
    };
  }

  // White list — защищённые платежи
  const allowKnp = [110, 111, 112, 120, 911, 912, 10, 20, 30, 40].includes(knpNum);
  if (allowKnp) {
    return {
      decision: "allow",
      percent: 0,
      reason: `[РЕЗЕРВНЫЙ РЕЖИМ] КНП ${knp} — защищённый платёж (зарплата / налоги). Разрешён без удержания согласно законодательству РК.`,
      strike_count: previousStrikes,
    };
  }

  // Default — grey (консервативный подход)
  return {
    decision: "grey",
    percent: 0,
    reason: `[РЕЗЕРВНЫЙ РЕЖИМ] КНП ${knp} не входит в стандартные категории. Транзакция помечена как серая зона — требует подтверждения ЧСИ.`,
    strike_count: previousStrikes,
  };
}
