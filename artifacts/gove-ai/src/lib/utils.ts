import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("kk-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function truncateSignature(sig?: string) {
  if (!sig) return "";
  if (sig.length < 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}
