/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ElectronProvider, useElectron } from './context/ElectronContext';
import { WindowFrame } from './components/WindowFrame';
import { PairingWizard } from './pages/PairingWizard';
import { Dashboard } from './pages/Dashboard';
import { Loader2 } from 'lucide-react';

function MainLayout() {
  const { settings, initialized } = useElectron();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0c0f17] text-gray-200 select-none">
      {/* Top frameless drag and control utility */}
      <WindowFrame />
      
      {/* Content Area with conditional routing */}
      <div className="flex-1 overflow-hidden relative">
        {!initialized ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 space-y-4">
            <Loader2 size={32} className="animate-spin text-cyan-400" />
            <span className="text-xs font-mono text-cyan-300">Initializing PrintFlow Agent...</span>
          </div>
        ) : settings.isPaired ? (
          <Dashboard />
        ) : (
          <PairingWizard />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ElectronProvider>
      <MainLayout />
    </ElectronProvider>
  );
}
