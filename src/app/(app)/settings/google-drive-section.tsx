"use client";

import { useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Card } from "@/components/ui/card";
import { saveDriveAutoSave, saveDriveShareLinks, setupDriveArchive } from "@/lib/google/drive-actions";
import type { GoogleConnectionView } from "./google-section";

/** Drive setup remains visible before the shared Google client or account is connected. */
export function GoogleDriveSection({ connection, autoSave = true, shareLinks = false }: { connection: GoogleConnectionView; autoSave?: boolean; shareLinks?: boolean }) {
  const [automatic, setAutomatic] = useState(autoSave);
  const [shareable, setShareable] = useState(shareLinks);
  const [busy, setBusy] = useState(false);
  const [folderUrl, setFolderUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const granted = connection.status === "connected" && connection.canArchiveDrive;

  const setupFolder = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await setupDriveArchive({});
      if (result.ok) setFolderUrl(result.data.url);
      else setError(result.error);
    } catch {
      setError("Couldn’t set up the HireMe folder. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card role="region" aria-labelledby="google-drive-heading" className="flex flex-col items-start gap-4">
      <div className="space-y-1">
        <h3 id="google-drive-heading" className="font-medium">Google Drive</h3>
        <p className="text-sm text-muted">Keep your resume, cover letter and apply instructions in a HireMe folder, organised by application and dated snapshot.</p>
      </div>
      <p role="status" className="text-sm">
        {granted && connection.status === "connected"
          ? `Drive connected as ${connection.email}`
          : connection.status === "not-configured"
            ? "Set up your Google OAuth client to connect Drive."
            : connection.status === "connected"
              ? "Your Google account is connected. Allow Drive access to set up the archive."
              : "Google Drive is not connected."}
      </p>
      <Toggle label="Save application packets automatically" description="Queue a dated Drive snapshot when an application is created or its documents change. Unchanged packets are not uploaded again. ZIP downloads work independently."
        checked={automatic} onCheckedChange={value => {
          setAutomatic(value);
          void saveDriveAutoSave({ enabled: value }).then(result => { if (!result.ok) { setAutomatic(!value); setError(result.error); } }, () => { setAutomatic(!value); setError("Couldn’t save the auto-save preference."); });
        }} />
      <Toggle label="Make snapshot links shareable" description="On: anyone who has a snapshot’s link can open that job’s folder read-only, without signing in — useful when a bot cannot reach your Drive account. Off: the link opens only for your own Google account. Each new snapshot follows this setting when it is saved; folders shared earlier stay shared until you change them in Drive."
        checked={shareable} onCheckedChange={value => {
          setShareable(value);
          void saveDriveShareLinks({ enabled: value }).then(result => { if (!result.ok) { setShareable(!value); setError(result.error); } }, () => { setShareable(!value); setError("Couldn’t save the link-sharing preference."); });
        }} />
      {shareable && <p role="status" className="text-sm text-muted">New snapshots will be readable by anyone with their link. The PDFs and the posting are in that folder, so treat the link as private to the people you send it to; HireMe never lists it publicly.</p>}
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Enable the <strong>Google Drive API</strong> in the Google Cloud project used by your OAuth client.</li>
        <li>{connection.status === "not-configured"
          ? "Save your Client ID and Client secret in the Google settings above, then connect Google Drive here."
          : "Connect Google Drive and approve access to files HireMe creates or you share with it. Gmail and Calendar access are optional."}</li>
        <li>Create or find your HireMe folder, then open it in Drive to check the archive.</li>
      </ol>
      {connection.status === "not-configured" ? (
        <p className="text-sm text-muted">The Drive connection button will be available once your OAuth client is saved.</p>
      ) : granted ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setupFolder()}>
          {busy ? "Setting up folder…" : "Create or find HireMe folder"}
        </Button>
      ) : (
        <a href="/api/google/connect?scopes=drive" className={buttonClassName("secondary", "sm")}>Connect Google Drive</a>
      )}
      {granted && <a href="/api/google/connect?scopes=drive" className="text-sm underline">Reconnect Google Drive</a>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      {folderUrl && (
        <div className="space-y-1 text-sm">
          <p role="status">Your HireMe folder is ready.</p>
          <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="underline">Open HireMe folder in Drive</a>
        </div>
      )}
      <p className="text-sm text-muted">Application packets save in the background when auto-save is on. Earlier snapshots stay in Drive when you disconnect HireMe.</p>
    </Card>
  );
}
