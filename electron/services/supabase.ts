import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getStorageService } from './storage';
import { getLoggingService } from './logging';
import { getPrinterService } from './printer';
import { PrintJob } from '../types';
import { BrowserWindow } from 'electron';
import fs from 'fs';
import crypto from 'crypto';

/**
 * Decodes the pairing code to extract shopId and pairingKey
 */
function decodePairingCode(code: string): { shopId?: string; pairingKey: string } {
  const trimmed = code.trim();
  
  // 1. Try to check if it's base64 encoded
  try {
    if (/^[a-zA-Z0-9+/=]+$/.test(trimmed)) {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(decoded);
        const sId = parsed.shopId || parsed.shop_id || parsed.id;
        const pKey = parsed.pairingKey || parsed.pairing_key || parsed.key;
        if (sId && pKey) {
          return { shopId: String(sId).trim(), pairingKey: String(pKey).trim() };
        }
      } catch {
        // Not JSON, check if it's in the format "shopId:pairingKey" or "shopId|pairingKey"
        if (decoded.includes(':')) {
          const parts = decoded.split(':');
          return { shopId: parts[0].trim(), pairingKey: parts.slice(1).join(':').trim() };
        }
        if (decoded.includes('|')) {
          const parts = decoded.split('|');
          return { shopId: parts[0].trim(), pairingKey: parts.slice(1).join('|').trim() };
        }
      }
    }
  } catch (e) {
    // Ignore error, fallback
  }

  // 2. Try direct JSON parsing
  try {
    const parsed = JSON.parse(trimmed);
    const sId = parsed.shopId || parsed.shop_id || parsed.id;
    const pKey = parsed.pairingKey || parsed.pairing_key || parsed.key;
    if (sId && pKey) {
      return { shopId: String(sId).trim(), pairingKey: String(pKey).trim() };
    }
  } catch {
    // Ignore
  }

  // 3. Fallback: Treat as plain pairingKey/code. The database query will identify the shop
  return { pairingKey: trimmed };
}

export class SupabaseDaemon {
  private client: SupabaseClient | null = null;
  private storage = getStorageService();
  private logger = getLoggingService();
  private printer = getPrinterService();
  private subscription: any = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private activeJobs = new Set<string>(); // Prevent duplicate print executions
  private isInitializing = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private window: BrowserWindow | null = null;

  constructor() {}

  public setWindow(win: BrowserWindow) {
    this.window = win;
  }

