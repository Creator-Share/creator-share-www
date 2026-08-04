export const PUBLIC_PATH_CHANGE_EVENT = "creator-share:public-path-change"

export function notifyPublicPathChange(): void {
  window.dispatchEvent(new Event(PUBLIC_PATH_CHANGE_EVENT))
}
