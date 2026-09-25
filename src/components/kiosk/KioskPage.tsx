import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import { KioskLaunchError } from '../../lib/kiosk-launch-error';
import { logger } from '../../lib/logging';
import React, { useEffect, useId, useRef, useState, useMemo } from 'react';
import { Button, Field, Input, Combobox, Icon, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import type { KioskPage as Page, KioskPageBlock, KioskMode } from '../../types/kiosk-page.schema';
import { reportKioskInteraction } from '../../lib/kiosk-analytics';
import { assertExhaustive } from '../../lib/assert-exhaustive';
import { KioskFormError, MAX_INPUT_LENGTH } from '../../lib/input-value';
import { filterDatasourcesByType, toDatasourceOptions } from '../interactive-tutorial/datasource-options';
import type { KioskRule } from './kiosk-rules';
import { launchKioskGuide } from './launch-kiosk-guide';
import { prepareKioskInputs } from './prepare-kiosk-inputs';
import { KioskTile } from './KioskTile';

const getStyles = (theme: GrafanaTheme2) => ({
  page: css({
    '--kiosk-block-gap': theme.spacing(4),
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--kiosk-block-gap)',
    padding: theme.spacing(2, 0),
  }),
  spacious: css({ '--kiosk-block-gap': theme.spacing(7), padding: theme.spacing(4, 0) }),
  text: css({ maxWidth: 850, width: '100%', margin: '0 auto' }),
  commandLabel: css({ marginBottom: `calc(${theme.spacing(2)} - var(--kiosk-block-gap))` }),
  commandDescription: css({ marginTop: `calc(${theme.spacing(2)} - var(--kiosk-block-gap))` }),
  center: css({ textAlign: 'center' }),
  hero: css({
    '& h1': { fontSize: 'clamp(2rem, 4vw, 3.5rem)', lineHeight: 1.15, margin: theme.spacing(2, 0, 3) },
    '& p': {
      fontSize: theme.typography.h4.fontSize,
      color: theme.colors.text.secondary,
      maxWidth: 850,
      margin: 'auto',
    },
  }),
  heroBanner: css({
    padding: theme.spacing(4),
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    '& h1': { fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', margin: theme.spacing(2, 0) },
    '& p': { maxWidth: 680, fontSize: theme.typography.body.fontSize },
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(3, 2) },
  }),
  heroBrand: css({ display: 'inline-flex', alignItems: 'center', gap: theme.spacing(1.5) }),
  bannerEyebrow: css({ color: theme.colors.text.secondary, fontWeight: theme.typography.fontWeightMedium }),
  eyebrow: css({ color: theme.colors.primary.text, fontWeight: theme.typography.fontWeightMedium }),
  secondary: css({ color: theme.colors.text.secondary }),
  form: css({ maxWidth: 850, width: '100%', margin: '0 auto' }),
  fields: css({
    display: 'flex',
    alignItems: 'flex-end',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
    '& > div': { flex: '1 1 260px' },
    '& button': { marginBottom: theme.spacing(2) },
  }),
  commandCode: css({
    flex: 1,
    minWidth: 0,
    '&& .token': { background: 'transparent' },
    '&& .token.function, && .token.builtin, && .token.keyword': { color: theme.colors.info.text },
    '&& .token.string': { color: theme.colors.success.text },
    '&& .token.operator, && .token.variable, && .token.parameter': { color: theme.colors.warning.text },
  }),
  commandContainer: css({ maxWidth: 850, width: '100%', margin: '0 auto' }),
  copyButton: css({ width: 104, minHeight: 44, flexShrink: 0 }),
  copyStatus: css({ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }),
  copyError: css({ marginTop: theme.spacing(1), color: theme.colors.error.text }),
  command: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    padding: theme.spacing(2, 3),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.secondary,
    '&& code, && code[class*="language-"]': {
      flex: 1,
      minWidth: 0,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      padding: 0,
      border: 0,
      borderRadius: 0,
      textShadow: 'none',
      lineHeight: 1.5,
      background: 'transparent',
      color: theme.colors.text.primary,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.h4.fontSize,
    },
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2), flexWrap: 'wrap', '& code': { flexBasis: '100%' } },
  }),
  divider: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(3),
    color: theme.colors.text.secondary,
    '&::before, &::after': { content: '""', height: 1, flex: 1, background: theme.colors.border.weak },
  }),
  cards: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: theme.spacing(3),
  }),
  links: css({ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: theme.spacing(3) }),
});

interface Props {
  page: Page;
  rules: KioskRule[];
  mode: KioskMode;
  onLaunch: () => void;
}

