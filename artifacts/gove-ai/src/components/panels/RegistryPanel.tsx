import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Check, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
import { useListTransactions, useApproveTransaction } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface RegistryPanelProps {
  onSelectTransaction: (id: string) => void;
  selectedId: string | null;
  searchQuery: string;
}

interface SolanaError {
  txId: string;
  message: string;
  faucetUrl?: string;
}

function RiskBadge({ decision, percent, strikeCount }: { decision: string; percent: number; strikeCount?: number }) {
  const strikes = strikeCount ?? 0;
  const strikeTag = strikes > 0 ? (
    <span className={`ml-1 font-bold ${strikes >= 3 ? "text-red-600" : "text-orange-500"}`}>
      ⚡S{strikes}
    </span>
  ) : null;

  if (decision === "block") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200">
        Заблокировано{strikeTag}
      </span>
    );
  }
  if (decision === "grey") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
        Серая зона / ЧСИ{strikeTag}
      </span>
    );
  }
  if (decision === "split" || percent > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
        Удержание {percent}%{strikeTag}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 border border-green-200">
      Разрешено{strikeTag}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 border border-green-200">
      <Check className="h-3 w-3 mr-1" />Исполнено
    </span>
  );
  if (status === "blocked") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 border border-red-200">
      Заблокировано
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">
      Ожидание
    </span>
  );
}

