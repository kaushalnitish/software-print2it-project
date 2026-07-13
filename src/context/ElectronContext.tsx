import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AppSettings, PrinterInfo, LogEntry, PrintJob } from '../types';

interface ElectronContextType {
  settings: AppSettings;
  printers: PrinterInfo[];
  logs: LogEntry[];
  isElectron: boolean;
  isPaired: boolean;
  supabaseConnected: boolean;
  realtimeStatus: string;
  activeJob: PrintJob | null;
  completedCount: number;
  failedCount: number;
  lastSyncTime: string;
  initialized: boolean;
  saveSettings: (newSettings: Partial<AppSettings>) => Promise<boolean>;
  verifyPairing: (pairingCode: string, pairingKeyOrUrl?: string, url?: string, key?: string) => Promise<{ success: boolean; shopName?: string; shopId?: string; pairingKey?: string; error?: string }>;
  clearPairing: () => Promise<boolean>;
  clearLogs: () => Promise<boolean>;
  toggleAutoLaunch: (enabled: boolean) => Promise<boolean>;
  openLogsFolder: () => void;
  minimizeWindow: () => void;
  closeWindow: () => void;
  simulateIncomingJob: (job: Partial<PrintJob>) => void;
}

const defaultSettings: AppSettings = {
  shopId: '',
  pairingKey: '',
  defaultPrinter: '',
  autoLaunch: false,
  minimizeToTray: true,
  supabaseUrl: '',
  supabaseAnonKey: '',
  isPaired: false,
  pollingInterval: 5,
  realtimeEnabled: true,
  tempFolder: 'C:\\Users\\Public\\PrintFlowTemp',
  isPaused: false,
};

const ElectronContext = createContext<ElectronContextType | undefined>(undefined);

