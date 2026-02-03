/**
 * BlockJsonEditor Component
 *
 * JSON code editor for directly editing guide content.
 * Displays validation errors inline and provides syntax highlighting.
 */

import React from 'react';
import { Alert, CodeEditor, useStyles2 } from '@grafana/ui';
import type { BlockJsonEditorProps } from './types';
import { getStyles } from './block-json-editor.styles';

export function BlockJsonEditor({ jsonText, onJsonChange, validationErrors, isValid }: BlockJsonEditorProps) {
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container} data-testid="block-json-editor">
      {!isValid && validationErrors.length > 0 && (
        <Alert severity="error" title="Invalid JSON">
          <ul className={styles.errorList}>
            {validationErrors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className={styles.editorContainer}>
        <CodeEditor
          value={jsonText}
          language="json"
          onBlur={onJsonChange}
          showLineNumbers
          showMiniMap={false}
          height="100%"
        />
      </div>
    </div>
  );
}

BlockJsonEditor.displayName = 'BlockJsonEditor';
