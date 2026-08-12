/**
 * Data Check Block Form
 *
 * Form for creating/editing data check blocks. The query and AI prompt fields
 * show and become required according to the selected mode.
 */

import React, { useState, useCallback } from 'react';
import { Button, Checkbox, Field, Input, RadioButtonGroup, Select, TextArea, useStyles2 } from '@grafana/ui';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import { testIds } from '../../../constants/testIds';
import type { BlockFormProps, JsonBlock } from '../types';
import type { DataCheckDatasourceType, DataCheckMode, JsonDataCheckBlock } from '../../../types/json-guide.types';

function isDataCheckBlock(block: JsonBlock): block is JsonDataCheckBlock {
  return block.type === 'data-check';
}

const MODE_OPTIONS: Array<{ label: string; value: DataCheckMode; description: string }> = [
  { label: 'Query', value: 'query', description: 'Run your query and pass if it returns data' },
  { label: 'AI', value: 'ai', description: 'Let the assistant investigate and decide' },
  { label: 'Either', value: 'either', description: 'Offer both and let the user pick' },
];

const DATASOURCE_TYPE_OPTIONS: Array<{ label: string; value: DataCheckDatasourceType }> = [
  { label: 'Prometheus', value: 'prometheus' },
  { label: 'Loki', value: 'loki' },
  { label: 'Tempo', value: 'tempo' },
  { label: 'Pyroscope', value: 'pyroscope' },
];

const QUERY_PLACEHOLDERS: Record<DataCheckDatasourceType, string> = {
  prometheus: 'container_cpu_usage_seconds_total',
  loki: '{job="varlogs"}',
  tempo: '{ name = "HTTP GET" }',
  pyroscope: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds|{}',
};

/**
 * Fields this form owns outright: a save rebuilds them from form state, so
 * their absence means the author cleared them. Everything else is carried over
 * untouched — `objectives`, `authorNote`, and `id`, whose stability keeps
 * completion progress from leaking across a block type change.
 */
const FORM_OWNED_FIELDS = [
  'type',
  'datasourceType',
  'mode',
  'title',
  'content',
  'query',
  'aiPrompt',
  'timeFrom',
  'timeTo',
  'failureMessage',
  'variableName',
  'requirements',
  'skippable',
  'hint',
] as const satisfies ReadonlyArray<keyof JsonDataCheckBlock>;

function carriedOverFields(block: JsonDataCheckBlock | null): Partial<JsonDataCheckBlock> {
  if (!block) {
    return {};
  }
  const carried: Record<string, unknown> = { ...block };
  for (const field of FORM_OWNED_FIELDS) {
    delete carried[field];
  }
  return carried as Partial<JsonDataCheckBlock>;
}

