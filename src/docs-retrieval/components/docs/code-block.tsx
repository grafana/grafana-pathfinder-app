import { warn } from '../../../lib/logger';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { IconButton } from '@grafana/ui';
import Prism from 'prismjs';

// Import Prism CSS theme
import 'prismjs/themes/prism.css';

// Import language definitions
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';

export interface CodeBlockProps {
  code: string;
  language?: string;
  showCopy?: boolean;
  inline?: boolean;
  className?: string;
}

export function CodeBlock({ code, language, showCopy = true, inline = false, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      warn('Failed to copy code:', err);
    }
  }, [code]);

  // Apply Prism highlighting when component mounts or code/language changes
  useEffect(() => {
    if (language && codeRef.current) {
      try {
        Prism.highlightElement(codeRef.current);
      } catch (err) {
        warn('Failed to highlight code with Prism:', err);
      }
    }
  }, [code, language]);

  if (inline) {
    return (
      <span className={`inline-code${className ? ` ${className}` : ''}`}>
        <code ref={codeRef} className={language ? `language-${language}` : ''}>
          {code}
        </code>
        {showCopy && (
          <IconButton
            name={copied ? 'check' : 'copy'}
            size="xs"
            onClick={handleCopy}
            tooltip={copied ? 'Copied!' : 'Copy code'}
            className="inline-copy-btn"
          />
        )}
      </span>
    );
  }

  return (
    <div className={`code-block${className ? ` ${className}` : ''}`}>
      <div className="code-block-header">
        <span className="code-block-language">{language}</span>
        {showCopy && (
          <IconButton
            name={copied ? 'check' : 'copy'}
            size="xs"
            onClick={handleCopy}
            tooltip={copied ? 'Copied!' : 'Copy code'}
            className="inline-copy-btn ml-auto"
          />
        )}
      </div>
      <pre className="code-block-pre">
        <code ref={codeRef} className={language ? `language-${language}` : ''}>
          {code}
        </code>
      </pre>
    </div>
  );
}
