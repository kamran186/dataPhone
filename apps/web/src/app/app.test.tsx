import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./app";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "DataPhone",
        purpose: "Internal DID management",
      }),
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

it("renders the overview with navigation", async () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(
    screen.getByRole("navigation", { name: "Main navigation" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Connected")).toBeInTheDocument();
});
