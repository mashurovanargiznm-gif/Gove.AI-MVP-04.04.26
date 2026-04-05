import { useState, useMemo, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Building2, AlertCircle, CheckCircle2, Loader2,
  TrendingUp, Lock, ShieldAlert, ShieldCheck, ShieldX,
  ArrowDownLeft, ArrowUpRight, Banknote, CreditCard,
  ChevronRight, Cpu, BarChart3,
} from "lucide-react";
import { useAnalyzePayment, useListTransactions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  amount: z.coerce.number().positive("Введите сумму"),
  debtor_bin: z.string().min(6).max(12),
  receiver_iin: z.string().min(12).max(12),
  recipient_name: z.string().optional(),
  knp_code: z.string().min(1),
  description: z.string().min(1),
});

type FormValues = z.infer<typeof formSchema>;

const ACCOUNT_NAME = "ТОО «Тест-Организация»";
const ACCOUNT_NUMBER = "KZ84 125K Z000 0153 4556";
const INITIAL_BALANCE = 10_000_000;
const INFLOW_AMOUNT = 500_000;

// ── OKED справочник (маржинальность → % удержания) ──────────────────────────
interface OkedProfile {
  code: string;
  label: string;
  tier: "low" | "medium" | "high";
  tierLabel: string;
  percent: number;
  color: string;
  bg: string;
  border: string;
}

