import { guideVariableCheck } from './vars';
import { registerGuideId, resetGuideIdentityForTests } from '../../global-state/guide-identity';
import { guideResponseStorage } from '../../lib/user-storage';

jest.mock('../../lib/user-storage', () => ({
  guideResponseStorage: {
    getResponse: jest.fn(),
  },
}));

const mockGetResponse = guideResponseStorage.getResponse as jest.MockedFunction<
  typeof guideResponseStorage.getResponse
>;

/** Responses keyed by guide, so a cross-guide read is observable in the result. */
function storeResponses(responses: Record<string, Record<string, string | boolean | number>>) {
  mockGetResponse.mockImplementation(async (guideId, variableName) => responses[guideId]?.[variableName]);
}

describe('guideVariableCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGuideIdentityForTests();
    delete (window as any).__DocsPluginGuideId;
    mockGetResponse.mockResolvedValue(undefined);
  });

  describe('parsing', () => {
    it('rejects a requirement with no expected value', async () => {
      const result = await guideVariableCheck('var-policyAccepted');
      expect(result.pass).toBe(false);
      expect(result.error).toContain('Invalid variable requirement format');
    });
  });

  describe('matching', () => {
    beforeEach(() => {
      registerGuideId('guide-a');
    });

    it('passes a wildcard when any value is stored', async () => {
      storeResponses({ 'guide-a': { region: 'us-east-1' } });
      await expect(guideVariableCheck('var-region:*')).resolves.toMatchObject({ pass: true });
    });

    it('fails a wildcard when no value is stored', async () => {
      await expect(guideVariableCheck('var-region:*')).resolves.toMatchObject({ pass: false });
    });

    it('accepts both boolean and string forms of true', async () => {
      storeResponses({ 'guide-a': { accepted: true, alsoAccepted: 'true' } });
      await expect(guideVariableCheck('var-accepted:true')).resolves.toMatchObject({ pass: true });
      await expect(guideVariableCheck('var-alsoAccepted:true')).resolves.toMatchObject({ pass: true });
    });

    it('accepts both boolean and string forms of false', async () => {
      storeResponses({ 'guide-a': { declined: false, alsoDeclined: 'false' } });
      await expect(guideVariableCheck('var-declined:false')).resolves.toMatchObject({ pass: true });
      await expect(guideVariableCheck('var-alsoDeclined:false')).resolves.toMatchObject({ pass: true });
    });

    it('matches an exact string value', async () => {
      storeResponses({ 'guide-a': { region: 'us-east-1' } });
      await expect(guideVariableCheck('var-region:us-east-1')).resolves.toMatchObject({ pass: true });
      await expect(guideVariableCheck('var-region:eu-west-2')).resolves.toMatchObject({ pass: false });
    });
  });

  describe('guide scoping', () => {
    it('reads the responses of the registered guide', async () => {
      storeResponses({ 'guide-a': { accepted: true } });
      registerGuideId('guide-a');

      await expect(guideVariableCheck('var-accepted:true')).resolves.toMatchObject({ pass: true });
      expect(mockGetResponse).toHaveBeenCalledWith('guide-a', 'accepted');
    });

    // Regression (#1519): the window global outlives the guide that set it, so a
    // stale value must never satisfy the guide that is actually registered.
    it('does not let a stale window global unlock the registered guide', async () => {
      storeResponses({ 'guide-a': { accepted: true } });
      (window as any).__DocsPluginGuideId = 'guide-a';
      registerGuideId('guide-b');

      await expect(guideVariableCheck('var-accepted:true')).resolves.toMatchObject({ pass: false });
      expect(mockGetResponse).toHaveBeenCalledWith('guide-b', 'accepted');
      expect(mockGetResponse).not.toHaveBeenCalledWith('guide-a', 'accepted');
    });

    it('does not share answers between guides', async () => {
      storeResponses({ 'guide-a': { accepted: true } });

      const releaseA = registerGuideId('guide-a');
      await expect(guideVariableCheck('var-accepted:true')).resolves.toMatchObject({ pass: true });

      const releaseB = registerGuideId('guide-b');
      await expect(guideVariableCheck('var-accepted:true')).resolves.toMatchObject({ pass: false });

      releaseB();
      releaseA();
    });

    it('reports the resolved guide id in the failure context', async () => {
      registerGuideId('guide-b');
      const result = await guideVariableCheck('var-accepted:true');
      expect(result.context).toMatchObject({ guideId: 'guide-b' });
    });

    // The `'default'` sentinel is retired: an unidentified caller gets an empty
    // bucket, not a bucket shared with every other guide.
    it('resolves an empty guide id when no identity is available', async () => {
      storeResponses({ default: { accepted: true } });

      await expect(guideVariableCheck('var-accepted:true')).resolves.toMatchObject({ pass: false });
      expect(mockGetResponse).toHaveBeenCalledWith('', 'accepted');
    });
  });

  describe('failures', () => {
    it('fails closed when the storage read throws', async () => {
      registerGuideId('guide-a');
      mockGetResponse.mockRejectedValue(new Error('storage unavailable'));

      const result = await guideVariableCheck('var-accepted:true');
      expect(result.pass).toBe(false);
      expect(result.error).toContain('Variable check failed');
    });
  });
});
