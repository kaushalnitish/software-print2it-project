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
  pollingInterval?: number;
  realtimeEnabled?: boolean;
  tempFolder?: string;
  isPaused?: boolean;
}
