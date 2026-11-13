import * as fs from 'fs';
import * as path from 'path';

const COMPONENTS = path.join(__dirname, '../..');

// Source pin: these surfaces cannot be mounted under Jest (see docs-panel.auto-open-event.test.tsx).
it.each([
  ['docs-panel/docs-panel.tsx', 'sidebar'],
  ['floating-panel/FloatingPanelManager.tsx', 'floating'],
  ['full-screen/FullScreenPanel.tsx', 'fullscreen'],
])('%s listens for guide updates as %s', (file, surface) => {
  const src = fs.readFileSync(path.join(COMPONENTS, file), 'utf8');
  expect(src).toMatch(new RegExp(`useAssistantPathfinderListener\\(\\w+, '${surface}'\\)`));
});
