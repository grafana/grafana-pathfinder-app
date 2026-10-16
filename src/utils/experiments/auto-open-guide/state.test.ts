import { setAutoOpenGuideEnrollment, subscribeToAutoOpenGuideEnrollment } from './state';

it('notifies subscribers when the activation cache changes, until they unsubscribe', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeToAutoOpenGuideEnrollment(listener);

  setAutoOpenGuideEnrollment({ variant: 'treatment', experiences: [] });
  expect(listener).toHaveBeenCalledTimes(1);

  unsubscribe();
  setAutoOpenGuideEnrollment(null);
  expect(listener).toHaveBeenCalledTimes(1);
});
