"use client";

import { useParams } from "next/navigation";
import { PackSlipScreen } from "@/components/PackSlipScreen";

export default function PackSlipPage() {
  const params = useParams<{ id: string }>();
  return <PackSlipScreen slipId={String(params.id || "")} />;
}
