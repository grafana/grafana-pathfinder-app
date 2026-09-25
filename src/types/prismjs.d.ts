// Type declarations for prismjs
declare module 'prismjs' {
  interface Token {
    type: string;
    content: string | Array<string | Token>;
  }
  interface PrismStatic {
    tokenize(text: string, grammar: Record<string, unknown>): Array<string | Token>;
    highlightElement(element: Element, async?: boolean, callback?: () => void): void;
    highlightAll(async?: boolean, callback?: () => void): void;
    highlightAllUnder(element: Element, async?: boolean, callback?: () => void): void;
    languages: Record<string, any>;
    plugins: Record<string, any>;
    manual?: boolean;
  }

  const Prism: PrismStatic;
  export = Prism;
}

declare module 'prismjs/components/*' {
  const component: any;
  export = component;
}

declare module 'prismjs/themes/*' {
  const theme: any;
  export = theme;
}
