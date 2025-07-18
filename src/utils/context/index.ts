// Export all context-related functionality
export * from './context.types';
export * from './context.service';
export * from './context.hook';

// Re-export commonly used types for backward compatibility
export type {
  DataSource,
  DashboardInfo,
  Recommendation,
  ContextData,
  UseContextPanelOptions,
  UseContextPanelReturn,
} from './context.types';

// Re-export main service and hook
export { ContextService } from './context.service';
export { useContextPanel } from './context.hook'; 