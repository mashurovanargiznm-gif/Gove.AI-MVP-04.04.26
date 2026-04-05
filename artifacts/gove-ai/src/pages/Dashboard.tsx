import { useState } from "react";
import { Terminal, Search, User, Scale } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useListTransactions } from "@workspace/api-client-react";
import { EmulatorPanel } from "@/components/panels/EmulatorPanel";
import { RegistryPanel } from "@/components/panels/RegistryPanel";
import { CopilotPanel } from "@/components/panels/CopilotPanel";

export default function Dashboard() {
  const [showEmulator, setShowEmulator] = useState(false);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data } = useListTransactions({
    query: { refetchInterval: 5000 },
  });

  const selectedTx = data?.transactions?.find((t: any) => t.id === selectedTxId) || null;

  return (
    <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden font-sans">

      {/* ── Top Navbar ── */}
      <header className="bg-white border-b border-slate-200 flex items-center gap-4 px-4 py-2 flex-shrink-0 z-30">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2 flex-shrink-0">
          <div className="bg-blue-700 text-white p-1.5 rounded">
            <Scale className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-sm text-slate-800">Gove.AI</div>
            <div className="text-[10px] text-slate-500 font-medium leading-none">Реестр Исполнительного Производства</div>
          </div>
        </div>

        {/* Global Search */}
        <div className="flex-1 max-w-xl relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по БИН / ИИН / Наименованию..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>

        {/* Emulator toggle */}
        <button
          onClick={() => setShowEmulator((v) => !v)}
          title="Банк-Эмулятор"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
            showEmulator
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600"
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          Эмулятор
        </button>

        {/* Operator */}
        <div className="flex items-center gap-2 flex-shrink-0 pl-3 border-l border-slate-200">
          <div className="bg-slate-200 rounded-full p-1">
            <User className="h-4 w-4 text-slate-500" />
          </div>
          <div className="leading-tight text-right">
            <div className="text-xs font-semibold text-slate-700">Инспектор: А. Ибраев</div>
            <div className="text-[10px] text-slate-400">Департамент Юстиции</div>
          </div>
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Emulator (Animated) */}
        <AnimatePresence>
          {showEmulator && (
            <EmulatorPanel onClose={() => setShowEmulator(false)} />
          )}
        </AnimatePresence>

        {/* Center Panel: Registry */}
        <RegistryPanel
          onSelectTransaction={setSelectedTxId}
          selectedId={selectedTxId}
          searchQuery={searchQuery}
        />

        {/* Right Panel: AI Copilot */}
        <CopilotPanel transaction={selectedTx} />
      </div>
    </div>
  );
}
