import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiSettingsPanel } from "@/components/ai-settings";
import {
  listAiModelsAction,
  saveAiConfigAction,
  testAiConnectionAction,
} from "@/app/actions";

/**
 * The model list has to answer the question the provider asked: an exact
 * model ID. Display names ("Gemini 3.8 Flash") are a 400 if pasted back, so
 * every row shows both, and the ID is copyable without retyping.
 *
 * "Test primary" also tests what is on screen, not only the saved config —
 * otherwise a corrected model ID appears to fail until you save.
 */

vi.mock("@/app/actions", () => ({
  saveAiConfigAction: vi.fn(),
  removeAiKeyAction: vi.fn(),
  setAiKeyAction: vi.fn(),
  testAiConnectionAction: vi.fn(),
  testProviderAction: vi.fn(),
  listAiModelsAction: vi.fn(),
}));

const status = {
  enabled: true,
  configured: true,
  imageConfigured: false,
  provider: "gemini",
  model: "gemini-flash-latest",
  dailyCap: 200,
  callsToday: 0,
};

const config = {};

beforeEach(() => {
  vi.mocked(listAiModelsAction).mockReset();
  vi.mocked(testAiConnectionAction).mockReset();
  vi.mocked(saveAiConfigAction).mockReset();
});

async function showModels() {
  vi.mocked(listAiModelsAction).mockResolvedValue({
    ok: true,
    models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }],
  });
  const user = userEvent.setup();
  render(<AiSettingsPanel status={status} config={config} />);
  await user.click(screen.getByRole("button", { name: "List models" }));
  expect(await screen.findByText("Gemini 3.8 Flash")).toBeInTheDocument();
  return user;
}

describe("accessibility of feedback", () => {
  it("announces success in a live region", async () => {
    vi.mocked(saveAiConfigAction).mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(<AiSettingsPanel status={status} config={config} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(screen.getByText("Saved.").closest('[role="status"]')).not.toBeNull();
  });

  it("renders the copyable diagnostic in the alert so clipboard fallback is actionable", async () => {
    vi.mocked(testAiConnectionAction).mockResolvedValue({
      ok: false,
      kind: "http",
      message: "Provider returned HTTP 404",
      detail: "action=test | type=http",
    });
    const user = userEvent.setup();
    render(<AiSettingsPanel status={status} config={config} />);

    await user.click(screen.getByRole("button", { name: "Test primary" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("NutriPlan AI error");
    expect(alert).toHaveTextContent("type: http");
  });
});

describe("model list", () => {
  it("shows the exact model ID next to the display name", async () => {
    await showModels();
    expect(screen.getByText("gemini-3.8-flash")).toBeInTheDocument();
  });

  it("copies the exact ID without selecting or retyping it", async () => {
    const user = await showModels();
    // `userEvent.setup()` installs its own clipboard stub, so replace it
    // after the component is rendered and the user is ready.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.click(
      screen.getByRole("button", { name: "Copy model ID gemini-3.8-flash" }),
    );

    expect(writeText).toHaveBeenCalledWith("gemini-3.8-flash");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("puts the ID, not the label, into the model field when a row is used", async () => {
    const user = await showModels();
    await user.click(screen.getByRole("button", { name: "Use model gemini-3.8-flash" }));
    expect(screen.getByDisplayValue("gemini-3.8-flash")).toBeInTheDocument();
  });

  it("lists models for the provider selected on screen, before saving", async () => {
    const user = userEvent.setup();
    vi.mocked(listAiModelsAction).mockResolvedValue({ ok: true, models: [] });
    render(<AiSettingsPanel status={status} config={config} />);
    await user.click(screen.getByRole("button", { name: "List models" }));
    expect(listAiModelsAction).toHaveBeenCalledWith({
      provider: "gemini",
      baseUrl: undefined,
    });
  });
});

describe("test primary", () => {
  it("tests the values currently in the form", async () => {
    vi.mocked(testAiConnectionAction).mockResolvedValue({ ok: true, latencyMs: 12 });
    const user = userEvent.setup();
    render(<AiSettingsPanel status={status} config={config} />);

    const model = screen.getByPlaceholderText("e.g. gemini-flash-latest");
    await user.clear(model);
    await user.type(model, "gemini-3.8-flash");
    await user.click(screen.getByRole("button", { name: "Test primary" }));

    await waitFor(() =>
      expect(testAiConnectionAction).toHaveBeenCalledWith({
        provider: "gemini",
        model: "gemini-3.8-flash",
        baseUrl: undefined,
      }),
    );
    expect(await screen.findByText("Connected in 12 ms.")).toBeInTheDocument();
  });

  it("asks for a save first when the key has not been stored yet", async () => {
    const user = userEvent.setup();
    render(<AiSettingsPanel status={status} config={config} />);

    await user.type(
      screen.getByPlaceholderText("configured — leave blank to keep"),
      "AIza-not-saved",
    );
    await user.click(screen.getByRole("button", { name: "Test primary" }));

    expect(
      await screen.findByText("Save the key first, then test the connection."),
    ).toBeInTheDocument();
    expect(testAiConnectionAction).not.toHaveBeenCalled();
  });

  it("shows the error type and copies a redacted diagnostic", async () => {
    vi.mocked(testAiConnectionAction).mockResolvedValue({
      ok: false,
      kind: "http",
      message:
        "Provider returned HTTP 404: models/gemini-2.0-flash is not found. " +
        "Use models/gemini-3.8-flash instead.",
      detail:
        "2026-11-18T01:00:00.000Z action=testAiConnectionAction | type=http | " +
        "provider=gemini | model=gemini-2.0-flash | message=HTTP 404",
    });
    const user = userEvent.setup();
    render(<AiSettingsPanel status={status} config={config} />);

    await user.click(screen.getByRole("button", { name: "Test primary" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Provider rejected the request");
    expect(alert).toHaveTextContent("(http)");
    expect(alert).toHaveTextContent("HTTP 404");
    expect(alert).toHaveTextContent("Safe to share — keys are redacted.");

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByRole("button", { name: "Copy error" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("type: http");
    expect(copied).toContain("provider=gemini");
    expect(copied).toContain("HTTP 404");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});
