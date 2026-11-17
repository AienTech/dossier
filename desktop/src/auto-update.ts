import { dialog } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * Checks GitHub for a newer desktop build and replaces this app when the user
 * agrees. Uses the zip artifact (unsigned Mac builds; no Apple Developer ID).
 */
export function startAutoUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("update-available", (info) => {
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Download and install", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update available",
        message: `HireMe ${info.version} is out`,
        detail: "Download and install it over this one. Your data stays as it is. On Mac, the first open of a new download may need right-click → Open.",
      })
      .then(({ response }) => {
        if (response === 0) void autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on("update-downloaded", (info) => {
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Restart and install", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `HireMe ${info.version} is ready to install`,
        detail: "Restart now to replace this app with the new version.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall(false, true);
      });
  });

  autoUpdater.on("error", (error) => {
    console.error("Desktop update check failed:", error);
  });

  const check = () => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error("Desktop update check failed:", error);
    });
  };

  // After launch settles, then once a day while the app stays open.
  setTimeout(check, 15_000);
  setInterval(check, 24 * 60 * 60 * 1000);
}
