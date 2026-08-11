import { Link } from "@/i18n/routing";

/** Deep-link to open a voucher detail on the vouchers page. */
export function voucherHref(voucherId: string): string {
  return `/admin/accounts/vouchers?id=${encodeURIComponent(voucherId)}`;
}

export function VoucherNumberLink({
  id,
  number,
  className = "font-mono text-sm font-semibold text-[var(--brand-deep)] underline",
}: {
  id?: string | null;
  number: string;
  className?: string;
}) {
  if (!id) {
    return <span className="font-mono text-sm">{number}</span>;
  }
  return (
    <Link href={voucherHref(id)} className={className}>
      {number}
    </Link>
  );
}
