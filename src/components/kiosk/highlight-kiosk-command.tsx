import React from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';

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

export function highlightKioskCommand(command: string): React.ReactNode {
  return renderCommandTokens(Prism.tokenize(command, Prism.languages.bash));
}
