import {
  AbortableOperation,
  raceProcessTeardownEvents,
} from "@jsenv/core/src/abort/main.js"
import { normalizeRuntimeSupport } from "@jsenv/core/src/internal/generateGroupMap/runtime_support.js"
import {
  assertProjectDirectoryUrl,
  assertProjectDirectoryExists,
} from "./internal/argUtils.js"
import { startCompileServer } from "./internal/compiling/startCompileServer.js"
import { launchAndExecute } from "./internal/executing/launchAndExecute.js"

export const execute = async ({
  signal = new AbortController().signal,
  handleSIGINT = true,

  logLevel = "warn",
  compileServerLogLevel = logLevel,
  launchAndExecuteLogLevel = logLevel,

  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  jsenvDirectoryClean,

  importDefaultExtension,

  fileRelativeUrl,
  runtime,
  runtimeParams,

  allocatedMs,
  measureDuration,
  mirrorConsole = true,
  captureConsole,
  collectRuntimeName,
  collectRuntimeVersion,
  inheritCoverage,
  collectCoverage,
  measurePerformance,
  collectPerformance,
  collectCompileServerInfo = false,
  stopAfterExecute = false,
  stopAfterExecuteReason,
  gracefulStopAllocatedMs,
  ignoreError = false,

  compileServerProtocol,
  compileServerPrivateKey,
  compileServerCertificate,
  compileServerIp,
  compileServerPort,
  babelPluginMap,
  customCompilers,
  compileServerCanReadFromFilesystem,
  compileServerCanWriteOnFilesystem,

  runtimeConsoleCallback,
  runtimeStartedCallback,
  runtimeStoppedCallback,
  runtimeErrorAfterExecutionCallback,
  runtimeDisconnectCallback = () => {},
}) => {
  projectDirectoryUrl = assertProjectDirectoryUrl({ projectDirectoryUrl })
  await assertProjectDirectoryExists({ projectDirectoryUrl })

  if (typeof fileRelativeUrl !== "string") {
    throw new TypeError(
      `fileRelativeUrl must be a string, got ${fileRelativeUrl}`,
    )
  }
  fileRelativeUrl = fileRelativeUrl.replace(/\\/g, "/")

  if (typeof runtime !== "object") {
    throw new TypeError(`runtime must be an object, got ${runtime}`)
  }
  if (typeof runtime.launch !== "function") {
    throw new TypeError(
      `runtime.launch must be a function, got ${runtime.launch}`,
    )
  }

  const executeOperation = AbortableOperation.fromSignal(signal)
  if (handleSIGINT) {
    AbortableOperation.effect(executeOperation, (cb) =>
      raceProcessTeardownEvents(
        {
          SIGINT: true,
        },
        cb,
      ),
    )
  }

  const {
    outDirectoryRelativeUrl,
    origin: compileServerOrigin,
    stop,
  } = await startCompileServer({
    abortSignal: executeOperation.abortSignal,
    compileServerLogLevel,

    projectDirectoryUrl,
    jsenvDirectoryRelativeUrl,
    jsenvDirectoryClean,
    outDirectoryName: "out-dev",

    importDefaultExtension,

    compileServerProtocol,
    compileServerPrivateKey,
    compileServerCertificate,
    compileServerIp,
    compileServerPort,
    babelPluginMap,
    customCompilers,
    runtimeSupport: normalizeRuntimeSupport({
      [runtime.name]: runtime.version,
    }),
    compileServerCanReadFromFilesystem,
    compileServerCanWriteOnFilesystem,
  })
  executeOperation.cleaner.addCallback(() => {
    return stop()
  })

  const result = await launchAndExecute({
    abortSignal: executeOperation.abortSignal,
    launchAndExecuteLogLevel,

    runtime,
    runtimeParams: {
      projectDirectoryUrl,
      compileServerOrigin,
      outDirectoryRelativeUrl,
      ...runtimeParams,
    },
    executeParams: {
      fileRelativeUrl,
    },

    allocatedMs,
    measureDuration,
    mirrorConsole,
    captureConsole,
    collectRuntimeName,
    collectRuntimeVersion,
    inheritCoverage,
    collectCoverage,
    measurePerformance,
    collectPerformance,

    stopAfterExecute,
    stopAfterExecuteReason,
    gracefulStopAllocatedMs,

    runtimeConsoleCallback,
    runtimeStartedCallback,
    runtimeStoppedCallback,
    runtimeErrorAfterExecutionCallback,
    runtimeDisconnectCallback: () => {
      // stop server when runtime disconnects
      executeOperation.cleaner.clean("runtime-stopped")
      runtimeDisconnectCallback()
    },
  })

  if (collectCompileServerInfo) {
    result.outDirectoryRelativeUrl = outDirectoryRelativeUrl
    result.compileServerOrigin = compileServerOrigin
  }

  if (result.status === "errored") {
    if (ignoreError) {
      return result
    }
    /*
    Warning: when node launched with --unhandled-rejections=strict, despites
    this promise being rejected by throw result.error node will compltely ignore it.

    The error can be logged by doing
    ```js
    process.setUncaughtExceptionCaptureCallback((error) => {
      console.error(error.stack)
    })
    ```
    But it feels like a hack.
    */
    throw result.error
  }
  return result
}
