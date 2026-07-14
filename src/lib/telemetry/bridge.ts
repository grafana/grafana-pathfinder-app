// Entry-safe telemetry sinks. Entry-eager modules (analytics, logging) must
// not import the Faro adapter — that would pull the whole telemetry package
// into module.js. The adapter chunk registers itself here when it loads (via
// initFaro's dynamic import); until then every sink no-ops, which matches
// the adapter's own pre-init behavior exactly.
import type { FaroLogLevel } from './faro-adapter';

export interface TelemetryBridge {
  pushFaroUserAction: (name: string, attributes?: Record<string, unknown>) => void;
  pushFaroError: (error: Error, context?: Record<string, string>) => void;
  pushFaroLog: (level: FaroLogLevel, message: string, context?: Record<string, string>) => void;
}

let bridge: TelemetryBridge | null = null;

export function registerTelemetryBridge(impl: TelemetryBridge): void {
  bridge = impl;
}

export function pushFaroUserAction(name: string, attributes?: Record<string, unknown>): void {
  bridge?.pushFaroUserAction(name, attributes);
}

export function pushFaroError(error: Error, context?: Record<string, string>): void {
  bridge?.pushFaroError(error, context);
}

export function pushFaroLog(level: FaroLogLevel, message: string, context?: Record<string, string>): void {
  bridge?.pushFaroLog(level, message, context);
}
