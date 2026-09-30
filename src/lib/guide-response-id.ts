export function getGuideResponseId(contentUrl: string, origin: string): string {
  try {
    return new URL(contentUrl, origin).pathname.replace(/^\//, '').replace(/\//g, '-') || 'default';
  } catch {
    return contentUrl || 'default';
  }
}
