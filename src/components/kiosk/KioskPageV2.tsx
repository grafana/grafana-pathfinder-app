import React from 'react';
import { css } from '@emotion/css';
import { Button, useStyles2, useTheme2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { flattenKioskBlocks, type KioskPageV2 as Page, type KioskMode } from '../../types/kiosk-page.schema';
import { assertExhaustive } from '../../lib/assert-exhaustive';
import { Command, LaunchForm } from './KioskPage';
import { KioskTile } from './KioskTile';
import { KioskImage } from './KioskImage';
import { KioskMarkdown } from './KioskMarkdown';
import { kioskAppearanceClass } from './kiosk-appearance';
import { launchKioskGuide } from './launch-kiosk-guide';
import type { KioskRule } from './kiosk-rules';

const getStyles = (theme: GrafanaTheme2) => ({
  stack: css({
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--kiosk-gap, 24px)',
    minWidth: 0,
    overflowWrap: 'anywhere',
  }),
  section: css({ padding: theme.spacing(3), minWidth: 0, '& h2': { margin: 0 }, '& > p': { margin: 0 } }),
  column: css({
    '& > [data-kiosk-actions]:last-child': { marginTop: 'auto', paddingTop: theme.spacing(3) },
  }),
  columns: css({
    display: 'grid',
    gap: 'var(--kiosk-gap, 24px)',
    minWidth: 0,
    [theme.breakpoints.down('md')]: { gridTemplateColumns: '1fr !important' },
  }),
  hero: css({
    padding: theme.spacing(4),
    alignItems: 'center',
    '& h1, & h2': { lineHeight: 1.15, fontWeight: 600, margin: theme.spacing(2, 0) },
    '& p': { margin: 0 },
    [theme.breakpoints.down('sm')]: { padding: theme.spacing(2) },
  }),
  eyebrow: css({ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }),
  columnTitle: css({ fontSize: 'clamp(1.4rem, 2.4vw, 1.8rem)', lineHeight: 1.2, fontWeight: 600, margin: 0 }),
  actions: css({ display: 'flex', flexWrap: 'wrap', gap: theme.spacing(2), marginTop: theme.spacing(3) }),
  cards: css({
    display: 'grid',
    gap: 'var(--kiosk-gap, 24px)',
    gridTemplateColumns: 'repeat(var(--kiosk-columns, 2), minmax(0, 1fr))',
    [theme.breakpoints.down('md')]: { gridTemplateColumns: '1fr' },
  }),
  controlSurface: css({
    padding: theme.spacing(2),
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    borderRadius: 'var(--kiosk-radius, 8px)',
  }),
  divider: css({ borderTop: `1px solid ${theme.colors.border.medium}`, paddingTop: theme.spacing(2) }),
});

