"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="onboarding">
      <h1>Something went wrong</h1>
      <p>Please retry. Your saved audit evidence is preserved.</p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
