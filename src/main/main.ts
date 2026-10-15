import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import * as path from "node:path";
import { AXIS_IPC_CHANNELS, type AxisAppInfo } from "../shared/ipc-contract";
import { createAiController } from "./ai/aiController";
import { createConversationRepository } from "./conversations/conversationRepository";
import { createConversationsController } from "./conversations/conversationsController";

/**
 * AXIS — Electron main process.
 *
 * Responsibilities: create the application window, enforce security policy
 * (CSP, navigation restrictions, permission denial), answer the read-only
 * app-info request, and (Phase 3) own the AI engine + credential storage.
 * All Gemini network calls and all credential encryption/decryption happen
 * only in this process; the renderer only ever sees narrow, validated IPC
 * results — never raw key material.
 */

const isDev = Boolean(process.env["AXIS_DEV_SERVER_URL"]);
const DEV_SERVER_URL = process.env["AXIS_DEV_SERVER_URL"];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'" + (isDev ? " ws://localhost:5173 http://localhost:5173" : ""),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#15171c",
    show: false,
    title: "AXIS",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  win.once("ready-to-show", () => win.show());

  if (isDev && DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Deny navigation away from the app shell and block opening new windows.
  win.webContents.on("will-navigate", (event, url) => {
    const isDevServer = isDev && DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL);
    const isAppFile = url.startsWith("file://");
    if (!isDevServer && !isAppFile) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CONTENT_SECURITY_POLICY]
      }
    });
  });

  // Deny every permission request by default (camera, mic, notifications, etc).
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  ipcMain.handle(AXIS_IPC_CHANNELS.getAppInfo, (): AxisAppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron ?? "unknown",
    chromeVersion: process.versions.chrome ?? "unknown",
    nodeVersion: process.versions.node ?? "unknown"
  }));

  const aiController = createAiController({ getMainWindow: () => mainWindow });
  aiController.registerIpc(ipcMain);

  // Phase 5: local conversation history. Lives entirely under this app's
  // own userData directory, in a folder separate from Phase 3's `secure/`
  // credential storage — conversation files never contain key material.
  const conversationsRepository = createConversationRepository({
    baseDir: path.join(app.getPath("userData"), "conversations")
  });
  const conversationsController = createConversationsController({
    getMainWindow: () => mainWindow,
    repository: conversationsRepository
  });
  conversationsController.registerIpc(ipcMain);

  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Defence in depth: refuse any renderer request to attach a new webContents
// (e.g. <webview> tags) since AXIS does not use them.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});
