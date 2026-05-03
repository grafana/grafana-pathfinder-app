import React, { useState, useCallback, useMemo } from 'react';
import { css } from '@emotion/css';
import { Button, Icon, IconButton, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import { substituteVariables } from '../../utils/variable-substitution';
import { escapeHtml } from '../../security/html-sanitizer';
import type {
  GrotGuideWelcome,
  GrotGuideQuestionScreen,
  GrotGuideResultScreen,
  GrotGuideLinkItem,
} from '../../types/json-guide.types';

// Props include pre-rendered bodyHtml from the parser
interface WelcomeWithHtml extends GrotGuideWelcome {
  bodyHtml: string;
}

interface ResultScreenWithHtml extends GrotGuideResultScreen {
  bodyHtml: string;
}

type ScreenWithHtml = GrotGuideQuestionScreen | ResultScreenWithHtml;

export interface GrotGuideBlockProps {
  welcome: WelcomeWithHtml;
  screens: ScreenWithHtml[];
  responses?: Record<string, unknown>;
}

const WELCOME_SENTINEL = '__welcome__';

export const GrotGuideBlock: React.FC<GrotGuideBlockProps> = ({ welcome, screens, responses = {} }) => {
  const styles = useStyles2(getStyles);

  // State: null = welcome screen, string = screen ID
  const [currentScreenId, setCurrentScreenId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  // Build a screen lookup map
  const screenMap = useMemo(() => {
    const map = new Map<string, ScreenWithHtml>();
    for (const screen of screens) {
      map.set(screen.id, screen);
    }
    return map;
  }, [screens]);

  // Variable substitution helper for plain text (used in React text nodes)
  const sub = useCallback(
    (text: string): string => {
      return substituteVariables(text, responses as Record<string, string | boolean | number>, {
        preserveUnmatched: true,
      });
    },
    [responses]
  );

  // Variable substitution helper for HTML content (escapes substituted values)
  const subHtml = useCallback(
    (html: string): string => {
      // SECURITY: Escape HTML in variable values before substituting into pre-sanitized HTML
      // to prevent XSS when user responses contain HTML characters (F1, F4)
      const escapedResponses: Record<string, string | boolean | number> = {};
      for (const [key, value] of Object.entries(responses)) {
        if (typeof value === 'string') {
          escapedResponses[key] = escapeHtml(value);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          escapedResponses[key] = value;
        }
        // Skip unknown types
      }
      return substituteVariables(html, escapedResponses, {
        preserveUnmatched: true,
      });
    },
    [responses]
  );

  // Navigate to a screen
  const navigateTo = useCallback(
    (screenId: string) => {
      setHistory((prev) => [...prev, currentScreenId ?? WELCOME_SENTINEL]);
      setCurrentScreenId(screenId);
    },
    [currentScreenId]
  );

  // Go back
  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const previous = prev[prev.length - 1];
      setCurrentScreenId(previous === WELCOME_SENTINEL ? null : (previous ?? null));
      return prev.slice(0, -1);
    });
  }, []);

  // Start over
  const startOver = useCallback(() => {
    setCurrentScreenId(null);
    setHistory([]);
  }, []);

  const currentScreen = currentScreenId ? screenMap.get(currentScreenId) : null;

  return (
    <div className={styles.container}>
      {currentScreenId === null ? (
        <WelcomeScreen welcome={welcome} sub={sub} subHtml={subHtml} onNavigate={navigateTo} styles={styles} />
      ) : currentScreen?.type === 'question' ? (
        <QuestionScreen
          screen={currentScreen}
          sub={sub}
          onNavigate={navigateTo}
          onBack={history.length > 0 ? goBack : undefined}
          styles={styles}
        />
      ) : currentScreen?.type === 'result' ? (
        <ResultScreen
          screen={currentScreen as ResultScreenWithHtml}
          sub={sub}
          subHtml={subHtml}
          onBack={history.length > 0 ? goBack : undefined}
          onStartOver={startOver}
          styles={styles}
        />
      ) : null}
    </div>
  );
};

// ============ Sub-components ============

interface WelcomeScreenProps {
  welcome: WelcomeWithHtml;
  sub: (text: string) => string;
  subHtml: (html: string) => string;
  onNavigate: (screenId: string) => void;
  styles: ReturnType<typeof getStyles>;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ welcome, sub, subHtml, onNavigate, styles }) => (
  <div>
    <h3 className={styles.title}>{sub(welcome.title)}</h3>
    {/* eslint-disable-next-line no-restricted-syntax -- bodyHtml is pre-sanitized at parse time via DOMPurify + sanitizeDocumentationHTML, and variable values are HTML-escaped */}
    <div className={styles.body} dangerouslySetInnerHTML={{ __html: subHtml(welcome.bodyHtml) }} />
    <div className={styles.ctaGroup}>
      {welcome.ctas.map((cta, i) => (
        <Button key={i} variant="primary" onClick={() => onNavigate(cta.screenId)} fullWidth>
          {sub(cta.text)}
        </Button>
      ))}
    </div>
  </div>
);

interface QuestionScreenProps {
  screen: GrotGuideQuestionScreen;
  sub: (text: string) => string;
  onNavigate: (screenId: string) => void;
  onBack?: () => void;
  styles: ReturnType<typeof getStyles>;
}

