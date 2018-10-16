// https://github.com/jsenv/core/blob/master/src/api/util/transpiler.js

import { createRequestToFileResponse } from "../createRequestToFileResponse/index.js"
import {
  openServer,
  enableCORS,
  createResponseGenerator,
  acceptContentType,
  createSSERoom,
} from "../openServer/index.js"
import { watchFile } from "../watchFile.js"
import { createSignal } from "@dmail/signal"
import { JSCreateCompileService } from "../JSCreateCompileService/JSCreateCompileService.js"

export const openCompileServer = ({
  // server options
  protocol,
  ip,
  port,
  autoCloseOnExit,
  autoCloseOnCrash,
  autoCloseOnError,
  watch = false,
  watchPredicate = () => false,
  preventCors = false,
  cacheIgnore = false,

  // generic compile options
  root,
  into,
  cacheTrackHit = false,
  cacheStrategy = "eTag",

  // js compile options
  transpile = true,
  instrument = false,
  instrumentPredicate,
}) => {
  const cleanup = createSignal()

  const cacheFolder = into
  const compileFolder = `${into}__dynamic__`

  return Promise.resolve().then(() => {
    const watchSignal = createSignal()

    const createWatchService = () => {
      const watchedFiles = new Map()
      cleanup.listenOnce(() => {
        watchedFiles.forEach((closeWatcher) => closeWatcher())
        watchedFiles.clear()
      })

      return ({ ressource }) => {
        const dirname = ressource.slice(0, ressource.indexOf("/"))
        if (dirname === into) {
          // when I ask for a compiled file, watch the corresponding file on filesystem
          const file = ressource.slice(into.length + 1)
          const fileLocation = `${root}/${file}`

          if (watchedFiles.has(fileLocation) === false && watchPredicate(file)) {
            const fileWatcher = watchFile(fileLocation, () => {
              watchSignal.emit(file)
            })
            watchedFiles.set(fileLocation, fileWatcher)
          }
        }
      }
    }

    const createFileChangedSSEService = () => {
      const fileChangedSSE = createSSERoom()

      fileChangedSSE.open()
      cleanup.listenOnce(() => {
        fileChangedSSE.close()
      })

      watchSignal.listen((relativeFilename) => {
        fileChangedSSE.sendEvent({
          type: "file-changed",
          data: relativeFilename,
        })
      })

      return ({ headers }) => {
        if (acceptContentType(headers.accept, "text/event-stream")) {
          return fileChangedSSE.connect(headers["last-event-id"])
        }
        return null
      }
    }

    const responseGenerator = createResponseGenerator(
      ...[
        ...(watch ? [createWatchService(), createFileChangedSSEService()] : []),
        // eslint-disable-next-line new-cap
        JSCreateCompileService({
          root,
          cacheFolder,
          compileFolder,
          cacheIgnore,
          cacheTrackHit,
          cacheStrategy,
          instrumentPredicate,
          createOptions: () => {
            return {
              transpile,
              instrument,
            }
          },
        }),
        createRequestToFileResponse({
          root,
          cacheIgnore,
          cacheStrategy,
        }),
      ],
    )

    const getResponseForRequest = (request) => {
      return responseGenerator(request).then((response) => {
        return preventCors ? response : enableCORS(request, response)
      })
    }

    return openServer({
      protocol,
      ip,
      port,
      autoCloseOnExit,
      autoCloseOnCrash,
      autoCloseOnError,
      getResponseForRequest,
    }).then((server) => {
      server.closed.listenOnce(cleanup.emit)

      return {
        ...server,
        watchSignal,
      }
    })
  })
}
