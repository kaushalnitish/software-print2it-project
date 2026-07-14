import { app, BrowserWindow, ipcMain, Tray, Menu, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import AutoLaunch from 'auto-launch';
import dotenv from 'dotenv';

// Configure dotenv to load local .env files
try {
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: true });

  if (app) {
    try {
      dotenv.config({ path: path.join(app.getAppPath(), '.env'), override: true });
      dotenv.config({ path: path.join(path.dirname(app.getPath('exe')), '.env'), override: true });
    } catch (e) {
      // Ignore app-not-ready errors
    }
  }
} catch (e) {
  // Ignore
}

const loadedUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const loadedKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

console.log("Loaded URL:", loadedUrl);
console.log("Loaded Key Present:", !!loadedKey);

if (!loadedUrl) {
  console.error("FATAL ERROR: SUPABASE_URL is not configured in the local .env file!");
  console.error("Please create a .env file containing:");
  console.error("SUPABASE_URL=https://your-supabase-url.supabase.co");
  console.error("SUPABASE_ANON_KEY=your-supabase-anon-key");
  process.exit(1);
}

import { getStorageService } from '../services/storage';
import { getLoggingService } from '../services/logging';
import { getPrinterService } from '../services/printer';
import { getSupabaseDaemon } from '../services/supabase';
import { AppSettings, PrintJob } from '../types';

