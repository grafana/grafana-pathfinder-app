import React, { useEffect, useMemo, useState } from 'react';
import { config } from '@grafana/runtime';
import { Button, Field, Combobox, Stack } from '@grafana/ui';
import { z } from 'zod';
import { GuideOutcomesSchema } from '../../types/outcome.schema';
import type { GuideOutcome, OutcomeScope } from '../../types/outcome.types';
import { getFeatureFlagValue } from '../../utils/openfeature';
import { hashString } from '../../lib/hash.util';
import { createUserStorage } from '../../lib/user-storage';
import { createOutcomeEvidenceStore, type OutcomeEvidenceStore } from '../../lib/outcomes/outcome-evidence';
import { useOutcomeCheck } from './use-outcome-check';
import { OutcomeAssistantContext } from '../../integrations/assistant-integration';

export const VERIFIED_OUTCOMES_FLAG = 'pathfinder.verified-outcomes';
const PilotSchema = z.object({ id: z.literal('first-dashboard-cloud'), outcomes: GuideOutcomesSchema });
const statusLabels = {
  satisfied: 'Verified',
  unsatisfied: 'Not met yet',
  unavailable: 'Could not check. Try again.',
  invalid: 'Select a valid resource.',
};

function OutcomeRow({
  scope,
  outcome,
  store,
}: {
  scope: OutcomeScope;
  outcome: GuideOutcome;
  store: OutcomeEvidenceStore;
}) {
  const state = useOutcomeCheck(scope, outcome, store);
  return (
    <section aria-label={outcome.label}>
      <OutcomeAssistantContext
        guideRevision={scope.guideRevision}
        outcome={outcome}
        resourceUid={state.resourceUid}
        checking={state.checking}
        result={state.result}
        lastVerifiedAt={state.historical?.verifiedAt}
      />
      <Field label={outcome.label}>
        <Combobox
          aria-label={outcome.label}
          value={state.resource}
          options={state.loadOptions}
          key={state.resourceRefresh}
          onChange={(option) => state.selectResource(option.value, option.label)}
          placeholder="Choose a resource"
        />
      </Field>
      <Stack gap={1}>
        <Button size="sm" disabled={!state.resourceUid || state.checking} onClick={state.check}>
          Check outcome
        </Button>
        {state.checking && (
          <Button size="sm" variant="secondary" onClick={state.cancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={state.reloadResources}>
          Refresh resources
        </Button>
      </Stack>
      <p role="status">
        {state.checking ? 'Checking…' : state.result?.verdict ? statusLabels[state.result.verdict] : 'Not checked'}
      </p>
      {state.historical && <p>Last verified: {new Date(state.historical.verifiedAt).toLocaleString()}</p>}
      {state.storageError && <p role="alert">Verification history could not be saved or loaded.</p>}
    </section>
  );
}

function PilotSession({
  guideId,
  content,
  outcomes,
  userId,
  orgId,
}: {
  guideId: string;
  content: string;
  outcomes: GuideOutcome[];
  userId: string;
  orgId: string;
}) {
  const [revision, setRevision] = useState<string | null>(null);
  const [revisionError, setRevisionError] = useState(false);
  const store = useMemo(() => createOutcomeEvidenceStore(createUserStorage()), []);
  useEffect(() => {
    let cancelled = false;
    hashString(content)
      .then((value) => {
        if (!cancelled) {
          setRevision(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRevisionError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [content]);
  const scope = useMemo(
    () => (revision ? { userId, orgId, guideId, guideRevision: revision } : null),
    [userId, orgId, guideId, revision]
  );
  if (revisionError) {
    return <p role="alert">Outcome verification could not start. Reload to try again.</p>;
  }
  if (!scope) {
    return null;
  }
  return (
    <section aria-label="Verified outcomes">
      <h2>Verified outcomes</h2>
      <p>Guide progress tracks the instructions you complete. These checks verify the selected resources in Grafana.</p>
      {outcomes.map((outcome) => (
        <OutcomeRow key={outcome.id} scope={scope} outcome={outcome} store={store} />
      ))}
    </section>
  );
}

export function GuideOutcomePilot({ content, guideId }: { content: string; guideId: string }) {
  const enabled = getFeatureFlagValue(VERIFIED_OUTCOMES_FLAG, false);
  const pilot = useMemo(() => {
    if (!enabled) {
      return null;
    }
    try {
      const parsed = PilotSchema.safeParse(JSON.parse(content));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }, [content, enabled]);
  const user = config.bootData?.user;
  if (!pilot || !user?.id || !user.orgId) {
    return null;
  }
  return (
    <PilotSession
      key={JSON.stringify([guideId, content, user.id, user.orgId])}
      guideId={guideId}
      content={content}
      outcomes={pilot.outcomes}
      userId={String(user.id)}
      orgId={String(user.orgId)}
    />
  );
}