function renderCommandTokens(tokens: ReturnType<typeof Prism.tokenize>): React.ReactNode {
  return tokens.map((token, index) =>
    typeof token === 'string' ? (
      token
    ) : (
      <span key={index} className={`token ${token.type}`}>
        {typeof token.content === 'string' ? token.content : renderCommandTokens(token.content)}
      </span>
    )
  );
}

function Command({
  command,
  language = 'bash',
  mode,
  blockIndex,
}: {
  command: string;
  language?: 'bash' | 'text';
  mode: KioskMode;
  blockIndex: number;
}) {
  const styles = useStyles2(getStyles);
  const [status, setStatus] = useState('');
  const highlighted = useMemo(
    () => (language === 'bash' ? renderCommandTokens(Prism.tokenize(command, Prism.languages.bash)) : command),
    [command, language]
  );
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  return (
    <div className={styles.commandContainer}>
      <div className={styles.command}>
        <span aria-hidden="true">$</span>
        <code className={styles.commandCode}>{highlighted}</code>
        <Button
          variant="primary"
          className={styles.copyButton}
          aria-label="Copy"
          icon={status === 'Copied' ? 'check' : 'copy'}
          onClick={async () => {
            clearTimeout(resetTimer.current);
            try {
              await navigator.clipboard.writeText(command);
              setStatus('Copied');
              resetTimer.current = setTimeout(() => setStatus(''), 2000);
              reportKioskInteraction(mode, blockIndex, { component: 'command', action: 'copy', outcome: 'success' });
            } catch {
              setStatus('Could not copy. Select and copy the command manually');
              reportKioskInteraction(mode, blockIndex, { component: 'command', action: 'copy', outcome: 'error' });
            }
          }}
        >
          {status === 'Copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span role="status" className={status.startsWith('Could not') ? styles.copyError : styles.copyStatus}>
        {status}
      </span>
    </div>
  );
}

function LaunchForm({
  block,
  blockIndex,
  rule,
  mode,
  onLaunch,
}: {
  block: Extract<KioskPageBlock, { type: 'launch-form' }>;
  blockIndex: number;
  rule: KioskRule;
  mode: KioskMode;
  onLaunch: () => void;
}) {
  const styles = useStyles2(getStyles);
  const id = useId();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const changedInputs = useRef(new Set<number>());
  const reportChange = (inputIndex: number, inputType: 'text' | 'datasource') => {
    if (!changedInputs.current.has(inputIndex)) {
      changedInputs.current.add(inputIndex);
      reportKioskInteraction(mode, blockIndex, { component: 'input', action: 'change', inputIndex, inputType });
    }
  };
  useEffect(() => () => request.current?.abort(), []);
  return (
    <form
      className={styles.form}
      onSubmit={async (event) => {
        event.preventDefault();
        if (request.current) {
          return;
        }
        reportKioskInteraction(mode, blockIndex, { component: 'launch-form', action: 'submit' });
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setError('');
        try {
          const prepared = await prepareKioskInputs(rule, mode, block.inputs, draft, controller.signal);
          if (!controller.signal.aborted) {
            if (prepared.inputTransfer === 'skipped') {
              logger.warn(`Kiosk input transfer skipped: destination/${prepared.reason}`, {
                stage: 'destination',
                reason: prepared.reason,
                launch_mode: mode,
              });
              reportKioskInteraction(mode, blockIndex, { component: 'launch-form', action: 'fallback' });
            } else {
              reportKioskInteraction(mode, blockIndex, { component: 'launch-form', action: 'ready' });
            }
            launchKioskGuide(rule, mode, onLaunch, prepared.launch);
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            if (!(cause instanceof KioskFormError) || cause.reason === 'storage') {
              const stage =
                cause instanceof KioskLaunchError
                  ? cause.stage
                  : cause instanceof KioskFormError
                    ? 'storage'
                    : 'launch';
              const reason =
                cause instanceof KioskLaunchError
                  ? cause.reason
                  : cause instanceof KioskFormError
                    ? 'write-failed'
                    : 'unexpected-error';
              logger.error(`Kiosk guide launch failed: ${stage}/${reason}`, { stage, reason, launch_mode: mode });
            }
            reportKioskInteraction(mode, blockIndex, {
              component: 'launch-form',
              action: 'error',
              reason: cause instanceof KioskFormError ? cause.reason : 'unavailable',
            });
            setError(
              cause instanceof KioskFormError ? cause.message : 'Could not open this guide. Please try again later.'
            );
          }
        } finally {
          if (!controller.signal.aborted) {
            setBusy(false);
            request.current = null;
          }
        }
      }}
    >
      <div className={styles.fields}>
        {block.inputs.map((input, inputIndex) => (
          <Field
            key={input.variableName}
            label={input.prompt}
            htmlFor={`${id}-${input.variableName}`}
            required={input.required}
          >
            {input.inputType === 'datasource' ? (
              <Combobox
                id={`${id}-${input.variableName}`}
                disabled={busy}
                options={toDatasourceOptions(filterDatasourcesByType(input.datasourceFilter))}
                value={draft[input.variableName] ?? null}
                onChange={(option) => {
                  reportChange(inputIndex, 'datasource');
                  setDraft((previous) => ({ ...previous, [input.variableName]: option?.value ?? '' }));
                }}
              />
            ) : (
              <Input
                id={`${id}-${input.variableName}`}
                required={input.required}
                disabled={busy}
                maxLength={MAX_INPUT_LENGTH}
                placeholder={input.placeholder}
                value={draft[input.variableName] ?? ''}
                autoComplete="off"
                aria-describedby={error ? `${id}-error` : undefined}
                onInvalid={() =>
                  reportKioskInteraction(mode, blockIndex, {
                    component: 'input',
                    action: 'invalid',
                    inputIndex,
                    inputType: 'text',
                  })
                }
                onChange={(event) => {
                  reportChange(inputIndex, 'text');
                  const value = event.currentTarget.value;
                  setDraft((previous) => ({ ...previous, [input.variableName]: value }));
                }}
              />
            )}
          </Field>
        ))}
        <Button type="submit" disabled={busy || mode !== 'instance'}>
          {busy ? 'Opening guide…' : block.label}
        </Button>
      </div>
      {mode !== 'instance' && <p>Open this kiosk in instance mode to use its input form.</p>}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function KioskPage({ page, rules, mode, onLaunch }: Props) {
  const styles = useStyles2(getStyles);
  return (
    <div className={`${styles.page} ${page.spacing === 'spacious' ? styles.spacious : ''}`}>
      {page.blocks.map((block, index) => {
        switch (block.type) {
          case 'hero':
            return (
              <section
                key={index}
                className={`${styles.hero} ${block.variant === 'banner' ? styles.heroBanner : ''} ${block.alignment === 'start' ? '' : styles.center}`}
              >
                <div className={styles.heroBrand}>
                  {block.variant === 'banner' && <Icon name="grafana" size="xxl" aria-label="Grafana" />}
                  {block.eyebrow && (
                    <span className={block.variant === 'banner' ? styles.bannerEyebrow : styles.eyebrow}>
                      {block.eyebrow}
                    </span>
                  )}
                </div>
                <h1>{block.title}</h1>
                {block.description && <p>{block.description}</p>}
              </section>
            );
          case 'text':
            return (
              <p
                key={index}
                className={`${styles.text} ${block.alignment === 'center' ? styles.center : ''} ${block.secondary ? styles.secondary : ''} ${page.blocks[index + 1]?.type === 'command' ? styles.commandLabel : ''} ${page.blocks[index - 1]?.type === 'command' ? styles.commandDescription : ''}`}
              >
                {block.content}
              </p>
            );
          case 'divider':
            return (
              <div key={index} className={styles.divider}>
                {block.label}
              </div>
            );
          case 'command':
            return (
              <Command key={index} command={block.command} language={block.language} mode={mode} blockIndex={index} />
            );
          case 'launch-form':
            return (
              <LaunchForm
                key={index}
                block={block}
                blockIndex={index}
                rule={rules.find((rule) => rule.id === block.ruleId)!}
                mode={mode}
                onLaunch={onLaunch}
              />
            );
          case 'guide-links':
            return (
              <div key={index} className={block.layout === 'cards' ? styles.cards : styles.links}>
                {block.links.map((link) => {
                  const rule = rules.find((rule) => rule.id === link.ruleId)!;
                  if (block.layout === 'cards') {
                    return (
                      <KioskTile
                        key={link.ruleId}
                        rule={{
                          ...rule,
                          title: link.label ?? rule.title,
                          description: link.description ?? rule.description,
                        }}
                        index={rules.indexOf(rule)}
                        mode={mode}
                        onLaunch={onLaunch}
                      />
                    );
                  }
                  return (
                    <Button
                      key={link.ruleId}
                      variant="secondary"
                      onClick={() => launchKioskGuide(rule, mode, onLaunch)}
                    >
                      {link.label ?? rule.title}
                    </Button>
                  );
                })}
              </div>
            );
          default:
            assertExhaustive(block);
            return null;
        }
      })}
    </div>
  );
}