export function KioskPageV2({
  page,
  rules,
  mode,
  onLaunch,
  catalogUrl,
}: {
  page: Page;
  rules: KioskRule[];
  mode: KioskMode;
  onLaunch?: () => void;
  catalogUrl: string;
}) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const flat = flattenKioskBlocks(page.blocks);
  const ruleFor = (id: string) => rules.find((rule) => rule.id === id)!;
  const renderBlocks = (blocks: Page['blocks'], nested = false): React.ReactNode =>
    blocks.map((block, position) => {
      const index = flat.indexOf(block);
      const key = `${block.type}-${position}`;
      switch (block.type) {
        case 'section':
          return (
            <section
              key={key}
              className={`${styles.stack} ${styles.section} ${kioskAppearanceClass(block.appearance, theme)}`}
            >
              {block.title && <h2>{block.title}</h2>}
              {block.description && <p>{block.description}</p>}
              {renderBlocks(block.blocks, true)}
            </section>
          );
        case 'columns': {
          const fractions =
            block.columns.length === 3
              ? '1fr 1fr 1fr'
              : block.ratio === 'wide-left'
                ? '2fr 1fr'
                : block.ratio === 'wide-right'
                  ? '1fr 2fr'
                  : '1fr 1fr';
          return (
            <div key={key} className={styles.columns} style={{ gridTemplateColumns: fractions }}>
              {block.columns.map((column, i) => (
                <section
                  key={i}
                  className={`${styles.stack} ${styles.column} ${column.appearance ? styles.section : ''} ${kioskAppearanceClass(column.appearance, theme)}`}
                >
                  {(column.title || column.eyebrow || column.description) && (
                    <div>
                      {column.eyebrow && <p className={styles.eyebrow}>{column.eyebrow}</p>}
                      {column.title && <h2 className={styles.columnTitle}>{column.title}</h2>}
                      {column.description && <p style={{ margin: '8px 0 0' }}>{column.description}</p>}
                    </div>
                  )}
                  {renderBlocks(column.blocks, true)}
                </section>
              ))}
            </div>
          );
        }
        case 'hero': {
          const Heading = nested || position > 0 ? 'h2' : 'h1';
          const hasActions = block.primaryAction || block.secondaryAction;
          const split = block.layout === 'split' && (block.image || hasActions);
          const actions = hasActions ? (
            <div
              className={styles.actions}
              style={{
                justifyContent:
                  split && !block.image ? 'flex-end' : block.alignment === 'start' || split ? 'flex-start' : 'center',
                marginTop: split && !block.image ? 0 : undefined,
              }}
            >
              {[block.primaryAction, block.secondaryAction].map(
                (action, i) =>
                  action && (
                    <Button
                      key={i}
                      variant={i === 0 ? 'primary' : 'secondary'}
                      size="lg"
                      style={
                        i === 1
                          ? { background: theme.colors.background.primary, color: theme.colors.text.primary }
                          : {
                              background: `var(--kiosk-action-background, ${theme.colors.primary.main})`,
                              color: `var(--kiosk-action-foreground, ${theme.colors.primary.text})`,
                            }
                      }
                      onClick={() => launchKioskGuide(ruleFor(action.ruleId), mode, onLaunch, undefined, index)}
                    >
                      {action.label}
                    </Button>
                  )
              )}
            </div>
          ) : null;
          return (
            <section
              key={key}
              className={`${styles.hero} ${split ? styles.columns : styles.stack} ${kioskAppearanceClass(block.appearance ?? (block.variant === 'banner' ? { preset: 'subtle' } : undefined), theme)}`}
              style={{
                textAlign: block.alignment === 'start' || split ? 'left' : 'center',
                gridTemplateColumns: split ? (block.image ? '1.1fr 1fr' : '2fr 1fr') : undefined,
              }}
            >
              <div>
                <span className={styles.eyebrow}>{block.eyebrow}</span>
                <Heading
                  style={{
                    fontSize: {
                      medium: 'clamp(1.5rem, 3vw, 2rem)',
                      large: 'clamp(2rem, 4vw, 3rem)',
                      'extra-large': 'clamp(2.5rem, 5vw, 4rem)',
                    }[block.titleSize ?? 'large'],
                  }}
                >
                  {block.title}
                </Heading>
                {block.description && <p>{block.description}</p>}
                {(!split || block.image) && actions}
              </div>
              {block.image && <KioskImage image={block.image} catalogUrl={catalogUrl} />}
              {split && !block.image && actions}
            </section>
          );
        }
        case 'image':
          return <KioskImage key={key} image={block.image} catalogUrl={catalogUrl} />;
        case 'text':
          return (
            <div
              key={key}
              style={{
                textAlign: block.alignment === 'center' ? 'center' : 'left',
                fontSize: block.secondary ? theme.typography.sm.fontSize : undefined,
              }}
            >
              {block.format === 'markdown' ? (
                <KioskMarkdown content={block.content} />
              ) : (
                <p style={{ margin: 0 }}>{block.content}</p>
              )}
            </div>
          );
        case 'command':
          return <Command key={key} command={block.command} language={block.language} mode={mode} blockIndex={index} />;
        case 'divider':
          return (
            <div key={key} className={styles.divider}>
              {block.label}
            </div>
          );
        case 'launch-form':
          return (
            <div key={key} className={styles.controlSurface}>
              <LaunchForm
                key={key}
                block={block}
                blockIndex={index}
                rule={ruleFor(block.ruleId)}
                mode={mode}
                onLaunch={onLaunch}
              />
            </div>
          );
        case 'guide-links':
          return (
            <div
              key={key}
              data-kiosk-actions={block.layout === 'links' ? true : undefined}
              className={block.layout === 'cards' ? styles.cards : styles.actions}
              style={{ '--kiosk-columns': block.columns ?? 2 } as React.CSSProperties}
            >
              {block.links.map((link) => {
                const rule = ruleFor(link.ruleId);
                return block.layout === 'cards' ? (
                  <KioskTile
                    key={link.ruleId}
                    rule={{
                      ...rule,
                      title: link.label ?? rule.title,
                      description: link.description ?? rule.description,
                    }}
                    index={rules.indexOf(rule)}
                    blockIndex={index}
                    mode={mode}
                    onLaunch={onLaunch}
                    decoration={link}
                    catalogUrl={catalogUrl}
                  />
                ) : (
                  <Button
                    key={link.ruleId}
                    variant="secondary"
                    style={{ background: theme.colors.background.primary, color: theme.colors.text.primary }}
                    onClick={() => launchKioskGuide(rule, mode, onLaunch, undefined, index)}
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
    });
  return (
    <div
      className={styles.stack}
      style={
        page.spacing === 'spacious' && !page.appearance?.density
          ? ({ '--kiosk-gap': '40px' } as React.CSSProperties)
          : undefined
      }
    >
      {renderBlocks(page.blocks)}
    </div>
  );
}
