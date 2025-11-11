export { FocusHandler } from './focus-handler';
export { ButtonHandler } from './button-handler';
export { NavigateHandler } from './navigate-handler';
export { FormFillHandler } from './form-fill-handler';
export { HoverHandler } from './hover-handler';
export { GuidedHandler } from './guided-handler';

// Enhanced selector support and element validation utilities
export {
  querySelectorEnhanced,
  querySelectorAllEnhanced,
  getBrowserSelectorSupport,
  isElementVisible,
  hasFixedPosition,
  getScrollParent,
  isInViewport,
  hasCustomScrollParent,
  getElementVisibilityInfo,
} from '../../lib/dom';
