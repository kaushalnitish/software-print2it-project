import Store from 'electron-store';
import { AppSettings } from '../types';
import dotenv from 'dotenv';
import path from 'path';
import { app, safeStorage } from 'electron';
import crypto from 'crypto';
import fs from 'fs';

// Safely configure dotenv and load local .env files
try {
  dotenv.config({ path: path.join(process.cwd(), '.env'), override: true });

  // Also attempt to load .env from the app's standard path
  if (app) {
    try {
      dotenv.config({ path: path.join(app.getAppPath(), '.env'), override: true });
      dotenv.config({ path: path.join(path.dirname(app.getPath('exe')), '.env'), override: true });
    } catch (e) {
      // Ignore app-not-ready errors
    }
  }
} catch (e) {
  // Ignore errors outside of Electron context or missing files
}

const ENCRYPTION_SECRET = 'printflow-agent-secret-key-32chars!!'; // Fallback secret

export function encryptToken(token: string): string {
  if (!token) return '';
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64');
    }
  } catch (e) {
    // Fallback to crypto
  }
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_SECRET), iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch {
    return Buffer.from(token).toString('base64');
  }
}

export function decryptToken(encrypted: string): string {
  if (!encrypted) return '';
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
  } catch (e) {
    // Fallback
  }
  try {
    if (encrypted.includes(':')) {
      const parts = encrypted.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encryptedText = parts[1];
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_SECRET), iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
  } catch {
    // Fallback to plain base64
  }
  try {
    return Buffer.from(encrypted, 'base64').toString('utf8');
  } catch {
    return encrypted;
  }
}

const schema = {
  shopId: { type: 'string', default: '' },
  pairingKey: { type: 'string', default: '' },
  defaultPrinter: { type: 'string', default: '' },
  autoLaunch: { type: 'boolean', default: false },
  minimizeToTray: { type: 'boolean', default: true },
  supabaseUrl: { type: 'string', default: '' },
  supabaseAnonKey: { type: 'string', default: '' },
  isPaired: { type: 'boolean', default: false },
  agentToken: { type: 'string', default: '' }
} as const;

class StorageService {
  private store: any;

  constructor() {
    const StoreClass: any = (Store as any).default || Store;
    this.store = new StoreClass({
      name: 'printflow_config',
      // Ensure the store schema is validated
      schema: schema as any,
    });
  }

  public getSettings(): AppSettings & { agentToken?: string } {
    const envUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || this.store.get('supabaseUrl') || '';
    const envKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || this.store.get('supabaseAnonKey') || '';
    
    let rawToken = this.store.get('agentToken') || '';
    let decryptedToken = '';
    if (rawToken) {
      decryptedToken = decryptToken(rawToken);
    }

    return {
      shopId: this.store.get('shopId') || '',
      pairingKey: this.store.get('pairingKey') || '',
      defaultPrinter: this.store.get('defaultPrinter') || '',
      autoLaunch: !!this.store.get('autoLaunch'),
      minimizeToTray: this.store.get('minimizeToTray') !== false,
      supabaseUrl: envUrl,
      supabaseAnonKey: envKey,
      isPaired: !!this.store.get('isPaired'),
      pollingInterval: this.store.get('pollingInterval') || 30,
      realtimeEnabled: this.store.get('realtimeEnabled') !== false,
      tempFolder: this.store.get('tempFolder') || '',
      isPaused: !!this.store.get('isPaused'),
      agentToken: decryptedToken,
    };
  }

  public saveSettings(settings: Partial<AppSettings & { agentToken?: string }>): void {
    Object.entries(settings).forEach(([key, value]) => {
      if (key === 'agentToken' && value) {
        const encrypted = encryptToken(value as string);
        this.store.set('agentToken', encrypted);
      } else {
        this.store.set(key as keyof AppSettings, value);
      }
    });
  }

  public clear(): void {
    this.store.clear();
  }
}

let instance: StorageService | null = null;
export function getStorageService(): StorageService {
  if (!instance) {
    instance = new StorageService();
  }
  return instance;
}
