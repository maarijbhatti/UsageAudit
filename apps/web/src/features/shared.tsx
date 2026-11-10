"use client";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { ArrowUpRight, Inbox, RefreshCw } from "lucide-react";
import { api, selectedOrg } from "../lib/api";
import { Button } from "../components/ui/button";
export type Row = { id: string; [key: string]: unknown };
export interface List {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}
export function useData<T>(path: string, poll = false) {
  return useQuery<T>({
    queryKey: [selectedOrg(), path],
    queryFn: () => api<T>(path),
    refetchInterval: poll ? 2000 : false,
  });
}
export const label = (v: string) =>
  v
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
export const text = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
export const money = (v: unknown, currency = "USD") =>
  v === null || v === undefined
    ? "—"
    : currency +
      " " +
      String(v)
        .replace(/(\.\d{2,}?)0+$/, "$1")
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function Badge({ value }: { value: unknown }) {
  const s = String(value ?? "UNKNOWN");
  return (
    <span className={"badge badge-" + s.toLowerCase()}>
      <i />
      {label(s)}
    </span>
  );
}
export function Empty({
  message = "No records yet. Your results will appear here.",
}: {
  message?: string;
}) {
  return (
    <div className="empty">
      <Inbox size={28} />
      <p>{message}</p>
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Table({
  rows,
  columns,
  link,
  actions,
}: {
  rows: Row[];
  columns: { key: string; title: string }[];
  link?: string;
  actions?: (r: Row) => React.ReactNode;
}) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.title}</th>
            ))}
            {(link || actions) && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id ?? JSON.stringify(r)}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.key.includes("status") || c.key === "severity" ? (
                    <Badge value={r[c.key]} />
                  ) : c.key.endsWith("_at") ? (
                    new Date(String(r[c.key])).toLocaleString()
                  ) : (
                    text(r[c.key])
                  )}
                </td>
              ))}
              {(link || actions) && (
                <td>
                  {actions?.(r)}
                  {link && (
                    <Link
                      className="table-link"
                      href={`${link}/${r.id}`}
                      aria-label={`Open ${r.id}`}
                    >
                      <ArrowUpRight size={17} />
                    </Link>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
export function Feedback({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  return (
    <>
      {error && (
        <div role="alert" className="notice notice-error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="notice notice-success">
          {message}
        </div>
      )}
    </>
  );
}
export interface Field {
  name: string;
  label: string;
  type?: string;
  value?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
}
export function ActionForm({
  fields,
  onSubmit,
  submit = "Save",
  onSuccess,
}: {
  fields: Field[];
  onSubmit: (v: Record<string, string>) => Promise<unknown>;
  submit?: string;
  onSuccess?: (result: unknown) => void;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const client = useQueryClient();
  const form = useForm<Record<string, string>>({
    resolver: zodResolver(z.record(z.string(), z.string())),
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, f.value ?? f.options?.[0]?.value ?? ""]),
    ),
  });
  return (
    <form
      className="action-form"
      onSubmit={form.handleSubmit(async (values) => {
        setError("");
        setMessage("");
        try {
          const result = await onSubmit(values);
          setMessage("Saved successfully.");
          await client.invalidateQueries();
          onSuccess?.(result);
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.name}>
            {f.label}
            {f.options ? (
              <select {...form.register(f.name)} required={!f.optional}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...form.register(f.name)}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                required={!f.optional}
              />
            )}
          </label>
        ))}
      </div>
      <Feedback error={error} message={message} />
      <Button disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Working…" : submit}
      </Button>
    </form>
  );
}
export function DataTable({
  path,
  columns,
  link,
}: {
  path: string;
  columns: { key: string; title: string }[];
  link?: string;
}) {
  const [page, setPage] = useState(1);
  const q = useData<List>(
    `${path}${path.includes("?") ? "&" : "?"}page=${page}&pageSize=20`,
    true,
  );
  if (q.isPending) return <div className="skeleton" />;
  if (q.error) return <Feedback error={q.error.message} />;
  return (
    <>
      <Table rows={q.data!.items} columns={columns} link={link} />
      <div className="pagination">
        <span>{q.data!.total ?? q.data!.items.length} records</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={q.data!.items.length < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
        <button aria-label="Refresh records" onClick={() => void q.refetch()}>
          <RefreshCw size={15} />
        </button>
      </div>
    </>
  );
}
