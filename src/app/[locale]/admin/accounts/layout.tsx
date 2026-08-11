/**
 * Accounts routes render normally. Access is enforced per page via the
 * `manage_accounts` capability, and cost/profit figures are further gated
 * behind `view_financials` (owner only).
 */
export default function AccountsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
