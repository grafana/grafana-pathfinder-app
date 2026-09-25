import { KioskLaunchError } from '../../lib/kiosk-launch-error';
import { KioskFormError } from '../../lib/input-value';
import type { KioskInput, KioskMode } from '../../types/kiosk-page.schema';
import type { KioskRule } from './kiosk-rules';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { validateKioskValues } from '../../security/kiosk-inputs';
import { validateKioskDestination } from '../../docs-retrieval';
import { validateInternalNavigationPath } from '../../security/url-validator';
import { getGuideResponseId } from '../../lib/guide-response-id';
import { guideResponseStorage } from '../../lib/user-storage';
import { filterDatasourcesByType } from '../interactive-tutorial/datasource-options';

export async function prepareKioskInputs(
  rule: KioskRule,
  mode: KioskMode,
  inputs: KioskInput[],
  draft: Record<string, string>,
  signal: AbortSignal
) {
  if (
    mode !== 'instance' ||
    rule.type === 'learning-journey' ||
    (rule.targetUrl && new URL(rule.targetUrl).origin !== window.location.origin) ||
    (rule.page !== undefined && validateInternalNavigationPath(rule.page) === null)
  ) {
    throw new KioskLaunchError(
      'destination',
      'unsupported-destination',
      'Input forms require a standalone guide in this Grafana instance'
    );
  }
  const values = validateKioskValues(inputs, draft);
  for (const input of inputs) {
    if (
      input.inputType === 'datasource' &&
      values[input.variableName] &&
      !filterDatasourcesByType(input.datasourceFilter).some((ds) => ds.name === values[input.variableName])
    ) {
      throw new KioskFormError('Choose an available data source');
    }
  }
  const result = await prepareGuideLaunch(rule.url, {
    title: rule.title,
    source: 'url_param',
    requireResolvedSnippets: true,
  });
  signal.throwIfAborted();
  if (!result.ok) {
    throw new KioskLaunchError('prepare', result.errorCode, 'The guide could not be validated. Try again');
  }
  const { launch } = result;
  if (
    launch.type === 'learning-journey' ||
    launch.packageInfo?.packageManifest?.type === 'path' ||
    launch.preparedContent.metadata.learningJourney
  ) {
    throw new KioskLaunchError('destination', 'unsupported-destination', 'Input forms require a standalone guide');
  }
  try {
    validateKioskDestination(JSON.parse(launch.preparedContent.content), inputs);
  } catch (error) {
    if (!(error instanceof KioskLaunchError)) {
      throw error;
    }
    signal.throwIfAborted();
    return { launch, inputTransfer: 'skipped' as const, reason: error.reason };
  }
  signal.throwIfAborted();
  try {
    await guideResponseStorage.mergeResponses(
      getGuideResponseId(launch.preparedContent.url, window.location.origin),
      values
    );
  } catch {
    throw new KioskFormError('Could not save inputs. Try again', 'storage');
  }
  signal.throwIfAborted();
  return { launch, inputTransfer: 'saved' as const };
}
