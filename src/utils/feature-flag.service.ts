/**
 * Feature Flag Service for Grafana Docs Plugin
 * Based on Grafana Assistant's feature flag implementation
 * Manages feature toggles for experimental functionality
 */

import { useEffect, useState } from 'react';

type FeatureChangeListener = () => void;

export class FeatureFlagService {
  private static instance: FeatureFlagService;
  private readonly storageKey = 'grafana-docs-plugin-features';
  private features: Set<string> = new Set();
  private listeners: Set<FeatureChangeListener> = new Set();

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): FeatureFlagService {
    if (!FeatureFlagService.instance) {
      FeatureFlagService.instance = new FeatureFlagService();
    }
    return FeatureFlagService.instance;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: FeatureChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private loadFromStorage(): void {
    try {
      const stored = sessionStorage.getItem(this.storageKey);
      if (stored) {
        const features = JSON.parse(stored);
        if (Array.isArray(features)) {
          this.features = new Set(features);
        }
      }
    } catch (error) {
      console.error('Failed to load feature flags from storage:', error);
      // Clear corrupted data so defaults can be applied
      try {
        sessionStorage.removeItem(this.storageKey);
      } catch (removeError) {
        console.error('Failed to clear corrupted feature flags:', removeError);
      }
    }
  }

  private saveToStorage(): void {
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(Array.from(this.features)));
    } catch (error) {
      console.error('Failed to save feature flags to storage:', error);
    }
  }

  loadDefaults(defaultFeatures: string): void {
    if (!defaultFeatures) {
      return;
    }

    const defaults = defaultFeatures
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    // Always apply defaults as a baseline so server-provided flags take effect
    // Users can still toggle flags during the session via window.features
    defaults.forEach((feature) => {
      this.features.add(feature);
    });
    this.saveToStorage();
  }

  enable(feature: string): void {
    this.features.add(feature);
    this.saveToStorage();
    this.notifyListeners();
  }

  disable(feature: string): void {
    this.features.delete(feature);
    this.saveToStorage();
    this.notifyListeners();
  }

  isEnabled(feature: string): boolean {
    return this.features.has(feature);
  }

  toggle(feature: string): boolean {
    if (this.isEnabled(feature)) {
      this.disable(feature);
      return false;
    } else {
      this.enable(feature);
      return true;
    }
  }

  list(): string[] {
    return Array.from(this.features);
  }

  clear(): void {
    this.features.clear();
    this.saveToStorage();
    this.notifyListeners();
  }
}

export interface WindowWithFeatures extends Window {
  features: {
    enable: (feature: string) => void;
    disable: (feature: string) => void;
    isEnabled: (feature: string) => boolean;
    toggle: (feature: string) => boolean;
    list: () => string[];
    clear: () => void;
  };
}

export function initializeFeatureFlags(defaultFeatures?: string): void {
  const service = FeatureFlagService.getInstance();

  if (defaultFeatures) {
    service.loadDefaults(defaultFeatures);
  }

  // Expose feature flag controls to window for debugging (exactly like Grafana Assistant)
  (window as unknown as WindowWithFeatures).features = {
    enable: (feature: string) => service.enable(feature),
    disable: (feature: string) => service.disable(feature),
    isEnabled: (feature: string) => service.isEnabled(feature),
    toggle: (feature: string) => service.toggle(feature),
    list: () => service.list(),
    clear: () => service.clear(),
  };
}

export function useFeatureFlag(feature: string): boolean {
  const [isEnabled, setIsEnabled] = useState(() => FeatureFlagService.getInstance().isEnabled(feature));

  useEffect(() => {
    const service = FeatureFlagService.getInstance();

    // Check current state
    setIsEnabled(service.isEnabled(feature));

    // Subscribe to changes
    const unsubscribe = service.subscribe(() => {
      setIsEnabled(service.isEnabled(feature));
    });

    return unsubscribe;
  }, [feature]);

  return isEnabled;
}

/**
 * Check if a feature flag is enabled (synchronous, non-React version)
 * Useful for non-React contexts like bootstrap
 */
export function isFeatureEnabled(feature: string): boolean {
  return FeatureFlagService.getInstance().isEnabled(feature);
}