// Establish Services
const storage = getStorageService();
const logger = getLoggingService();
const printer = getPrinterService();
const daemon = getSupabaseDaemon();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Auto Launch Config
const printFlowLauncher = new AutoLaunch({
  name: 'PrintFlow Agent v2',
  path: app.getPath('exe'),
});

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  logger.log('warn', 'Secondary instance execution aborted due to Single Instance Lock');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function waitForViteServer(url: string, callback: () => void) {
  logger.log('info', `Waiting for Vite development server at ${url}...`);
  console.log(`Waiting for Vite development server at ${url}...`);
  
  const check = () => {
    const req = http.get(url, (res) => {
      logger.log('info', `Vite server status check: ${res.statusCode}`);
      console.log(`Vite server status check: ${res.statusCode}`);
      if (res.statusCode === 200) {
        callback();
      } else {
        setTimeout(check, 500);
      }
    });
    
    req.on('error', (err) => {
      logger.log('info', `Vite server not ready yet (error: ${err.message}), retrying...`);
      console.log(`Vite server not ready yet (error: ${err.message}), retrying...`);
      setTimeout(check, 500);
    });
    
    req.end();
  };
  
  check();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 700,
    resizable: false,
    maximizable: false,
    title: 'PrintFlow Agent v2',
    frame: false, // Frameless design for custom premium UI
    transparent: false,
    backgroundColor: '#0c0f17', // Match dark slate dashboard
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Link window to supabase daemon
  daemon.setWindow(mainWindow);

  // Monitor webContents events
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.log('error', `did-fail-load event: errorCode=${errorCode}, errorDescription=${errorDescription}, validatedURL=${validatedURL}`);
    console.error(`did-fail-load event: errorCode=${errorCode}, errorDescription=${errorDescription}, validatedURL=${validatedURL}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logger.log('info', 'did-finish-load event fired successfully');
    console.log('did-finish-load event fired successfully');
    // Open DevTools automatically after the renderer loads
    mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.on('dom-ready', () => {
    logger.log('info', 'dom-ready event fired');
    console.log('dom-ready event fired');
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logger.log('error', `render-process-gone event: reason=${details.reason}, exitCode=${details.exitCode}`);
    console.error(`render-process-gone event: reason=${details.reason}, exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelStr = ['verbose', 'info', 'warning', 'error'][level] || 'unknown';
    logger.log('info', `Renderer Console [${levelStr}]: ${message} (at ${sourceId}:${line})`);
    console.log(`Renderer Console [${levelStr}]: ${message} (at ${sourceId}:${line})`);
  });

  // Serve content: Dev server or production files
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    const devUrl = 'http://localhost:3000';
    waitForViteServer(devUrl, () => {
      if (!mainWindow) return;
      logger.log('info', `Calling loadURL with ${devUrl}...`);
      console.log(`Calling loadURL with ${devUrl}...`);
      mainWindow.loadURL(devUrl).then(() => {
        logger.log('info', `loadURL completed for ${devUrl}`);
        console.log(`loadURL completed for ${devUrl}`);
      }).catch((err) => {
        logger.log('error', `loadURL failed for ${devUrl}: ${String(err)}`);
        console.error(`loadURL failed for ${devUrl}:`, err);
      });
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Handle Close (Intercept to minimize to tray)
  mainWindow.on('close', (event) => {
    const settings = storage.getSettings();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
      logger.log('info', 'Window hidden to system tray');
    } else {
      daemon.stop();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSystemTray() {
  try {
    // Locate a suitable icon
    let iconPath = path.join(__dirname, '../../public/favicon.ico');
    if (!fs.existsSync(iconPath)) {
      // Dev fallback path
      iconPath = path.join(__dirname, '../assets/tray.png');
      if (!fs.existsSync(iconPath)) {
        // Safe fallbacks, check parent directories
        iconPath = path.join(app.getAppPath(), 'public/favicon.ico');
      }
    }

    // If icon STILL doesn't exist, Electron Tray might crash.
    // Create an empty file or dummy if missing during intermediate development
    if (!fs.existsSync(iconPath)) {
      const parentDir = path.dirname(iconPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(iconPath, ''); // Temporary mock file
    }

    tray = new Tray(iconPath);
    tray.setToolTip('PrintFlow Agent v2');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Restore Dashboard',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Open Logs Folder',
        click: () => {
          shell.openPath(path.dirname(logger.getLogFilePath()));
        },
      },
      {
        label: 'Clear pairing & Reset',
        click: async () => {
          daemon.stop();
          storage.clear();
          logger.log('info', 'System reset from Tray context menu');
          mainWindow?.show();
          mainWindow?.webContents.send('settings:reset-notify');
        },
      },
      { type: 'separator' },
      {
        label: 'Exit Application',
        click: () => {
          isQuitting = true;
          daemon.stop();
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });

    logger.log('info', 'System Tray successfully registered');
  } catch (err) {
    logger.log('error', 'Failed to register System Tray', String(err));
  }
}

// IPC Registration
function registerIpcHandlers() {
  // Settings IPC
  ipcMain.handle('settings:save', async (_, settings: Partial<AppSettings>) => {
    try {
      logger.log('info', 'Saving app settings', JSON.stringify(settings));
      storage.saveSettings(settings);
      
      // If pairing settings or keys changed, re-initialize Supabase daemon
      if (settings.supabaseUrl || settings.supabaseAnonKey || settings.shopId || settings.isPaired !== undefined) {
        await daemon.initialize();
      }
      
      return true;
    } catch (e) {
      logger.log('error', 'Failed to save settings', String(e));
      return false;
    }
  });

  ipcMain.handle('settings:get', async () => {
    return storage.getSettings();
  });

  // Pairing IPC
  ipcMain.handle('pairing:verify', async (_, { pairingCode, shopId, pairingKey, supabaseUrl, supabaseAnonKey }) => {
    const settings = storage.getSettings();
    const finalUrl = supabaseUrl || settings.supabaseUrl;
    const finalKey = supabaseAnonKey || settings.supabaseAnonKey;
    const code = pairingCode || pairingKey || shopId;
    return await daemon.verifyPairing(code, finalUrl, finalKey);
  });

  ipcMain.handle('pairing:clear', async () => {
    try {
      logger.log('info', 'Clearing shop pairing from device');
      daemon.stop();
      storage.saveSettings({
        isPaired: false,
        shopId: '',
        pairingKey: '',
        agentToken: '',
      });
      return true;
    } catch (e) {
      logger.log('error', 'Failed to clear pairing', String(e));
      return false;
    }
  });

  // Printer IPC
  ipcMain.handle('printers:get', async () => {
    return await printer.getPrinters();
  });

  ipcMain.handle('print:job', async (_, { job, filePath }: { job: PrintJob; filePath: string }) => {
    return await printer.printJob(job, filePath);
  });

  // Logs IPC
  ipcMain.handle('logs:get', async () => {
    return logger.getLogs();
  });

  ipcMain.handle('logs:clear', async () => {
    return logger.clearLogs();
  });

  // Auto Start IPC
  ipcMain.handle('system:set-autolaunch', async (_, enabled: boolean) => {
    try {
      logger.log('info', `Configuring auto-launch state: ${enabled}`);
      if (enabled) {
        await printFlowLauncher.enable();
      } else {
        await printFlowLauncher.disable();
      }
      storage.saveSettings({ autoLaunch: enabled });
      return true;
    } catch (err) {
      logger.log('error', `Failed to toggle auto-launch`, String(err));
      return false;
    }
  });

  // Window Controls IPC (Frameless utility bindings)
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:close', () => {
    const settings = storage.getSettings();
    if (settings.minimizeToTray) {
      mainWindow?.hide();
    } else {
      daemon.stop();
      app.quit();
    }
  });

  ipcMain.on('logs:open-folder', () => {
    shell.openPath(path.dirname(logger.getLogFilePath()));
  });
}

// App Lifecycle
app.whenReady().then(async () => {
  logger.log('info', '=========================================');
  logger.log('info', 'Starting PrintFlow Agent v2 Desktop App...');
  logger.log('info', '=========================================');

  registerIpcHandlers();
  createMainWindow();
  createSystemTray();

  // Initialize the Daemon background loop if already paired
  const settings = storage.getSettings();
  if (settings.isPaired) {
    logger.log('info', 'Paired state detected on boot. Starting background agent.');
    await daemon.initialize();
  }

  // Manage auto-launch registry sync
  try {
    const isEnabled = await printFlowLauncher.isEnabled();
    if (isEnabled !== settings.autoLaunch) {
      if (settings.autoLaunch) {
        await printFlowLauncher.enable();
      } else {
        await printFlowLauncher.disable();
      }
      logger.log('info', `Synced auto-launch state to matches settings: ${settings.autoLaunch}`);
    }
  } catch (e) {
    logger.log('warn', 'Failed to sync auto-launch registry state', String(e));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
