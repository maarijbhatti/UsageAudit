"use client";
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Plug, ShieldCheck } from "lucide-react";
import { api, downloadReport } from "../lib/api";
import { Button } from "../components/ui/button";
import {
  ActionForm,
  Badge,
  Feedback,
  Field,
  Panel,
  Row,
  Table,
  text,
  useData,
} from "./shared";
const effective: Field[] = [
  {
    name: "effectiveFrom",
    label: "Effective from (UTC)",
    value: "2026-10-01T00:00:00Z",
  },
  {
    name: "effectiveTo",
    label: "Effective to (UTC, optional)",
    optional: true,
    placeholder: "2026-11-01T00:00:00Z",
  },
];
const withoutEmpty = (v: Record<string, string>) =>
  Object.fromEntries(Object.entries(v).filter(([, v]) => v !== ""));
export function ConfigurationPage({
  page,
  configure,
  writable,
}: {
  page: string;
  configure: boolean;
  writable: boolean;
}) {
  const customer = page === "customers",
    pricing = page === "pricing";
  const path = customer
    ? "customer-mappings"
    : pricing
      ? "pricing-rules"
      : "metric-mappings";
  const data = useData<Row[]>(path);
  const fields: Field[] = customer
    ? [
        {
          name: "sourceCustomerId",
          label: "Application customer ID",
          placeholder: "acme",
        },
        {
          name: "providerCustomerId",
          label: "Provider customer ID",
          placeholder: "cus_acme",
        },
        ...effective,
      ]
    : pricing
      ? [
          { name: "metricKey", label: "Metric key", placeholder: "requests" },
          {
            name: "providerPriceId",
            label: "Provider price ID",
            placeholder: "price_requests",
          },
          {
            name: "pricingModel",
            label: "Pricing model",
            options: [{ value: "FLAT_PER_UNIT", label: "Flat per unit" }],
          },
          { name: "currency", label: "Currency", value: "USD" },
          {
            name: "unitPrice",
            label: "Rate per unit (major currency units)",
            placeholder: "0.02",
          },
          {
            name: "customerMappingId",
            label: "Customer mapping ID (optional override)",
            optional: true,
          },
          ...effective,
        ]
      : [
          {
            name: "sourceMetricKey",
            label: "Application metric",
            placeholder: "requests",
          },
          {
            name: "providerMeterId",
            label: "Provider meter ID",
            placeholder: "meter_requests",
          },
          {
            name: "aggregationMethod",
            label: "Aggregation",
            options: [{ value: "SUM", label: "Sum of integer quantities" }],
          },
          ...effective,
        ];
  const cols = customer
    ? [
        { key: "sourceCustomerId", title: "Application customer" },
        { key: "providerCustomerId", title: "Provider customer" },
      ]
    : pricing
      ? [
          { key: "metricKey", title: "Metric" },
          { key: "providerPriceId", title: "Provider price" },
          { key: "unitPrice", title: "Unit rate" },
          { key: "currency", title: "Currency" },
          { key: "version", title: "Version" },
        ]
      : [
          { key: "sourceMetricKey", title: "Metric" },
          { key: "providerMeterId", title: "Provider meter" },
          { key: "aggregationMethod", title: "Aggregation" },
        ];
  return (
    <>
      {!customer && (
        <div className="tabs">
          <Link href="/metrics" className={!pricing ? "selected" : ""}>
            Metric mappings
          </Link>
          <Link href="/pricing" className={pricing ? "selected" : ""}>
            Pricing versions
          </Link>
        </div>
      )}
      <Feedback error={data.error?.message} />
      <Panel
        title={
          customer
            ? "Customer mappings"
            : pricing
              ? "Effective-dated pricing"
              : "Metric mappings"
        }
        subtitle="Overlapping mappings and price rules are rejected at the database level."
      >
        <Table
          rows={data.data ?? []}
          columns={[
            ...cols,
            { key: "effectiveFrom", title: "Effective from" },
            { key: "effectiveTo", title: "Effective to" },
          ]}
        />
      </Panel>
      {(customer ? writable : configure) && (
        <Panel
          title={pricing ? "Add a pricing version" : "Add a mapping"}
          subtitle={
            pricing
              ? "Existing pricing is preserved. End-date earlier versions when creating them so the next version has a non-overlapping period."
              : "Use the IDs recorded in your application and provider exports."
          }
        >
          <ActionForm
            fields={fields}
            onSubmit={(v) => api(path, withoutEmpty(v))}
            submit={pricing ? "Create pricing version" : "Save mapping"}
          />
        </Panel>
      )}
    </>
  );
}
export function FindingDetail({
  id,
  writable,
}: {
  id: string;
  writable: boolean;
}) {
  const q = useData<Row>(`findings/${id}`);
  if (q.error) return <Feedback error={q.error.message} />;
  if (!q.data) return <div className="skeleton" />;
  const f = q.data,
    e = (f.evidence_payload ?? {}) as Row,
    inputs = (f.inputs ?? {}) as Row;
  const transitions: Record<string, string[]> = {
    OPEN: ["INVESTIGATING", "CONFIRMED", "DISMISSED"],
    INVESTIGATING: ["OPEN", "CONFIRMED", "DISMISSED", "RESOLVED"],
    CONFIRMED: ["INVESTIGATING", "RESOLVED"],
    DISMISSED: ["OPEN"],
    RESOLVED: ["OPEN"],
  };
  return (
    <>
      <Link href="/findings" className="back-link">
        ← All findings
      </Link>
      <Panel
        title={String(f.finding_type).replaceAll("_", " ")}
        subtitle={`${f.customer_identifier} · ${f.metric_key}`}
        action={<Badge value={f.review_status} />}
      >
        <div className="panel-body">
          <p>{text(e.message)}</p>
          <Badge value={f.evidence_status} />
          <p className="muted">
            Potential financial variance requires investigation; it is not
            automatically confirmed revenue loss.
          </p>
        </div>
        <div className="detail-grid">
          {[
            ["Expected quantity", f.expected_quantity],
            ["Provider quantity", f.actual_quantity],
            ["Expected charge", f.expected_amount],
            ["Invoice charge", f.actual_amount],
            ["Variance", f.variance_amount],
            ["Currency", f.currency],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <span>{String(k)}</span>
              <strong>{text(v)}</strong>
            </div>
          ))}
        </div>
      </Panel>
      <Panel
        title="Calculation & supporting evidence"
        subtitle="Frozen source records, mappings, prices, and provider evidence used by this run"
      >
        <div className="panel-body">
          <p>
            <code>
              variance = expected usage charge − comparable invoice usage charge
            </code>
          </p>
          <p className="muted">
            Source evidence preview is limited to the first 100 events. The
            original import and full run input remain preserved.
          </p>
          {[
            "events",
            "pricing",
            "customerMappings",
            "metricMappings",
            "provider",
          ].map((k) => (
            <details key={k}>
              <summary>
                {k === "events"
                  ? "Source records"
                  : k === "provider"
                    ? "Provider records and limitations"
                    : k}
              </summary>
              <pre>{JSON.stringify(inputs[k], null, 2)}</pre>
            </details>
          ))}
        </div>
      </Panel>
      {writable && (
        <Panel
          title="Review this finding"
          subtitle="Every review appends a timestamped history entry."
        >
          <ActionForm
            key={String(f.review_status)}
            fields={[
              {
                name: "newStatus",
                label: "New review status",
                options: (transitions[String(f.review_status)] ?? [])
                  .filter(
                    (s) =>
                      s !== "CONFIRMED" || f.evidence_status === "COMPLETE",
                  )
                  .map((v) => ({ value: v, label: v })),
              },
              {
                name: "comment",
                label: "Investigation note",
                placeholder: "What did you check or learn?",
              },
            ]}
            onSubmit={(v) => api(`findings/${id}/reviews`, v)}
            submit="Save review"
          />
        </Panel>
      )}
      <Panel title="Review history">
        <Table
          rows={(f.reviews ?? []) as Row[]}
          columns={[
            { key: "reviewer", title: "Reviewer" },
            { key: "previous_status", title: "From" },
            { key: "new_status", title: "To" },
            { key: "comment", title: "Comment" },
            { key: "created_at", title: "Recorded" },
          ]}
        />
      </Panel>
    </>
  );
}
export function ReportsPage() {
  const q = useData<Row[]>("reports", true),
    [error, setError] = useState("");
  return (
    <Panel
      title="Audit reports"
      subtitle="Generate a report from a completed reconciliation. Downloads require organization membership."
    >
      <Feedback error={error || q.error?.message} />
      <Table
        rows={q.data ?? []}
        columns={[
          { key: "reconciliation_run_id", title: "Reconciliation" },
          { key: "status", title: "Status" },
          { key: "created_at", title: "Requested" },
        ]}
        actions={(r) =>
          r.status === "COMPLETED" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await downloadReport(r.id);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Download size={15} />
              Download CSV
            </Button>
          ) : null
        }
      />
    </Panel>
  );
}
export function ConnectionsPage({ configure }: { configure: boolean }) {
  const q = useData<Row[]>("connections", true),
    client = useQueryClient(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const action = async (id: string, type: string) => {
    try {
      setError("");
      await api(
        `connections/${id}${type === "revoke" ? "" : "/" + type}`,
        type === "revoke" ? undefined : {},
        type === "revoke" ? "DELETE" : "POST",
      );
      setMessage(
        type === "test" ? "Connection verified." : "Connection revoked.",
      );
      await client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="overview-banner">
        <div className="banner-icon">
          <ShieldCheck />
        </div>
        <div>
          <strong>Read-only by design</strong>
          <p>
            UsageAudit reads billing data. Stripe aggregation is asynchronous;
            raw event delivery history is not available through meter summaries.
          </p>
        </div>
      </div>
      <Feedback error={error || q.error?.message} message={message} />
      <Panel
        title="Billing connections"
        subtitle="Restricted credentials are encrypted on the server."
      >
        <Table
          rows={q.data ?? []}
          columns={[
            { key: "display_name", title: "Connection" },
            { key: "provider", title: "Provider" },
            { key: "environment", title: "Environment" },
            { key: "status", title: "Health" },
            { key: "last_synced_at", title: "Last sync" },
          ]}
          actions={(r) =>
            configure && r.provider === "STRIPE" ? (
              <div className="row-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void action(r.id, "test")}
                >
                  Test
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(r.id)}
                >
                  Manage
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Revoke this connection? Stored audit evidence will remain.",
                      )
                    )
                      void action(r.id, "revoke");
                  }}
                >
                  Revoke
                </Button>
              </div>
            ) : null
          }
        />
      </Panel>
      {configure && (
        <Panel
          title="Connect Stripe"
          subtitle="Create a restricted key with read permissions for Customers, Billing Meters, Invoices, and Prices. The key must have no write permissions."
        >
          <ActionForm
            fields={[
              {
                name: "displayName",
                label: "Connection name",
                placeholder: "Stripe production",
              },
              {
                name: "secretKey",
                label: "Restricted API key",
                type: "password",
                placeholder: "rk_test_…",
              },
            ]}
            onSubmit={(v) => api("connections/stripe", v)}
            submit="Verify & connect"
          />
        </Panel>
      )}
      {configure && selected && (
        <>
          <Panel
            title="Synchronize billing data"
            subtitle="Only mapped customers and meters are requested. Jobs are visible in Settings."
          >
            <ActionForm
              fields={[
                {
                  name: "periodStart",
                  label: "Period start (UTC)",
                  value: "2026-10-01T00:00:00Z",
                },
                {
                  name: "periodEnd",
                  label: "Period end (UTC)",
                  value: "2026-11-01T00:00:00Z",
                },
              ]}
              onSubmit={(v) => api(`connections/${selected}/sync`, v)}
              submit="Queue synchronization"
            />
          </Panel>
          <Panel title="Rotate credentials">
            <ActionForm
              fields={[
                {
                  name: "displayName",
                  label: "Connection name",
                  value: "Stripe",
                },
                {
                  name: "secretKey",
                  label: "New restricted key",
                  type: "password",
                },
              ]}
              onSubmit={(v) => api(`connections/${selected}/rotate`, v)}
              submit="Verify & rotate"
            />
          </Panel>
        </>
      )}
      <Panel
        title="Working without Stripe?"
        subtitle="Use CSV exports to complete the same audit workflow."
      >
        <div className="panel-body">
          <Button asChild variant="outline">
            <Link href="/imports">
              <Plug size={16} />
              Import billing data
            </Link>
          </Button>
        </div>
      </Panel>
    </>
  );
}
export function SettingsPage({
  section,
  org,
  orgName,
  owner,
  configure,
  writable,
}: {
  section: string;
  org: string;
  orgName: string;
  owner: boolean;
  configure: boolean;
  writable: boolean;
}) {
  const members = useData<Row[]>(`organizations/${org}/members`),
    jobs = useData<Row[]>("jobs", true),
    logs = useData<Row[]>("audit-logs"),
    schedules = useData<Row[]>("schedules", true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const client = useQueryClient();
  if (section === "members")
    return (
      <>
        <Feedback error={error || members.error?.message} />
        <Panel title="Workspace members">
          <Table
            rows={members.data ?? []}
            columns={[
              { key: "display_name", title: "Name" },
              { key: "email", title: "Email" },
              { key: "role", title: "Role" },
            ]}
            actions={(member) =>
              configure &&
              member.role !== "OWNER" &&
              (owner || member.role !== "ADMIN") ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Remove ${String(member.email)} from this workspace?`,
                      )
                    )
                      return;
                    setPending(true);
                    setError("");
                    try {
                      await api(
                        `organizations/${org}/members/${member.id}`,
                        undefined,
                        "DELETE",
                      );
                      await client.invalidateQueries();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  Remove
                </Button>
              ) : null
            }
          />
        </Panel>
        {configure && (
          <Panel
            title="Add a registered team member"
            subtitle="The user must create an account first. Email invitations are not sent by this MVP."
          >
            <ActionForm
              fields={[
                { name: "email", label: "Account email", type: "email" },
                {
                  name: "role",
                  label: "Role",
                  options: (owner
                    ? ["ANALYST", "VIEWER", "ADMIN"]
                    : ["ANALYST", "VIEWER"]
                  ).map((v) => ({
                    value: v,
                    label: v,
                  })),
                },
              ]}
              onSubmit={(v) => api(`organizations/${org}/invitations`, v)}
              submit="Add member"
            />
          </Panel>
        )}
      </>
    );
  if (section === "organization")
    return (
      <>
        <Feedback error={error || logs.error?.message} />
        {configure && (
          <Panel title="Workspace name">
            <ActionForm
              fields={[
                { name: "name", label: "Organization name", value: orgName },
              ]}
              onSubmit={async (values) => {
                await api(`organizations/${org}/settings`, values);
                window.location.reload();
              }}
              submit="Save workspace name"
            />
          </Panel>
        )}
        <Panel
          title="Workspace audit trail"
          subtitle="Append-only actions for this organization"
        >
          <Table
            rows={logs.data ?? []}
            columns={[
              { key: "action", title: "Action" },
              { key: "resource_type", title: "Resource" },
              { key: "created_at", title: "Time" },
            ]}
          />
        </Panel>
        <Panel title="Another workspace">
          <div className="panel-body">
            <p>
              Organizations keep their usage, configuration, and financial
              evidence separate.
            </p>
            <Button asChild variant="outline">
              <Link href="/onboarding">Create organization</Link>
            </Button>
          </div>
        </Panel>
        {owner && (
          <Panel
            title="Close workspace"
            subtitle="Revoke workspace access, disable schedules, and revoke billing connections. Audit evidence is retained."
          >
            <div className="panel-body">
              <Button
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Close ${orgName}? All members will lose access. This cannot be undone from the application.`,
                    )
                  )
                    return;
                  setPending(true);
                  setError("");
                  try {
                    await api(`organizations/${org}`, undefined, "DELETE");
                    localStorage.removeItem("usageaudit.organization");
                    window.location.assign("/dashboard");
                  } catch (e) {
                    setError((e as Error).message);
                    setPending(false);
                  }
                }}
              >
                Close workspace
              </Button>
            </div>
          </Panel>
        )}
      </>
    );
  return (
    <>
      <Feedback error={error} />
      <Panel
        title="Background operations"
        subtitle="Failed jobs retain their source evidence and can be retried."
      >
        <Table
          rows={jobs.data ?? []}
          columns={[
            { key: "kind", title: "Operation" },
            { key: "status", title: "Status" },
            { key: "attempts", title: "Attempts" },
            { key: "error", title: "Last error" },
          ]}
          actions={(r) =>
            writable && r.status === "FAILED" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api("jobs/retry", { jobId: r.id });
                    await client.invalidateQueries();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Retry
              </Button>
            ) : null
          }
        />
      </Panel>
      <Panel
        title="Scheduled audits"
        subtitle="Daily UTC reruns use explicitly pinned source and provider snapshots. Create a new schedule when selecting new evidence."
      >
        <Table
          rows={schedules.data ?? []}
          columns={[
            { key: "period_start", title: "Period start" },
            { key: "period_end", title: "Period end" },
            { key: "next_run_at", title: "Next run" },
            { key: "enabled", title: "Enabled" },
          ]}
          actions={(r) =>
            configure ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api(`schedules/${r.id}`, { enabled: !r.enabled });
                    await client.invalidateQueries();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {r.enabled ? "Disable" : "Enable"}
              </Button>
            ) : null
          }
        />
      </Panel>
      {configure && (
        <Panel
          title="Schedule a daily audit"
          subtitle="Enter the explicit import and snapshot IDs from your audit workflow."
        >
          <ActionForm
            fields={[
              { name: "sourceImportBatchId", label: "Source import ID" },
              { name: "providerSnapshotId", label: "Provider snapshot ID" },
              {
                name: "periodStart",
                label: "Period start (UTC)",
                value: "2026-10-01T00:00:00Z",
              },
              {
                name: "periodEnd",
                label: "Period end (UTC)",
                value: "2026-11-01T00:00:00Z",
              },
              {
                name: "nextRunAt",
                label: "First run (UTC)",
                placeholder: "2026-11-08T06:00:00Z",
              },
            ]}
            onSubmit={(v) =>
              api("schedules", { ...v, requestKey: crypto.randomUUID() })
            }
            submit="Create schedule"
          />
        </Panel>
      )}
      <Panel title="Session security">
        <div className="panel-body">
          <p>
            Sessions use HttpOnly cookies, short-lived access, rotating refresh
            tokens, and server-side revocation. Mutations require CSRF
            validation and organization permissions.
          </p>
        </div>
      </Panel>
    </>
  );
}
