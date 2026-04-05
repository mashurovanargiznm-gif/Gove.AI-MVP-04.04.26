@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
@import "tailwindcss";

@theme inline {
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --color-background: hsl(210 17% 96%);
  --color-foreground: hsl(215 25% 15%);

  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(215 25% 15%);

  --color-popover: hsl(0 0% 100%);
  --color-popover-foreground: hsl(215 25% 15%);

  --color-primary: hsl(221 83% 43%);
  --color-primary-foreground: hsl(0 0% 100%);

  --color-secondary: hsl(210 17% 93%);
  --color-secondary-foreground: hsl(215 25% 30%);

  --color-muted: hsl(210 17% 90%);
  --color-muted-foreground: hsl(215 16% 46%);

  --color-accent: hsl(221 83% 95%);
  --color-accent-foreground: hsl(221 83% 43%);

  --color-success: hsl(142 60% 38%);
  --color-success-foreground: hsl(0 0% 100%);

  --color-warning: hsl(35 92% 40%);
  --color-warning-foreground: hsl(0 0% 100%);

  --color-destructive: hsl(0 72% 50%);
  --color-destructive-foreground: hsl(0 0% 100%);

  --color-border: hsl(214 20% 82%);
  --color-input: hsl(214 20% 82%);
  --color-ring: hsl(221 83% 43%);

  --radius-sm: 0.125rem;
  --radius-md: 0.25rem;
  --radius-lg: 0.375rem;
}

@layer base {
  * {
    box-sizing: border-box;
  }

  body {
    @apply bg-background text-foreground font-sans antialiased;
    font-size: 14px;
  }

  h1, h2, h3, h4, h5, h6 {
    @apply font-semibold;
  }
}

@layer utilities {
  .gov-panel {
    @apply bg-card border border-border;
  }

  .gov-table th {
    @apply bg-slate-100 text-slate-600 text-xs font-semibold uppercase tracking-wide border-b border-slate-200 py-2 px-3 text-left whitespace-nowrap;
  }

  .gov-table td {
    @apply py-2 px-3 border-b border-slate-100 text-sm text-slate-800 align-middle;
  }

  .gov-table tbody tr:nth-child(even) {
    @apply bg-slate-50/70;
  }

  .gov-table tbody tr:hover {
    @apply bg-blue-50/60 cursor-pointer;
  }

  .gov-table tbody tr.row-selected {
    @apply bg-blue-50 border-l-2 border-l-blue-600;
  }

  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .solana-confirmed-link {
    @apply inline-flex items-center gap-1 text-emerald-700 font-semibold text-xs border border-emerald-300 bg-emerald-50 rounded px-2 py-1 hover:bg-emerald-100 transition-colors;
  }
}
