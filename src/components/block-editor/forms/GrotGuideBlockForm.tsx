/**
 * Grot Guide Block Form
 *
 * JSON textarea editor with YAML import support for grot guide decision trees.
 */

import React, { useState, useCallback } from 'react';
import { Button, Field, Alert, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import yaml from 'js-yaml';
import { getBlockFormStyles } from '../block-editor.styles';
import { TypeSwitchDropdown } from './TypeSwitchDropdown';
import type { BlockFormProps, JsonBlock } from '../types';
import type { JsonGrotGuideBlock } from '../../../types/json-guide.types';

function isGrotGuideBlock(block: JsonBlock): block is JsonGrotGuideBlock {
  return block.type === 'grot-guide';
}

/**
 * Convert a Grot Guide YAML definition to the Pathfinder JSON block format.
 * Maps snake_case fields (screen_id, link_text) to camelCase (screenId, linkText)
 * and extracts only the welcome and screens fields.
 */
function convertYamlToBlock(yamlContent: string): JsonGrotGuideBlock {
  // Grot Guide YAML files use --- frontmatter delimiters which create multiple
  // YAML documents. Parse all documents and find the one with welcome/screens.
  const documents: any[] = [];
  yaml.loadAll(yamlContent, (doc) => documents.push(doc));

  const parsed = documents.find((doc) => doc && typeof doc === 'object' && (doc.welcome || doc.screens));

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid YAML: no document found with "welcome" or "screens" fields');
  }

  const welcome = parsed.welcome;
  const screens = parsed.screens;

  if (!welcome) {
    throw new Error('Missing "welcome" field in YAML');
  }
  if (!screens || !Array.isArray(screens)) {
    throw new Error('Missing or invalid "screens" field in YAML');
  }

  // Convert welcome CTAs
  const convertedWelcome = {
    title: welcome.title ?? '',
    body: welcome.body ?? '',

    ctas: (welcome.ctas ?? []).map((cta: any) => ({
      text: cta.text ?? '',
      screenId: cta.screen_id ?? cta.screenId ?? '',
    })),
  };

  // Convert screens

  const convertedScreens = screens.map((screen: any) => {
    if (screen.type === 'question') {
      return {
        type: 'question' as const,
        id: screen.id ?? '',
        title: screen.title ?? '',

        options: (screen.options ?? []).map((opt: any) => ({
          text: opt.text ?? '',
          screenId: opt.screen_id ?? opt.screenId ?? '',
        })),
      };
    } else if (screen.type === 'result') {
      return {
        type: 'result' as const,
        id: screen.id ?? '',
        title: screen.title ?? '',
        body: screen.body ?? '',
        links: screen.links
          ? screen.links.map((link: any) => ({
              type: link.type,
              title: link.title ?? '',
              linkText: link.link_text ?? link.linkText ?? link.text ?? '',
              href: link.href ?? '',
            }))
          : undefined,
      };
    }
    throw new Error(`Unknown screen type: ${screen.type}`);
  });

  return {
    type: 'grot-guide',
    welcome: convertedWelcome,
    screens: convertedScreens,
  };
}

const DEFAULT_BLOCK: JsonGrotGuideBlock = {
  type: 'grot-guide',
  welcome: {
    title: 'Welcome',
    body: 'Answer a few questions to find the right resource.',
    ctas: [{ text: "Let's go!", screenId: 'first_question' }],
  },
  screens: [
    {
      type: 'question',
      id: 'first_question',
      title: 'What are you looking for?',
      options: [{ text: 'Option A', screenId: 'result_a' }],
    },
    {
      type: 'result',
      id: 'result_a',
      title: 'Result A',
      body: 'Here is your answer.',
      links: [{ title: 'Documentation', linkText: 'Visit docs', href: 'https://grafana.com/docs/' }],
    },
  ],
};

