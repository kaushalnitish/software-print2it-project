import { contextBridge, ipcRenderer } from 'electron';
import { AppSettings, PrintJob } from '../types';

const electronAPI = {
  isElectron: true,

  // Settings & Pairing
  saveSettings: (settings: Partial<AppSettings>) => 
    ipcRenderer.invoke('settings:save', settings),
  
  getSettings: () => 
    ipcRenderer.invoke('settings:get'),
  
  verifyPairing: (pairingCode: string, pairingKeyOrUrl?: string, supabaseUrl?: string, supabaseAnonKey?: string) => {
    if (supabaseAnonKey !== undefined) {
      return ipcRenderer.invoke('pairing:verify', { 
        shopId: pairingCode, 
        pairingKey: pairingKeyOrUrl, 
        supabaseUrl, 
        supabaseAnonKey 
      });
    }
    return ipcRenderer.invoke('pairing:verify', { 
      pairingCode, 
      supabaseUrl: pairingKeyOrUrl, 
      supabaseAnonKey: supabaseUrl 
    });
  },
  
  clearPairing: () => 
    ipcRenderer.invoke('pairing:clear'),

  // Printers
  getPrinters: () => 
    ipcRenderer.invoke('printers:get'),
  
  printJob: (job: PrintJob, filePath: string) => 
    ipcRenderer.invoke('print:job', { job, filePath }),

  // Logs & System
  getLogs: () => 
    ipcRenderer.invoke('logs:get'),
  
  clearLogs: () => 
    ipcRenderer.invoke('logs:clear'),
  
  setAutoLaunch: (enabled: boolean) => 
    ipcRenderer.invoke('system:set-autolaunch', enabled),
  
  minimizeWindow: () => 
    ipcRenderer.send('window:minimize'),
  
  closeWindow: () => 
    ipcRenderer.send('window:close'),

  openLogsFolder: () => 
    ipcRenderer.send('logs:open-folder'),

  // Secure IPC event listener subscription
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
