import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw'

// Keys in the room's state map. Each element and each pasted image is its own
// key holding plain JSON, so a peer that joins creates no shared type: it
// cannot replace the board (as one shared array could be replaced by a late
// joiner that had not seen it yet), and peers editing different elements never
// conflict. For the same element, Excalidraw's reconcileElements keeps the
// higher version, as in Excalidraw's own collaboration.
export const ELEMENT = 'whiteboard:element:'
export const FILE = 'whiteboard:file:'

// origin of our own writes, so the room observer can skip them
const LOCAL = 'whiteboard'

/**
 * What the room's board holds, as Excalidraw's initialData. Excalidraw loads its
 * initialData after the editor has mounted and replaces the scene with it, so a
 * board loaded any other way at mount time is wiped again.
 */
export function boardContent(room) {
  const keys = [...room.keys()]
  return {
    elements: keys.filter((key) => key.startsWith(ELEMENT)).map((key) => room.get(key)),
    files: Object.fromEntries(keys.filter((key) => key.startsWith(FILE)).map((key) => [room.get(key).id, room.get(key)])),
  }
}

/**
 * Sync an Excalidraw editor with the room's state map `room`, and show the
 * peers of `awareness` as collaborators. Returns a function that stops it.
 */
export function bindBoard(api, room, awareness) {
  // version of each element as last written or received, so we neither echo nor miss changes
  const versions = new Map()
  const files = new Set()
  let selection = ''

  const sharedElements = (keys) =>
    keys.filter((key) => key.startsWith(ELEMENT)).map((key) => room.get(key)).filter(Boolean)

  function applyRemote(elements) {
    const merged = reconcileElements(api.getSceneElementsIncludingDeleted(), elements, api.getAppState())
    const kept = new Map(merged.map((element) => [element.id, element]))
    // Record only the remote elements that won. Where the local copy was kept (newer, being
    // edited, or the lower versionNonce while the room's map kept the other one), it stays
    // unrecorded, so onChange writes it back and every peer ends up with the same element.
    for (const element of elements) {
      if (kept.get(element.id) === element) versions.set(element.id, element.version)
    }
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER })
  }

  function applyRemoteFiles(keys) {
    const added = keys
      .filter((key) => key.startsWith(FILE))
      .map((key) => room.get(key))
      .filter((file) => file && !files.has(file.id))
    for (const file of added) files.add(file.id)
    if (added.length) api.addFiles(added)
  }

  // what the room holds when we join
  const keys = [...room.keys()]
  applyRemote(sharedElements(keys))
  applyRemoteFiles(keys)

  const onRoom = (event) => {
    if (event.transaction.origin === LOCAL) return
    const changed = [...event.keysChanged]
    const elements = sharedElements(changed)
    if (elements.length) applyRemote(elements)
    applyRemoteFiles(changed)
  }
  room.observe(onRoom)

  const unsubscribe = api.onChange((_, appState, sceneFiles) => {
    const changed = api.getSceneElementsIncludingDeleted().filter((e) => (versions.get(e.id) ?? -1) < e.version)
    const newFiles = Object.values(sceneFiles).filter((file) => !files.has(file.id))

    if (changed.length || newFiles.length) {
      Edrys.updateState(() => {
        for (const element of changed) {
          versions.set(element.id, element.version)
          room.set(ELEMENT + element.id, element)
        }
        for (const file of newFiles) {
          files.add(file.id)
          room.set(FILE + file.id, file)
        }
      }, LOCAL)
    }

    // onChange also fires on every pointer move: only send a selection that changed
    const selected = JSON.stringify(appState.selectedElementIds)
    if (selected !== selection) {
      selection = selected
      awareness.setLocalStateField('selectedElementIds', appState.selectedElementIds)
    }
  })

  const onAwareness = () => {
    const collaborators = new Map()
    awareness.getStates().forEach((state, clientID) => {
      if (clientID === awareness.clientID || !state.user) return
      collaborators.set(String(clientID), {
        username: state.user.name,
        color: { background: state.user.color, stroke: state.user.color },
        pointer: state.pointer,
        button: state.button,
        selectedElementIds: state.selectedElementIds,
      })
    })
    api.updateScene({ collaborators })
  }
  awareness.on('change', onAwareness)
  onAwareness()

  return () => {
    room.unobserve(onRoom)
    unsubscribe()
    awareness.off('change', onAwareness)
  }
}

/** Show this peer's pointer to the others (Excalidraw's onPointerUpdate). */
export function sharePointer(awareness, { pointer, button }) {
  // one awareness update (and message) per move
  awareness.setLocalState({ ...awareness.getLocalState(), pointer, button })
}
