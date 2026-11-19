import { config } from '@grafana/runtime';
import { parseBcp47Tag } from '../lib/guide-language';

export function getGrafanaUiLocale(): string | undefined {
  return parseBcp47Tag(config.bootData?.user?.language) ?? undefined;
}
