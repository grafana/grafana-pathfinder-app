
import type { JsonGuide } from '../../types/json-guide.types';

export function createDeeplyNestedGuide(depth: number): JsonGuide {
  // Depth 0: blocks = [markdown]
  // Depth 1: blocks = [section(blocks=markdown)]
  // Depth 5: blocks = [section(section(...(markdown)))]
  
  // Note: depth here refers to nesting level of SECTIONS.
  // The schema allows 5 levels of RECURSION.
  // Level 0: JsonBlockSchema -> Section -> blocks (Level 1)
  // Level 1: ... -> blocks (Level 2)
  // ...
  // Level 5: ... -> blocks (Level 6) -> which is NonRecursiveBlockSchema (no sections)
  
  // So if we have depth=5, we have 5 nested sections, and the innermost one contains markdown.
  // Section -> Section -> Section -> Section -> Section -> Markdown
  // 1          2          3          4          5
  
  let blocks: any[] = [{ type: 'markdown', content: 'Deepest' }];
  for (let i = 0; i < depth; i++) {
    blocks = [{ type: 'section', title: `Level ${depth - i}`, blocks }];
  }
  return { id: 'deep-test', title: 'Deep Nesting Test', blocks };
}

export function createWideGuide(blockCount: number): JsonGuide {
  const blocks = Array.from({ length: blockCount }, (_, i) => ({
    type: 'markdown' as const,
    content: `Block ${i + 1}`,
  }));
  return { id: 'wide-test', title: 'Wide Guide Test', blocks };
}

