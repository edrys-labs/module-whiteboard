import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { bindBoard, boardContent, sharePointer } from './sync'

// awareness of the room (Edrys.getState): pointers, selections and names
const AWARENESS = 'whiteboard'

const COLORS = ['#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#0c8599', '#e8590c', '#5c940d']

// fonts are copied next to the build (npm run build), so the board needs no CDN
window.EXCALIDRAW_ASSET_PATH = new URL('./', location.href).href

const status = document.getElementById('status')
const container = document.getElementById('board')

function showError(error) {
  console.error(error)
  status.textContent = `Could not open the whiteboard: ${error.message || error}`
  status.hidden = false
  container.hidden = true
}

/** A colour per user, the same on every peer. */
function colorOf(name) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

/**
 * The room's state map. It can be missing for a moment (e.g. a room that has no
 * state yet when the module loads), so wait for it instead of failing.
 */
function roomState() {
  return new Promise((resolve) => {
    const check = () => {
      const room = Edrys.getState()
      if (room) resolve(room)
      return !!room
    }
    if (!check()) Edrys.onUpdate(check)
  })
}

const theme = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

// The module frame is re-created on every room change, so all of this runs once.
Edrys.onReady(async () => {
  try {
    const room = await roomState()
    const awareness = Edrys.getState(AWARENESS, 'Awareness')
    const name = Edrys.liveUser.displayName || Edrys.username
    awareness.setLocalStateField('user', { name, color: colorOf(Edrys.username) })

    // The room's state map can be replaced after we got it (edrys-Lite hands the module an
    // older doc first, and recreates a room's map when it goes missing). Bind to whichever
    // map is current, and rebind when it changes.
    let api
    let bound
    let unbind
    const bind = () => {
      const current = Edrys.getState()
      if (!api || !current || current === bound) return
      unbind?.()
      bound = current
      unbind = bindBoard(api, current, awareness)
    }
    Edrys.onUpdate(() => {
      try {
        bind()
      } catch (error) {
        showError(error)
      }
    })

    const element = createElement(Excalidraw, {
      theme: theme(),
      initialData: boardContent(room),
      excalidrawAPI: (excalidrawAPI) => {
        if (api) return
        api = excalidrawAPI
        // the e2e tests (edrys-module-tests) read the scene through it
        window.excalidrawAPI = api
        try {
          bind()
        } catch (error) {
          showError(error)
        }
      },
      onPointerUpdate: (payload) => sharePointer(awareness, payload),
    })
    // Excalidraw sizes itself to the container when it mounts, so show it first
    status.hidden = true
    container.hidden = false
    createRoot(container).render(element)

    addEventListener('pagehide', () => {
      unbind?.()
      awareness.setLocalState(null)
    })
  } catch (error) {
    showError(error)
  }
})
