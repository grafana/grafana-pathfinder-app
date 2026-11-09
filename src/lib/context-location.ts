export function contextLocationKey(pathname: string, search = ''): string {
  const params = new URLSearchParams(search);
  return JSON.stringify([pathname, ...['editPanel', 'editview', 'firstPanel', 'id'].map((key) => params.get(key))]);
}
