import React, { useState, useCallback, useEffect, useRef } from 'react';
import { IconButton, useTheme2 } from '@grafana/ui';

// Import Prism.js and common languages
declare const Prism: any;

// Import Prism CSS theme
import 'prismjs/themes/prism.css';

// Import Prism core and language definitions
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-python';

// Import custom Prism theme
import { getPrismTheme } from '../../../../styles/prism-theme';

export interface CodeBlockProps {
  code: string;
  language?: string;
  showCopy?: boolean;
  inline?: boolean;
  className?: string;
}

export function CodeBlock({ code, language, showCopy = true, inline = false, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [prismLoaded, setPrismLoaded] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const theme = useTheme2();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn('Failed to copy code:', error);
    }
  }, [code]);

  // Load Prism.js if not available
  useEffect(() => {
    const loadPrism = async () => {
      // Check if Prism is already available
      if ((window as any).Prism) {
        setPrismLoaded(true);
        return;
      }
    };

    console.log('loadPrism');

    loadPrism();
  }, []);

  // Apply Prism highlighting when component mounts or code/language changes
  useEffect(() => {
    const prismInstance = (window as any).Prism;

    if (prismInstance && language && codeRef.current) {
      console.log('Language requested:', language, codeRef?.current, code);

      // Apply Prism highlighting
      prismInstance.highlightElement(codeRef?.current);
    } else {
      console.warn('Prism not available');
    }
  }, [code, language, prismLoaded]);

  // Get custom Prism theme styles
  const prismThemeStyles = getPrismTheme(theme);

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
        <style>{prismThemeStyles}</style>
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
            className="inline-copy-btn"
          />
        )}
      </div>
      <pre className="code-block-pre">
        <code ref={codeRef} className={language ? `language-${language}` : ''}>
          {code}
        </code>
      </pre>
      <style>{prismThemeStyles}</style>
    </div>
  );
}
