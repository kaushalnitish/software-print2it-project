import React, { useState, useEffect } from 'react';
import { useElectron } from '../context/ElectronContext';
import { createClient } from '@supabase/supabase-js';
import { 
  Cloud, 
  CloudOff, 
  Printer, 
  Settings, 
  RotateCw, 
  Terminal, 
  FileText, 
  AlertCircle,
  LogOut,
  X,
  Loader2,
  Check,
  Power,
  FolderOpen
} from 'lucide-react';
import { PrintJob } from '../types';

export const Dashboard: React.FC = () => {
  const {
    settings,
    printers,
    logs,
    supabaseConnected,
    activeJob,
    completedCount,
    failedCount,
    lastSyncTime,
    saveSettings,
    clearPairing,
    openLogsFolder,
    simulateIncomingJob,
    toggleAutoLaunch,
    closeWindow,
    virtualPrintCompleted,
    resetVirtualPrint
  } = useElectron();

  // Settings & Logs Overlays State
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Database jobs state for display
  const [dbJobs, setDbJobs] = useState<PrintJob[]>([]);
  const [fetchingDb, setFetchingDb] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Settings Local States (synced with settings object)
  const [selectedPrinterName, setSelectedPrinterName] = useState(settings.defaultPrinter);
  const [autoLaunch, setAutoLaunchState] = useState(settings.autoLaunch);
  const [minimizeToTray, setMinimizeToTray] = useState(settings.minimizeToTray);
  const [pollingInterval, setPollingInterval] = useState(settings.pollingInterval || 5);
  const [realtimeEnabled, setRealtimeEnabled] = useState(settings.realtimeEnabled !== false);
  const [tempFolder, setTempFolder] = useState(settings.tempFolder || 'C:\\Users\\Public\\PrintFlowTemp');

  useEffect(() => {
    setSelectedPrinterName(settings.defaultPrinter);
    setAutoLaunchState(settings.autoLaunch);
    setMinimizeToTray(settings.minimizeToTray);
    setPollingInterval(settings.pollingInterval || 5);
    setRealtimeEnabled(settings.realtimeEnabled !== false);
    setTempFolder(settings.tempFolder || 'C:\\Users\\Public\\PrintFlowTemp');
  }, [settings]);

  // Fetch real jobs assigned to this shop directly from Supabase for real-time backlog indicator
  const fetchPendingJobsCount = async () => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey || !settings.shopId) return;
    try {
      setFetchingDb(true);
      console.log("Loaded URL:", settings.supabaseUrl);
      console.log("Loaded Key Present:", !!settings.supabaseAnonKey);
      const client = createClient(settings.supabaseUrl, settings.supabaseAnonKey);
      const { data, error } = await client
        .from('print_jobs')
        .select('*')
        .eq('shop_id', settings.shopId)
        .in('status', ['waiting', 'pending']);

      if (!error && data) {
        setDbJobs(data as PrintJob[]);
      }
    } catch (err) {
      console.error('Error fetching pending jobs count:', err);
    } finally {
      setFetchingDb(false);
    }
  };

  // Poll database on interval to keep pending list accurate
  useEffect(() => {
    fetchPendingJobsCount();
    const interval = setInterval(fetchPendingJobsCount, 8000);
    return () => clearInterval(interval);
  }, [settings.shopId, activeJob, completedCount]);

  // Monitor virtual print completed trigger
  useEffect(() => {
    if (virtualPrintCompleted) {
      showTemporaryFeedback('Virtual Print Completed');
      resetVirtualPrint();
    }
  }, [virtualPrintCompleted, resetVirtualPrint]);

  // Action: Reconnect
  const handleReconnect = async () => {
    setReconnecting(true);
    setActionFeedback(null);
    try {
      // Re-trigger the background sync context
      await saveSettings({ ...settings });
      await new Promise(resolve => setTimeout(resolve, 1200));
      await fetchPendingJobsCount();
      showTemporaryFeedback('Connection reloaded and verified.');
    } catch (err) {
      showTemporaryFeedback('Reconnection failed.');
    } finally {
      setReconnecting(false);
    }
  };

  // Action: Print Test Page
  const handlePrintTest = async () => {
    setActionFeedback(null);
    try {
      await simulateIncomingJob({
        file_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        copies: 1,
        paper_size: 'A4',
        color: false,
        orientation: 'portrait',
        duplex: false
      });
      showTemporaryFeedback('Test receipt dispatched to print spooler.');
      setTimeout(fetchPendingJobsCount, 600);
    } catch (err) {
      showTemporaryFeedback('Failed to enqueue test document.');
    }
  };

  const showTemporaryFeedback = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3500);
  };

  // Save Settings actions
  const handlePrinterChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedPrinterName(val);
    await saveSettings({ defaultPrinter: val });
  };

  const handleAutoLaunchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoLaunchState(checked);
    await toggleAutoLaunch(checked);
  };

  const handleMinimizeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setMinimizeToTray(checked);
    await saveSettings({ minimizeToTray: checked });
  };

  const handlePollingChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = parseInt(e.target.value, 10);
    setPollingInterval(val);
    await saveSettings({ pollingInterval: val });
  };

  const handleRealtimeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setRealtimeEnabled(checked);
    await saveSettings({ realtimeEnabled: checked });
  };

  const handleTempFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTempFolder(val);
    await saveSettings({ tempFolder: val });
  };

  return (
    <div className="w-full h-full bg-[#070913] text-gray-300 font-sans flex items-center justify-center p-4 overflow-hidden select-none">
      
      {/* Compact Utility Window Card */}
      <div className="w-full max-w-sm bg-[#0e1120] border border-[#202744] rounded-xl shadow-2xl overflow-hidden relative flex flex-col">
        
        {/* Header (Product branding/identity) */}
        <div className="bg-[#0b0e1a] border-b border-[#1b2137] px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-cyan-500/10 p-1.5 rounded-lg border border-cyan-500/25 text-cyan-400">
              <Printer size={15} />
            </div>
            <div>
              <span className="block text-xs font-extrabold text-white leading-tight">PrintFlow Agent</span>
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-widest font-mono">Status</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-gray-500 font-semibold font-mono">v2.0.0</span>
          </div>
        </div>

        {/* Temporary Feedback Notification */}
        {actionFeedback && (
          <div className="bg-cyan-950/40 border-b border-cyan-800/30 text-cyan-300 px-4 py-2 text-[11px] font-medium flex items-center gap-2 animate-fadeIn shrink-0">
            <Check size={12} className="text-cyan-400 shrink-0" />
            <span className="truncate">{actionFeedback}</span>
          </div>
        )}

        {/* Spooling Status Indicator (Only appears when job is active) */}
        {activeJob && (
          <div className="bg-emerald-950/30 border-b border-emerald-900/30 text-emerald-300 px-4 py-2.5 text-[11px] flex items-center justify-between shrink-0 animate-pulse">
            <div className="flex items-center gap-2 truncate">
              <Loader2 size={12} className="animate-spin text-emerald-400 shrink-0" />
              <span className="truncate">Active printing spool: <strong className="font-mono text-white">{activeJob.id.substring(0, 8)}</strong></span>
            </div>
            <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded font-bold uppercase text-emerald-400">
              Spooling
            </span>
          </div>
        )}

        {/* Central Grid Metrics Dashboard */}
        <div className="p-4 space-y-3.5 flex-1 overflow-y-auto">
          
          {/* Metrics Layout */}
          <div className="grid grid-cols-2 gap-2.5">
            
            {/* Cloud Status */}
            <div className="bg-[#080a13] border border-[#1b2137]/80 rounded-lg p-3">
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Cloud Status</span>
              <div className="flex items-center gap-1.5 mt-1">
                {supabaseConnected ? (
                  <>
                    <Cloud size={13} className="text-emerald-400 shrink-0" />
                    <span className="text-[11px] font-black text-emerald-400">Connected</span>
                  </>
                ) : (
                  <>
                    <CloudOff size={13} className="text-rose-400 shrink-0" />
                    <span className="text-[11px] font-black text-rose-400">Offline</span>
                  </>
                )}
              </div>
            </div>

            {/* Printer Status */}
            <div className="bg-[#080a13] border border-[#1b2137]/80 rounded-lg p-3 overflow-hidden">
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Printer Status</span>
              <div className="flex items-center gap-1.5 mt-1 overflow-hidden" title={settings.defaultPrinter || 'No printer selected'}>
                <Printer size={13} className={settings.isPaused ? "text-amber-500 shrink-0" : "text-cyan-400 shrink-0"} />
                <span className={`text-[11px] font-black truncate ${settings.isPaused ? "text-amber-400" : "text-gray-200"}`}>
                  {settings.isPaused ? 'Paused' : settings.defaultPrinter ? 'Ready' : 'Missing'}
                </span>
              </div>
            </div>

            {/* Connected Shop */}
            <div className="bg-[#080a13] border border-[#1b2137]/80 rounded-lg p-3 overflow-hidden col-span-2">
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Connected Shop</span>
              <div className="text-[11px] font-black text-white mt-1 font-mono truncate" title={settings.shopId || 'Unpaired'}>
                {settings.shopId || 'Unlinked'}
              </div>
            </div>

            {/* Pending Jobs */}
            <div className="bg-[#080a13] border border-[#1b2137]/80 rounded-lg p-3">
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Pending Jobs</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className={`text-base font-black font-mono leading-none ${dbJobs.length > 0 ? 'text-amber-400' : 'text-gray-300'}`}>
                  {dbJobs.length}
                </span>
                <span className="text-[10px] text-gray-500 font-bold">in queue</span>
              </div>
            </div>

            {/* Completed Today */}
            <div className="bg-[#080a13] border border-[#1b2137]/80 rounded-lg p-3">
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Completed Today</span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-base font-black text-emerald-400 font-mono leading-none">
                  {completedCount}
                </span>
                <span className="text-[10px] text-gray-500 font-bold">success</span>
              </div>
            </div>

            {/* Last Sync */}
            <div className="bg-[#080a13] border border-[#1b2137]/80 rounded-lg p-3 col-span-2">
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider">Last Sync Check</span>
              <div className="text-[11px] font-black text-gray-300 mt-1 font-mono">
                {lastSyncTime}
              </div>
            </div>

          </div>

          {/* Action Suite Utility buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            
            {/* Reconnect */}
            <button
              onClick={handleReconnect}
              disabled={reconnecting}
              className="flex items-center justify-center gap-1.5 bg-[#15192c] hover:bg-[#1b213a] border border-[#232b4a] disabled:opacity-50 rounded-lg py-2 text-xs font-bold text-white transition cursor-pointer"
            >
              {reconnecting ? (
                <>
                  <Loader2 size={13} className="animate-spin text-cyan-400" />
                  <span>Syncing...</span>
                </>
              ) : (
                <>
                  <RotateCw size={12} className="text-cyan-400" />
                  <span>Reconnect</span>
                </>
              )}
            </button>

            {/* Print Test */}
            <button
              onClick={handlePrintTest}
              disabled={!!activeJob}
              className="flex items-center justify-center gap-1.5 bg-[#15192c] hover:bg-[#1b213a] border border-[#232b4a] disabled:opacity-50 rounded-lg py-2 text-xs font-bold text-white transition cursor-pointer"
            >
              <FileText size={12} className="text-cyan-400" />
              <span>Print Test</span>
            </button>

            {/* Open Logs */}
            <button
              onClick={() => setShowLogs(true)}
              className="flex items-center justify-center gap-1.5 bg-[#15192c] hover:bg-[#1b213a] border border-[#232b4a] rounded-lg py-2 text-xs font-bold text-white transition cursor-pointer"
            >
              <Terminal size={12} className="text-cyan-400" />
              <span>Open Logs</span>
            </button>

            {/* Settings Overlay trigger */}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center justify-center gap-1.5 bg-[#15192c] hover:bg-[#1b213a] border border-[#232b4a] rounded-lg py-2 text-xs font-bold text-white transition cursor-pointer"
            >
              <Settings size={12} className="text-cyan-400" />
              <span>Settings</span>
            </button>

          </div>

          {/* Core Service Kill/Exit button */}
          <div className="pt-2">
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to stop PrintFlow background agent and exit?')) {
                  closeWindow();
                }
              }}
              className="w-full flex items-center justify-center gap-1.5 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 rounded-lg py-2 text-xs font-extrabold text-rose-400 transition cursor-pointer animate-none"
            >
              <Power size={13} />
              <span>Exit Agent</span>
            </button>
          </div>

        </div>

        {/* LOGS DIRECT STREAMING CONSOLE OVERLAY */}
        {showLogs && (
          <div className="absolute inset-0 bg-[#070913]/95 z-40 flex flex-col p-4 animate-slideIn">
            <div className="flex items-center justify-between border-b border-[#1b2137] pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-cyan-400" />
                <span className="text-xs font-extrabold text-white">Streaming Logs</span>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={openLogsFolder}
                  className="p-1 bg-[#12162d] text-gray-400 hover:text-white rounded border border-[#22294c] text-[10px] font-bold flex items-center gap-1 cursor-pointer transition"
                  title="Open RAW logs directory"
                >
                  <FolderOpen size={11} />
                  <span>Raw Folder</span>
                </button>
                <button
                  onClick={() => setShowLogs(false)}
                  className="p-1 text-gray-500 hover:text-white rounded cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Scrollable console view */}
            <div className="flex-1 bg-[#04050a] border border-[#1b2137] rounded-lg p-3 overflow-y-auto font-mono text-[9px] text-gray-400 space-y-2">
              {logs.length === 0 ? (
                <div className="text-center italic text-gray-600 py-6">No console output logged.</div>
              ) : (
                logs.slice(0, 100).map((log, idx) => (
                  <div key={idx} className="border-b border-gray-900/60 pb-1 shrink-0">
                    <div className="flex items-center gap-1.5 text-[8px] text-gray-600">
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className={`uppercase text-[7px] px-0.5 rounded font-black ${log.level === 'error' ? 'text-rose-400 bg-rose-950/50' : 'text-cyan-400 bg-cyan-950/50'}`}>
                        {log.level}
                      </span>
                    </div>
                    <p className={`${log.level === 'error' ? 'text-rose-300' : 'text-gray-300'} mt-0.5 leading-normal`}>{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* SETTINGS UTILITY OVERLAY */}
        {showSettings && (
          <div className="absolute inset-0 bg-[#070913]/95 z-40 flex flex-col p-4 animate-slideIn">
            <div className="flex items-center justify-between border-b border-[#1b2137] pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Settings size={14} className="text-cyan-400" />
                <span className="text-xs font-extrabold text-white">Local Configuration</span>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1 text-gray-500 hover:text-white rounded cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-4 flex-1 overflow-y-auto">
              
              {/* Printer selector */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Active Printer Device
                </label>
                <select
                  value={selectedPrinterName}
                  onChange={handlePrinterChange}
                  className="w-full bg-[#080a13] border border-[#20273f] rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500 transition cursor-pointer"
                >
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} {p.isDefault ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Startup parameter auto-launch */}
              <label className="flex items-center justify-between cursor-pointer group bg-[#080a13] p-2.5 rounded-lg border border-[#1b2137] text-xs">
                <div>
                  <span className="block font-bold text-gray-300 group-hover:text-white transition">
                    Run on Startup
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    Start automatically with Windows.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoLaunch}
                  onChange={handleAutoLaunchChange}
                  className="w-4 h-4 rounded text-cyan-500 bg-gray-950 border-gray-700 focus:ring-cyan-500 cursor-pointer accent-cyan-500"
                />
              </label>

              {/* Minimize to tray parameter */}
              <label className="flex items-center justify-between cursor-pointer group bg-[#080a13] p-2.5 rounded-lg border border-[#1b2137] text-xs">
                <div>
                  <span className="block font-bold text-gray-300 group-hover:text-white transition">
                    Minimize to Tray
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    Keep running silent in Windows tray.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={minimizeToTray}
                  onChange={handleMinimizeChange}
                  className="w-4 h-4 rounded text-cyan-500 bg-gray-950 border-gray-700 focus:ring-cyan-500 cursor-pointer accent-cyan-500"
                />
              </label>

              {/* Realtime enabled */}
              <label className="flex items-center justify-between cursor-pointer group bg-[#080a13] p-2.5 rounded-lg border border-[#1b2137] text-xs">
                <div>
                  <span className="block font-bold text-gray-300 group-hover:text-white transition">
                    Realtime Sync
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    Instantly capture new jobs via Supabase.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={realtimeEnabled}
                  onChange={handleRealtimeChange}
                  className="w-4 h-4 rounded text-cyan-500 bg-gray-950 border-gray-700 focus:ring-cyan-500 cursor-pointer accent-cyan-500"
                />
              </label>

              {/* Pause Printing Queue */}
              <label className="flex items-center justify-between cursor-pointer group bg-[#080a13] p-2.5 rounded-lg border border-[#1b2137] text-xs">
                <div>
                  <span className="block font-bold text-gray-300 group-hover:text-white transition">
                    Pause Agent Queue
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-0.5">
                    Temporarily hold all automatic printing.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.isPaused}
                  onChange={async (e) => {
                    await saveSettings({ isPaused: e.target.checked });
                  }}
                  className="w-4 h-4 rounded text-cyan-500 bg-gray-950 border-gray-700 focus:ring-cyan-500 cursor-pointer accent-cyan-500"
                />
              </label>

              {/* Polling Interval Select */}
              <div className="space-y-1 bg-[#080a13] p-2.5 rounded-lg border border-[#1b2137] text-xs">
                <label className="block font-bold text-gray-300">
                  Fallback Polling Interval
                </label>
                <span className="block text-[10px] text-gray-500 mb-1.5">
                  How often the agent queries the cloud DB backup.
                </span>
                <select
                  value={pollingInterval}
                  onChange={handlePollingChange}
                  className="w-full bg-[#040509] border border-[#20273f] rounded px-2.5 py-1 text-xs text-gray-200 cursor-pointer focus:outline-none focus:border-cyan-500"
                >
                  <option value={2}>Every 2 seconds (High performance)</option>
                  <option value={5}>Every 5 seconds (Recommended)</option>
                  <option value={10}>Every 10 seconds</option>
                  <option value={30}>Every 30 seconds (Offline-saver)</option>
                </select>
              </div>

              {/* Temporary Storage Directory */}
              <div className="space-y-1 bg-[#080a13] p-2.5 rounded-lg border border-[#1b2137] text-xs">
                <label className="block font-bold text-gray-300">
                  Temporary Spool Folder
                </label>
                <span className="block text-[10px] text-gray-500 mb-1.5">
                  Directory where downloaded order documents are cached.
                </span>
                <input
                  type="text"
                  value={tempFolder}
                  onChange={handleTempFolderChange}
                  placeholder="e.g. C:\Users\Public\PrintFlowTemp"
                  className="w-full bg-[#040509] border border-[#20273f] rounded px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="border-t border-[#1b2137] my-2 pt-3" />

              {/* Unpair / Disconnect button */}
              <div className="space-y-1 bg-[#220d18]/20 border border-[#44122d]/30 rounded-lg p-2.5 text-[11px] text-rose-300">
                <span className="block font-bold text-rose-200">Reset Pairing</span>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed">
                  Disconnect this printer from the current shop to pair with a different location.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm('Disconnect shop pairing and return to configuration wizard?')) {
                      await clearPairing();
                    }
                  }}
                  className="w-full mt-2 flex items-center justify-center gap-1 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-800/30 rounded py-1.5 text-xs font-bold text-rose-400 cursor-pointer transition"
                >
                  <LogOut size={12} />
                  <span>Disconnect Shop</span>
                </button>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
};
