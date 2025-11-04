/**
 * Reconnection Manager with Exponential Backoff
 * 
 * Handles automatic reconnection attempts with exponential backoff
 * to avoid overwhelming the server during connection issues.
 */

export interface ReconnectionConfig {
  /** Maximum number of reconnection attempts */
  maxAttempts?: number;
  /** Initial delay in milliseconds */
  baseDelay?: number;
  /** Maximum delay between attempts in milliseconds */
  maxDelay?: number;
  /** Jitter factor (0-1) to randomize delays */
  jitterFactor?: number;
}

/**
 * Manages automatic reconnection with exponential backoff
 */
export class ReconnectionManager {
  private attempts = 0;
  private readonly maxAttempts: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly jitterFactor: number;
  private reconnecting = false;
  
  constructor(config: ReconnectionConfig = {}) {
    this.maxAttempts = config.maxAttempts ?? 5;
    this.baseDelay = config.baseDelay ?? 1000; // 1 second
    this.maxDelay = config.maxDelay ?? 30000; // 30 seconds
    this.jitterFactor = config.jitterFactor ?? 0.1; // 10% jitter
  }
  
  /**
   * Get current number of attempts
   */
  getAttempts(): number {
    return this.attempts;
  }
  
  /**
   * Check if currently reconnecting
   */
  isReconnecting(): boolean {
    return this.reconnecting;
  }
  
  /**
   * Reset the reconnection state
   */
  reset(): void {
    this.attempts = 0;
    this.reconnecting = false;
  }
  
  /**
   * Calculate delay for next attempt with exponential backoff and jitter
   */
  private calculateDelay(): number {
    // Exponential backoff: baseDelay * 2^attempts
    const exponentialDelay = this.baseDelay * Math.pow(2, this.attempts);
    
    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = cappedDelay * this.jitterFactor * (Math.random() - 0.5);
    
    return Math.floor(cappedDelay + jitter);
  }
  
  /**
   * Attempt to reconnect with exponential backoff
   * 
   * @param reconnectFn - Async function that performs the reconnection
   * @param onAttempt - Optional callback called before each attempt
   * @returns Promise that resolves to true if reconnection succeeded, false otherwise
   */
  async reconnect(
    reconnectFn: () => Promise<void>,
    onAttempt?: (attempt: number, maxAttempts: number, delay: number) => void
  ): Promise<boolean> {
    if (this.reconnecting) {
      console.warn('[ReconnectionManager] Reconnection already in progress');
      return false;
    }
    
    this.reconnecting = true;
    this.attempts = 0;
    
    console.log(`[ReconnectionManager] Starting reconnection (max ${this.maxAttempts} attempts)`);
    
    while (this.attempts < this.maxAttempts) {
      const delay = this.calculateDelay();
      
      // Notify about upcoming attempt
      if (onAttempt) {
        onAttempt(this.attempts + 1, this.maxAttempts, delay);
      }
      
      // Wait before attempting (skip delay on first attempt)
      if (this.attempts > 0) {
        console.log(`[ReconnectionManager] Waiting ${delay}ms before attempt ${this.attempts + 1}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      try {
        console.log(`[ReconnectionManager] Reconnection attempt ${this.attempts + 1}/${this.maxAttempts}`);
        await reconnectFn();
        
        // Success!
        console.log('[ReconnectionManager] Reconnection successful');
        this.reset();
        return true;
        
      } catch (err) {
        this.attempts++;
        console.warn(
          `[ReconnectionManager] Attempt ${this.attempts}/${this.maxAttempts} failed:`,
          err instanceof Error ? err.message : err
        );
        
        // If we've exhausted all attempts, give up
        if (this.attempts >= this.maxAttempts) {
          console.error('[ReconnectionManager] All reconnection attempts exhausted');
          this.reconnecting = false;
          return false;
        }
      }
    }
    
    this.reconnecting = false;
    return false;
  }
  
  /**
   * Cancel ongoing reconnection attempts
   */
  cancel(): void {
    if (this.reconnecting) {
      console.log('[ReconnectionManager] Reconnection cancelled');
      this.reset();
    }
  }
}