export function RegistryPanel({ onSelectTransaction, selectedId, searchQuery }: RegistryPanelProps) {
  const queryClient = useQueryClient();
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [solanaError, setSolanaError] = useState<SolanaError | null>(null);

  const { data, isLoading } = useListTransactions({
    query: { refetchInterval: 5000 },
  });

  const approveMutation = useApproveTransaction({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        setApprovingId(null);
        setSolanaError(null);
      },
      onError: (error: any, variables) => {
        setApprovingId(null);
        const txId = variables?.data?.transaction_id || "";
        const body = error?.body || {};
        if (body?.error === "INSUFFICIENT_SOL" || error?.status === 402) {
          setSolanaError({
            txId,
            message: body?.details || "Недостаточно Devnet SOL.",
            faucetUrl: body?.faucet_url || "https://faucet.solana.com",
          });
        } else {
          setSolanaError({
            txId,
            message: body?.details || error?.message || "Ошибка при выполнении операции Solana.",
          });
        }
      },
    },
  });

  const handleApprove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setApprovingId(id);
    setSolanaError(null);
    approveMutation.mutate({ data: { transaction_id: id } });
  };

  const allTransactions = data?.transactions || [];

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allTransactions;
    return allTransactions.filter(
      (tx) =>
        tx.debtor_bin.toLowerCase().includes(q) ||
        tx.receiver_iin.toLowerCase().includes(q) ||
        tx.description?.toLowerCase().includes(q)
    );
  }, [allTransactions, searchQuery]);

  const totalSafe = allTransactions.filter((t) => t.withheld_percent === 0 && t.status === "approved").reduce((s, t) => s + t.amount_kzt, 0);
  const totalWithheld = allTransactions.filter((t) => t.status === "approved").reduce((s, t) => s + t.amount_kzt * (t.withheld_percent / 100), 0);
  const approvedCount = allTransactions.filter((t) => t.status === "approved").length;
  const pendingCount = allTransactions.filter((t) => t.status === "pending").length;

  const fmt = (n: number) =>
    "KZT " + n.toLocaleString("ru-KZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden min-w-0">

      {/* Stats strip */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-6 text-xs text-slate-500 flex-shrink-0">
        <span>Всего записей: <strong className="text-slate-700">{allTransactions.length}</strong></span>
        <span className="text-slate-300">|</span>
        <span>Ожидают: <strong className="text-amber-600">{pendingCount}</strong></span>
        <span className="text-slate-300">|</span>
        <span>Исполнено: <strong className="text-green-700">{approvedCount}</strong></span>
        <span className="text-slate-300">|</span>
        <span>Обеленный ФОТ: <strong className="text-blue-700 font-mono">{fmt(totalSafe)}</strong></span>
        <span className="text-slate-300">|</span>
        <span>Взыскано: <strong className="text-amber-700 font-mono">{fmt(totalWithheld)}</strong></span>
      </div>

      {/* Error Banner */}
      {solanaError && (
        <div className="mx-4 mt-3 p-3 rounded border border-red-200 bg-red-50 flex items-start gap-2 text-sm text-red-700 flex-shrink-0">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">Ошибка операции: </span>
            {solanaError.message}
            {solanaError.faucetUrl && (
              <a href={solanaError.faucetUrl} target="_blank" rel="noreferrer"
                className="ml-2 underline text-blue-600 text-xs">
                Получить Devnet SOL →
              </a>
            )}
          </div>
          <button onClick={() => setSolanaError(null)} className="text-red-400 hover:text-red-600 font-bold text-lg leading-none">×</button>
        </div>
      )}

      {/* Section header */}
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Реестр транзакций
          {searchQuery && (
            <span className="ml-2 text-blue-600 normal-case font-normal">
              — найдено: {filteredTransactions.length}
            </span>
          )}
        </h2>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="w-full border-collapse gov-table">
            <thead>
              <tr>
                <th className="w-8">№</th>
                <th className="w-28">Дата</th>
                <th>Должник (БИН)</th>
                <th>Взыскатель (ИИН)</th>
                <th>Сумма</th>
                <th>КНП / Назначение</th>
                <th>Риск-фактор (ИИ)</th>
                <th>Действие / Статус</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400 text-sm">
                    <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                    Загрузка данных реестра...
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400 text-sm">
                    {searchQuery ? "Записи не найдены по запросу." : "Реестр пуст. Используйте Эмулятор для добавления транзакций."}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx, idx) => {
                  const isSelected = tx.id === selectedId;
                  const isApproving = approvingId === tx.id;

                  return (
                    <tr
                      key={tx.id}
                      onClick={() => onSelectTransaction(tx.id)}
                      className={isSelected ? "row-selected" : ""}
                    >
                      <td className="font-mono text-xs text-slate-400 w-8">{idx + 1}</td>
                      <td className="font-mono text-xs whitespace-nowrap text-slate-500">
                        {format(new Date(tx.created_at), "dd.MM.yy HH:mm")}
                      </td>
                      <td className="font-mono text-xs font-semibold text-slate-800">{tx.debtor_bin}</td>
                      <td className="font-mono text-xs text-slate-600">{tx.receiver_iin}</td>
                      <td className="font-mono text-sm font-bold text-slate-800 whitespace-nowrap">
                        {tx.amount_kzt.toLocaleString("ru-KZ")} ₸
                      </td>
                      <td>
                        <div className="font-mono text-xs text-slate-500 leading-tight">
                          <div>КНП: <span className="text-slate-700 font-semibold">{tx.knp_code}</span></div>
                          {tx.oked_code && <div className="text-slate-400">ОКЭД: <span className="text-slate-600">{tx.oked_code}</span></div>}
                        </div>
                      </td>
                      <td>
                        <RiskBadge decision={tx.ai_decision} percent={tx.withheld_percent} strikeCount={tx.strike_count} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {tx.status === "pending" && tx.ai_decision === "grey" ? (
                          // Только GREY ждёт ЧСИ. ALLOW/BLOCK исполняются автоматически.
                          <button
                            onClick={(e) => handleApprove(e, tx.id)}
                            disabled={isApproving}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded text-xs font-semibold border transition-colors bg-amber-500 text-white border-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-wait"
                          >
                            {isApproving
                              ? <><Loader2 className="h-3 w-3 animate-spin" /> Выполнение...</>
                              : "Подтвердить ЧСИ"
                            }
                          </button>
                        ) : tx.status === "approved" && tx.solana_signature ? (
                          <a
                            href={`https://explorer.solana.com/tx/${tx.solana_signature}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="solana-confirmed-link"
                          >
                            <Check className="h-3 w-3" />
                            Блокчейн
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : tx.status === "blocked" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 border border-red-200">Заблокировано</span>
                        ) : (
                          <StatusBadge status={tx.status} />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
