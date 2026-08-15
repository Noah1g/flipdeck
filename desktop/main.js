const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const { Client } = require("@xhayper/discord-rpc");
const { autoUpdater } = require("electron-updater");

// ============================================================
//  HIER ANPASSEN — die 4 Werte unten musst du ausfüllen
// ============================================================

// Deine live Flipdeck-URL (Vercel-Domain, mit https://)
const APP_URL = "https://getflipdeck.vercel.app";

// Client-ID aus dem Discord Developer Portal (discord.com/developers/applications
// -> New Application -> General Information -> "Application ID")
const DISCORD_CLIENT_ID = "1533199998039232573";

// Texte, die in Discord unter dem Namen erscheinen (Zeile 1 / Zeile 2)
const RICH_PRESENCE_DETAILS = "entwickelt von noah1g";
const RICH_PRESENCE_STATE = "";

// Name des Bildes, das du im Developer Portal unter
// "Rich Presence" -> "Art Assets" hochgeladen hast (nur der Key, ohne Dateiendung)
const LARGE_IMAGE_KEY = "chatgpt_image_1_aug_2026_21_52_25";

// ============================================================

let mainWindow;
let rpcClient;
const startTimestamp = Date.now();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    autoHideMenuBar: true,
    backgroundColor: "#0B0F19",
    // Nativen hellen Titelbalken durch einen dunklen, ins App-Design integrierten ersetzen.
    // Die Fenster-Buttons (Minimieren/Maximieren/Schließen) bleiben, aber dunkel getönt.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0B0F19", symbolColor: "#ffffff", height: 44 },
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Der Web-App signalisieren, dass sie in der neuen Desktop-Shell läuft (für die
  // passende Titelleisten-Optik). Nur die aktualisierte App aktiviert die Anpassungen.
  mainWindow.webContents.setUserAgent(
    mainWindow.webContents.getUserAgent() + " FlipdeckShell/2"
  );

  // Bei jedem Start HTTP-Cache + Service-Worker-Cache leeren, damit die App
  // nie eine veraltete gecachte Version von getflipdeck.vercel.app zeigt.
  const ses = mainWindow.webContents.session;

  // Flipdeck-Backups (flipdeck-backup-*.json) lautlos in einen festen Ordner speichern —
  // kein „Speichern unter"-Dialog. So läuft das automatische Wochen-Backup wirklich von allein.
  const backupDir = path.join(app.getPath("documents"), "Flipdeck Backups");
  ses.on("will-download", (event, item) => {
    const name = item.getFilename() || "";
    if (name.startsWith("flipdeck-backup-") && name.endsWith(".json")) {
      try { require("fs").mkdirSync(backupDir, { recursive: true }); } catch (e) {}
      item.setSavePath(path.join(backupDir, name));
    }
  });
  Promise.all([
    ses.clearCache(),
    ses.clearStorageData({ storages: ["serviceworkers", "cachestorage"] }),
  ])
    .catch(() => {})
    .finally(() => mainWindow.loadURL(APP_URL));

  // Alle "target=_blank"-Links (idealo, eBay, Kaufland etc.) im echten
  // System-Browser öffnen statt in einem neuen Electron-Fenster
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupDiscordRPC() {
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === "DEINE_CLIENT_ID") {
    console.warn(
      "[Discord RPC] Keine Client-ID gesetzt (main.js oben ausfüllen) — Rich Presence bleibt aus."
    );
    return;
  }

  rpcClient = new Client({ clientId: DISCORD_CLIENT_ID });

  rpcClient.on("ready", () => {
    console.log("[Discord RPC] Verbunden, setze Activity.");
    updateActivity();
    // Discord zeigt die "Elapsed"-Zeit selbst live an, ein Neusetzen ist nicht
    // nötig für den Timer — aber falls Discord neu startet, holt das hier die
    // Verbindung zurück, ohne dass du die App neu starten musst.
    setInterval(updateActivity, 15000);
  });

  rpcClient.login().catch((err) => {
    console.error(
      "[Discord RPC] Verbindung fehlgeschlagen (läuft der Discord-Client gerade?):",
      err.message
    );
  });
}

function updateActivity() {
  if (!rpcClient?.user) return;
  rpcClient.user
    .setActivity({
      details: RICH_PRESENCE_DETAILS,
      startTimestamp,
      largeImageKey: LARGE_IMAGE_KEY,
      instance: false,
    })
    .catch((err) =>
      console.error("[Discord RPC] setActivity fehlgeschlagen:", err.message)
    );
}

function setupAutoUpdater() {
  // Nur bei der installierten .exe – im Dev-Modus (npm start) gibt's nichts zu updaten
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log("[Update] Neue Version verfügbar:", info.version, "– lade im Hintergrund.");
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Update] Bereits auf dem neuesten Stand.");
  });

  autoUpdater.on("error", (err) => {
    console.error("[Update] Fehler bei der Update-Prüfung:", err.message);
  });

  autoUpdater.on("update-downloaded", (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Flipdeck-Update bereit",
        message: `Version ${info.version} wurde heruntergeladen.`,
        detail: "Jetzt neu starten, um das Update zu installieren?",
        buttons: ["Jetzt neu starten", "Später"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.checkForUpdates();
  // zusätzlich alle 4 Stunden erneut prüfen, falls die App lange offen bleibt
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  createWindow();
  setupDiscordRPC();
  setupAutoUpdater();

  // Autostart bei Windows-Login (nur bei der installierten .exe, nicht im Dev-Modus)
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (rpcClient) rpcClient.destroy().catch(() => {});
  if (process.platform !== "darwin") app.quit();
});