export function GrotGuideBlockForm({
  initialData,
  onSubmit,
  onCancel,
  isEditing = false,
  onSwitchBlockType,
}: BlockFormProps) {
  const styles = useStyles2(getBlockFormStyles);
  const formStyles = useStyles2(getFormStyles);

  const initial = initialData && isGrotGuideBlock(initialData) ? initialData : null;

  // Strip the type field for display (it's added back on submit)
  const initialJson = initial
    ? JSON.stringify({ welcome: initial.welcome, screens: initial.screens }, null, 2)
    : JSON.stringify({ welcome: DEFAULT_BLOCK.welcome, screens: DEFAULT_BLOCK.screens }, null, 2);

  const [jsonContent, setJsonContent] = useState(initialJson);
  const [error, setError] = useState<string | null>(null);
  const [showYamlImport, setShowYamlImport] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      try {
        const parsed = JSON.parse(jsonContent);
        const block: JsonGrotGuideBlock = {
          type: 'grot-guide',
          welcome: parsed.welcome,
          screens: parsed.screens,
        };

        // Basic validation
        if (!block.welcome?.title || !block.welcome?.ctas?.length) {
          setError('Welcome screen must have a title and at least one CTA');
          return;
        }
        if (!block.screens?.length) {
          setError('At least one screen is required');
          return;
        }

        // Validate screen ID references
        const screenIds = new Set(block.screens.map((s) => s.id));
        for (const cta of block.welcome.ctas) {
          if (!screenIds.has(cta.screenId)) {
            setError(`Welcome CTA references unknown screen: "${cta.screenId}"`);
            return;
          }
        }
        for (const screen of block.screens) {
          if (screen.type === 'question') {
            for (const opt of screen.options) {
              if (!screenIds.has(opt.screenId)) {
                setError(`Screen "${screen.id}" option references unknown screen: "${opt.screenId}"`);
                return;
              }
            }
          }
        }

        onSubmit(block);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid JSON');
      }
    },
    [jsonContent, onSubmit]
  );

  const handleYamlImport = useCallback(() => {
    setYamlError(null);
    try {
      const block = convertYamlToBlock(yamlContent);
      setJsonContent(JSON.stringify({ welcome: block.welcome, screens: block.screens }, null, 2));
      setShowYamlImport(false);
      setYamlContent('');
      setError(null);
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'Failed to parse YAML');
    }
  }, [yamlContent]);

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <Field
        label="Grot guide definition"
        description="JSON definition of the decision tree (welcome screen + question/result screens)"
      >
        <div className={formStyles.editorContainer}>
          <div className={formStyles.toolbar}>
            <Button
              variant="secondary"
              size="sm"
              icon={showYamlImport ? 'angle-up' : 'import'}
              onClick={() => setShowYamlImport(!showYamlImport)}
              type="button"
            >
              {showYamlImport ? 'Hide YAML import' : 'Import from YAML'}
            </Button>
          </div>
          <textarea
            className={formStyles.textarea}
            value={jsonContent}
            onChange={(e) => {
              setJsonContent(e.target.value);
              setError(null);
            }}
            spellCheck={false}
          />
        </div>
      </Field>

      {showYamlImport && (
        <Field label="Paste Grot Guide YAML" description="Paste the YAML definition and click Import to convert">
          <div className={formStyles.editorContainer}>
            <textarea
              className={formStyles.textarea}
              value={yamlContent}
              onChange={(e) => {
                setYamlContent(e.target.value);
                setYamlError(null);
              }}
              placeholder={`welcome:\n  title: "..."\n  body: "..."\n  ctas:\n    - text: "Let's go!"\n      screen_id: first_question\nscreens:\n  - type: question\n    id: first_question\n    ...`}
              spellCheck={false}
            />
            {yamlError && (
              <Alert severity="error" title="YAML import error">
                {yamlError}
              </Alert>
            )}
            <div className={formStyles.importActions}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleYamlImport}
                type="button"
                disabled={!yamlContent.trim()}
              >
                Import
              </Button>
            </div>
          </div>
        </Field>
      )}

      {error && (
        <Alert severity="error" title="Validation error">
          {error}
        </Alert>
      )}

      <div className={styles.footer}>
        {isEditing && onSwitchBlockType && (
          <div className={styles.footerLeft}>
            <TypeSwitchDropdown currentType="grot-guide" onSwitch={onSwitchBlockType} blockData={initialData} />
          </div>
        )}
        <Button variant="secondary" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          {isEditing ? 'Update block' : 'Add block'}
        </Button>
      </div>
    </form>
  );
}

GrotGuideBlockForm.displayName = 'GrotGuideBlockForm';

const getFormStyles = (theme: GrafanaTheme2) => ({
  editorContainer: css({
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    backgroundColor: theme.colors.background.primary,
    '&:focus-within': {
      borderColor: theme.colors.primary.border,
      boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
    },
  }),

  toolbar: css({
    display: 'flex',
    justifyContent: 'flex-end',
    padding: theme.spacing(0.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
  }),

  textarea: css({
    width: '100%',
    minHeight: '250px',
    maxHeight: '400px',
    padding: theme.spacing(1.5),
    border: 'none',
    outline: 'none',
    resize: 'vertical',
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: 1.5,
    backgroundColor: 'transparent',
    color: theme.colors.text.primary,
    overflowY: 'auto',
    '&::placeholder': {
      color: theme.colors.text.disabled,
    },
  }),

  importActions: css({
    display: 'flex',
    justifyContent: 'flex-end',
    padding: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
  }),
});
