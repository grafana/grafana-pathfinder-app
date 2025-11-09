import { useState, useCallback } from 'react';

export interface PopoverState {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
}

export interface UsePopoverReturn {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  open: (anchor: HTMLElement) => void;
  close: () => void;
  toggle: (anchor: HTMLElement) => void;
}

/**
 * Hook that manages popover state
 * @returns Popover state and control functions
 */
export function usePopover(): UsePopoverReturn {
  const [state, setState] = useState<PopoverState>({
    isOpen: false,
    anchorEl: null,
  });

  const open = useCallback((anchor: HTMLElement) => {
    setState({ isOpen: true, anchorEl: anchor });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, anchorEl: null });
  }, []);

  const toggle = useCallback((anchor: HTMLElement) => {
    setState((prev) => ({
      isOpen: !prev.isOpen,
      anchorEl: prev.isOpen ? null : anchor,
    }));
  }, []);

  return {
    isOpen: state.isOpen,
    anchorEl: state.anchorEl,
    open,
    close,
    toggle,
  };
}

