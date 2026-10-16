import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

export const getSelectionStyles = (theme: GrafanaTheme2) => css`
  &&::selection,
  && ::selection {
    background-color: ${theme.colors.primary.main};
    color: ${theme.colors.primary.contrastText};
    text-shadow: none;
  }

  @media (forced-colors: active) {
    &&::selection,
    && ::selection {
      background-color: Highlight;
      color: HighlightText;
    }
  }
`;
