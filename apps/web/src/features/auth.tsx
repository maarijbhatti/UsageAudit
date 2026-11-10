"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { ShieldCheck, ArrowRight, Check } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
const schema = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
  displayName: z.string().max(100).optional(),
});
type Values = z.infer<typeof schema>;
export function AuthForm({ registering = false }: { registering?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const submit = form.handleSubmit(async (values) => {
    try {
      setError("");
      await api(
        "auth/" + (registering ? "register" : "login"),
        registering
          ? values
          : { email: values.email, password: values.password },
      );
      router.push(registering ? "/onboarding" : "/dashboard");
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Link className="brand" href="/">
          <ShieldCheck />
          UsageAudit
          <span className="brand-dot" />
        </Link>
        <div>
          <div className="eyebrow">INDEPENDENT BILLING VERIFICATION</div>
          <h1>
            Every request.
            <br />
            Every dollar.
            <br />
            <span>Accounted for.</span>
          </h1>
          <p>
            Connect your usage to your billing. Find the gaps, follow the
            evidence, and close the loop.
          </p>
          <div className="auth-points">
            <p>
              <Check size={17} /> Exact decimal calculations
            </p>
            <p>
              <Check size={17} /> Reproducible audit evidence
            </p>
            <p>
              <Check size={17} /> Read-only billing connections
            </p>
          </div>
        </div>
        <small>Built for finance and engineering teams.</small>
      </aside>
      <main className="auth-panel">
        <form onSubmit={submit} className="auth-form">
          <span className="eyebrow">YOUR BILLING, VERIFIED</span>
          <h2>{registering ? "Create your account" : "Welcome back"}</h2>
          <p className="muted">
            {registering
              ? "Start with a workspace for your team."
              : "Sign in to your organization’s audit workspace."}
          </p>
          {registering && (
            <label>
              Full name
              <input
                {...form.register("displayName")}
                required
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Work email
            <input
              type="email"
              {...form.register("email")}
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              aria-label="Password"
              type="password"
              {...form.register("password")}
              autoComplete={registering ? "new-password" : "current-password"}
            />
            <small>At least 12 characters.</small>
          </label>
          {Object.values(form.formState.errors).map((e, i) => (
            <p role="alert" className="error" key={i}>
              {e.message}
            </p>
          ))}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <Button disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? "Please wait…"
              : registering
                ? "Create account"
                : "Sign in"}
            <ArrowRight size={16} />
          </Button>
          <p className="auth-switch">
            {registering ? "Already have an account?" : "New to UsageAudit?"}{" "}
            <Link href={registering ? "/login" : "/register"}>
              {registering ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
export function Onboarding() {
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <main className="onboarding">
      <ShieldCheck size={40} />
      <span className="eyebrow">SET UP YOUR WORKSPACE</span>
      <h1>
        Make billing confidence
        <br />a team habit.
      </h1>
      <p className="muted">
        Your organization keeps usage, billing evidence, and reviews together.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const org = await api<{ id: string }>("organizations", { name });
            localStorage.setItem("usageaudit.organization", org.id);
            router.push("/dashboard");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Organization name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme AI"
            required
            maxLength={100}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy}>
          Create workspace
          <ArrowRight size={16} />
        </Button>
      </form>
    </main>
  );
}
