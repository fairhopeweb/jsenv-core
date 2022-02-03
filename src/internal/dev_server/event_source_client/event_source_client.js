/* eslint-env browser */

import { createEventSourceConnection } from "./event_source_connection.js"
import {
  isLivereloadEnabled,
  setLivereloadPreference,
} from "./livereload_preference.js"
import { reloadPage } from "./reload.js"

const reloadMessages = []
// const urlHotMetas = {}
const reloadMessagesSignal = { onchange: () => {} }
const applyReloadMessageEffects = async () => {
  const someEffectIsFullReload = reloadMessages.find(
    (reloadMessage) => reloadMessage.type === "full_reload",
  )
  if (someEffectIsFullReload) {
    reloadPage()
    return
  }
  const copy = reloadMessages.slice()
  reloadMessages.length = 0
  copy.forEach(() => {
    // todo
  })
}

const eventsourceConnection = createEventSourceConnection(
  document.location.href,
  {
    reload: ({ reason, fileRelativeUrl, instruction }) => {
      reloadMessages.push({
        reason,
        fileRelativeUrl,
        instruction,
      })
      if (isLivereloadEnabled()) {
        applyReloadMessageEffects()
      } else {
        reloadMessagesSignal.onchange()
      }
    },
  },
  {
    retryMaxAttempt: Infinity,
    retryAllocatedMs: 20 * 1000,
  },
)

const { status, connect, disconnect } = eventsourceConnection
connect()
window.__jsenv_event_source_client__ = {
  status,
  connect,
  disconnect,
  isLivereloadEnabled,
  setLivereloadPreference,
  reloadMessages,
  reloadMessagesSignal,
  applyReloadMessageEffects,
}

// const findHotMetaUrl = (originalFileRelativeUrl) => {
//   return Object.keys(urlHotMetas).find((compileUrl) => {
//     return (
//       parseCompiledUrl(compileUrl).fileRelativeUrl === originalFileRelativeUrl
//     )
//   })
// }

// // TODO: the following "parseCompiledUrl"
// // already exists somewhere in the codebase: reuse the other one
// const parseCompiledUrl = (url) => {
//   const { pathname, search } = new URL(url)
//   const ressource = `${pathname}${search}`
//   const slashIndex = ressource.indexOf("/", 1)
//   const compileDirectoryRelativeUrl = ressource.slice(1, slashIndex)
//   const afterCompileDirectory = ressource.slice(slashIndex)
//   const nextSlashIndex = afterCompileDirectory.indexOf("/")
//   const compileId = afterCompileDirectory.slice(0, nextSlashIndex)
//   const afterCompileId = afterCompileDirectory.slice(nextSlashIndex)
//   return {
//     compileDirectoryRelativeUrl,
//     compileId,
//     fileRelativeUrl: afterCompileId,
//   }
// }