const OKED_PROFILES: OkedProfile[] = [
  { code: "47111", label: "Розничная торговля, супермаркеты", tier: "low",    tierLabel: "Низкая маржа",    percent: 5,  color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
  { code: "49410", label: "Грузовые автоперевозки",           tier: "low",    tierLabel: "Низкая маржа",    percent: 5,  color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
  { code: "41200", label: "Строительство жилых зданий",       tier: "low",    tierLabel: "Низкая маржа",    percent: 5,  color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
  { code: "10710", label: "Производство хлебобулочных изделий", tier: "medium", tierLabel: "Средняя маржа", percent: 12, color: "text-yellow-700",  bg: "bg-yellow-50",  border: "border-yellow-200" },
  { code: "56100", label: "Рестораны и кафе",                 tier: "medium", tierLabel: "Средняя маржа",   percent: 12, color: "text-yellow-700",  bg: "bg-yellow-50",  border: "border-yellow-200" },
  { code: "86210", label: "Медицинские клиники",              tier: "medium", tierLabel: "Средняя маржа",   percent: 12, color: "text-yellow-700",  bg: "bg-yellow-50",  border: "border-yellow-200" },
  { code: "62011", label: "Разработка ПО (IT)",               tier: "high",   tierLabel: "Высокая маржа",   percent: 15, color: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200" },
  { code: "64190", label: "Финансовое посредничество",        tier: "high",   tierLabel: "Высокая маржа",   percent: 15, color: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200" },
  { code: "70220", label: "Управленческий консалтинг",        tier: "high",   tierLabel: "Высокая маржа",   percent: 15, color: "text-orange-700",  bg: "bg-orange-50",  border: "border-orange-200" },
];

const OKED_DEMO_AMOUNT = 5_000_000;

type OkedStep = {
  id: number;
  text: string;
  done: boolean;
};

const KNP_OPTIONS = [
  { value: "110", label: "110 — Оплата труда (зарплата)" },
  { value: "911", label: "911 — Налоги и сборы" },
  { value: "010", label: "010 — Обязательные пенсионные взносы" },
  { value: "710", label: "710 — Оплата B2B услуг" },
  { value: "220", label: "220 — Консалтинговые услуги" },
  { value: "421", label: "421 — Платежи нерезидентам" },
  { value: "850", label: "850 — Дивиденды" },
];

function fmt(n: number) {
  return n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

type RiskLevel = "low" | "medium" | "high" | "blocked";

interface PreAnalysis {
  risk: RiskLevel;
  label: string;
  observation: string;
}

function computePreAnalysis(knp: string, description: string, recipientName: string): PreAnalysis {
  const haystack = (description + " " + recipientName).toLowerCase();

  if (/родственник|обнал|обналич|супруг|дочер|сестр[еу]?|брат[еу]?|сынов?|сына/.test(haystack)) {
    return {
      risk: "blocked",
      label: "БЛОКИРОВКА",
      observation: "Обнаружены признаки вывода средств на связанных лиц. Транзакция будет автоматически заблокирована.",
    };
  }
  if (/аффилир|учредител|директор|владелец/.test(haystack)) {
    return {
      risk: "high",
      label: "ВЫСОКИЙ",
      observation: "Возможна связь с аффилированными лицами. Серая зона — потребует подтверждения ЧСИ.",
    };
  }

  const knpNum = parseInt(knp, 10);
  if ([110, 111, 112, 120].includes(knpNum)) {
    return { risk: "low", label: "НИЗКИЙ", observation: `КНП ${knp} — Оплата труда. Защищённый платёж, удержание не применяется согласно ст. 96 ТК РК.` };
  }
  if ([911, 912, 10, 20, 30, 40].includes(knpNum)) {
    return { risk: "low", label: "НИЗКИЙ", observation: `КНП ${knp} — Налоговый платёж. Приоритетная категория, проходит в полном объёме.` };
  }
  if ([850, 860].includes(knpNum)) {
    return { risk: "high", label: "ВЫСОКИЙ", observation: `КНП ${knp} — Выплата дивидендов. Транзакция получит статус «Серая зона» и требует подтверждения ЧСИ.` };
  }
  if ([421].includes(knpNum)) {
    return { risk: "high", label: "ВЫСОКИЙ", observation: `КНП ${knp} — Платёж нерезиденту. Серая зона — ЧСИ должен вручную подтвердить операцию.` };
  }
  if ([220].includes(knpNum)) {
    return { risk: "medium", label: "СРЕДНИЙ", observation: `КНП ${knp} — Консалтинг. Будет проверено соответствие ОКЭД и описания назначению платежа.` };
  }
  return {
    risk: "medium",
    label: "СРЕДНИЙ",
    observation: `КНП ${knp} — Стандартный B2B платёж. ИИ проанализирует соответствие деятельности компании.`,
  };
}

const RISK_CONFIG: Record<RiskLevel, { bg: string; border: string; text: string; badge: string; Icon: any }> = {
  low:     { bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-800", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: ShieldCheck },
  medium:  { bg: "bg-yellow-50",   border: "border-yellow-200",  text: "text-yellow-800",  badge: "bg-yellow-100  text-yellow-700  border-yellow-200",  Icon: ShieldAlert },
  high:    { bg: "bg-orange-50",   border: "border-orange-200",  text: "text-orange-800",  badge: "bg-orange-100  text-orange-700  border-orange-200",  Icon: ShieldAlert },
  blocked: { bg: "bg-red-50",      border: "border-red-200",     text: "text-red-800",     badge: "bg-red-100     text-red-700     border-red-200",     Icon: ShieldX    },
};

interface InflowResult {
  gross: number;
  withheld: number;
  net: number;
  solana?: string | null;
}

export function EmulatorPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [balance, setBalance] = useState(INITIAL_BALANCE);
  const [lastResult, setLastResult] = useState<any>(null);
  const [inflowResult, setInflowResult] = useState<InflowResult | null>(null);
  const [inflowLoading, setInflowLoading] = useState(false);

  // ── OKED-demo state ──────────────────────────────────────────────────────
  const [okedCode, setOkedCode] = useState("62011");
  const [okedRunning, setOkedRunning] = useState(false);
  const [okedSteps, setOkedSteps] = useState<OkedStep[]>([]);
  const [okedResult, setOkedResult] = useState<OkedProfile | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const runOkedDemo = () => {
    // Очищаем предыдущий прогон
    timerRef.current.forEach(clearTimeout);
    timerRef.current = [];
    setOkedResult(null);
    setOkedSteps([]);
    setOkedRunning(true);

    const profile = OKED_PROFILES.find((p) => p.code === okedCode) ?? OKED_PROFILES[6];
    const withheld = Math.round(OKED_DEMO_AMOUNT * profile.percent / 100);
    const net = OKED_DEMO_AMOUNT - withheld;

    const steps: Array<{ text: string; delay: number }> = [
      { text: `🔍 Идентификация ОКЭД ${profile.code}...`,                        delay: 0 },
      { text: `📋 ${profile.label}`,                                              delay: 700 },
      { text: `📊 Маржинальность → ${profile.tierLabel}`,                        delay: 1400 },
      { text: `⚙️  Применяю ставку удержания: ${profile.percent}%`,              delay: 2100 },
      { text: `💰 Расчёт: ${fmt(OKED_DEMO_AMOUNT)} × ${profile.percent}% = ${fmt(withheld)} ₸`, delay: 2800 },
      { text: `✅ Чистое поступление на счёт: ${fmt(net)} ₸`,                   delay: 3600 },
    ];

    steps.forEach((s, i) => {
      const t = setTimeout(() => {
        setOkedSteps((prev) => [...prev, { id: i, text: s.text, done: true }]);
        if (i === steps.length - 1) {
          setOkedResult(profile);
          setOkedRunning(false);
        }
      }, s.delay);
      timerRef.current.push(t);
    });
  };

  const { data: txData } = useListTransactions({ query: { refetchInterval: 3000 } });

  // Calculate bailiff hold from pending + blocked transactions
  const bailiffHold = useMemo(() => {
    const txs = txData?.transactions ?? [];
    return txs
      .filter((t) => (t.ai_decision === "block" || t.ai_decision === "grey") && t.status !== "approved")
      .reduce((sum, t) => sum + t.amount_kzt, 0);
  }, [txData]);

  const available = Math.max(0, balance - bailiffHold);
  const holdPercent = balance > 0 ? Math.min(100, (bailiffHold / balance) * 100) : 0;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: 1_500_000,
      debtor_bin: "123456789012",
      receiver_iin: "098765432109",
      recipient_name: "",
      knp_code: "110",
      description: "Оплата труда — апрель 2026",
    },
  });

  const watchedKnp = form.watch("knp_code");
  const watchedDesc = form.watch("description");
  const watchedRecipient = form.watch("recipient_name") ?? "";
  const preAnalysis = useMemo(
    () => computePreAnalysis(watchedKnp, watchedDesc, watchedRecipient),
    [watchedKnp, watchedDesc, watchedRecipient]
  );
  const riskCfg = RISK_CONFIG[preAnalysis.risk];

  const analyzeMutation = useAnalyzePayment({
    mutation: {
      onSuccess: (data) => {
        setLastResult(data);
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        // Исходящие транзакции НЕ списываются с баланса — только мониторинг.
        // 15% удержание действует только при поступлении средств.
        form.reset({ ...form.getValues(), amount: Math.floor(Math.random() * 3_000_000) + 200_000 });
      },
    },
  });

  const onSubmit = (data: FormValues) => {
    setLastResult(null);
    const { recipient_name: _rn, ...apiData } = data;
    analyzeMutation.mutate({ data: apiData });
  };

  const handleInflow = async () => {
    setInflowLoading(true);
    setInflowResult(null);
    try {
      const resp = await fetch(`/api/inflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_kzt: INFLOW_AMOUNT, counterparty: "АО «Контрагент Тест»" }),
      });
      const json = await resp.json();
      if (json.success) {
        setBalance((b) => b + json.net_amount);
        setInflowResult({
          gross: json.gross_amount,
          withheld: json.withheld_amount,
          net: json.net_amount,
          solana: json.solana_signature,
        });
        setTimeout(() => setInflowResult(null), 6000);
      }
    } catch {
      // fallback — просто добавляем 85% от суммы (уже вычтен 15%)
      const net = Math.round(INFLOW_AMOUNT * 0.85);
      setBalance((b) => b + net);
      setInflowResult({ gross: INFLOW_AMOUNT, withheld: INFLOW_AMOUNT - net, net });
      setTimeout(() => setInflowResult(null), 4000);
    } finally {
      setInflowLoading(false);
    }
  };

  const isRestricted = bailiffHold > 0;

  return (
    <motion.div
      initial={{ x: -420, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -420, opacity: 0 }}
      transition={{ type: "spring", damping: 28, stiffness: 220 }}
      className="w-[380px] h-full flex flex-col bg-white border-r border-slate-200 flex-shrink-0 z-20 overflow-hidden"
      style={{ fontFamily: "'Inter', 'Roboto', sans-serif" }}
    >

      {/* ── Top bar: bank brand ── */}
      <div style={{ background: "#0047FF" }} className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-white/90" />
          <div>
            <div className="text-white font-bold text-sm leading-tight tracking-wide">GOVE BANK</div>
            <div className="text-blue-200 text-[10px] tracking-widest">Kazakhstan · DEVNET</div>
          </div>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white transition-colors p-1 rounded">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── Account status bar ── */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0 flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold text-slate-700">{ACCOUNT_NAME}</div>
          <div className="text-[10px] font-mono text-slate-400">{ACCOUNT_NUMBER}</div>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
          isRestricted
            ? "bg-orange-50 text-orange-700 border-orange-200"
            : "bg-green-50 text-green-700 border-green-200"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isRestricted ? "bg-orange-400" : "bg-green-400"}`} />
          {isRestricted ? "Частично ограничен" : "Активен"}
        </span>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">

        {/* ── Balance card ── */}
        <div className="mx-4 mt-4 rounded-2xl overflow-hidden" style={{
          background: "linear-gradient(135deg, #0047FF 0%, #003ACC 60%, #0028A0 100%)",
          boxShadow: "0 8px 24px rgba(0,71,255,0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
        }}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-blue-200" />
                <span className="text-blue-200 text-[10px] font-semibold uppercase tracking-widest">Расчётный счёт</span>
              </div>
              <CreditCard className="h-4 w-4 text-white/40" />
            </div>

            <div className="mb-1">
              <div className="text-blue-200 text-[10px] uppercase tracking-wide">Общий баланс</div>
              <motion.div
                key={balance}
                initial={{ scale: 1.04, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-white font-bold text-2xl mt-0.5"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {fmt(balance)} <span className="text-base font-normal text-blue-200">KZT</span>
              </motion.div>
            </div>

            {/* Hold progress bar */}
            <div className="mt-3 mb-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] text-blue-200 flex items-center gap-1">
                  <Lock className="h-2.5 w-2.5" /> Арест ЧСИ
                </span>
                <span className="text-[10px] text-red-300 font-mono font-semibold">{fmt(bailiffHold)} KZT</span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-red-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${holdPercent}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div>
                <div className="text-[10px] text-blue-200 uppercase tracking-wide">Доступно</div>
                <div className="text-white font-bold text-base font-mono">{fmt(available)} KZT</div>
              </div>
              <button
                onClick={handleInflow}
                disabled={inflowLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all active:scale-95 disabled:opacity-60"
                style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                {inflowLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Solana...</>
                  : <><ArrowDownLeft className="h-3.5 w-3.5" /> +{fmt(INFLOW_AMOUNT)} KZT</>
                }
              </button>
            </div>
          </div>

          {/* Inflow result — detailed withholding breakdown */}
          <AnimatePresence>
            {inflowResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mx-0 overflow-hidden"
              >
                <div className="px-4 pb-3 pt-1 space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-300 text-[11px] font-bold">
                    <TrendingUp className="h-3.5 w-3.5" /> Поступление обработано (−15% ЧСИ)
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <div className="bg-white/10 rounded-lg p-1.5 text-center">
                      <div className="text-blue-200">Gross</div>
                      <div className="text-white font-mono font-semibold">{fmt(inflowResult.gross)}</div>
                    </div>
                    <div className="bg-red-500/20 rounded-lg p-1.5 text-center">
                      <div className="text-red-300">Удержано</div>
                      <div className="text-red-200 font-mono font-semibold">−{fmt(inflowResult.withheld)}</div>
                    </div>
                    <div className="bg-emerald-500/20 rounded-lg p-1.5 text-center">
                      <div className="text-emerald-300">Зачислено</div>
                      <div className="text-emerald-200 font-mono font-semibold">{fmt(inflowResult.net)}</div>
                    </div>
                  </div>
                  {inflowResult.solana && (
                    <div className="text-[10px] text-blue-200 flex items-center gap-1 pt-0.5">
                      <span className="text-blue-300">🔗 Solana:</span>
                      <span className="font-mono truncate">{inflowResult.solana.slice(0, 20)}…</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Transfer form ── */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpRight className="h-3.5 w-3.5" style={{ color: "#0047FF" }} />
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">Исходящий перевод</span>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">

            {/* Amount */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">
                Сумма перевода (KZT)
              </label>
              <div className="relative">
                <input
                  type="number"
                  {...form.register("amount")}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 font-mono font-semibold focus:outline-none focus:ring-2 focus:border-transparent pr-10"
                  style={{ "--tw-ring-color": "#0047FF40" } as any}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">KZT</span>
              </div>
              {form.formState.errors.amount && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{form.formState.errors.amount.message}
                </p>
              )}
            </div>

            {/* Recipient Name */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">
                Наименование получателя
              </label>
              <input
                {...form.register("recipient_name")}
                placeholder="ТОО / ИП / ФИО..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ "--tw-ring-color": "#0047FF40" } as any}
              />
            </div>

            {/* Two columns: BIN / IIN */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">БИН должника</label>
                <input
                  {...form.register("debtor_bin")}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-800 font-mono focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ "--tw-ring-color": "#0047FF40" } as any}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">ИИН взыскателя</label>
                <input
                  {...form.register("receiver_iin")}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 text-slate-800 font-mono focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ "--tw-ring-color": "#0047FF40" } as any}
                />
              </div>
            </div>

            {/* KNP */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">
                КНП — Код назначения платежа
              </label>
              <select
                {...form.register("knp_code")}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ "--tw-ring-color": "#0047FF40" } as any}
              >
                {KNP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">
                Назначение платежа
              </label>
              <input
                {...form.register("description")}
                placeholder="Текст назначения..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ "--tw-ring-color": "#0047FF40" } as any}
              />
            </div>

            {/* ── Real-time AI Pre-Analysis ── */}
            <motion.div
              key={preAnalysis.risk}
              initial={{ opacity: 0.6, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-xl border p-3 ${riskCfg.bg} ${riskCfg.border}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <riskCfg.Icon className={`h-3.5 w-3.5 ${riskCfg.text}`} />
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Пред-анализ ИИ</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${riskCfg.badge}`}>
                  {preAnalysis.label}
                </span>
              </div>
              <p className={`text-xs leading-relaxed ${riskCfg.text}`}>{preAnalysis.observation}</p>
            </motion.div>

            {/* Submit */}
            <button
              type="submit"
              disabled={analyzeMutation.isPending}
              className="w-full py-2.5 text-white text-sm font-bold rounded-xl transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2"
              style={{
                background: analyzeMutation.isPending ? "#6B89FF" : "#0047FF",
                boxShadow: analyzeMutation.isPending ? "none" : "0 4px 14px rgba(0,71,255,0.35)",
              }}
            >
              {analyzeMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> ИИ-анализ...</>
              ) : (
                <><ArrowUpRight className="h-4 w-4" /> Выполнить перевод (Тест)</>
              )}
            </button>
          </form>
        </div>

        {/* ── Result card ── */}
        <AnimatePresence>
          {lastResult && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mx-4 mb-4 mt-2 rounded-xl border overflow-hidden"
              style={{ borderColor: lastResult.decision === "allow" ? "#6EE7B7" : lastResult.decision === "block" ? "#FCA5A5" : "#FCD34D" }}
            >
              <div className={`px-3 py-2 flex items-center justify-between ${
                lastResult.decision === "allow" ? "bg-emerald-50" :
                lastResult.decision === "block" ? "bg-red-50" : "bg-amber-50"
              }`}>
                <div className="flex items-center gap-2">
                  {lastResult.decision === "allow"
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : lastResult.decision === "block"
                    ? <ShieldX className="h-4 w-4 text-red-600" />
                    : <ShieldAlert className="h-4 w-4 text-amber-600" />}
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    {lastResult.decision === "allow" ? "Разрешено" : lastResult.decision === "block" ? "Заблокировано" : "Серая зона / ЧСИ"}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate-400">#{lastResult.transaction_id?.slice(0, 8)}</span>
              </div>
              <div className="bg-white px-3 py-2">
                {lastResult.strike_count > 0 && (
                  <div className={`text-xs font-bold mb-1 ${lastResult.strike_count >= 3 ? "text-red-600" : "text-orange-500"}`}>
                    ⚡ Strike {lastResult.strike_count}{lastResult.strike_count >= 3 ? " — CRITICAL RISK" : ""}
                  </div>
                )}
                <p className="text-xs text-slate-500 leading-relaxed">{lastResult.message}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {analyzeMutation.isError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mx-4 mb-4 mt-2 p-3 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{(analyzeMutation.error as any)?.response?.data?.details || analyzeMutation.error?.message || "Ошибка анализа."}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── OKED Dynamic Retention Demo ── */}
        <div className="px-4 pb-2 pt-1">
          <div className="rounded-xl border border-slate-200 overflow-hidden">

            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-800">
              <Cpu className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span className="text-[11px] font-bold text-white uppercase tracking-widest">
                Динамическое удержание по ОКЭД
              </span>
            </div>

            <div className="bg-slate-900 px-3 py-3 space-y-2.5">

              {/* OKED selector */}
              <div>
                <div className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">Вид деятельности (ОКЭД)</div>
                <select
                  value={okedCode}
                  onChange={(e) => { setOkedCode(e.target.value); setOkedSteps([]); setOkedResult(null); }}
                  className="w-full px-2 py-1.5 text-[11px] rounded-lg border border-slate-700 bg-slate-800 text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {OKED_PROFILES.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.code} — {p.label} ({p.percent}%)
                    </option>
                  ))}
                </select>
              </div>

              {/* Run button */}
              <button
                onClick={runOkedDemo}
                disabled={okedRunning}
                className="w-full py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-60"
                style={{
                  background: okedRunning ? "#1e3a5f" : "linear-gradient(90deg,#0047FF,#0090FF)",
                  color: "white",
                }}
              >
                {okedRunning
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Анализирую...</>
                  : <><BarChart3 className="h-3.5 w-3.5" /> Показать расчёт удержания</>
                }
              </button>

              {/* Animated steps log */}
              <AnimatePresence>
                {okedSteps.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 space-y-1 font-mono"
                  >
                    {okedSteps.map((step) => (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25 }}
                        className="flex items-start gap-1.5"
                      >
                        <ChevronRight className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                        <span className="text-[10px] text-slate-300 leading-tight">{step.text}</span>
                      </motion.div>
                    ))}
                    {okedRunning && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="inline-flex gap-0.5">
                          {[0,1,2].map(i => (
                            <motion.span
                              key={i}
                              className="block h-1 w-1 rounded-full bg-blue-400"
                              animate={{ opacity: [0.3,1,0.3] }}
                              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.2 }}
                            />
                          ))}
                        </span>
                        <span className="text-[10px] text-slate-500">вычисляю...</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Final result card */}
              <AnimatePresence>
                {okedResult && (() => {
                  const withheld = Math.round(OKED_DEMO_AMOUNT * okedResult.percent / 100);
                  const net = OKED_DEMO_AMOUNT - withheld;
                  const barW = Math.round((okedResult.percent / 15) * 100);
                  return (
                    <motion.div
                      key="oked-result"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-lg border border-slate-600 overflow-hidden"
                    >
                      {/* Tier badge */}
                      <div className={`px-3 py-1.5 flex items-center justify-between ${okedResult.bg}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${okedResult.color}`}>
                          {okedResult.tierLabel}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${okedResult.border} ${okedResult.color} bg-white/60`}>
                          {okedResult.percent}% удержание
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="px-3 pt-2 pb-1 bg-slate-800">
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              okedResult.tier === "low" ? "bg-emerald-400" :
                              okedResult.tier === "medium" ? "bg-yellow-400" : "bg-orange-400"
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${barW}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-slate-500 mt-0.5">
                          <span>0%</span><span>5%</span><span>10%</span><span>15%</span>
                        </div>
                      </div>

                      {/* Money breakdown */}
                      <div className="grid grid-cols-3 gap-1.5 px-3 pb-3 pt-1 bg-slate-800">
                        <div className="bg-slate-700 rounded-lg p-2 text-center">
                          <div className="text-[9px] text-slate-400 uppercase">Gross</div>
                          <div className="text-[11px] text-white font-mono font-bold mt-0.5">
                            {fmt(OKED_DEMO_AMOUNT)}
                          </div>
                        </div>
                        <div className="bg-red-900/40 rounded-lg p-2 text-center border border-red-700/30">
                          <div className="text-[9px] text-red-400 uppercase">Удержано</div>
                          <div className="text-[11px] text-red-300 font-mono font-bold mt-0.5">
                            −{fmt(withheld)}
                          </div>
                        </div>
                        <div className="bg-emerald-900/40 rounded-lg p-2 text-center border border-emerald-700/30">
                          <div className="text-[9px] text-emerald-400 uppercase">На счёт</div>
                          <div className="text-[11px] text-emerald-300 font-mono font-bold mt-0.5">
                            {fmt(net)}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>

            </div>
          </div>
        </div>

        {/* Padding bottom */}
        <div className="h-4" />
      </div>
    </motion.div>
  );
}
