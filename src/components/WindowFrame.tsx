import React from 'react';
import { useElectron } from '../context/ElectronContext';
import { Minus, X, Printer, Monitor, Layers } from 'lucide-react';

export const WindowFrame: React.FC = () => {
  const { isElectron, minimizeWindow, closeWindow } = useElectron();

  return (
    <header 
      id="window-frame-header"
      className="flex items-center justify-between bg-[#080a10] border-b border-[#161b2a] px-4 py-2 select-none"
      style={{ WebkitAppRegion: isElectron ? 'drag' : 'no-drag' } as any}
    >
      {/* Brand Label */}
      <div className="flex items-center gap-2">
        <div className="bg-gradient-to-tr from-cyan-500 to-indigo-600 p-1.5 rounded-lg text-white shadow-lg shadow-cyan-900/20">
          <Printer size={16} />
        </div>
        <span className="font-sans font-semibold text-sm text-gray-200 tracking-tight">
          PrintFlow <span className="text-cyan-400 font-mono text-xs">v2</span>
        </span>
        
        {/* Runtime Environment Badge */}
        <span className="ml-3 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider font-semibold border bg-emerald-950/40 text-emerald-400 border-emerald-800/50">
          Desktop Agent
        </span>
      </div>

      {/* Control Buttons */}
      <div 
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <button
          onClick={minimizeWindow}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800/60 transition"
          title="Minimize to Tray"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={closeWindow}
          className="p-1.5 rounded text-gray-400 hover:text-rose-400 hover:bg-rose-950/30 transition"
          title="Close (Minimize to Tray)"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
};
