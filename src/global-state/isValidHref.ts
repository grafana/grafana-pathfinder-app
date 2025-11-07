export function isValidHref(event: MouseEvent) {
  if (!(event.target instanceof Element)) {
    return false;
  }

  const href = event.target.getAttribute('href');

  if (!href || href.startsWith('#')) {
    return false;
  }

  return true;
}