export function DataCheckBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);

  const initial = initialData && isDataCheckBlock(initialData) ? initialData : null;

  const [datasourceType, setDatasourceType] = useState<DataCheckDatasourceType>(
    initial?.datasourceType ?? 'prometheus'
  );
  const [mode, setMode] = useState<DataCheckMode>(initial?.mode ?? 'query');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [query, setQuery] = useState(initial?.query ?? '');
  const [aiPrompt, setAiPrompt] = useState(initial?.aiPrompt ?? '');
  const [timeFrom, setTimeFrom] = useState(initial?.timeFrom ?? '');
  const [timeTo, setTimeTo] = useState(initial?.timeTo ?? '');
  const [failureMessage, setFailureMessage] = useState(initial?.failureMessage ?? '');
  const [variableName, setVariableName] = useState(initial?.variableName ?? '');
  const [requirements, setRequirements] = useState(initial?.requirements?.join(', ') ?? '');
  const [skippable, setSkippable] = useState(initial?.skippable ?? false);
  const [hint, setHint] = useState(initial?.hint ?? '');

  const needsQuery = mode !== 'ai';
  const needsAiPrompt = mode !== 'query';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      const parsedRequirements = requirements
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      const block: JsonDataCheckBlock = {
        type: 'data-check',
        ...carriedOverFields(initial),
        datasourceType,
        mode,
        ...(title.trim() && { title: title.trim() }),
        ...(content.trim() && { content: content.trim() }),
        ...(needsQuery && query.trim() && { query: query.trim() }),
        ...(needsAiPrompt && aiPrompt.trim() && { aiPrompt: aiPrompt.trim() }),
        ...(timeFrom.trim() && { timeFrom: timeFrom.trim() }),
        ...(timeTo.trim() && { timeTo: timeTo.trim() }),
        ...(failureMessage.trim() && { failureMessage: failureMessage.trim() }),
        ...(variableName.trim() && { variableName: variableName.trim() }),
        ...(parsedRequirements.length > 0 && { requirements: parsedRequirements }),
        ...(skippable && { skippable }),
        ...(hint.trim() && { hint: hint.trim() }),
      };

      onSubmit(block as JsonBlock);
    },
    [
      initial,
      datasourceType,
      mode,
      title,
      content,
      query,
      aiPrompt,
      timeFrom,
      timeTo,
      failureMessage,
      variableName,
      requirements,
      skippable,
      hint,
      needsQuery,
      needsAiPrompt,
      onSubmit,
    ]
  );

  const isValid = (!needsQuery || query.trim().length > 0) && (!needsAiPrompt || aiPrompt.trim().length > 0);

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field label="Data source type" description="The user picks a data source of this type" required>
        <Select
          options={DATASOURCE_TYPE_OPTIONS}
          value={datasourceType}
          onChange={(v) => setDatasourceType((v.value as DataCheckDatasourceType) ?? 'prometheus')}
        />
      </Field>

      <Field label="Check mode" description="How the check decides whether the data is there" required>
        <RadioButtonGroup options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v ?? 'query')} />
      </Field>

      <Field label="Title" description="Short heading shown above the check">
        <Input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Check you have container metrics"
        />
      </Field>

      <Field label="Description" description="Markdown shown above the data source picker">
        <TextArea
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          placeholder="This guide needs container CPU data..."
          rows={3}
        />
      </Field>

      {needsQuery && (
        <Field label="Query" description="Passes when this returns any data" required>
          <TextArea
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={QUERY_PLACEHOLDERS[datasourceType]}
            rows={2}
          />
        </Field>
      )}

      {needsAiPrompt && (
        <Field label="AI prompt" description="What the assistant should verify" required>
          <TextArea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.currentTarget.value)}
            placeholder="the user has container CPU metrics"
            rows={2}
          />
        </Field>
      )}

      <Field label="Time range start" description="Defaults to now-1h">
        <Input value={timeFrom} onChange={(e) => setTimeFrom(e.currentTarget.value)} placeholder="now-1h" />
      </Field>

      <Field label="Time range end" description="Defaults to now">
        <Input value={timeTo} onChange={(e) => setTimeTo(e.currentTarget.value)} placeholder="now" />
      </Field>

      <Field label="Failure message" description="Shown under the step when the check fails">
        <Input
          value={failureMessage}
          onChange={(e) => setFailureMessage(e.currentTarget.value)}
          placeholder="No container CPU data found — install cAdvisor first."
        />
      </Field>

      <Field label="Variable name" description="Store the chosen data source uid for later blocks to reuse">
        <Input
          value={variableName}
          onChange={(e) => setVariableName(e.currentTarget.value)}
          placeholder="myDatasource"
        />
      </Field>

      <Field label="Requirements" description="Comma-separated requirement conditions">
        <Input
          value={requirements}
          onChange={(e) => setRequirements(e.currentTarget.value)}
          placeholder="has-datasource:prometheus"
        />
      </Field>

      <Field label="Hint" description="Message shown when requirements are not met">
        <Input
          value={hint}
          onChange={(e) => setHint(e.currentTarget.value)}
          placeholder="Configure a data source first"
        />
      </Field>

      <Checkbox
        label="Skippable"
        description="Allow users to continue when the data is missing"
        value={skippable}
        onChange={(e) => setSkippable(e.currentTarget.checked)}
      />

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="data-check" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button type="submit" disabled={!isValid}>
          {isEditing ? 'Update' : 'Add'} block
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid={testIds.blockEditor.formCancelButton}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
