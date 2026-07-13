export interface Shop {
  id: string;
  pairing_key: string;
  name: string;
  created_at?: string;
}

export interface PrintJob {
  id: string;
  shop_id: string;
  file_url: string;
  status: 'waiting' | 'pending' | 'printing' | 'completed' | 'failed';
  copies: number;
  paper_size: string;
  color: boolean;
  orientation: 'portrait' | 'landscape';
  duplex: boolean;
  printer_name?: string;
  error_message?: string;
  created_at: string;
  updated_at?: string;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: string;
}

export interface AppSettings {
  shopId: string;
  pairingKey: string;
  defaultPrinter: string;
  autoLaunch: boolean;
  minimizeToTray: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  isPaired: boolean;
  pollingInterval: number;
  realtimeEnabled: boolean;
  tempFolder: string;
  isPaused: boolean;
  agentToken?: string;
}

export interface ElectronAPI {
  // Pairing & Auth
  saveSettings: (settings: Partial<AppSettings>) => Promise<boolean>;
  getSettings: () => Promise<AppSettings>;
  verifyPairing: (pairingCode: string, pairingKeyOrUrl?: string, supabaseUrl?: string, supabaseAnonKey?: string) => Promise<{ success: boolean; shopName?: string; shopId?: string; pairingKey?: string; error?: string }>;
  clearPairing: () => Promise<boolean>;

  // Printers
  getPrinters: () => Promise<PrinterInfo[]>;
  printJob: (job: PrintJob, filePath: string) => Promise<{ success: boolean; error?: string }>;

  // Queue & System
  getLogs: () => Promise<LogEntry[]>;
  clearLogs: () => Promise<boolean>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  minimizeWindow: () => void;
  closeWindow: () => void;
  openLogsFolder: () => void;
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
