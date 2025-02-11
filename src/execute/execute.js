import { Abort, raceProcessTeardownEvents } from "@jsenv/abort"
import { assertAndNormalizeDirectoryUrl } from "@jsenv/filesystem"
import { createLogger } from "@jsenv/log"

import { pingServer } from "../ping_server.js"
import { run } from "./run.js"

export const execute = async ({
  signal = new AbortController().signal,
  handleSIGINT = true,
  logLevel,
  rootDirectoryUrl,
  devServerOrigin,

  fileRelativeUrl,
  allocatedMs,
  mirrorConsole = true,
  keepRunning = false,

  collectConsole,
  collectCoverage,
  coverageTempDirectoryUrl,
  collectPerformance = false,
  runtime,
  runtimeParams,

  ignoreError = false,
}) => {
  const logger = createLogger({ logLevel })
  rootDirectoryUrl = assertAndNormalizeDirectoryUrl(rootDirectoryUrl)
  const executeOperation = Abort.startOperation()
  executeOperation.addAbortSignal(signal)
  if (handleSIGINT) {
    executeOperation.addAbortSource((abort) => {
      return raceProcessTeardownEvents(
        {
          SIGINT: true,
        },
        abort,
      )
    })
  }

  let resultTransformer = (result) => result
  runtimeParams = {
    rootDirectoryUrl,
    devServerOrigin,
    fileRelativeUrl,
    ...runtimeParams,
  }
  if (runtime.type === "browser") {
    if (!devServerOrigin) {
      throw new TypeError(
        `devServerOrigin is required when running tests on browser(s)`,
      )
    }
    const devServerStarted = await pingServer(devServerOrigin)
    if (!devServerStarted) {
      throw new Error(
        `dev server not started at ${devServerOrigin}. It is required to run tests`,
      )
    }
  }

  let result = await run({
    signal: executeOperation.signal,
    logger,
    allocatedMs,
    keepRunning,
    mirrorConsole,
    collectConsole,
    collectCoverage,
    coverageTempDirectoryUrl,
    collectPerformance,
    runtime,
    runtimeParams,
  })
  result = resultTransformer(result)

  try {
    if (result.status === "errored") {
      if (ignoreError) {
        return result
      }
      /*
  Warning: when node launched with --unhandled-rejections=strict, despites
  this promise being rejected by throw result.error node will completely ignore it.

  The error can be logged by doing
  ```js
  process.setUncaughtExceptionCaptureCallback((error) => {
    console.error(error.stack)
  })
  ```
  But it feels like a hack.
  */
      throw result.errors[result.errors.length - 1]
    }
    return result
  } finally {
    await executeOperation.end()
  }
}