export const ElectronProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  
  // Settings State
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [initialized, setInitialized] = useState(false);
  
  // Live Sync & Daemon State (Browser mode fallback)
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState('Disconnected');
  const [activeJob, setActiveJob] = useState<PrintJob | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState('Never');

  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);

  // Load basic configurations
  const loadInitialData = useCallback(async () => {
    const startupLogs: LogEntry[] = [];
    const addStartupLog = (level: 'info' | 'warn' | 'error', message: string, context?: string) => {
      startupLogs.push({
        timestamp: new Date().toISOString(),
        level,
        message,
        context
      });
    };

    addStartupLog('info', 'Starting Agent...');

    const timeoutMs = 5000;

    const runWithTimeout = async <T,>(
      promiseFn: () => Promise<T>,
      defaultValue: T,
      stepName: string
    ): Promise<T> => {
      return new Promise<T>((resolve) => {
        const timer = setTimeout(() => {
          addStartupLog('warn', `[Timeout] ${stepName} took longer than ${timeoutMs / 1000}s. Continuing...`);
          resolve(defaultValue);
        }, timeoutMs);

        promiseFn()
          .then((val) => {
            clearTimeout(timer);
            resolve(val);
          })
          .catch((err) => {
            clearTimeout(timer);
            addStartupLog('error', `[Failed] ${stepName} error: ${err instanceof Error ? err.message : String(err)}`);
            resolve(defaultValue);
          });
      });
    };

    try {
      if (isElectron && window.electronAPI) {
        addStartupLog('info', 'Initializing Electron...');
        
        // 1. Loading local configuration
        addStartupLog('info', 'Loading local configuration...');
        const storedSettings = await runWithTimeout(
          async () => await window.electronAPI!.getSettings(),
          defaultSettings,
          'Loading local configuration'
        );
        setSettings(storedSettings);

        // 2. Loading printer list
        addStartupLog('info', 'Loading printer list...');
        const printerList = await runWithTimeout(
          async () => await window.electronAPI!.getPrinters(),
          [] as PrinterInfo[],
          'Loading printer list'
        );
        setPrinters(printerList);

        if (storedSettings.isPaired) {
          addStartupLog('info', 'Connecting to Supabase...');
        }

        // 3. Loading existing logs
        const logList = await runWithTimeout(
          async () => await window.electronAPI!.getLogs(),
          [] as LogEntry[],
          'Loading system logs'
        );
        
        // Add all startup logs into the beginning of the loaded logs
        const finalLogs = [...startupLogs, ...logList].slice(0, 500);
        setLogs(finalLogs);

      } else {
        // Browser/Web fallback initialization
        addStartupLog('info', 'Initializing Web Agent...');
        
        // 1. Loading local configuration
        addStartupLog('info', 'Loading local configuration...');
        let storedSettings = { ...defaultSettings };
        const stored = localStorage.getItem('printflow_sim_settings');
        if (stored) {
          try {
            storedSettings = { ...storedSettings, ...JSON.parse(stored) };
          } catch (e) {
            addStartupLog('warn', 'Failed to parse localStorage settings', String(e));
          }
        }

        // Overwrite with environment variables if provided
        const envUrl = (import.meta as any).env.VITE_SUPABASE_URL || '';
        const envKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';
        if (envUrl) {
          storedSettings.supabaseUrl = envUrl;
        }
        if (envKey) {
          storedSettings.supabaseAnonKey = envKey;
        }

        setSettings(storedSettings);

        // 2. Loading printer list
        addStartupLog('info', 'Loading printer list...');
        const mockPrinters: PrinterInfo[] = [
          { name: 'Microsoft Print to PDF', isDefault: true },
          { name: 'Office Jet Pro 8020 Series', isDefault: false },
          { name: 'LabelPrinter Pro (Thermal)', isDefault: false },
          { name: 'Brother MFC-L2710DW Series', isDefault: false }
        ];
        setPrinters(mockPrinters);

        if (storedSettings.isPaired) {
          addStartupLog('info', 'Connecting to Supabase...');
        }

        // 3. Loading logs from localStorage
        let existingLogs: LogEntry[] = [];
        const storedLogs = localStorage.getItem('printflow_sim_logs');
        if (storedLogs) {
          try {
            existingLogs = JSON.parse(storedLogs);
          } catch {
            // ignore
          }
        }
        
        const finalLogs = [...startupLogs, ...existingLogs].slice(0, 500);
        setLogs(finalLogs);
        localStorage.setItem('printflow_sim_logs', JSON.stringify(finalLogs));
      }
    } catch (globalErr) {
      addStartupLog('error', 'Global startup initialization error occurred', String(globalErr));
      setLogs((prev) => [...startupLogs, ...prev].slice(0, 500));
    } finally {
      addStartupLog('info', 'Agent Ready.');
      // Append final Agent Ready confirmation to the logs
      setLogs((prev) => {
        // Avoid duplicate logging of "Agent Ready." if we already have it
        const hasReady = prev.some(l => l.message === 'Agent Ready.');
        if (hasReady) return prev;
        const readyLog: LogEntry = {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Agent Ready.'
        };
        const updated = [readyLog, ...prev];
        if (!isElectron) {
          localStorage.setItem('printflow_sim_logs', JSON.stringify(updated));
        }
        return updated;
      });
      setInitialized(true);
    }
  }, [isElectron]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Synchronize stats
  useEffect(() => {
    if (isElectron) {
      // Setup IPC event listeners for updates from Electron main process Daemon
      const ipc = (window as any).ipcRenderer; // exposed or standard preload hook
      
      const handleLogsUpdate = async () => {
        if (window.electronAPI) {
          const freshLogs = await window.electronAPI.getLogs();
          setLogs(freshLogs);
        }
      };

      const handleSettingsReset = () => {
        loadInitialData();
      };

      // Listen on window.electronAPI events
      // To keep it standard, we'll register standard listeners in preload or window object
      const handleDaemonStatus = (_event: any, data: { connected: boolean; error?: string }) => {
        setSupabaseConnected(data.connected);
        setRealtimeStatus(data.connected ? 'Connected' : `Error: ${data.error || 'Connection Failed'}`);
        if (data.connected) {
          setLastSyncTime(new Date().toLocaleTimeString());
        }
      };

      const handleRealtimeStatus = (_event: any, data: { status: string }) => {
        setRealtimeStatus(data.status);
      };

      const handleJobProcessing = (_event: any, job: PrintJob) => {
        setActiveJob(job);
        setLastSyncTime(new Date().toLocaleTimeString());
        addSimulatedLog('info', `Daemon started processing job ${job.id}`, `Url: ${job.file_url}`);
      };

      const handleJobStatusUpdated = (_event: any, data: { jobId: string; status: PrintJob['status']; error?: string }) => {
        if (data.status === 'completed') {
          setCompletedCount(prev => prev + 1);
          setActiveJob(null);
          addSimulatedLog('info', `Print job ${data.jobId} completed successfully`);
        } else if (data.status === 'failed') {
          setFailedCount(prev => prev + 1);
          setActiveJob(null);
          addSimulatedLog('error', `Print job ${data.jobId} failed to print`, data.error);
        } else if (data.status === 'printing') {
          addSimulatedLog('info', `Job ${data.jobId} is currently routing to print device`);
        }
        handleLogsUpdate();
      };

      let unsubscribers: (() => void)[] = [];

      if (window.electronAPI && typeof window.electronAPI.on === 'function') {
        const u1 = window.electronAPI.on('supabase:status', (data: any) => handleDaemonStatus(null, data));
        const u2 = window.electronAPI.on('supabase:realtime-status', (data: any) => handleRealtimeStatus(null, data));
        const u3 = window.electronAPI.on('job:processing', (job: any) => handleJobProcessing(null, job));
        const u4 = window.electronAPI.on('job:status-updated', (data: any) => handleJobStatusUpdated(null, data));
        const u5 = window.electronAPI.on('settings:reset-notify', () => handleSettingsReset());
        unsubscribers = [u1, u2, u3, u4, u5];
      }

      return () => {
        unsubscribers.forEach(unsub => unsub());
      };
    }
  }, [isElectron, loadInitialData]);

  // Logging function
  const addSimulatedLog = useCallback((level: 'info' | 'warn' | 'error', message: string, context?: string) => {
    const newLog: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };
    
    setLogs((prev) => {
      const updated = [newLog, ...prev].slice(0, 500);
      if (!isElectron) {
        localStorage.setItem('printflow_sim_logs', JSON.stringify(updated));
      }
      return updated;
    });
  }, [isElectron]);

  // Web Browser Mock Printing Daemon (active fallback when running in a normal browser)
  const processSimulatedJob = useCallback(async (job: PrintJob, client: SupabaseClient) => {
    if (settings.isPaused) {
      addSimulatedLog('warn', `Print engine is paused. Job ${job.id} held in queue.`);
      return;
    }
    setActiveJob(job);
    addSimulatedLog('info', `[PRINT ENGINE] Commencing download of file`, job.file_url);

    try {
      // Update remote db status to 'printing'
      await client.from('print_jobs').update({ status: 'printing', updated_at: new Date().toISOString() }).eq('id', job.id);
      addSimulatedLog('info', `[PRINT ENGINE] Job status updated to [printing] on remote database`);

      // Mock print network download + rendering latency
      await new Promise(resolve => setTimeout(resolve, 2000));

      addSimulatedLog('info', `[PRINT ENGINE] Rendering file format to device output commands`, `Target Printer: ${settings.defaultPrinter || 'Microsoft Print to PDF'}`);
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Update remote db status to 'completed'
      await client.from('print_jobs').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', job.id);
      
      setCompletedCount(prev => prev + 1);
      setActiveJob(null);
      setLastSyncTime(new Date().toLocaleTimeString());
      addSimulatedLog('info', `[PRINT ENGINE] Job ${job.id} dispatched to system print spooler successfully!`);

    } catch (e) {
      addSimulatedLog('error', `[PRINT ENGINE] Failed processing print pipeline`, String(e));
      await client.from('print_jobs').update({ 
        status: 'failed', 
        error_message: String(e), 
        updated_at: new Date().toISOString() 
      }).eq('id', job.id);
      setFailedCount(prev => prev + 1);
      setActiveJob(null);
    }
  }, [addSimulatedLog, settings.defaultPrinter, settings.isPaused]);

  // Supabase Web Simulation Engine (Listen and poll directly on client-side)
  useEffect(() => {
    if (isElectron || !settings.isPaired || !settings.supabaseUrl || !settings.supabaseAnonKey) {
      setSupabaseConnected(false);
      setRealtimeStatus('Disconnected');
      return;
    }

    addSimulatedLog('info', 'Connecting background agent to Supabase...', settings.supabaseUrl);
    setRealtimeStatus('Connecting');

    const client = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
      auth: { persistSession: false }
    });
    setSupabaseClient(client);

    let activeSubscription: any = null;
    let fallbackPoll: NodeJS.Timeout | null = null;

    const startAgentSync = async () => {
      try {
        // Confirm connection
        const { error } = await client.from('shops').select('id').eq('id', settings.shopId).maybeSingle();
        if (error) {
          throw error;
        }

        setSupabaseConnected(true);
        setRealtimeStatus('Connected');
        setLastSyncTime(new Date().toLocaleTimeString());
        addSimulatedLog('info', 'Agent connected successfully to Supabase');

        // Initial print_agents heartbeat registration
        const sendWebHeartbeat = async () => {
          try {
            const { error: agentErr } = await client
              .from('print_agents')
              .upsert({
                shop_id: settings.shopId,
                agent_version: '2.0.0',
                printer_name: settings.defaultPrinter || 'None',
                os_platform: 'web-simulation',
                status: 'online',
                last_connected_at: new Date().toISOString()
              }, { onConflict: 'shop_id' });

            if (agentErr) {
              addSimulatedLog('error', 'Heartbeat update failed in print_agents table', agentErr.message);
              setSupabaseConnected(false);
            } else {
              addSimulatedLog('info', `Heartbeat sent successfully for shop: ${settings.shopId}`);
              setSupabaseConnected(true);
              setLastSyncTime(new Date().toLocaleTimeString());
            }
          } catch (err) {
            addSimulatedLog('error', 'Heartbeat update exception', String(err));
            setSupabaseConnected(false);
          }
        };

        await sendWebHeartbeat();

        // Heartbeat poll every 20 seconds
        fallbackPoll = setInterval(sendWebHeartbeat, 20000);

      } catch (err) {
        setSupabaseConnected(false);
        setRealtimeStatus('Connection Error');
        addSimulatedLog('error', 'Agent connection failed', String(err));
      }
    };

    startAgentSync();

    return () => {
      if (activeSubscription) {
        activeSubscription.unsubscribe();
      }
      if (fallbackPoll) {
        clearInterval(fallbackPoll);
      }
      setSupabaseConnected(false);
      setRealtimeStatus('Disconnected');
    };
  }, [isElectron, settings.isPaired, settings.supabaseUrl, settings.supabaseAnonKey, settings.shopId, settings.isPaused, settings.pollingInterval, settings.realtimeEnabled, processSimulatedJob, addSimulatedLog]);


  // Action methods bridging Electron or Mocking

  const saveSettings = async (newSettings: Partial<AppSettings>): Promise<boolean> => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    if (isElectron && window.electronAPI) {
      return await window.electronAPI.saveSettings(newSettings);
    } else {
      localStorage.setItem('printflow_sim_settings', JSON.stringify(updated));
      addSimulatedLog('info', 'Updated app configuration settings', JSON.stringify(newSettings));
      return true;
    }
  };

  const verifyPairing = async (pairingCode: string, pairingKeyOrUrl?: string, url?: string, key?: string) => {
    let finalCode = pairingCode;
    let finalUrl = url || (import.meta as any).env.VITE_SUPABASE_URL || '';
    let finalKey = key || (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';

    // If we're called in the old style: verifyPairing(shopId, pairingKey, url, key)
    if (key !== undefined) {
      if (isElectron && window.electronAPI) {
        return await window.electronAPI.verifyPairing(pairingCode, pairingKeyOrUrl, finalUrl, finalKey);
      }
    }

    // Single code flow
    if (key === undefined) {
      finalUrl = pairingKeyOrUrl || (import.meta as any).env.VITE_SUPABASE_URL || '';
      finalKey = url || (import.meta as any).env.VITE_SUPABASE_ANON_KEY || '';
    }

    if (isElectron && window.electronAPI) {
      return await window.electronAPI.verifyPairing(finalCode, finalUrl, finalKey);
    } else {
      // Browser Mock
      try {
        addSimulatedLog('info', `Performing direct agent pairing verification for Code: ${finalCode.substring(0, 8)}...`);
        
        let decodedShopId: string | undefined = undefined;
        let decodedPairingKey = finalCode.trim();

        // Try decoding from Base64
        try {
          if (/^[a-zA-Z0-9+/=]+$/.test(decodedPairingKey)) {
            const decoded = atob(decodedPairingKey);
            try {
              const parsed = JSON.parse(decoded);
              const sId = parsed.shopId || parsed.shop_id || parsed.id;
              const pKey = parsed.pairingKey || parsed.pairing_key || parsed.key;
              if (sId && pKey) {
                decodedShopId = String(sId).trim();
                decodedPairingKey = String(pKey).trim();
              }
            } catch {
              if (decoded.includes(':')) {
                const parts = decoded.split(':');
                decodedShopId = parts[0].trim();
                decodedPairingKey = parts.slice(1).join(':').trim();
              } else if (decoded.includes('|')) {
                const parts = decoded.split('|');
                decodedShopId = parts[0].trim();
                decodedPairingKey = parts.slice(1).join('|').trim();
              }
            }
          }
        } catch {
          // ignore
        }

        const testClient = createClient(finalUrl, finalKey, { auth: { persistSession: false } });
        
        let query = testClient.from('shops').select('*');
        if (decodedShopId) {
          query = query.eq('id', decodedShopId);
        } else {
          query = query.eq('pairing_key', decodedPairingKey);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
          return { success: false, error: error.message };
        }

        if (!data) {
          return { success: false, error: 'Invalid pairing code: Shop not found.' };
        }

        if (decodedShopId && data.pairing_key && data.pairing_key !== decodedPairingKey) {
          return { success: false, error: 'Invalid pairing code: Security mismatch.' };
        }

        const shopName = data.name || 'Retail Print Shop';
        const resolvedShopId = data.id;
        const resolvedPairingKey = data.pairing_key || decodedPairingKey;

        addSimulatedLog('info', `Successfully paired with ${shopName} (${resolvedShopId}) via agent verification!`);
        return { 
          success: true, 
          shopName,
          shopId: resolvedShopId,
          pairingKey: resolvedPairingKey
        };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  };

  const clearPairing = async () => {
    setSettings(defaultSettings);
    setSupabaseConnected(false);
    setRealtimeStatus('Disconnected');
    setCompletedCount(0);
    setFailedCount(0);
    setActiveJob(null);

    if (isElectron && window.electronAPI) {
      return await window.electronAPI.clearPairing();
    } else {
      localStorage.removeItem('printflow_sim_settings');
      addSimulatedLog('warn', 'Shop pairing credentials cleared. System reset to wizard.');
      return true;
    }
  };

  const clearLogs = async () => {
    if (isElectron && window.electronAPI) {
      const res = await window.electronAPI.clearLogs();
      const logList = await window.electronAPI.getLogs();
      setLogs(logList);
      return res;
    } else {
      setLogs([]);
      localStorage.removeItem('printflow_sim_logs');
      return true;
    }
  };

  const toggleAutoLaunch = async (enabled: boolean): Promise<boolean> => {
    setSettings(prev => ({ ...prev, autoLaunch: enabled }));
    if (isElectron && window.electronAPI) {
      return await window.electronAPI.setAutoLaunch(enabled);
    } else {
      const updated = { ...settings, autoLaunch: enabled };
      localStorage.setItem('printflow_sim_settings', JSON.stringify(updated));
      addSimulatedLog('info', `Auto-launch ${enabled ? 'enabled' : 'disabled'} in agent settings.`);
      return true;
    }
  };

  const openLogsFolder = () => {
    if (isElectron && window.electronAPI) {
      window.electronAPI.openLogsFolder();
    } else {
      addSimulatedLog('info', 'System command: Open local log directories');
      alert(`Local Agent Mode:\nLogs are kept inside local system user directories.\nTotal logs size: ${logs.length} entries.`);
    }
  };

  const minimizeWindow = () => {
    if (isElectron && window.electronAPI) {
      window.electronAPI.minimizeWindow();
    } else {
      addSimulatedLog('info', 'System command: Minimize window frame.');
    }
  };

  const closeWindow = () => {
    if (isElectron && window.electronAPI) {
      window.electronAPI.closeWindow();
    } else {
      addSimulatedLog('info', 'System command: Close window frame (Minimized to tray).');
    }
  };

  // Utility to test incoming prints from inside the web-editor (mocking)
  const simulateIncomingJob = async (jobProps: Partial<PrintJob>) => {
    if (!settings.isPaired) {
      alert('Please pair the agent first before trying to trigger a print!');
      return;
    }
    
    const mockJob: PrintJob = {
      id: `job_sim_${Math.random().toString(36).substring(2, 9)}`,
      shop_id: settings.shopId,
      file_url: jobProps.file_url || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      status: 'waiting',
      copies: jobProps.copies || 1,
      paper_size: jobProps.paper_size || 'A4',
      color: jobProps.color !== undefined ? jobProps.color : true,
      orientation: jobProps.orientation || 'portrait',
      duplex: jobProps.duplex || false,
      created_at: new Date().toISOString(),
    };

    addSimulatedLog('info', `Enqueuing manual test print: ${mockJob.id}`);
    
    // Process using client if connected, or direct mock trigger if offline
    if (supabaseClient) {
      try {
        // Upload it straight to Supabase table so it syncs up completely!
        const { error } = await supabaseClient.from('print_jobs').insert([mockJob]);
        if (error) {
          throw error;
        }
        addSimulatedLog('info', `Successfully enqueued test print job: ${mockJob.id}`);
      } catch (e) {
        addSimulatedLog('warn', `Failed to queue job on db, processing locally`, String(e));
        // Fallback to local run
        processSimulatedJob(mockJob, {
          from: () => ({
            update: () => Promise.resolve({ error: null })
          })
        } as any);
      }
    } else {
      // Pure offline mock process
      processSimulatedJob(mockJob, {
        from: () => ({
          update: () => Promise.resolve({ error: null })
        })
      } as any);
    }
  };

  return (
    <ElectronContext.Provider
      value={{
        settings,
        printers,
        logs,
        isElectron,
        isPaired: settings.isPaired,
        supabaseConnected,
        realtimeStatus,
        activeJob,
        completedCount,
        failedCount,
        lastSyncTime,
        initialized,
        saveSettings,
        verifyPairing,
        clearPairing,
        clearLogs,
        toggleAutoLaunch,
        openLogsFolder,
        minimizeWindow,
        closeWindow,
        simulateIncomingJob,
      }}
    >
      {children}
    </ElectronContext.Provider>
  );
};

export const useElectron = () => {
  const context = useContext(ElectronContext);
  if (context === undefined) {
    throw new Error('useElectron must be used within an ElectronProvider');
  }
  return context;
};
