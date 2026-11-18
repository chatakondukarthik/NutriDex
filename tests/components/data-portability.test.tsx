import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataPortabilityPanel } from "@/components/data-portability";

/**
 * The safety rules in the portability UI:
 *
 *   1. the export scope is explicit: a household archive, one person's
 *      archive plus the shared library, or the shared library alone;
 *   2. "Import" stays disabled until the same file, mode and target person
 *      passed a dry run through the real importer;
 *   3. changing the file, the mode or the target person throws that check
 *      away rather than letting it authorise a different import.
 *
 * The export link is also checked because it is the only control that
 * decides what leaves the machine.
 */

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const PEOPLE = [
  { id: "person-1", displayName: "Karthik" },
  { id: "person-2", displayName: "Priya" },
];

const report = {
  ok: true as const,
  mode: "merge" as const,
  dryRun: true,
  formatVersion: 2,
  scope: "household" as const,
  personId: null,
  appVersion: "0.1.0",
  exportedAt: "2026-11-18T09:00:00.000Z",
  tables: [
    { table: "entries", label: "Diary entries", archiveRows: 3, added: 2, kept: 1, conflicts: 0 },
  ],
  files: { written: 0, skipped: 0 },
  warnings: [] as string[],
};

function archive(name = "nutriplan.zip"): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
    type: "application/zip",
  });
}

function mockFetch(payload: unknown = report, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>): FormData {
  const call = fetchMock.mock.calls.at(-1);
  return (call?.[1] as RequestInit).body as FormData;
}

function panel() {
  return <DataPortabilityPanel people={PEOPLE} activePersonId="person-1" />;
}

beforeEach(() => {
  refresh.mockReset();
  vi.unstubAllGlobals();
});

describe("export", () => {
  it("downloads the whole household with a snapshot by default", () => {
    render(panel());
    expect(screen.getByRole("link", { name: /Download household archive/ })).toHaveAttribute(
      "href",
      "/api/export?scope=household",
    );
  });

  it("reflects the AI log and snapshot choices in the URL", async () => {
    const user = userEvent.setup();
    render(panel());

    await user.click(screen.getByLabelText(/Include a full database snapshot/));
    expect(screen.getByRole("link", { name: /Download household archive/ })).toHaveAttribute(
      "href",
      "/api/export?scope=household&snapshot=0",
    );

    await user.click(screen.getByLabelText(/Include the AI activity log/));
    expect(screen.getByRole("link", { name: /Download household archive/ })).toHaveAttribute(
      "href",
      "/api/export?scope=household&ai=1&snapshot=0",
    );
  });

  it("exports one person with the shared library", async () => {
    const user = userEvent.setup();
    render(panel());

    await user.selectOptions(
      screen.getByLabelText(/What to include/),
      "person",
    );
    const link = screen.getByRole("link", { name: /Download person archive/ });
    expect(link).toHaveAttribute("href", "/api/export?scope=person&person=person-1");

    await user.selectOptions(screen.getByRole("combobox", { name: /^Person/ }), "person-2");
    expect(link).toHaveAttribute("href", "/api/export?scope=person&person=person-2");
    expect(screen.getByText(/Contains Priya's diary/i)).toBeInTheDocument();
  });

  it("exports the shared library alone without snapshot or AI controls", async () => {
    const user = userEvent.setup();
    render(panel());

    await user.selectOptions(screen.getByLabelText(/What to include/), "shared");
    expect(screen.getByRole("link", { name: /Download shared library archive/ })).toHaveAttribute(
      "href",
      "/api/export?scope=shared",
    );
    expect(screen.queryByLabelText(/Include a full database snapshot/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Include the AI activity log/)).not.toBeInTheDocument();
  });
});

describe("import gating", () => {
  it("keeps Import disabled until the archive has been checked", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    render(panel());

    const importButton = screen.getByRole("button", { name: "Import" });
    expect(importButton).toBeDisabled();

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    expect(importButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Check archive" }));
    await waitFor(() => expect(importButton).toBeEnabled());

    const checkBody = lastBody(fetchMock);
    expect(checkBody.get("dryRun")).toBe("1");
    expect(checkBody.get("mode")).toBe("merge");
    expect(checkBody.get("targetPersonId")).toBe("person-1");
    expect(screen.getByText(/Archive checked — nothing was written/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("applies only after a check, without the dry-run flag", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch();
    render(panel());

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    await user.click(screen.getByRole("button", { name: "Check archive" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled(),
    );

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    const applyBody = lastBody(fetchMock);
    expect(applyBody.has("dryRun")).toBe(false);
    expect(applyBody.get("mode")).toBe("merge");
    expect(applyBody.get("targetPersonId")).toBe("person-1");
  });

  it("throws the check away when the mode changes", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(panel());

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    await user.click(screen.getByRole("button", { name: "Check archive" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled(),
    );

    await user.click(screen.getByLabelText(/Replace matching data/));

    expect(screen.getByRole("button", { name: "Replace with archive" })).toBeDisabled();
    expect(screen.getByText("Check the archive before importing.")).toBeInTheDocument();
  });

  it("throws the check away when the target person changes", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(panel());

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    await user.click(screen.getByRole("button", { name: "Check archive" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled(),
    );

    await user.selectOptions(screen.getByLabelText(/Restore personal data into/), "person-2");

    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.getByText("Check the archive before importing.")).toBeInTheDocument();
  });

  it("throws the check away when a different file is chosen", async () => {
    const user = userEvent.setup();
    mockFetch();
    render(panel());

    const input = screen.getByLabelText("Archive to import");
    await user.upload(input, archive("first.zip"));
    await user.click(screen.getByRole("button", { name: "Check archive" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled(),
    );

    await user.upload(input, archive("second.zip"));
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });
});

describe("report and errors", () => {
  it("shows the importer's error and does not enable Import", async () => {
    const user = userEvent.setup();
    mockFetch({ ok: false, error: "The manifest checksum does not match." }, false);
    render(panel());

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    await user.click(screen.getByRole("button", { name: "Check archive" }));

    expect(
      await screen.findByText("The manifest checksum does not match."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("shows warnings from a successful check", async () => {
    const user = userEvent.setup();
    mockFetch({
      ...report,
      warnings: ["Skipped setting “unknown_key” — this build cannot restore it."],
    });
    render(panel());

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    await user.click(screen.getByRole("button", { name: "Check archive" }));

    expect(
      await screen.findByText(/Skipped setting “unknown_key”/),
    ).toBeInTheDocument();
  });

  it("labels a report with its format, scope and person", async () => {
    const user = userEvent.setup();
    mockFetch({ ...report, scope: "person", personId: "person-2" });
    render(panel());

    await user.upload(screen.getByLabelText("Archive to import"), archive());
    await user.click(screen.getByRole("button", { name: "Check archive" }));

    expect(await screen.findByText(/Format v2 · person archive/)).toBeInTheDocument();
    expect(screen.getByText(/· Priya/)).toBeInTheDocument();
  });
});
