import { KioskCatalogSchema, KioskCatalogDocumentSchema } from './kiosk-page.schema';
import event from '../../docs/examples/kiosk/event-v2.json';
import onboarding from '../../docs/examples/kiosk/onboarding-v2.json';
import demSetup from '../../docs/examples/kiosk/dem-setup-first.json';
import demStory from '../../docs/examples/kiosk/dem-two-perspectives.json';

const catalog = (blocks: unknown[]) => ({ ...event, page: { version: 2, blocks } });
it.each([event, onboarding, demSetup, demStory])('accepts the documented version 2 examples', (data) => {
  expect(KioskCatalogSchema.safeParse(data).success).toBe(true);
});
it.each([
  [{ type: 'columns', columns: [{ blocks: [{ type: 'text', content: 'One' }] }] }],
  [{ type: 'section', blocks: [{ type: 'section', blocks: [{ type: 'text', content: 'Too deep' }] }] }],
  [{ type: 'hero', title: 'Hello', primaryAction: { ruleId: 'missing', label: 'Go' } }],
  [{ type: 'hero', title: 'Hello', secondaryAction: { ruleId: 'missing', label: 'Go' } }],
  [{ type: 'section', blocks: [{ type: 'guide-links', layout: 'cards', links: [{ ruleId: 'missing' }] }] }],
  [{ type: 'image', image: { src: 'https://example.com/image.png' } }],
  [{ type: 'image', image: { src: 'javascript:alert(1)', decorative: true } }],
  [{ type: 'hero', title: 'Hello', style: 'position:fixed' }],
])('rejects invalid layout, references, images, and arbitrary styles', (blocks) => {
  expect(KioskCatalogSchema.safeParse(catalog([blocks])).success).toBe(false);
});
it('enforces the total block budget across containers', () => {
  expect(
    KioskCatalogSchema.safeParse(
      catalog(Array.from({ length: 30 }, () => ({ type: 'section', blocks: [{ type: 'text', content: 'Text' }] })))
    ).success
  ).toBe(false);
});
it.each([
  { background: { type: 'gradient', from: '#000000', to: '#ffffff' } },
  { accentColor: 'var(--arbitrary)' },
  { background: { type: 'solid', color: 'url(https://evil.example)' } },
])('rejects unreadable backgrounds and arbitrary CSS', (appearance) => {
  expect(KioskCatalogSchema.safeParse({ ...event, page: { ...event.page, appearance } }).success).toBe(false);
});
it('keeps legacy catalog objects and arrays valid', () => {
  const rules = [
    { title: 'Tour', url: 'https://interactive-learning.grafana.net/guides/tour/content.json', description: 'Explore' },
  ];
  expect(KioskCatalogDocumentSchema.safeParse({ rules, banner: '<h2>Welcome</h2>' }).success).toBe(true);
  expect(KioskCatalogDocumentSchema.safeParse(rules).success).toBe(true);
});
it('does not reinterpret an invalid structured page as a legacy catalog', () => {
  expect(KioskCatalogDocumentSchema.safeParse({ ...event, page: { version: 99 } }).success).toBe(false);
});

it('requires an accessible name for an icon-only brand', () => {
  const logo = { src: 'assets/logo.png' };
  expect(
    KioskCatalogSchema.safeParse({ ...event, page: { ...event.page, brand: { logo: { ...logo, decorative: true } } } })
      .success
  ).toBe(false);
  expect(
    KioskCatalogSchema.safeParse({ ...event, page: { ...event.page, brand: { logo: { ...logo, alt: 'Grafana' } } } })
      .success
  ).toBe(true);
});
