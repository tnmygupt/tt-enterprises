/** True only on the packing host, so that site never pulls the shop books. */
export function isPackHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "pack.ttenterprises.shop" || host === "www.pack.ttenterprises.shop";
}
