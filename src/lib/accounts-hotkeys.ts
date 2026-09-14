/** Tally-style gateway shortcuts used across Accounts. */
export const ACCOUNTS_HOTKEYS: {
  keys: string;
  href: string;
  label: string;
  ownerOnly?: boolean;
}[] = [
  { keys: "Ctrl+K", href: "/admin/accounts/search", label: "Search" },
  { keys: "Ctrl+H", href: "/admin/accounts", label: "Accounts home" },
  {
    keys: "F5",
    href: "/admin/accounts/vouchers?new=payment",
    label: "Payment",
    ownerOnly: true,
  },
  { keys: "F6", href: "/admin/accounts/vouchers?new=receipt", label: "Receipt" },
  { keys: "F7", href: "/admin/accounts/journal", label: "Journal" },
  { keys: "F8", href: "/admin/orders/new", label: "New sale" },
  { keys: "F9", href: "/admin/accounts/goods-received", label: "Goods received" },
  { keys: "Alt+F1", href: "/admin/accounts/daybook", label: "Day book" },
  { keys: "Alt+F2", href: "/admin/accounts/inventory", label: "Stock" },
  { keys: "Alt+C", href: "/admin/accounts/cash-bank", label: "Cash & bank" },
  { keys: "Alt+B", href: "/admin/accounts/brs", label: "Bank recon (BRS)" },
  { keys: "Alt+L", href: "/admin/accounts/ledger", label: "Ledger" },
  { keys: "Alt+V", href: "/admin/accounts/vouchers", label: "Vouchers" },
  { keys: "Alt+R", href: "/admin/accounts/receivables", label: "Receivables" },
  { keys: "Alt+P", href: "/admin/accounts/payables", label: "Payables" },
  {
    keys: "Alt+U",
    href: "/admin/accounts/purchases",
    label: "Purchase bills",
    ownerOnly: true,
  },
  {
    keys: "Alt+N",
    href: "/admin/accounts/needs-pricing",
    label: "Needs pricing",
    ownerOnly: true,
  },
  { keys: "Alt+E", href: "/admin/accounts/expenses", label: "Log expense" },
  {
    keys: "Alt+S",
    href: "/admin/accounts/party-statement",
    label: "Party statement",
  },
];

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return !!target.closest("[contenteditable='true'], [role='textbox']");
}

export function matchAccountsHotkey(
  e: KeyboardEvent
): (typeof ACCOUNTS_HOTKEYS)[number] | null {
  const key = e.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  // Ctrl/Cmd+K is owned by AccountsSearch focus — leave it alone here
  if ((e.ctrlKey || e.metaKey) && !e.altKey && lower === "k") return null;

  if ((e.ctrlKey || e.metaKey) && !e.altKey && lower === "h") {
    return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Ctrl+H") ?? null;
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (key === "F5")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "F5") ?? null;
    if (key === "F6")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "F6") ?? null;
    if (key === "F7")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "F7") ?? null;
    if (key === "F8")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "F8") ?? null;
    if (key === "F9")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "F9") ?? null;
  }

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (key === "F1")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+F1") ?? null;
    if (key === "F2")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+F2") ?? null;
    if (lower === "c")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+C") ?? null;
    if (lower === "b")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+B") ?? null;
    if (lower === "l")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+L") ?? null;
    if (lower === "v")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+V") ?? null;
    if (lower === "r")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+R") ?? null;
    if (lower === "p")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+P") ?? null;
    if (lower === "u")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+U") ?? null;
    if (lower === "n")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+N") ?? null;
    if (lower === "e")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+E") ?? null;
    if (lower === "s")
      return ACCOUNTS_HOTKEYS.find((h) => h.keys === "Alt+S") ?? null;
  }

  return null;
}
