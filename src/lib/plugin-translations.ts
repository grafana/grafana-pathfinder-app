import pluginJson from '../plugin.json';
import { retryChunkImport } from './retry-chunk-import';

let initialization: Promise<void> | undefined;

export function ensurePluginTranslations(): Promise<void> {
  initialization ??= retryChunkImport(() => import('@grafana/i18n'))
    .then(async ({ initPluginTranslations }) => {
      await initPluginTranslations(pluginJson.id);
    })
    .catch((error: unknown) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}

export async function loadTranslatedModule<T>(load: () => Promise<T>): Promise<T> {
  // Scenes can translate during module evaluation, before React renders anything.
  await ensurePluginTranslations();
  return retryChunkImport(load);
}
