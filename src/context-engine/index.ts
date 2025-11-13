// Export all context-related functionality
export * from '../types/context.types';
export * from './context.service';
export * from './context.hook';
export * from './context.init';

// Re-export commonly used types for backward compatibility
export type {
  DataSource,
  DashboardInfo,
  Recommendation,
  ContextData,
  UseContextPanelOptions,
  UseContextPanelReturn,
} from '../types/context.types';

// Re-export main service and hook
export { ContextService } from './context.service';
export { useContextPanel } from './context.hook';

// Re-export initialization functions
export { initializeContextServices, onPluginStart } from './context.init';
