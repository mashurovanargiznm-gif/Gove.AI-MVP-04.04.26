import React from "react";
import { FileText, Fingerprint, Link as LinkIcon, Send, AlertTriangle, CheckCircle, Search, ShieldAlert, Users, Gavel } from "lucide-react";

interface CopilotPanelProps {
  transaction: any | null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 font-medium flex-shrink-0 pr-2">{label}</span>
      <span className="font-mono text-xs text-slate-800 text-right break-all">{value}</span>
    </div>
  );
}

interface AiSections {
  analysis?: string;
  schemes?: string;
  connections?: string;
  conclusion?: string;
}

function parseAiReason(raw: string): AiSections | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed.analysis || parsed.conclusion)) {
      return parsed as AiSections;
    }
  } catch {}
  return { conclusion: raw };
}

function AiSection({ icon, label, text, color }: { icon: React.ReactNode; label: string; text?: string; color: string }) {
  if (!text) return null;
  return (
    <div className={`rounded border p-2.5 ${color}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs leading-relaxed">{text}</p>
    </div>
  );
}

export function CopilotPanel({ transaction }: CopilotPanelProps) {

  return (
    <div
      className="w-[320px] h-full flex flex-col bg-white border-l border-slate-200 flex-shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <FileText className="h-4 w-4 text-blue-600" />
        <h2 className="font-semibold text-sm text-slate-700 uppercase tracking-wide">
          Аналитическая справка ИИ
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {!transaction ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-8">
            <Fingerprint className="h-12 w-12 mb-3 stroke-1 text-slate-300" />
            <p className="text-sm font-medium text-slate-400">Выберите транзакцию</p>
            <p className="text-xs text-slate-300 mt-1">для просмотра аналитики</p>
          </div>
        ) : (
          <div className="p-4 space-y-4">

            {/* Verdict block */}
            {(() => {
              const d = transaction.ai_decision;
              const isBlock = d === "block";
              const isGrey = d === "grey";
              const isAllow = d === "allow";
              const bgCls = isBlock ? "bg-red-50 border-red-200"
                : isGrey ? "bg-amber-50 border-amber-200"
                : "bg-green-50 border-green-200";
              const labelCls = isBlock ? "bg-red-100 text-red-700 border border-red-200"
                : isGrey ? "bg-amber-100 text-amber-700 border border-amber-300"
                : "bg-green-100 text-green-700 border border-green-200";
              const label = isBlock ? "Заблокировано" : isGrey ? "Серая зона" : "Разрешено";
              return (
                <div className={`rounded border p-3 ${bgCls}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Вердикт системы</span>
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${labelCls}`}>{label}</span>
                  </div>
                  {isGrey && (
                    <div className="text-xs text-amber-800 leading-relaxed">
                      Транзакция помечена как подозрительная. Уведомления отправлены должнику и ЧСИ.
                      Требуется ручное подтверждение инспектора.
                    </div>
                  )}
                  {isBlock && (
                    <div className="text-xs text-red-700 leading-relaxed">
                      Транзакция заблокирована — обнаружены признаки мошенничества или вывода средств.
                    </div>
                  )}
                  {isAllow && (
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 mb-0.5">Статус</div>
                        <div className="text-base font-bold text-green-700">Защищённый платёж</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 mb-0.5">Сумма</div>
                        <div className="font-mono text-sm font-semibold text-slate-700">
                          {transaction.amount_kzt.toLocaleString("ru-KZ")} ₸
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Strike Counter */}
            {(() => {
              const strikes = transaction.strike_count ?? 0;
              if (strikes === 0) return null;
              const isCritical = strikes >= 3;
              return (
                <div className={`rounded border p-3 flex items-start gap-2 ${
                  isCritical ? "bg-red-50 border-red-300" : "bg-orange-50 border-orange-200"
                }`}>
                  <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${isCritical ? "text-red-600" : "text-orange-500"}`} />
                  <div>
                    <div className={`text-xs font-bold uppercase tracking-wide ${isCritical ? "text-red-700" : "text-orange-700"}`}>
                      {isCritical ? "⚠️ CRITICAL_RISK — Strike " + strikes : `Предупреждение — Strike ${strikes}`}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {isCritical
                        ? "Рекомендуется немедленная полная блокировка счёта должника."
                        : "Зафиксировано нарушение. При 3 страйках — рекомендация полной блокировки счёта."}
                    </div>
                    <div className="flex gap-1 mt-1.5">
                      {[1, 2, 3].map((n) => (
                        <div key={n} className={`h-2 w-8 rounded-sm ${n <= strikes ? (isCritical ? "bg-red-500" : "bg-orange-400") : "bg-slate-200"}`} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Details */}
            <div className="bg-slate-50 rounded border border-slate-200 p-3">
              <div className="text-[10px] uppercase text-slate-400 font-semibold tracking-wide mb-2">Реквизиты операции</div>
              <div>
                <DetailRow label="БИН должника" value={transaction.debtor_bin} />
                <DetailRow label="ИИН взыскателя" value={transaction.receiver_iin} />
                <DetailRow label="КНП" value={transaction.knp_code} />
                <DetailRow label="ОКЭД" value={transaction.oked_code} />
                <DetailRow label="Сумма" value={`${transaction.amount_kzt.toLocaleString("ru-KZ")} ₸`} />
              </div>
              {transaction.description && (
                <div className="mt-2 pt-2 border-t border-slate-200">
                  <div className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Назначение платежа</div>
                  <div className="text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 font-mono leading-relaxed">
                    {transaction.description}
                  </div>
                </div>
              )}
            </div>

            {/* AI Reasoning — Detective Report */}
            {(() => {
              const sections = parseAiReason(transaction.ai_reason);
              const isBlock = transaction.ai_decision === "block";
              const isGrey = transaction.ai_decision === "grey";
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-1">
                    {isBlock
                      ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                      : isGrey
                      ? <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                      : <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    }
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Разведывательный отчёт ИИ
                    </span>
                  </div>

                  <AiSection
                    icon={<Search className="h-3 w-3 text-blue-600" />}
                    label="Анализ транзакции"
                    text={sections?.analysis}
                    color="bg-blue-50 border-blue-200 text-blue-900"
                  />
                  <AiSection
                    icon={<ShieldAlert className="h-3 w-3 text-amber-600" />}
                    label="Обнаруженные схемы"
                    text={sections?.schemes}
                    color={isBlock
                      ? "bg-red-50 border-red-200 text-red-900"
                      : "bg-amber-50 border-amber-200 text-amber-900"}
                  />
                  <AiSection
                    icon={<Users className="h-3 w-3 text-purple-600" />}
                    label="Связанные лица"
                    text={sections?.connections}
                    color="bg-purple-50 border-purple-200 text-purple-900"
                  />
                  <AiSection
                    icon={<Gavel className="h-3 w-3 text-slate-600" />}
                    label="Вывод инспектору"
                    text={sections?.conclusion}
                    color={isBlock
                      ? "bg-red-100 border-red-300 text-red-950 font-medium"
                      : isGrey
                      ? "bg-amber-100 border-amber-300 text-amber-950"
                      : "bg-green-50 border-green-200 text-green-900"}
                  />

                  {!sections && (
                    <p className="text-xs text-slate-400 italic px-1">Обоснование недоступно</p>
                  )}
                </div>
              );
            })()}

            {/* Blockchain & Telegram Status */}
            <div className="bg-slate-50 rounded border border-slate-200 p-3 space-y-2">
              <div className="text-[10px] uppercase text-slate-400 font-semibold tracking-wide mb-1">Исполнение</div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <LinkIcon className="h-3.5 w-3.5" />
                  Solana Devnet
                </div>
                {transaction.solana_signature ? (
                  <a
                    href={`https://explorer.solana.com/tx/${transaction.solana_signature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] text-blue-600 hover:underline truncate max-w-[160px] text-right"
                  >
                    {transaction.solana_signature.slice(0, 20)}...
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">Ожидание</span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Send className="h-3.5 w-3.5" />
                  Telegram
                </div>
                {transaction.status === "approved" || transaction.status === "blocked" ? (
                  <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                    Отправлено
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Ожидание</span>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
