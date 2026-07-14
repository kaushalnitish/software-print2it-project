import React, { useState, useEffect } from 'react';
import { useElectron } from '../context/ElectronContext';
import { 
  Printer, 
  Check, 
  AlertCircle, 
  Loader2, 
  KeyRound, 
  Store,
  Cpu
} from 'lucide-react';

export const PairingWizard: React.FC = () => {
  const { 
    printers, 
    verifyPairing, 
    saveSettings, 
    toggleAutoLaunch,
    closeWindow,
    initialized
  } = useElectron();

  const [pairingCode, setPairingCode] = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fallback printers if no physical printers are available
  const displayPrinters = printers.length > 0 ? printers : [
    { name: 'Microsoft Print to PDF', isDefault: true },
    { name: 'Microsoft XPS Document Writer', isDefault: false }
  ];

  // Auto-select default printer when printers list loads
  useEffect(() => {
    if (displayPrinters.length > 0 && !selectedPrinter) {
      const defaultP = displayPrinters.find(p => p.isDefault)?.name || displayPrinters[0].name;
      setSelectedPrinter(defaultP);
    }
  }, [printers, selectedPrinter, displayPrinters]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pairingCode.trim() || !selectedPrinter) {
      setError('All fields are required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Verify pairing code with the SaaS database (Supabase)
      const result = await verifyPairing(pairingCode.trim());

      if (result.success) {
        setSuccess(true);
        // 2. Save everything locally & establish background daemon status
        await saveSettings({
          shopId: result.shopId || '',
          pairingKey: result.pairingKey || pairingCode.trim(),
          defaultPrinter: selectedPrinter,
          autoLaunch: true,
          minimizeToTray: true,
          isPaired: true,
          agentToken: result.agentToken || result.pairingKey || pairingCode.trim(),
        });
        
        // 3. Set Windows Startup parameter
        await toggleAutoLaunch(true);
      } else {
        setError(result.error || 'Connection failed. Please verify Pairing Code.');
      }
    } catch (err) {
      setError('Could not establish connection to the remote server. Please check your network.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full bg-[#070913] flex flex-col items-center justify-center p-4 font-sans text-gray-300">
      
      {/* Small Setup Utility Window Frame */}
      <div className="w-full max-w-sm bg-[#0e1120] border border-[#202744] rounded-xl p-6 shadow-2xl flex flex-col space-y-5">
        
        {/* Header Branding */}
        <div className="flex items-center gap-2.5 border-b border-[#1b2137] pb-3.5">
          <div className="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2 rounded-lg text-white shadow-md">
            <Cpu size={16} />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-cyan-400 uppercase tracking-wider font-mono">Agent Configuration</span>
            <span className="block text-sm font-extrabold text-white tracking-tight">PrintFlow Desktop Setup</span>
          </div>
        </div>

        {/* Informational Subtitle */}
        <p className="text-gray-400 text-xs leading-relaxed">
          Initialize this desktop background synchronization agent by entering your PrintFlow dashboard pairing code.
        </p>

        {/* Error Feedback */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-950/45 border border-rose-900/50 text-rose-300 rounded-lg p-3 text-xs">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {/* Success Feedback */}
        {success && (
          <div className="flex items-center gap-2.5 bg-emerald-950/45 border border-emerald-900/50 text-emerald-300 rounded-lg p-3 text-xs font-semibold animate-pulse">
            <Check size={14} className="text-emerald-400 shrink-0" />
            <span>Successfully connected! Starting background service...</span>
          </div>
        )}

        {/* Setup Form Fields */}
        <form onSubmit={handleConnect} className="space-y-4">
          
          {/* Pairing Code */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 flex items-center gap-1">
              <KeyRound size={11} className="text-gray-500" /> Pairing Code
            </label>
            <input
              type="text"
              required
              disabled={loading || success}
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value)}
              placeholder="Paste pairing code from PrintFlow SaaS dashboard"
              className="w-full bg-[#080a13] border border-[#232b4d] rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500 transition font-mono"
            />
          </div>

          {/* Default Printer Device */}
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-400 flex items-center gap-1">
              <Printer size={11} className="text-gray-500" /> Default Printer Device
            </label>
            {!initialized ? (
              <div className="flex items-center gap-2 text-[11px] text-amber-400 bg-amber-950/20 border border-amber-900/30 rounded-lg p-2.5">
                <Loader2 size={12} className="animate-spin shrink-0" /> Scanning local hardware devices...
              </div>
            ) : (
              <select
                disabled={loading || success}
                value={selectedPrinter}
                onChange={(e) => setSelectedPrinter(e.target.value)}
                className="w-full bg-[#080a13] border border-[#232b4d] rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500 transition cursor-pointer"
              >
                {displayPrinters.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Actions Submissions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={closeWindow}
              disabled={loading || success}
              className="flex-1 flex items-center justify-center bg-[#15192c] hover:bg-[#1b213a] border border-[#232b4a] text-gray-400 hover:text-white font-bold text-xs py-2.5 rounded-lg shadow-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || success || !pairingCode.trim()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 text-white font-bold text-xs py-2.5 rounded-lg shadow-lg transition cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Connecting...
                </>
              ) : (
                'Connect'
              )}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
