export { FocusHandler } from './focus-handler';
export { ButtonHandler } from './button-handler';
export { NavigateHandler } from './navigate-handler';
export { FormFillHandler } from './form-fill-handler';
export { HoverHandler } from './hover-handler';
export { GuidedHandler } from './guided-handler';

// Enhanced selector support
export {
  querySelectorEnhanced,
  querySelectorAllEnhanced,
  getBrowserSelectorSupport,
} from '../../utils/enhanced-selector';

// Element validation utilities
export {
  isElementVisible,
  hasFixedPosition,
  getScrollParent,
  isInViewport,
  hasCustomScrollParent,
  getElementVisibilityInfo,
} from '../../utils/element-validator';
