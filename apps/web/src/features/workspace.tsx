"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  ChevronRight,
  FileBarChart2,
  FileInput,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { api, selectedOrg } from "../lib/api";
import { Button } from "../components/ui/button";
import {
  Badge,
  DataTable,
  Empty,
  Feedback,
  Panel,
  Row,
  Table,
  money,
  useData,
} from "./shared";
import {
  ImportsPage,
  ImportDetail,
  ReconciliationsPage,
  RunDetail,
} from "./workflows";
import {
  ConfigurationPage,
  ConnectionsPage,
  FindingDetail,
  ReportsPage,
  SettingsPage,
} from "./management";
const navigation = [
  {
    group: "WORKSPACE",
    items: [{ path: "dashboard", name: "Overview", icon: LayoutDashboard }],
  },
  {
    group: "BILLING OPERATIONS",
    items: [
      { path: "connections", name: "Connections", icon: Plug },
      { path: "imports", name: "Imports", icon: FileInput },
      { path: "customers", name: "Customers", icon: Users },
      { path: "metrics", name: "Metrics & pricing", icon: SlidersHorizontal },
      { path: "reconciliations", name: "Reconciliations", icon: Activity },
      { path: "findings", name: "Findings", icon: Search },
    ],
  },
  {
    group: "REPORTING",
    items: [{ path: "reports", name: "Audit reports", icon: FileBarChart2 }],
  },
  {
    group: "ADMINISTRATION",
    items: [
      { path: "settings/organization", name: "Organization", icon: Building2 },
      { path: "settings/members", name: "Members", icon: Users },
      { path: "settings/security", name: "Settings", icon: Settings },
    ],
  },
];
const descriptions: Record<string, [string, string]> = {
  dashboard: ["Overview", "A clear view of your usage and billing accuracy."],
  connections: [
    "Connections",
    "Bring your billing evidence into one workspace.",
  ],
  imports: [
    "Data imports",
    "Preserve your source records. Build a reliable audit trail.",
  ],
  customers: [
    "Customer mappings",
    "Connect application identities to billing customers.",
  ],
  metrics: ["Metrics & pricing", "Define how usage becomes a billable charge."],
  pricing: [
    "Pricing rules",
    "Versioned rates, applied to the right billing period.",
  ],
  reconciliations: [
    "Reconciliations",
    "Compare source usage, provider summaries, and invoice charges.",
  ],
  findings: ["Findings", "Follow the evidence. Resolve billing discrepancies."],
  reports: ["Audit reports", "Share reproducible results with your team."],
  settings: [
    "Organization settings",
    "Manage your workspace, access, and operations.",
  ],
};
export function Workspace({ route }: { route: string[] }) {
  const router = useRouter(),
    client = useQueryClient();
  const [org, setOrg] = useState(""),
    [open, setOpen] = useState(false),
    [ready, setReady] = useState(false);
  const [user, setUser] = useState<{
      displayName: string;
      email: string;
    } | null>(null),
    [orgs, setOrgs] = useState<Row[]>([]),
    [error, setError] = useState("");
  const page = route[0] ?? "dashboard";
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await api<{ displayName: string; email: string }>("auth/me"),
          organizations = await api<Row[]>("organizations");
        if (cancelled) return;
        if (!organizations.length) {
          router.replace("/onboarding");
          return;
        }
        const id = organizations.some((o) => o.id === selectedOrg())
          ? selectedOrg()
          : organizations[0]!.id;
        localStorage.setItem("usageaudit.organization", id);
        setOrg(id);
        setOrgs(organizations);
        setUser(me);
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
        router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);
  const active = orgs.find((o) => o.id === org);
  const [title, description] = descriptions[page] ?? [
    "Page not found",
    "Choose a section from the sidebar.",
  ];
  const writable = active?.role !== "VIEWER",
    configure = ["OWNER", "ADMIN"].includes(String(active?.role));
  return (
    <div className="workspace">
      <aside className={"sidebar " + (open ? "sidebar-open" : "")}>
        <Link className="brand" href="/dashboard">
          <ShieldCheck size={25} />
          UsageAudit
          <span className="brand-dot" />
        </Link>
        <button
          className="mobile-close"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <div className="org-switch">
          <div className="org-avatar">
            {String(active?.name ?? "W").slice(0, 1)}
          </div>
          <label>
            <span>Workspace</span>
            <select
              aria-label="Active organization"
              value={org}
              onChange={(e) => {
                localStorage.setItem("usageaudit.organization", e.target.value);
                setOrg(e.target.value);
                client.clear();
              }}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {String(o.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav>
          {navigation.map((group) => (
            <div className="nav-group" key={group.group}>
              <p>{group.group}</p>
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  href={"/" + item.path}
                  onClick={() => setOpen(false)}
                  className={
                    route.join("/").startsWith(item.path) ||
                    (page === "pricing" && item.path === "metrics")
                      ? "active"
                      : ""
                  }
                >
                  <item.icon size={18} />
                  {item.name}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={19} />
          <strong>Evidence you can trust</strong>
          <p>Your billing connections are read-only.</p>
        </div>
        <div className="user-menu">
          <span className="user-avatar">
            {user?.displayName.slice(0, 1) ?? "U"}
          </span>
          <div>
            <strong>{user?.displayName ?? "Loading…"}</strong>
            <small>{String(active?.role ?? "")}</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={async () => {
              await api("auth/logout", {});
              client.clear();
              router.push("/login");
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <button
              className="mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="status-dot" /> Independent verification{" "}
            <span className="env-label">MVP</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                BILLING CONFIDENCE, BACKED BY EVIDENCE
              </div>
              <h1>
                {route.length > 1 && page !== "settings"
                  ? title + " / Detail"
                  : title}
              </h1>
              <p>{description}</p>
            </div>
            {page === "dashboard" && writable && (
              <Button asChild>
                <Link href="/reconciliations">
                  <Plus size={16} />
                  New reconciliation
                </Link>
              </Button>
            )}
          </div>
          <Feedback error={error} />
          {!ready ? (
            <>
              <div className="skeleton" />
              <div className="skeleton" />
            </>
          ) : (
            <div key={org}>
              {page === "dashboard" ? (
                <Dashboard />
              ) : page === "imports" ? (
                route[1] ? (
                  <ImportDetail id={route[1]} writable={writable} />
                ) : (
                  <ImportsPage writable={writable} />
                )
              ) : page === "reconciliations" ? (
                route[1] ? (
                  <RunDetail id={route[1]} />
                ) : (
                  <ReconciliationsPage writable={writable} />
                )
              ) : page === "findings" ? (
                route[1] ? (
                  <FindingDetail id={route[1]} writable={writable} />
                ) : (
                  <FindingsPage />
                )
              ) : ["customers", "metrics", "pricing"].includes(page) ? (
                <ConfigurationPage
                  page={page}
                  configure={configure}
                  writable={writable}
                />
              ) : page === "connections" ? (
                <ConnectionsPage configure={configure} />
              ) : page === "reports" ? (
                <ReportsPage />
              ) : page === "settings" ? (
                <SettingsPage
                  section={route[1] ?? "organization"}
                  org={org}
                  orgName={String(active?.name ?? "")}
                  owner={active?.role === "OWNER"}
                  configure={configure}
                  writable={writable}
                />
              ) : (
                <Empty message="This page does not exist." />
              )}
            </div>
          )}
          <footer className="footer">
            <ShieldCheck size={14} />
            UsageAudit · Independent usage-based billing verification
            <span>UTC billing periods · Exact decimal arithmetic</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
interface Overview {
  latestRunId: string | null;
  totals: {
    currency: string | null;
    audited_amount: string;
    potential_underbilling: string;
    potential_overbilling: string;
    components: number;
    complete_components: number;
  }[];
  counts: { open_findings: number; confirmed_findings: number };
  imports: { last_import: string | null };
  connections: Row[];
}
function Dashboard() {
  const data = useData<Overview>("dashboard/overview", true),
    history = useData<Row[]>("dashboard/reconciliation-history", true),
    exceptions = useData<{ finding_type: string; count: number }[]>(
      "dashboard/exception-summary",
      true,
    );
  if (data.isPending) return <div className="skeleton" />;
  if (data.error) return <Feedback error={data.error.message} />;
  const d = data.data!;
  return (
    <>
      <div className="overview-banner">
        <div className="banner-icon">
          <ShieldCheck size={25} />
        </div>
        <div>
          <strong>Know where your billing stands.</strong>
          <p>
            Financial exposure reflects the latest completed audit. Findings
            stay open until your team reviews them.
          </p>
        </div>
        <Link href="/imports">
          Import data
          <ArrowRight size={16} />
        </Link>
      </div>
      {d.totals.length ? (
        d.totals.map((t) => (
          <div className="stat-grid" key={t.currency ?? "unknown"}>
            <Stat
              title="Audited billing amount"
              value={money(t.audited_amount, t.currency ?? "")}
              note="Comparable invoice usage charges"
            />
            <Stat
              title="Potential underbilling"
              value={money(t.potential_underbilling, t.currency ?? "")}
              note="Complete evidence · requires review"
              accent="amber"
            />
            <Stat
              title="Potential overbilling"
              value={money(t.potential_overbilling, t.currency ?? "")}
              note="Complete evidence · requires review"
              accent="purple"
            />
            <Stat
              title="Audit coverage"
              value={`${t.complete_components} / ${t.components}`}
              note="Components with complete evidence"
            />
          </div>
        ))
      ) : (
        <div className="stat-grid">
          <Stat
            title="Audited billing amount"
            value="—"
            note="Run your first reconciliation"
          />
          <Stat
            title="Potential underbilling"
            value="—"
            note="Calculated from your audit evidence"
          />
          <Stat
            title="Potential overbilling"
            value="—"
            note="Calculated from your audit evidence"
          />
          <Stat
            title="Audit coverage"
            value="—"
            note="No completed audits yet"
          />
        </div>
      )}
      <div className="dashboard-grid">
        <Panel
          title="Recent reconciliations"
          subtitle="Your latest billing verification runs"
          action={
            <Link className="subtle-link" href="/reconciliations">
              View all
              <ArrowUpRight size={15} />
            </Link>
          }
        >
          <Table
            rows={history.data ?? []}
            columns={[
              { key: "period_start", title: "Period start" },
              { key: "period_end", title: "Period end" },
              { key: "status", title: "Status" },
            ]}
            link="/reconciliations"
          />
        </Panel>
        <Panel title="Exceptions by type" subtitle="Across your audit history">
          {exceptions.data?.length ? (
            <div className="bar-chart">
              {exceptions.data.map((e) => (
                <div key={e.finding_type}>
                  <span>
                    {e.finding_type.toLowerCase().replaceAll("_", " ")}
                  </span>
                  <strong>{e.count}</strong>
                  <div>
                    <i
                      style={{
                        width: `${Math.max(4, (e.count / Math.max(...exceptions.data.map((x) => x.count))) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="No findings to review yet." />
          )}
        </Panel>
      </div>
      <div className="dashboard-grid">
        <Panel
          title="Review queue"
          subtitle="Keep potential exposure separate from confirmed discrepancies"
        >
          <div className="review-stats">
            <div>
              <span className="amber-dot" />
              <strong>{d.counts.open_findings}</strong>
              <p>Open & investigating</p>
            </div>
            <div>
              <span className="status-dot" />
              <strong>{d.counts.confirmed_findings}</strong>
              <p>Confirmed findings</p>
            </div>
            <Button asChild variant="outline">
              <Link href="/findings">
                Review findings
                <ArrowRight size={15} />
              </Link>
            </Button>
          </div>
        </Panel>
        <Panel
          title="Data health"
          subtitle="Fresh evidence makes a stronger audit"
        >
          <div className="health-list">
            <div>
              <FileInput size={18} />
              <span>Last completed import</span>
              <strong>
                {d.imports.last_import
                  ? new Date(d.imports.last_import).toLocaleDateString()
                  : "No imports"}
              </strong>
            </div>
            {d.connections.map((c) => (
              <div key={c.id}>
                <Plug size={18} />
                <span>{String(c.display_name)}</span>
                <Badge value={c.status} />
              </div>
            ))}
            {!d.connections.length && (
              <Link href="/connections" className="subtle-link">
                Add a billing connection
                <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
function Stat({
  title,
  value,
  note,
  accent = "blue",
}: {
  title: string;
  value: string;
  note: string;
  accent?: string;
}) {
  return (
    <section className={"stat-card stat-" + accent}>
      <div>
        <span>{title}</span>
        <BarChart3 size={17} />
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </section>
  );
}
function FindingsPage() {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("");
  return (
    <Panel
      title="Billing exceptions"
      subtitle="Potential discrepancies and evidence gaps"
    >
      <div className="table-filters">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search findings"
            placeholder="Search customer, metric, or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Review status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All review statuses</option>
          {["OPEN", "INVESTIGATING", "CONFIRMED", "DISMISSED", "RESOLVED"].map(
            (v) => (
              <option key={v}>{v}</option>
            ),
          )}
        </select>
      </div>
      <DataTable
        key={search + status}
        path={`findings?search=${encodeURIComponent(search)}${status ? "&status=" + status : ""}`}
        columns={[
          { key: "customer_identifier", title: "Customer" },
          { key: "metric_key", title: "Metric" },
          { key: "finding_type", title: "Exception" },
          { key: "variance_amount", title: "Variance" },
          { key: "currency", title: "Currency" },
          { key: "evidence_status", title: "Evidence" },
          { key: "review_status", title: "Review" },
        ]}
        link="/findings"
      />
    </Panel>
  );
}
