"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { NumberField } from "@/components/NumberField";
import {
  SQFT_TO_SQM,
  pieceWeightGFromGsm,
  pieceWeightKgFromGsm,
} from "@/lib/pricing";

export function PacketWeightCalculator() {
  const t = useTranslations();
  const [gsm, setGsm] = useState<number | "">("");
  const [lengthFt, setLengthFt] = useState<number | "">("");
  const [widthFt, setWidthFt] = useState<number | "">("");

  const gsmN = Number(gsm) || 0;
  const lengthN = Number(lengthFt) || 0;
  const widthN = Number(widthFt) || 0;

  const grams = useMemo(
    () => pieceWeightGFromGsm(lengthN, widthN, gsmN),
    [lengthN, widthN, gsmN]
  );
  const kg = useMemo(
    () => pieceWeightKgFromGsm(lengthN, widthN, gsmN),
    [lengthN, widthN, gsmN]
  );

  return (
    <section className="tt-panel p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
        {t("home.packetCalcKicker")}
      </p>
      <h2 className="tt-display mt-1 text-2xl text-[var(--brand-deep)] sm:text-3xl">
        {t("home.packetCalcTitle")}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {t("home.packetCalcHint")}
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="tt-label">{t("home.packetCalcGsm")}</span>
          <NumberField
            className="tt-input"
            emptyAs={null}
            min={0}
            placeholder="120"
            value={gsm}
            onValueChange={setGsm}
          />
        </label>
        <label className="block">
          <span className="tt-label">{t("home.packetCalcLength")}</span>
          <NumberField
            className="tt-input"
            emptyAs={null}
            min={0}
            step={0.01}
            placeholder="12"
            value={lengthFt}
            onValueChange={setLengthFt}
          />
        </label>
        <label className="block">
          <span className="tt-label">{t("home.packetCalcWidth")}</span>
          <NumberField
            className="tt-input"
            emptyAs={null}
            min={0}
            step={0.01}
            placeholder="18"
            value={widthFt}
            onValueChange={setWidthFt}
          />
        </label>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("home.packetCalcKg")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--brand-deep)]">
            {kg > 0 ? `${kg.toFixed(2)} kg` : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("home.packetCalcG")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--brand-deep)]">
            {grams > 0 ? `${grams.toFixed(2)} g` : "—"}
          </p>
        </div>
      </div>

      <p className="mt-4 text-xs text-[var(--ink-muted)]">
        {t("home.packetCalcFormula", { n: String(SQFT_TO_SQM) })}
      </p>
    </section>
  );
}