  private notifyRenderer(channel: string, data: any) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  private scheduleReconnection() {
    if (this.reconnectTimeout) return;
    this.logger.log('info', 'Scheduling reconnection retry in 15 seconds...');
    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      const success = await this.initialize();
      if (!success) {
        this.scheduleReconnection();
      }
    }, 15000);
  }

  /**
   * Initializes Supabase client using stored credentials
   */
  public async initialize(): Promise<boolean> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.isInitializing) {
      this.logger.log('info', 'Daemon initialization already in progress, skipping overlapping call.');
      return false;
    }
    this.isInitializing = true;
    try {
      this.stop(); // Stop any existing listener first

      const settings = this.storage.getSettings();
      if (!settings.isPaired || !settings.supabaseUrl || !settings.supabaseAnonKey) {
        this.logger.log('warn', 'Daemon skip init: Agent is not paired yet');
        this.notifyRenderer('supabase:status', { connected: false, error: 'Not paired' });
        return false;
      }

      this.logger.log('info', 'Initializing Supabase connection', settings.supabaseUrl);
      
      this.client = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
        auth: { persistSession: false }
      });

      // Verify connection by performing a simple query
      const { error } = await this.client.from('shops').select('id').eq('id', settings.shopId).maybeSingle();
      
      if (error) {
        this.logger.log('error', 'Supabase connection check failed', error.message);
        this.notifyRenderer('supabase:status', { connected: false, error: error.message });
        this.scheduleReconnection();
        return false;
      }

      this.logger.log('info', 'Supabase connection verified successfully');
      this.notifyRenderer('supabase:status', { connected: true });
      
      // Start polling and realtime subscription
      this.start();
      return true;
    } catch (err) {
      this.logger.log('error', 'Exception in SupabaseDaemon init', String(err));
      this.notifyRenderer('supabase:status', { connected: false, error: String(err) });
      this.scheduleReconnection();
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Checks for shops and validates pairing using single Pairing Code
   */
  public async verifyPairing(
    pairingCode: string, 
    supabaseUrl: string, 
    supabaseAnonKey: string
  ): Promise<{ success: boolean; shopName?: string; shopId?: string; pairingKey?: string; agentToken?: string; error?: string }> {
    try {
      this.logger.log('info', `Attempting pairing verification with Code: ${pairingCode.substring(0, 8)}...`);
      
      const { shopId, pairingKey } = decodePairingCode(pairingCode);

      const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false }
      });

      let query = tempClient.from('shops').select('*');
      if (shopId) {
        query = query.eq('id', shopId);
      } else {
        query = query.eq('pairing_key', pairingKey);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        this.logger.log('error', `Pairing verification database error: ${error.message}`);
        return { success: false, error: `Database error: ${error.message}` };
      }

      if (!data) {
        this.logger.log('warn', `Pairing verification failed: Shop not found with the provided code.`);
        return { success: false, error: 'Invalid pairing code: Shop not found.' };
      }

      // Check pairing key if we had both decoded
      if (shopId && data.pairing_key && data.pairing_key !== pairingKey) {
        this.logger.log('warn', 'Pairing verification failed: Key mismatch');
        return { success: false, error: 'Invalid pairing code: Security mismatch.' };
      }

      const shopName = data.name || 'Unnamed Print Shop';
      const resolvedShopId = data.id;
      const resolvedPairingKey = data.pairing_key || pairingKey;
      const agentToken = crypto.randomBytes(32).toString('hex');

      this.logger.log('info', `Successfully verified pairing for: ${shopName} (${resolvedShopId})`);
      
      return { 
        success: true, 
        shopName,
        shopId: resolvedShopId,
        pairingKey: resolvedPairingKey,
        agentToken
      };
    } catch (err) {
      this.logger.log('error', 'Exception during pairing verification', String(err));
      return { success: false, error: String(err) };
    }
  }

  /**
   * Starts background listener services
   */
  private start() {
    this.startHeartbeat();
    this.startRealtime();
    this.startPolling();
    this.checkPendingJobs();
  }

  /**
   * Stops background listener services
   */
  public stop() {
    this.stopHeartbeat();
    this.stopRealtime();
    this.stopPolling();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.client = null;
    this.logger.log('info', 'Supabase background daemon stopped');
  }

  private async sendHeartbeat() {
    if (!this.client) {
      this.logger.log('warn', 'Heartbeat skipped: no client. Attempting automatic reconnection.');
      await this.initialize();
      return;
    }
    try {
      const settings = this.storage.getSettings();
      const { error } = await this.client
        .from('print_agents')
        .upsert({
          shop_id: settings.shopId,
          agent_version: '2.0.0',
          printer_name: settings.defaultPrinter || 'None',
          os_platform: process.platform,
          status: 'online',
          last_connected_at: new Date().toISOString()
        }, { onConflict: 'shop_id' });

      if (error) {
        this.logger.log('error', `Heartbeat update failed: ${error.message}. Triggering reconnection.`);
        this.notifyRenderer('supabase:status', { connected: false, error: error.message });
        await this.initialize();
      } else {
        this.logger.log('info', `Heartbeat sent successfully for shop_id: ${settings.shopId}`);
        this.notifyRenderer('supabase:status', { connected: true });
      }
    } catch (err) {
      this.logger.log('error', `Exception in sendHeartbeat: ${String(err)}. Triggering reconnection.`);
      this.notifyRenderer('supabase:status', { connected: false, error: String(err) });
      await this.initialize();
    }
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    
    // Send initial heartbeat immediately
    this.sendHeartbeat();

    // Heartbeat every 20 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Periodic database polling (fail-safe fallback)
   */
  private startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    
    // Poll every 30 seconds to guarantee delivery
    this.pollInterval = setInterval(() => {
      this.logger.log('info', 'Executing periodic fail-safe pending jobs poll');
      this.checkPendingJobs();
    }, 30000);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Realtime WebSocket subscription
   */
  private startRealtime() {
    if (!this.client) return;

    const settings = this.storage.getSettings();
    this.logger.log('info', 'Establishing Supabase Realtime channel subscription...');

    this.subscription = this.client
      .channel('print-jobs-daemon')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${settings.shopId}`,
        },
        (payload) => {
          this.logger.log('info', 'Realtime event: New print job inserted', payload.new.id);
          const job = payload.new as PrintJob;
          if (job.status === 'waiting' || job.status === 'pending') {
            this.processJob(job);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'print_jobs',
          filter: `shop_id=eq.${settings.shopId}`,
        },
        (payload) => {
          const job = payload.new as PrintJob;
          if (job.status === 'waiting' || job.status === 'pending') {
            this.logger.log('info', `Realtime event: Job updated to ${job.status} status`, job.id);
            this.processJob(job);
          }
        }
      )
      .subscribe((status) => {
        this.logger.log('info', `Supabase Realtime subscription status: ${status}`);
        this.notifyRenderer('supabase:realtime-status', { status });
      });
  }

  private stopRealtime() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  /**
   * Checks the database for any pending print jobs
   */
  private async checkPendingJobs() {
    if (!this.client) return;
    
    try {
      const settings = this.storage.getSettings();
      
      const { data, error } = await this.client
        .from('print_jobs')
        .select('*')
        .eq('shop_id', settings.shopId)
        .in('status', ['waiting', 'pending'])
        .order('created_at', { ascending: true });

      if (error) {
        this.logger.log('error', 'Error polling pending jobs', error.message);
        return;
      }

      if (data && data.length > 0) {
        this.logger.log('info', `Discovered ${data.length} pending jobs via poll`);
        for (const job of data) {
          await this.processJob(job as PrintJob);
        }
      }
    } catch (err) {
      this.logger.log('error', 'Exception in checkPendingJobs', String(err));
    }
  }

  /**
   * Processes an individual print job
   */
  private async processJob(job: PrintJob) {
    if (this.activeJobs.has(job.id)) {
      // Prevents running same job concurrently
      return;
    }

    this.activeJobs.add(job.id);
    this.logger.log('info', `Processing print job ${job.id}`, `Url: ${job.file_url}`);
    this.notifyRenderer('job:processing', job);

    let localTempPath = '';
    let preparedPdfPath = '';

    try {
      // 1. Update job status to printing in Supabase
      await this.updateJobStatusInDb(job.id, 'printing');
      this.notifyRenderer('job:status-updated', { jobId: job.id, status: 'printing' });

      // 2. Extract file extension from URL
      let extension = '.pdf';
      try {
        const parsedUrl = new URL(job.file_url);
        const pathname = parsedUrl.pathname;
        const matches = pathname.match(/\.[a-zA-Z0-9]+$/);
        if (matches) {
          extension = matches[0];
        } else {
          // If extension not found in path, try query params or header fallback
          const searchParams = parsedUrl.searchParams;
          // check supabase storage standard formats
          const mimeTypeParam = searchParams.get('mimetype') || '';
          if (mimeTypeParam.includes('png')) extension = '.png';
          else if (mimeTypeParam.includes('jpeg') || mimeTypeParam.includes('jpg')) extension = '.jpg';
          else if (mimeTypeParam.includes('word')) extension = '.docx';
          else if (mimeTypeParam.includes('text')) extension = '.txt';
        }
      } catch (e) {
        this.logger.log('warn', `Failed parsing URL extension, using .pdf fallback`, String(e));
      }

      // 3. Download file
      localTempPath = await this.printer.downloadFile(job.file_url, extension);

      // 4. Convert format if needed
      preparedPdfPath = await this.printer.preparePrintFile(localTempPath, extension);

      // 5. Check if the default printer config matches current settings
      const settings = this.storage.getSettings();
      const finalJob = {
        ...job,
        printer_name: job.printer_name || settings.defaultPrinter || undefined
      };

      // 6. Execute native printing
      const printResult = await this.printer.printJob(finalJob, preparedPdfPath);

      if (printResult.success) {
        // 7. Update status to completed
        await this.updateJobStatusInDb(job.id, 'completed');
        this.logger.log('info', `Successfully printed job ${job.id}`);
        this.notifyRenderer('job:status-updated', { jobId: job.id, status: 'completed' });
      } else {
        throw new Error(printResult.error || 'Unknown native print error');
      }

    } catch (err) {
      const errMsg = String(err);
      this.logger.log('error', `Failed to print job ${job.id}`, errMsg);
      
      // Update job status to failed with error message
      await this.updateJobStatusInDb(job.id, 'failed', errMsg);
      this.notifyRenderer('job:status-updated', { jobId: job.id, status: 'failed', error: errMsg });
    } finally {
      // Cleanup files
      if (localTempPath && fs.existsSync(localTempPath)) {
        fs.unlink(localTempPath, () => {});
      }
      if (preparedPdfPath && preparedPdfPath !== localTempPath && fs.existsSync(preparedPdfPath)) {
        fs.unlink(preparedPdfPath, () => {});
      }
      
      // Remove from active jobs after processing completes
      this.activeJobs.delete(job.id);
    }
  }

  /**
   * Updates job status in remote Supabase
   */
  private async updateJobStatusInDb(jobId: string, status: PrintJob['status'], errorMessage?: string) {
    if (!this.client) return;

    try {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (errorMessage) {
        updateData.error_message = errorMessage;
      }

      const { error } = await this.client
        .from('print_jobs')
        .update(updateData)
        .eq('id', jobId);

      if (error) {
        this.logger.log('error', `Failed to update job ${jobId} status in DB to ${status}`, error.message);
      }
    } catch (err) {
      this.logger.log('error', `Exception updating DB status for job ${jobId}`, String(err));
    }
  }
}

let instance: SupabaseDaemon | null = null;
export function getSupabaseDaemon(): SupabaseDaemon {
  if (!instance) {
    instance = new SupabaseDaemon();
  }
  return instance;
}
