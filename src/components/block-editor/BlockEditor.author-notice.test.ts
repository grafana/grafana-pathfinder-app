import { authorNoticeText } from './BlockEditor';

describe('authorNoticeText', () => {
  it('says the guide was attributed to the signed-in user when it had no author', () => {
    expect(authorNoticeText({ name: 'Sam Rivera' })).toBe('This guide had no author, so it was attributed to you.');
  });

  it('names the placeholder a real identity replaced', () => {
    expect(authorNoticeText({ name: 'Sam Rivera', replacedName: 'pathfinder-mcp' })).toBe(
      'This guide was attributed to the placeholder pathfinder-mcp, so it was attributed to you instead.'
    );
  });

  it('does not claim the guide was attributed to the user when only a placeholder was available', () => {
    expect(authorNoticeText({ name: 'pathfinder-block-editor' })).toBe(
      'This guide had no author and your account has no name, so it was given a placeholder author.'
    );
  });
});
