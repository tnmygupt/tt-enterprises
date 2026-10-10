"use client";

import { FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import { slugifyCategory } from "@/lib/categories";
import { autoFillOne } from "@/lib/translate-client";
import {
  deleteCategory,
  checkCapability,
  upsertCategory,
} from "@/lib/store/db";
import type { CategoryDef } from "@/lib/types";

export default function AdminCategoriesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [nameEn, setNameEn] = useState("");
  const [nameHi, setNameHi] = useState("");
  const [editing, setEditing] = useState<CategoryDef | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!session || !checkCapability(session, db, "manage_products")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db) {
    return (
      <AdminShell>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const en = nameEn.trim();
    if (!en) {
      setError(locale === "hi" ? "अंग्रेज़ी नाम जरूरी है" : "English name required");
      return;
    }
    setBusy(true);
    try {
      let id = slugifyCategory(en);
      if (db.categories.some((c) => c.id === id)) {
        id = `${id}_${Date.now().toString(36).slice(-4)}`;
      }
      const name = await autoFillOne({ en, hi: nameHi.trim() });
      upsertCategory({
        id,
        name,
        active: true,
      });
      setNameEn("");
      setNameHi("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const name = await autoFillOne({
        en: editing.name.en.trim(),
        hi: editing.name.hi.trim(),
      });
      upsertCategory({
        ...editing,
        name,
      });
      setEditing(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title={t("admin.categories")}
        hint={t("admin.categoriesHint")}
      />

      <form
        onSubmit={onCreate}
        className="mt-6 max-w-xl space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5"
      >
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {locale === "hi" ? "नई कैटेगरी" : "New category"}
        </p>
        <div>
          <label className="tt-label">Name (EN) *</label>
          <input
            className="tt-input"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            placeholder="e.g. Rope"
            required
          />
        </div>
        <div>
          <label className="tt-label">Name (HI)</label>
          <input
            className="tt-input"
            value={nameHi}
            onChange={(e) => setNameHi(e.target.value)}
            placeholder="जैसे रस्सी"
          />
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <button type="submit" className="tt-btn tt-btn-dark" disabled={busy}>
          {busy
            ? locale === "hi"
              ? "अनुवाद व सेव…"
              : "Translating & saving…"
            : locale === "hi"
              ? "कैटेगरी बनाएँ"
              : "Create category"}
        </button>
      </form>

      <TableWrap className="tt-panel mt-8">
        <table className="tt-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>EN</th>
              <th>HI</th>
              <th>{t("common.status")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {db.categories.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.id}</td>
                <td>{c.name.en}</td>
                <td>{c.name.hi}</td>
                <td>{c.active ? "Active" : "Off"}</td>
                <td className="space-x-2">
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--brand)]"
                    onClick={() => setEditing({ ...c })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-sm text-[var(--danger)]"
                    onClick={() => {
                      try {
                        if (
                          confirm(
                            locale === "hi"
                              ? "यह कैटेगरी हटाएँ?"
                              : "Delete this category?"
                          )
                        ) {
                          deleteCategory(c.id);
                          refresh();
                        }
                      } catch (err) {
                        alert(
                          err instanceof Error
                            ? err.message
                            : "Cannot delete — used by products"
                        );
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!db.categories.length ? (
          <EmptyState message={t("common.empty")} />
        ) : null}
      </TableWrap>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={onSaveEdit}
            className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5"
          >
            <h2 className="text-lg font-semibold">Edit · {editing.id}</h2>
            <div>
              <label className="tt-label">Name EN</label>
              <input
                className="tt-input"
                value={editing.name.en}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    name: { ...editing.name, en: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <label className="tt-label">Name HI</label>
              <input
                className="tt-input"
                value={editing.name.hi}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    name: { ...editing.name, hi: e.target.value },
                  })
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) =>
                  setEditing({ ...editing, active: e.target.checked })
                }
              />
              Active
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="tt-btn tt-btn-dark" disabled={busy}>
                {busy
                  ? locale === "hi"
                    ? "अनुवाद व सेव…"
                    : "Translating & saving…"
                  : t("common.save")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AdminShell>
  );
}
