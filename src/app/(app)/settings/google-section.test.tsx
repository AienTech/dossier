import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setupDriveArchive } from "@/lib/google/drive-actions";
import { checkInbox, disconnectGoogleAccount, saveGoogleSettings } from "@/lib/google/actions";

import { GoogleSection, type GoogleClientView, type GoogleSettings } from "./google-section";

vi.mock("@/lib/google/drive-actions", () => ({ setupDriveArchive: vi.fn(async () => ({ ok: true, data: { id: "root", url: "https://drive.google.com/drive/folders/root" } })) }));
vi.mock("@/lib/google/actions", () => ({
  saveGoogleClient: vi.fn(async () => ({ ok: true, data: { id: "", idState: "none", secretState: "none" } })),
  checkInbox: vi.fn(async () => ({ ok: true, data: null })),
  disconnectGoogleAccount: vi.fn(async () => ({ ok: true, data: null })),
  saveGoogleSettings: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const settings: GoogleSettings = {
  gmailRead: true,
  gmailScope: "known",
  gmailInterval: 10,
  calendarAvailability: true,
  calendarEvents: true,
  calendarId: "primary",
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "17:00",
  workTimeZone: null,
  slotMinutes: 45,
  bufferMinutes: 15,
};
const redirect = "http://localhost:3000/api/google/callback";
const client: GoogleClientView = { id: "", idState: "none", secretState: "none" };

beforeEach(() => vi.mocked(saveGoogleSettings).mockClear());

describe("GoogleSection (E15-1)", () => {
  it("explains the setup while the server has no Google client", () => {
    render(<GoogleSection client={client} connection={{ status: "not-configured" }} initial={settings} browserTimeZone="Europe/Berlin" redirectUri={redirect} />);
    expect(screen.getByText(redirect)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
    const drive = within(screen.getByRole("region", { name: "Google Drive" }));
    expect(drive.getByText("Set up your Google OAuth client to connect Drive.")).toBeInTheDocument();
    expect(drive.queryByRole("link", { name: "Connect Google Drive" })).not.toBeInTheDocument();
  });

  it("offers to connect", () => {
    render(<GoogleSection client={client} connection={{ status: "disconnected" }} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    expect(screen.getByRole("link", { name: "Connect Google account" })).toHaveAttribute("href", "/api/google/connect");
    const drive = within(screen.getByRole("region", { name: "Google Drive" }));
    expect(drive.getByRole("link", { name: "Connect Google Drive" })).toHaveAttribute("href", "/api/google/connect?scopes=drive");
    expect(drive.getByText("Google Drive is not connected.")).toBeInTheDocument();
  });

  it("offers Drive consent separately and opens the archive after setup", async () => {
    const connection = { status: "connected" as const, email: "jane@gmail.com", canSend: true, canRead: true, canUseCalendar: true, lastSync: null, syncProblem: null, signInProblem: null };
    const view = render(<GoogleSection client={client} connection={connection} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    expect(screen.getByRole("link", { name: "Connect Google Drive" })).toHaveAttribute("href", "/api/google/connect?scopes=drive");
    view.rerender(<GoogleSection client={client} connection={{ ...connection, canArchiveDrive: true }} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Create or find HireMe folder" }));
    expect(await screen.findByRole("link", { name: "Open HireMe folder in Drive" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/root");
  });

  it("shows folder setup errors in the Drive section and allows a retry", async () => {
    vi.mocked(setupDriveArchive).mockResolvedValueOnce({ ok: false, error: "Enable the Google Drive API, then retry." });
    const user = userEvent.setup();
    render(<GoogleSection client={client} connection={{ status: "connected", email: "jane@gmail.com", canSend: false, canRead: false, canUseCalendar: false, canArchiveDrive: true, lastSync: null, syncProblem: null, signInProblem: null }} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    const drive = within(screen.getByRole("region", { name: "Google Drive" }));
    expect(drive.getByText("Drive connected as jane@gmail.com")).toBeInTheDocument();
    await user.click(drive.getByRole("button", { name: "Create or find HireMe folder" }));
    expect(await drive.findByRole("alert")).toHaveTextContent("Enable the Google Drive API, then retry.");
    expect(drive.queryByRole("link", { name: "Open HireMe folder in Drive" })).not.toBeInTheDocument();
    await user.click(drive.getByRole("button", { name: "Create or find HireMe folder" }));
    expect(await drive.findByRole("link", { name: "Open HireMe folder in Drive" })).toBeInTheDocument();
    expect(drive.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks to connect again once Google refuses the saved access (#136)", () => {
    const problem = "Google no longer accepts HireMe's access. Connect your Google account again.";
    render(
      <GoogleSection
        client={client}
        connection={{ status: "connected", email: "jane@gmail.com", canSend: true, canRead: true, canUseCalendar: true, lastSync: null, syncProblem: problem, signInProblem: problem }}
        initial={settings}
        browserTimeZone={null}
        redirectUri={redirect}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Until then, HireMe doesn't check your mail or calendar.");
    expect(screen.getByRole("link", { name: "Connect again" })).toHaveAttribute("href", "/api/google/connect");
  });

  it("saves each choice, links to missing permissions, and disconnects after asking", async () => {
    const user = userEvent.setup();
    render(
      <GoogleSection
        client={client}
        connection={{ status: "connected", email: "jane@gmail.com", canSend: true, canRead: true, canUseCalendar: false, lastSync: "today at 10:00", syncProblem: null, signInProblem: null }}
        initial={settings}
        browserTimeZone="Europe/Berlin"
        redirectUri={redirect}
      />,
    );
    expect(screen.getByText("jane@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Allow" })).toHaveAttribute("href", "/api/google/connect?scopes=calendar");
    expect(screen.getByText("Last checked today at 10:00")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Every new email" }));
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ gmailScope: "all" });
    await user.click(screen.getByRole("button", { name: "Sat" }));
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ workDays: [1, 2, 3, 4, 5, 6] });
    await user.selectOptions(screen.getByRole("combobox", { name: "Interview length" }), "60");
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ slotMinutes: 60 });
    await user.type(screen.getByRole("textbox", { name: "Time zone" }), "America/New_York");
    await user.tab();
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ workTimeZone: "America/New_York" });

    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(checkInbox).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnectGoogleAccount).toHaveBeenCalled();
  });
});
