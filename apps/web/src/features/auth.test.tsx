// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthForm } from "./auth";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
describe("registration validation", () => {
  it("rejects short passwords before sending a request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<AuthForm registering />);
    fireEvent.change(screen.getByLabelText("Work email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Person" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "short" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("12"),
    );
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
