export function resolveRelativeUrls(html: string, baseUrl: string): string {
  try {
    if (!baseUrl) {
      return html;
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const baseUrlObj = new URL(baseUrl);

    const urlAttributes = ['href', 'action', 'poster', 'background'];

    urlAttributes.forEach((attr) => {
      const elements = doc.querySelectorAll(`[${attr}]:not(img)`);
      elements.forEach((element) => {
        const attrValue = element.getAttribute(attr);
        if (attrValue) {
          if (
            attrValue.startsWith('http://') ||
            attrValue.startsWith('https://') ||
            attrValue.startsWith('//') ||
            attrValue.startsWith('mailto:') ||
            attrValue.startsWith('tel:') ||
            attrValue.startsWith('javascript:') ||
            attrValue.startsWith('#')
          ) {
            return;
          }

          try {
            const resolvedUrl = new URL(attrValue, baseUrlObj).href;
            element.setAttribute(attr, resolvedUrl);
          } catch (urlError) {
            console.warn(`Failed to resolve URL: ${attrValue}`, urlError);
          }
        }
      });
    });

    if (doc.body && doc.body.innerHTML && doc.body.innerHTML.trim()) {
      return doc.body.innerHTML;
    }
    return doc.documentElement.outerHTML;
  } catch (error) {
    console.warn('Failed to resolve relative URLs in content:', error);
    return html;
  }
}
