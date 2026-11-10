"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, FileUp, Play, ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import {
  ActionForm,
  Badge,
  DataTable,
  Feedback,
  List,
  Panel,
  Row,
  Table,
  text,
  useData,
} from "./shared";
const columns = [
  { key: "original_filename", title: "File" },
  { key: "import_type", title: "Type" },
  { key: "status", title: "Status" },
  { key: "accepted_rows", title: "Accepted" },
  { key: "duplicate_rows", title: "Duplicates" },
  { key: "rejected_rows", title: "Rejected" },
  { key: "created_at", title: "Uploaded" },
];
const fields: Record<string, string[]> = {
  APPLICATION_USAGE: [
    "eventId",
    "sourceCustomerId",
    "metricKey",
    "quantity",
    "unit",
    "occurredAt",
    "billable",
  ],
  BILLING_USAGE: [
    "providerCustomerId",
    "providerMeterId",
    "periodStart",
    "periodEnd",
    "quantity",
  ],
  INVOICE_LINES: [
    "id",
    "invoiceId",
    "providerCustomerId",
    "providerPriceId",
    "periodStart",
    "periodEnd",
    "quantity",
    "amountMinorUnits",
    "currency",
    "componentType",
    "invoiceStatus",
  ],
};
export function ImportsPage({ writable }: { writable: boolean }) {
  const [type, setType] = useState("APPLICATION_USAGE"),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [batch, setBatch] = useState<Row | null>(null),
    [preview, setPreview] = useState<{
      headers: string[];
      sample: Record<string, string>[];
    } | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const router = useRouter(),
    client = useQueryClient();
  const imports = useData<List>("imports?pageSize=100", true);
  const options = (type: string) =>
    (imports.data?.items ?? [])
      .filter((r) => r.import_type === type && r.status === "COMPLETED")
      .map((r) => ({
        value: r.id,
        label: String(r.original_filename) + " · " + r.id.slice(0, 8),
      }));
  return (
    <>
      {writable && (
        <Panel
          title="Import your data"
          subtitle="CSV files up to 32 MiB · up to 200,000 rows"
        >
          <div className="steps">
            {["Choose file", "Preview & map", "Process & validate"].map(
              (s, i) => (
                <span
                  className={(batch ? i <= 1 : i === 0) ? "current" : ""}
                  key={s}
                >
                  <b>{i + 1}</b>
                  {s}
                  {i < 2 && <ChevronRight size={14} />}
                </span>
              ),
            )}
          </div>
          <div className="wizard-body">
            {!batch ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!file) return;
                  setBusy(true);
                  setError("");
                  try {
                    const form = new FormData();
                    form.set("importType", type);
                    form.set("file", file);
                    const b = await api<Row>("imports", form);
                    const p = await api<{
                      headers: string[];
                      sample: Record<string, string>[];
                    }>(`imports/${b.id}/preview`);
                    setMapping(
                      Object.fromEntries(
                        fields[type]!.map((f) => [
                          f,
                          p.headers.includes(f) ? f : "",
                        ]),
                      ),
                    );
                    setBatch(b);
                    setPreview(p);
                    await client.invalidateQueries();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Import type
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="APPLICATION_USAGE">Application usage</option>
                    <option value="BILLING_USAGE">
                      Provider usage summaries
                    </option>
                    <option value="INVOICE_LINES">Invoice usage lines</option>
                  </select>
                </label>
                <label className="upload-zone">
                  <FileUp size={32} />
                  <strong>{file?.name ?? "Choose a CSV file"}</strong>
                  <span>
                    Original records are preserved as immutable audit evidence.
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    aria-label="CSV file"
                    required
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <details>
                  <summary>Required columns</summary>
                  <code>{fields[type]!.join(", ")}</code>
                  <p className="muted">
                    Timestamps must use UTC ISO 8601. Usage quantities are
                    nonnegative integers. Invoice amounts use integer minor
                    units. Use true or false for billable.
                  </p>
                </details>
                <Button disabled={busy || !file}>
                  {busy ? "Uploading…" : "Upload & preview"}
                  <ArrowRight size={15} />
                </Button>
              </form>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api(`imports/${batch.id}/confirm`, {
                      columnMapping: mapping,
                    });
                    router.push(`/imports/${batch.id}`);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <p className="muted">
                  Map each expected field to a CSV column. Full row validation
                  runs in the worker after confirmation.
                </p>
                <div className="form-grid">
                  {fields[type]!.map((f) => (
                    <label key={f}>
                      {f}
                      <select
                        required
                        value={mapping[f] ?? ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [f]: e.target.value })
                        }
                      >
                        <option value="">Choose column</option>
                        {preview?.headers.map((h) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <h3>First five records</h3>
                <Table
                  rows={(preview?.sample ?? []).map((r, i) => ({
                    ...r,
                    id: String(i),
                  }))}
                  columns={(preview?.headers ?? []).map((k) => ({
                    key: k,
                    title: k,
                  }))}
                />
                <Button disabled={busy}>
                  {busy ? "Starting…" : "Confirm import"}
                  <Check size={15} />
                </Button>
              </form>
            )}
            <Feedback error={error} />
          </div>
        </Panel>
      )}
      <Panel
        title="Import history"
        subtitle="Accepted, rejected, and deduplicated source records"
      >
        <DataTable path="imports" columns={columns} link="/imports" />
      </Panel>
      {writable && (
        <Panel
          title="Create a provider snapshot"
          subtitle="Pair a provider usage export with its invoice lines. Missing or rejected evidence stays visible."
        >
          {options("BILLING_USAGE").length &&
          options("INVOICE_LINES").length ? (
            <ActionForm
              key={
                options("BILLING_USAGE")
                  .map((x) => x.value)
                  .join() +
                options("INVOICE_LINES")
                  .map((x) => x.value)
                  .join()
              }
              fields={[
                {
                  name: "usageImportId",
                  label: "Provider usage import",
                  options: options("BILLING_USAGE"),
                },
                {
                  name: "invoiceImportId",
                  label: "Invoice line import",
                  options: options("INVOICE_LINES"),
                },
              ]}
              onSubmit={(v) => api("provider-snapshots", v)}
              submit="Create snapshot"
            />
          ) : (
            <div className="empty">
              <p>
                Complete both a provider usage import and an invoice line import
                to create a snapshot.
              </p>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
export function ImportDetail({
  id,
  writable,
}: {
  id: string;
  writable: boolean;
}) {
  const batch = useData<Row>(`imports/${id}`, true),
    errors = useData<{ items: Row[] }>(`imports/${id}/errors`, true);
  const [error, setError] = useState("");
  if (batch.error) return <Feedback error={batch.error.message} />;
  if (!batch.data) return <div className="skeleton" />;
  const b = batch.data;
  return (
    <>
      <Link className="back-link" href="/imports">
        ← All imports
      </Link>
      <Panel
        title={String(b.original_filename)}
        subtitle={String(b.import_type)}
        action={<Badge value={b.status} />}
      >
        <div className="detail-grid">
          {[
            "total_rows",
            "accepted_rows",
            "duplicate_rows",
            "rejected_rows",
          ].map((key) => (
            <div key={key}>
              <span>{key.replaceAll("_", " ")}</span>
              <strong>{text(b[key])}</strong>
            </div>
          ))}
        </div>
        <div className="panel-body">
          <p className="muted">
            Identical event IDs are counted once per organization. Conflicting
            duplicate records are rejected. Original CSV and row evidence remain
            available.
          </p>
          {b.status === "FAILED" && (
            <Feedback error={String(b.failure_reason)} />
          )}
          <Feedback error={error} />
          {b.status === "UPLOADED" && writable && (
            <Button
              onClick={async () => {
                try {
                  await api(`imports/${id}/confirm`, { columnMapping: {} });
                  await batch.refetch();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Confirm with original headers
            </Button>
          )}
          {b.status === "COMPLETED" && (
            <Button asChild variant="outline">
              <Link href="/reconciliations">
                Continue to reconciliation
                <ArrowRight size={15} />
              </Link>
            </Button>
          )}
        </div>
      </Panel>
      <Panel
        title="Validation results"
        subtitle="First 25 rejected or duplicate records"
      >
        <Table
          rows={(errors.data?.items ?? []).map((r) => ({
            ...r,
            id: String(r.row_number),
          }))}
          columns={[
            { key: "row_number", title: "Row" },
            { key: "validation_status", title: "Result" },
            { key: "validation_errors", title: "Details" },
            { key: "raw_payload", title: "Original record" },
          ]}
        />
      </Panel>
    </>
  );
}
export function ReconciliationsPage({ writable }: { writable: boolean }) {
  const source = useData<List>("imports?pageSize=100", true),
    snapshots = useData<Row[]>("provider-snapshots", true);
  const router = useRouter();
  const [ready, setReady] = useState<{
      ready: boolean;
      warnings: string[];
      componentCount: number;
    } | null>(null),
    [values, setValues] = useState<Record<string, string> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sources =
    source.data?.items
      .filter(
        (i) =>
          i.import_type === "APPLICATION_USAGE" && i.status === "COMPLETED",
      )
      .map((i) => ({
        value: i.id,
        label: String(i.original_filename) + " · " + i.id.slice(0, 8),
      })) ?? [];
  return (
    <>
      {writable && (
        <Panel
          title="Run a billing audit"
          subtitle="Choose an explicit UTC billing period and immutable source snapshots."
        >
          {sources.length && snapshots.data?.length ? (
            <>
              <ActionForm
                key={
                  sources.map((s) => s.value).join() +
                  snapshots.data.map((s) => s.id).join()
                }
                fields={[
                  {
                    name: "periodStart",
                    label: "Period start (UTC, inclusive)",
                    value: "2026-10-01T00:00:00Z",
                  },
                  {
                    name: "periodEnd",
                    label: "Period end (UTC, exclusive)",
                    value: "2026-11-01T00:00:00Z",
                  },
                  {
                    name: "sourceImportBatchId",
                    label: "Application usage import",
                    options: sources,
                  },
                  {
                    name: "providerSnapshotId",
                    label: "Provider snapshot",
                    options: snapshots.data.map((s) => ({
                      value: s.id,
                      label:
                        String(s.snapshot_type) +
                        " · " +
                        s.id.slice(0, 8) +
                        " · " +
                        s.status,
                    })),
                  },
                ]}
                onSubmit={async (v) => {
                  const request = { ...v, requestKey: crypto.randomUUID() };
                  const r = await api<{
                    ready: boolean;
                    warnings: string[];
                    componentCount: number;
                  }>("reconciliation-runs/readiness", request);
                  setValues(request);
                  setReady(r);
                  return r;
                }}
                submit="Check audit readiness"
              />
              {ready && (
                <div className="readiness">
                  <h3>{ready.componentCount} source components found</h3>
                  {ready.warnings.length ? (
                    <ul>
                      {ready.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      <Check size={17} /> Mappings and pricing are available for
                      the source components.
                    </p>
                  )}
                  <p className="muted">
                    Warnings remain part of the audit. Missing data is never
                    assumed to be zero.
                  </p>
                  <Feedback error={error} />
                  <Button
                    disabled={!ready.ready || busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const run = await api<{ id: string }>(
                          "reconciliation-runs",
                          values,
                        );
                        router.push(`/reconciliations/${run.id}`);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <Play size={15} />
                    {busy ? "Starting…" : "Start reconciliation"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              <p>
                Complete an application usage import and create a provider
                snapshot first.
              </p>
              <Button asChild variant="outline">
                <Link href="/imports">
                  Go to imports
                  <ArrowRight size={15} />
                </Link>
              </Button>
            </div>
          )}
        </Panel>
      )}
      <Panel
        title="Audit history"
        subtitle="Reproducible results, preserved across runs"
      >
        <DataTable
          path="reconciliation-runs"
          columns={[
            { key: "period_start", title: "Period start" },
            { key: "period_end", title: "Period end" },
            { key: "status", title: "Status" },
            { key: "created_at", title: "Created" },
          ]}
          link="/reconciliations"
        />
      </Panel>
    </>
  );
}
export function RunDetail({ id }: { id: string }) {
  const q = useData<Row>(`reconciliation-runs/${id}`, true);
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  if (q.error) return <Feedback error={q.error.message} />;
  if (!q.data) return <div className="skeleton" />;
  const r = q.data,
    results = (r.result_summary ?? []) as Row[];
  return (
    <>
      <Link href="/reconciliations" className="back-link">
        ← All reconciliations
      </Link>
      <Panel
        title="Reconciliation results"
        subtitle={`${String(r.period_start)} → ${String(r.period_end)}`}
        action={<Badge value={r.status} />}
      >
        <div className="panel-body">
          <p className="muted">
            Algorithm {text(r.algorithm_version)} · All financial amounts use
            exact decimal arithmetic. Positive variance means potential
            underbilling.
          </p>
          {r.status === "FAILED" && <Feedback error={text(r.failure_reason)} />}
          <Feedback error={error} message={message} />
          {r.status === "COMPLETED" && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await api("reports", { reconciliationRunId: id });
                  setMessage(
                    "Report queued. Open Audit reports to download it.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Generate CSV report
            </Button>
          )}
        </div>
        <Table
          rows={results.map((v, i) => ({ ...v, id: String(i) }))}
          columns={[
            { key: "customerId", title: "Customer" },
            { key: "metricKey", title: "Metric" },
            { key: "expectedQuantity", title: "Source quantity" },
            { key: "providerQuantity", title: "Provider quantity" },
            { key: "expectedAmount", title: "Expected charge" },
            { key: "actualAmount", title: "Invoice charge" },
            { key: "varianceAmount", title: "Variance" },
            { key: "currency", title: "Currency" },
            { key: "evidenceStatus", title: "Evidence" },
          ]}
        />
      </Panel>
      <Panel
        title="Findings"
        subtitle="Investigate the underlying evidence and record your review"
      >
        <DataTable
          path={`reconciliation-runs/${id}/findings`}
          columns={[
            { key: "customer_identifier", title: "Customer" },
            { key: "metric_key", title: "Metric" },
            { key: "finding_type", title: "Type" },
            { key: "evidence_status", title: "Evidence" },
            { key: "review_status", title: "Review" },
          ]}
          link="/findings"
        />
      </Panel>
    </>
  );
}
