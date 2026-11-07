import { isPathfinderContent } from '../../lib/dom';
import { CLOUD_TOKEN_OBJECTIVE } from '../../lib/workflow-objectives';
import type { CheckResultError } from '../../types/requirements.types';

function isVisible(element: HTMLElement): boolean {
  // Do not use visibility helpers that inspect ancestor innerHTML: token forms can contain secrets.
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      current.hidden ||
      current.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0'
    ) {
      return false;
    }
  }
  return true;
}

export async function workflowReadyCheck(requirement: string): Promise<CheckResultError> {
  if (requirement !== CLOUD_TOKEN_OBJECTIVE) {
    return { requirement, pass: false, verdict: 'invalid', error: 'Unsupported workflow state check.' };
  }
  const fields = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-testid="generate-token-name-input"]')
  ).filter((field) => !isPathfinderContent(field) && isVisible(field));
  if (fields.length !== 1 || !fields[0]!.form) {
    return {
      requirement,
      pass: false,
      verdict: 'unavailable',
      error: 'Open the token creation form to check whether creation succeeded.',
    };
  }
  const form = fields[0]!.form!;
  // GenerateToken renders this marker only after its create mutation succeeds, including cached success.
  const success = form.querySelector<HTMLElement>('[data-testid="generate-token-success-message"]');
  const pass = !!success && isVisible(success);
  return {
    requirement,
    pass,
    verdict: pass ? 'satisfied' : 'unsatisfied',
    error: pass
      ? undefined
      : 'Finish creating the token. If creation failed, resolve the error shown in the token form.',
  };
}
