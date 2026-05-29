export const DEBOUNCE_MS = 0
export const AUTOSAVE_DEBOUNCE_MS = 1500

// Same host as the SPA (e.g. Nginx on :443 proxies /ws → backend). y-websocket appends `/${docId}`.
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
export const WS_URL = `${wsProtocol}://${window.location.host}/ws`

export const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