const QuestionScreen: React.FC<QuestionScreenProps> = ({ screen, sub, onNavigate, onBack, styles }) => (
  <div>
    {onBack && (
      <button className={styles.backButton} onClick={onBack}>
        <Icon name="arrow-left" size="sm" />
        Back
      </button>
    )}
    <h3 className={styles.title}>{sub(screen.title)}</h3>
    <div className={styles.options}>
      {screen.options.map((option, i) => (
        <button key={i} className={styles.option} onClick={() => onNavigate(option.screenId)}>
          {sub(option.text)}
          <Icon name="angle-right" size="lg" className={styles.optionArrow} />
        </button>
      ))}
    </div>
  </div>
);

interface ResultScreenProps {
  screen: ResultScreenWithHtml;
  sub: (text: string) => string;
  subHtml: (html: string) => string;
  onBack?: () => void;
  onStartOver: () => void;
  styles: ReturnType<typeof getStyles>;
}

const ResultScreen: React.FC<ResultScreenProps> = ({ screen, sub, subHtml, onBack, onStartOver, styles }) => (
  <div>
    {onBack && (
      <button className={styles.backButton} onClick={onBack}>
        <Icon name="arrow-left" size="sm" />
        Back
      </button>
    )}
    <h3 className={styles.title}>{sub(screen.title)}</h3>
    {/* eslint-disable-next-line no-restricted-syntax -- bodyHtml is pre-sanitized at parse time via DOMPurify + sanitizeDocumentationHTML, and variable values are HTML-escaped */}
    <div className={styles.body} dangerouslySetInnerHTML={{ __html: subHtml(screen.bodyHtml) }} />
    {screen.links && screen.links.length > 0 && (
      <div className={styles.links}>
        {screen.links.map((link: GrotGuideLinkItem, i: number) => {
          const isDocsLink = link.type === 'docs';
          const href = sub(link.href);
          const title = sub(link.title);

          const openInSidebar = () => {
            document.dispatchEvent(
              new CustomEvent('pathfinder-auto-open-docs', {
                detail: { url: href, title, source: 'grot_guide_block' },
              })
            );
          };

          const openInNewTab = () => {
            window.open(href, '_blank', 'noopener,noreferrer');
          };

          return (
            <div key={i} className={styles.link}>
              <button
                className={styles.linkButton}
                onClick={isDocsLink ? openInSidebar : openInNewTab}
                title={isDocsLink ? 'Open in Pathfinder' : 'Open in new tab'}
              >
                <div className={styles.linkContent}>
                  <span className={styles.linkTitle}>{title}</span>
                  <span className={styles.linkText}>{sub(link.linkText)}</span>
                </div>
                {!isDocsLink && <Icon name="external-link-alt" size="sm" className={styles.linkIcon} />}
              </button>
              {isDocsLink && (
                <Tooltip content="Open in new tab">
                  <IconButton
                    name="external-link-alt"
                    size="md"
                    aria-label="Open in new tab"
                    onClick={openInNewTab}
                    className={styles.linkExternalButton}
                  />
                </Tooltip>
              )}
            </div>
          );
        })}
      </div>
    )}
    <div className={styles.footer}>
      <Button variant="secondary" size="sm" onClick={onStartOver} icon="repeat">
        Start over
      </Button>
    </div>
  </div>
);

// ============ Styles ============

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    background: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(2),
    margin: `${theme.spacing(1.5)} 0`,
  }),

  title: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    margin: `0 0 ${theme.spacing(1.5)} 0`,
    color: theme.colors.text.primary,
  }),

  body: css({
    marginBottom: theme.spacing(2),
    color: theme.colors.text.secondary,
    lineHeight: theme.typography.body.lineHeight,
    '& p': {
      margin: `0 0 ${theme.spacing(1)} 0`,
      '&:last-child': {
        marginBottom: 0,
      },
    },
    '& a': {
      color: theme.colors.text.link,
      textDecoration: 'underline',
    },
  }),

  ctaGroup: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),

  backButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    background: 'none',
    border: 'none',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    padding: `${theme.spacing(0.5)} 0`,
    marginBottom: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      color: theme.colors.text.primary,
    },
  }),

  options: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),

  option: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1.5),
    padding: `${theme.spacing(1.5)} ${theme.spacing(2)}`,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textAlign: 'left',
    width: '100%',
    color: theme.colors.text.primary,
    fontSize: theme.typography.body.fontSize,
    '&:hover': {
      borderColor: theme.colors.border.medium,
      background: theme.colors.action.hover,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.main}`,
      outlineOffset: '2px',
    },
  }),

  optionArrow: css({
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),

  links: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
  }),

  link: css({
    display: 'flex',
    alignItems: 'center',
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',
    '&:hover': {
      borderColor: theme.colors.primary.border,
      background: theme.colors.primary.transparent,
    },
  }),

  linkButton: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1.5),
    padding: `${theme.spacing(1.5)} ${theme.spacing(2)}`,
    flex: 1,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'inherit',
  }),

  linkContent: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
  }),

  linkTitle: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    fontSize: theme.typography.body.fontSize,
  }),

  linkText: css({
    color: theme.colors.text.link,
    fontSize: theme.typography.bodySmall.fontSize,
  }),

  linkIcon: css({
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),

  linkExternalButton: css({
    flexShrink: 0,
    marginRight: theme.spacing(1),
    color: theme.colors.text.secondary,
  }),

  footer: css({
    display: 'flex',
    justifyContent: 'center',
    paddingTop: theme.spacing(1),
  }),
});
