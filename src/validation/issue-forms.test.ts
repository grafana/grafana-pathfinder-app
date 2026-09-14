/**
 * GitHub issue-form contract tests.
 *
 * `.github/ISSUE_TEMPLATE/*.yml` is a machine-consumed declarative artifact:
 * GitHub parses it against its issue-forms syntax and renders the fields a
 * filer sees. A malformed form is not a lint error — GitHub silently refuses
 * to render it and the chooser drops the template — so these tests parse the
 * YAML into the same normalized model GitHub builds and assert its meaning:
 * structural validity, which fields are required, and the chooser behavior
 * configured by `config.yml`.
 *
 * `needs-review` and the `area/*` dropdown values name real repository labels;
 * their existence needs the GitHub API, so it is not asserted here.
 */

import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE');

// https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms
const ELEMENT_TYPES = ['markdown', 'input', 'textarea', 'dropdown', 'checkboxes'] as const;

type ElementType = (typeof ELEMENT_TYPES)[number];

interface FormElement {
  type: ElementType;
  id?: string;
  attributes?: Record<string, unknown>;
  validations?: Record<string, unknown>;
}

interface IssueForm {
  name?: unknown;
  description?: unknown;
  title?: unknown;
  labels?: unknown;
  body?: unknown;
}

interface ChooserConfig {
  blank_issues_enabled?: unknown;
  contact_links?: unknown;
}

function readYaml<T>(absPath: string): T {
  return load(fs.readFileSync(absPath, 'utf-8')) as T;
}

function formFileNames(): string[] {
  return fs
    .readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .filter((name) => name !== 'config.yml' && name !== 'config.yaml')
    .sort();
}

function elementsOf(form: IssueForm): FormElement[] {
  return (Array.isArray(form.body) ? form.body : []) as FormElement[];
}

function fieldById(form: IssueForm, id: string): FormElement | undefined {
  return elementsOf(form).find((element) => element.id === id);
}

function isRequired(element: FormElement | undefined): boolean {
  return element?.validations?.required === true;
}

function requiredAttributesFor(type: ElementType): string[] {
  switch (type) {
    case 'markdown':
      return ['value'];
    case 'dropdown':
      return ['label', 'options'];
    case 'checkboxes':
      return ['label', 'options'];
    case 'input':
    case 'textarea':
      return ['label'];
  }
}

const formNames = formFileNames();

describe('issue forms parse as GitHub issue forms', () => {
  it('ships at least one form', () => {
    expect(formNames.length).toBeGreaterThan(0);
  });

  describe.each(formNames)('%s', (fileName) => {
    const form = readYaml<IssueForm>(path.join(TEMPLATE_DIR, fileName));

    it('declares the chooser entry GitHub lists it under', () => {
      expect(typeof form.name).toBe('string');
      expect((form.name as string).trim()).not.toBe('');
      expect(typeof form.description).toBe('string');
      expect((form.description as string).trim()).not.toBe('');
    });

    it('has a body of known element types with the attributes each type requires', () => {
      const elements = elementsOf(form);
      expect(elements.length).toBeGreaterThan(0);

      for (const element of elements) {
        expect(ELEMENT_TYPES).toContain(element.type);
        const attributes = element.attributes ?? {};
        for (const key of requiredAttributesFor(element.type)) {
          expect(Object.keys(attributes)).toContain(key);
        }
        if (element.type === 'dropdown' || element.type === 'checkboxes') {
          expect(Array.isArray(attributes.options)).toBe(true);
          expect((attributes.options as unknown[]).length).toBeGreaterThan(0);
        }
        if (element.validations?.required !== undefined) {
          expect(typeof element.validations.required).toBe('boolean');
        }
      }
    });

    it('gives every answerable field a unique slug id', () => {
      const answerable = elementsOf(form).filter((element) => element.type !== 'markdown');
      const ids = answerable.map((element) => element.id);

      for (const id of ids) {
        expect(typeof id).toBe('string');
        expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('offers each dropdown answer once', () => {
      for (const element of elementsOf(form).filter((e) => e.type === 'dropdown')) {
        const options = (element.attributes?.options ?? []) as string[];
        expect(new Set(options).size).toBe(options.length);
      }
    });

    it('applies only non-empty labels on submit', () => {
      if (form.labels === undefined) {
        return;
      }
      expect(Array.isArray(form.labels)).toBe(true);
      for (const label of form.labels as unknown[]) {
        expect(typeof label).toBe('string');
        expect((label as string).trim()).toBe(label);
        expect(label).not.toBe('');
      }
    });

    it('does not prefill the title with a placeholder a filer could submit verbatim', () => {
      // GitHub writes `title:` straight into the title field and never
      // validates it, so `<Short summary>` ships as a real issue title.
      if (form.title === undefined) {
        return;
      }
      expect(form.title).not.toMatch(/[<>]/);
    });
  });
});

describe('structured-issue form', () => {
  const form = readYaml<IssueForm>(path.join(TEMPLATE_DIR, 'structured-issue.yml'));

  it('requires the summary, user impact, and acceptance criteria answers', () => {
    expect(fieldById(form, 'user-impact')?.attributes?.label).toBe('User impact / flow change');
    expect(fieldById(form, 'acceptance-criteria')?.attributes?.label).toBe('Acceptance criteria');

    const requiredIds = elementsOf(form)
      .filter(isRequired)
      .map((element) => element.id);
    expect(requiredIds).toEqual(['summary', 'user-impact', 'acceptance-criteria']);
  });

  it('leaves triage answers optional so internal work can be filed without them', () => {
    for (const id of ['issue-type', 'area', 'severity']) {
      expect(isRequired(fieldById(form, id))).toBe(false);
    }
  });

  it('tells filers of internal work what to put in the user impact field', () => {
    const description = fieldById(form, 'user-impact')?.attributes?.description as string;
    expect(description).toContain('Internal only - no user-facing change');
  });

  it('forces the filer to type a title', () => {
    expect(form.title).toBeUndefined();
  });
});

describe('issue template chooser', () => {
  const config = readYaml<ChooserConfig>(path.join(TEMPLATE_DIR, 'config.yml'));

  it('keeps the blank-issue path open next to the form', () => {
    expect(config.blank_issues_enabled).toBe(true);
  });

  it('points every contact link at an http(s) url', () => {
    const links = (config.contact_links ?? []) as Array<{ name?: unknown; url?: unknown; about?: unknown }>;
    for (const link of links) {
      expect(typeof link.name).toBe('string');
      expect(typeof link.about).toBe('string');
      expect(link.url).toMatch(/^https?:\/\//);
    }
  });
});
