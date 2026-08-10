/**
 * Regression tests for plugin settings preservation.
 *
 * Grafana's plugin settings API does a full overwrite of jsonData (not a merge),
 * so we must explicitly preserve all existing fields when saving settings.
 * This is critical for provisioned fields like `stackId` from Grafana Cloud.
 *
 * @see https://grafana.com/developers/plugin-tools/how-to-guides/app-plugins/add-authentication-for-app-plugins
 */

import { getConfigWithDefaults, DocsPluginConfig } from '../../constants';

describe('plugin settings preservation', () => {
  /**
   * This test verifies the pattern used in ConfigurationForm, TermsAndConditions,
   * and InteractiveFeatures when constructing newJsonData for saving.
   *
   * The pattern is:
   *   const newJsonData = {
   *     ...(jsonData || {}),                      // 1. Preserve ALL existing fields
   *     ...getConfigWithDefaults(jsonData || {}), // 2. Apply defaults for known fields
   *     // form-specific overrides...             // 3. Override with form values
   *   };
   */
  describe('jsonData spread pattern', () => {
    it('preserves unknown/provisioned fields like stackId when constructing newJsonData', () => {
      // Simulate jsonData from Grafana Cloud with provisioned fields
      const jsonData = {
        stackId: '123456',
        someOtherProvisionedField: 'cloud-value',
        recommenderServiceUrl: 'https://custom.example.com',
        tutorialUrl: 'https://custom-tutorial.example.com',
      } as DocsPluginConfig & { stackId: string; someOtherProvisionedField: string };

      // Simulate the pattern used in our config forms
      const newJsonData = {
        ...(jsonData || {}),
        ...getConfigWithDefaults(jsonData || {}),
        // Form-specific override (simulating user changing tutorial URL)
        tutorialUrl: 'https://new-tutorial.example.com',
      };

      // Provisioned fields must be preserved
      expect(newJsonData.stackId).toBe('123456');
      expect(newJsonData.someOtherProvisionedField).toBe('cloud-value');

      // Known fields should have correct values
      expect(newJsonData.recommenderServiceUrl).toBe('https://custom.example.com');
      expect(newJsonData.tutorialUrl).toBe('https://new-tutorial.example.com');
    });

    it('preserves stackId even when other known fields use defaults', () => {
      // Minimal jsonData with only provisioned field
      const jsonData = {
        stackId: '789',
      } as DocsPluginConfig & { stackId: string };

      const newJsonData = {
        ...(jsonData || {}),
        ...getConfigWithDefaults(jsonData || {}),
      };

      // stackId must be preserved
      expect(newJsonData.stackId).toBe('789');

      // Known fields should have defaults applied
      expect(newJsonData.acceptedTermsAndConditions).toBeDefined();
      expect(newJsonData.enableAutoDetection).toBeDefined();
    });

    it('handles empty jsonData without losing provisioned fields on subsequent saves', () => {
      // First save: jsonData has provisioned fields
      const initialJsonData = {
        stackId: 'abc',
        accessToken: 'secret', // This would be in secureJsonData, but testing the pattern
      } as DocsPluginConfig & { stackId: string; accessToken: string };

      const firstSave = {
        ...(initialJsonData || {}),
        ...getConfigWithDefaults(initialJsonData || {}),
        acceptedTermsAndConditions: true,
      };

      expect(firstSave.stackId).toBe('abc');
      expect(firstSave.accessToken).toBe('secret');

      // Second save: using the result of first save (simulating round-trip)
      const secondSave = {
        ...(firstSave || {}),
        ...getConfigWithDefaults(firstSave || {}),
        tutorialUrl: 'https://changed.example.com',
      };

      // Provisioned fields still preserved after multiple saves
      expect(secondSave.stackId).toBe('abc');
      expect(secondSave.accessToken).toBe('secret');
      expect(secondSave.acceptedTermsAndConditions).toBe(true);
      expect(secondSave.tutorialUrl).toBe('https://changed.example.com');
    });
  });

  describe('getConfigWithDefaults behavior', () => {
    it('does not include unknown fields in its output', () => {
      const jsonData = {
        stackId: '123',
        recommenderServiceUrl: 'https://custom.example.com',
      } as DocsPluginConfig & { stackId: string };

      const defaults = getConfigWithDefaults(jsonData);

      // getConfigWithDefaults only returns known DocsPluginConfig fields
      expect('stackId' in defaults).toBe(false);

      // This is why we need the first spread: ...(jsonData || {})
      // Without it, stackId would be lost
    });

    it('preserves existing values for known fields', () => {
      const jsonData: DocsPluginConfig = {
        recommenderServiceUrl: 'https://custom.example.com',
        tutorialUrl: 'https://custom-tutorial.example.com',
        enableAutoDetection: false,
      };

      const defaults = getConfigWithDefaults(jsonData);

      expect(defaults.recommenderServiceUrl).toBe('https://custom.example.com');
      expect(defaults.tutorialUrl).toBe('https://custom-tutorial.example.com');
      expect(defaults.enableAutoDetection).toBe(false);
    });
  });

  describe('regression: without first spread, provisioned fields are lost', () => {
    it('demonstrates the bug when only using getConfigWithDefaults', () => {
      const jsonData = {
        stackId: '123',
        recommenderServiceUrl: 'https://custom.example.com',
      } as DocsPluginConfig & { stackId: string };

      // BUG: This pattern loses stackId
      const buggyNewJsonData = {
        ...getConfigWithDefaults(jsonData || {}),
        tutorialUrl: 'https://new.example.com',
      };

      // stackId is lost!
      expect('stackId' in buggyNewJsonData).toBe(false);

      // FIX: Include the original jsonData spread first
      const fixedNewJsonData = {
        ...(jsonData || {}),
        ...getConfigWithDefaults(jsonData || {}),
        tutorialUrl: 'https://new.example.com',
      };

      // stackId is preserved
      expect(fixedNewJsonData.stackId).toBe('123');
    });
  });
});
