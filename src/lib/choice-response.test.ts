import {
  decodeChoiceSelection,
  encodeChoiceSelection,
  evaluateChoiceConditions,
  parseChoiceRequirement,
} from './choice-response';

describe('choice responses', () => {
  it('stores a deduplicated selection in author order', () => {
    expect(encodeChoiceSelection(['traces', 'logs', 'logs'], ['metrics', 'logs', 'traces'])).toBe('logs,traces');
    expect(encodeChoiceSelection([], ['logs'])).toBe('');
  });
  it('ignores corrupt values and removed options', () => {
    expect(decodeChoiceSelection(true)).toEqual([]);
    expect(decodeChoiceSelection('logs,logs,removed,<bad>', ['metrics', 'logs'])).toEqual(['logs']);
  });
  it('parses only valid includes conditions', () => {
    expect(parseChoiceRequirement('var-signals:includes:logs')).toEqual({ variableName: 'signals', optionId: 'logs' });
    expect(parseChoiceRequirement('var-signals:includes:')).toBeNull();
    expect(parseChoiceRequirement('var-signals:true')).toBeNull();
  });
  it('requires all choices and leaves environment checks to the requirements engine', () => {
    expect(
      evaluateChoiceConditions(['var-signals:includes:logs', 'var-signals:includes:metrics'], { signals: 'logs' })
    ).toBe(false);
    expect(evaluateChoiceConditions(['var-signals:includes:logs'], { signals: 'logs' })).toBe(true);
    expect(evaluateChoiceConditions(['has-datasource:prometheus'], {})).toBeUndefined();
  });
});
