// A fixed action, never a renderer-supplied reload URL or storage operation.
export const STARTUP_RETRY_URL = 'hospitality-startup://retry/'

/** @param {{preventDefault(): void}} event
 * @param {string} url
 * @param {{isDestroyed(): boolean, getURL(): string, reloadIgnoringCache(): void}} contents
 * @param {(url: string) => boolean} isAllowedAppNavigation */
export function handleStartupRetry(event, url, contents, isAllowedAppNavigation) {
  if (url !== STARTUP_RETRY_URL) return false
  event.preventDefault()
  if (!contents.isDestroyed() && isAllowedAppNavigation(contents.getURL())) {
    contents.reloadIgnoringCache()
  }
  return true
}
