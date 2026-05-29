import type { NavigateFunction, To } from 'react-router-dom';

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => void;
};

export const navigateWithViewTransition = (
  navigate: NavigateFunction,
  to: To,
) => {
  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  if (prefersReducedMotion) {
    navigate(to);
    return;
  }

  const documentWithTransition = document as DocumentWithViewTransition;

  if (typeof documentWithTransition.startViewTransition !== 'function') {
    navigate(to);
    return;
  }

  documentWithTransition.startViewTransition(() => {
    navigate(to);
  });
};

