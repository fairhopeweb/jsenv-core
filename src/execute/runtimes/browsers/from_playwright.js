import { Script } from "node:vm"
import { createDetailedMessage } from "@jsenv/logger"
import {
  Abort,
  createCallbackListNotifiedOnce,
  raceProcessTeardownEvents,
} from "@jsenv/abort"
import { moveUrl } from "@jsenv/filesystem"

import { filterV8Coverage } from "@jsenv/core/src/utils/coverage/v8_coverage_from_directory.js"
import { composeTwoFileByFileIstanbulCoverages } from "@jsenv/core/src/utils/coverage/istanbul_coverage_composition.js"
import { escapeRegexpSpecialCharacters } from "@jsenv/core/src/utils/regexp_escape.js"
import { memoize } from "@jsenv/core/src/utils/memoize.js"

export const createRuntimeFromPlaywright = ({
  browserName,
  browserVersion,
  coveragePlaywrightAPIAvailable = false,
  ignoreErrorHook = () => false,
  transformErrorHook = (error) => error,
  isolatedTab = false,
}) => {
  const runtime = {
    name: browserName,
    version: browserVersion,
  }
  let browserAndContextPromise
  runtime.run = async ({
    signal = new AbortController().signal,
    logger,
    rootDirectoryUrl,
    server,
    fileUrl,

    // measurePerformance,
    // collectPerformance,
    collectCoverage = false,
    coverageForceIstanbul,
    coverageIgnorePredicate,

    stoppedCallbackList,
    errorCallbackList,
    outputCallbackList,
    stopAfterExecute = false,
    stopAfterExecuteReason = "",
    stopOnExit = true,

    executablePath,
    headless = true,
    ignoreHTTPSErrors = true,
    stopAfterAllExecutionCallbackList,
  }) => {
    const stopCallbackList = createCallbackListNotifiedOnce()
    const stop = memoize(async (reason) => {
      await stopCallbackList.notify({ reason })
      stoppedCallbackList.notify({ reason })
    })
    const closeBrowser = async () => {
      const { browser } = await browserAndContextPromise
      browserAndContextPromise = null
      await stopBrowser(browser)
    }
    if (
      !browserAndContextPromise ||
      isolatedTab ||
      !stopAfterAllExecutionCallbackList
    ) {
      browserAndContextPromise = (async () => {
        const browser = await launchBrowserUsingPlaywright({
          signal,
          browserName,
          stopOnExit,
          playwrightOptions: {
            headless,
            executablePath,
          },
        })
        const browserContext = await browser.newContext({ ignoreHTTPSErrors })
        return { browser, browserContext }
      })()
      // when using chromium tab during multiple executions we reuse the chromium browser
      // and only once all executions are done we close the browser
      if (!isolatedTab && stopAfterAllExecutionCallbackList) {
        stopAfterAllExecutionCallbackList.add(async () => {
          await closeBrowser()
        })
      } else {
        stopCallbackList.add(async () => {
          await closeBrowser()
        })
      }
    }
    const { browser, browserContext } = await browserAndContextPromise
    // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-disconnected
    browser.on("disconnected", () => {
      stop()
    })
    const page = await browserContext.newPage()
    stoppedCallbackList.add(async () => {
      try {
        await page.close()
      } catch (e) {
        if (isTargetClosedError(e)) {
          return
        }
        throw e
      }
    })
    const stopTrackingToNotify = trackPageToNotify(page, {
      onError: (error) => {
        error = transformErrorHook(error)
        if (!ignoreErrorHook(error)) {
          errorCallbackList.notify(error)
        }
      },
      onConsole: outputCallbackList.notify,
    })
    stoppedCallbackList.add(stopTrackingToNotify)

    let resultTransformer = (result) => result
    if (collectCoverage) {
      if (coveragePlaywrightAPIAvailable && !coverageForceIstanbul) {
        await page.coverage.startJSCoverage({
          // reportAnonymousScripts: true,
        })
        resultTransformer = composeTransformer(
          resultTransformer,
          async (result) => {
            const v8CoveragesWithWebUrls = await page.coverage.stopJSCoverage()
            // we convert urls starting with http:// to file:// because we later
            // convert the url to filesystem path in istanbulCoverageFromV8Coverage function
            const v8CoveragesWithFsUrls = v8CoveragesWithWebUrls.map(
              (v8CoveragesWithWebUrl) => {
                const fsUrl = moveUrl({
                  url: v8CoveragesWithWebUrl.url,
                  from: server.origin,
                  to: rootDirectoryUrl,
                  preferAbsolute: true,
                })
                return {
                  ...v8CoveragesWithWebUrl,
                  url: fsUrl,
                }
              },
            )
            const coverage = filterV8Coverage(
              { result: v8CoveragesWithFsUrls },
              {
                coverageIgnorePredicate,
              },
            )
            return {
              ...result,
              coverage,
            }
          },
        )
      } else {
        resultTransformer = composeTransformer(
          resultTransformer,
          async (result) => {
            result.coverage = generateCoverageForPage(result.namespace)
            return result
          },
        )
      }
    } else {
      resultTransformer = composeTransformer(resultTransformer, (result) => {
        const { namespace: fileExecutionResultMap } = result
        Object.keys(fileExecutionResultMap).forEach((fileRelativeUrl) => {
          delete fileExecutionResultMap[fileRelativeUrl].coverage
        })
        return result
      })
    }

    const fileClientUrl = moveUrl({
      url: fileUrl,
      from: rootDirectoryUrl,
      to: `${server.origin}/`,
      preferAbsolute: true,
    })
    await page.goto(fileClientUrl, { timeout: 0 })
    const result = await page.evaluate(
      /* istanbul ignore next */
      () => {
        // eslint-disable-next-line no-undef
        return window.__jsenv__.executionResultPromise
      },
    )
    if (stopAfterExecute) {
      logger.debug(`stop ${browserName} because ${stopAfterExecuteReason}`)
      await closeBrowser()
      logger.debug(`${browserName} stopped`)
    } else {
      errorCallbackList.add((error) => {
        throw error
      })
      stoppedCallbackList.add(() => {
        logger.debug(`${browserName} stopped after execution`)
      })
    }
    const { fileExecutionResultMap } = result
    const fileErrored = Object.keys(fileExecutionResultMap).find(
      (fileRelativeUrl) => {
        const fileExecutionResult = fileExecutionResultMap[fileRelativeUrl]
        return fileExecutionResult.status === "errored"
      },
    )
    if (fileErrored) {
      const { exceptionSource } = fileExecutionResultMap[fileErrored]
      const error = evalException(exceptionSource, {
        rootDirectoryUrl,
        server,
        transformErrorHook,
      })
      return resultTransformer({
        status: "errored",
        error,
        namespace: fileExecutionResultMap,
      })
    }
    return resultTransformer({
      status: "completed",
      namespace: fileExecutionResultMap,
    })
  }
  if (!isolatedTab) {
    runtime.isolatedTab = createRuntimeFromPlaywright({
      browserName,
      browserVersion,
      coveragePlaywrightAPIAvailable,
      ignoreErrorHook,
      transformErrorHook,
      isolatedTab: true,
    })
  }
  return runtime
}

const generateCoverageForPage = (scriptExecutionResults) => {
  let istanbulCoverageComposed = null
  Object.keys(scriptExecutionResults).forEach((fileRelativeUrl) => {
    const istanbulCoverage = scriptExecutionResults[fileRelativeUrl].coverage
    istanbulCoverageComposed = istanbulCoverageComposed
      ? composeTwoFileByFileIstanbulCoverages(
          istanbulCoverageComposed,
          istanbulCoverage,
        )
      : istanbulCoverage
  })
  return istanbulCoverageComposed
}

const stopBrowser = async (browser) => {
  const disconnected = browser.isConnected()
    ? new Promise((resolve) => {
        const disconnectedCallback = () => {
          browser.removeListener("disconnected", disconnectedCallback)
          resolve()
        }
        browser.on("disconnected", disconnectedCallback)
      })
    : Promise.resolve()

  // for some reason without this 100ms timeout
  // browser.close() never resolves (playwright does not like something)
  await new Promise((resolve) => setTimeout(resolve, 100))

  try {
    await browser.close()
  } catch (e) {
    if (isTargetClosedError(e)) {
      return
    }
    throw e
  }
  await disconnected
}

const launchBrowserUsingPlaywright = async ({
  signal,
  browserName,
  stopOnExit,
  playwrightOptions,
}) => {
  const launchBrowserOperation = Abort.startOperation()
  launchBrowserOperation.addAbortSignal(signal)
  const playwright = await importPlaywright({ browserName })
  if (stopOnExit) {
    launchBrowserOperation.addAbortSource((abort) => {
      return raceProcessTeardownEvents(
        {
          SIGHUP: true,
          SIGTERM: true,
          SIGINT: true,
          beforeExit: true,
          exit: true,
        },
        abort,
      )
    })
  }
  const browserClass = playwright[browserName]
  try {
    const browser = await browserClass.launch({
      ...playwrightOptions,
      // let's handle them to close properly browser + remove listener
      // instead of relying on playwright to do so
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    })
    launchBrowserOperation.throwIfAborted()
    return browser
  } catch (e) {
    if (launchBrowserOperation.signal.aborted && isTargetClosedError(e)) {
      // rethrow the abort error
      launchBrowserOperation.throwIfAborted()
    }
    throw e
  } finally {
    await launchBrowserOperation.end()
  }
}

const importPlaywright = async ({ browserName }) => {
  try {
    const namespace = await import("playwright")
    return namespace
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        createDetailedMessage(
          `"playwright" not found. You need playwright in your dependencies to use "${browserName}"`,
          {
            suggestion: `npm install --save-dev playwright`,
          },
        ),
        { cause: e },
      )
    }
    throw e
  }
}

const isTargetClosedError = (error) => {
  if (error.message.match(/Protocol error \(.*?\): Target closed/)) {
    return true
  }
  if (error.message.match(/Protocol error \(.*?\): Browser.*?closed/)) {
    return true
  }
  if (error.message.includes("browserContext.close: Browser closed")) {
    return true
  }
  return false
}

const trackPageToNotify = (page, { onError, onConsole }) => {
  // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-error
  const removeErrorListener = registerEvent({
    object: page,
    eventType: "error",
    callback: onError,
  })

  // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-pageerror
  const removePageErrorListener = registerEvent({
    object: page,
    eventType: "pageerror",
    callback: onError,
  })

  // https://github.com/GoogleChrome/puppeteer/blob/v1.4.0/docs/api.md#event-console
  const removeConsoleListener = registerEvent({
    object: page,
    eventType: "console",
    // https://github.com/microsoft/playwright/blob/master/docs/api.md#event-console
    callback: async (consoleMessage) => {
      onConsole({
        type: consoleMessage.type(),
        text: `${extractTextFromConsoleMessage(consoleMessage)}
`,
      })
    },
  })

  return () => {
    removeErrorListener()
    removePageErrorListener()
    removeConsoleListener()
  }
}

const composeTransformer = (previousTransformer, transformer) => {
  return async (value) => {
    const transformedValue = await previousTransformer(value)
    return transformer(transformedValue)
  }
}

const extractTextFromConsoleMessage = (consoleMessage) => {
  return consoleMessage.text()
  // ensure we use a string so that istanbul won't try
  // to put any coverage statement inside it
  // ideally we should use uneval no ?
  // eslint-disable-next-line no-new-func
  //   const functionEvaluatedBrowserSide = new Function(
  //     "value",
  //     `if (value instanceof Error) {
  //   return value.stack
  // }
  // return value`,
  //   )
  //   const argValues = await Promise.all(
  //     message.args().map(async (arg) => {
  //       const jsHandle = arg
  //       try {
  //         return await jsHandle.executionContext().evaluate(functionEvaluatedBrowserSide, jsHandle)
  //       } catch (e) {
  //         return String(jsHandle)
  //       }
  //     }),
  //   )
  //   const text = argValues.reduce((previous, value, index) => {
  //     let string
  //     if (typeof value === "object") string = JSON.stringify(value, null, "  ")
  //     else string = String(value)
  //     if (index === 0) return `${previous}${string}`
  //     return `${previous} ${string}`
  //   }, "")
  //   return text
}

const registerEvent = ({ object, eventType, callback }) => {
  object.on(eventType, callback)
  return () => {
    object.removeListener(eventType, callback)
  }
}

const evalException = (
  exceptionSource,
  { rootDirectoryUrl, server, transformErrorHook },
) => {
  const script = new Script(exceptionSource, { filename: "" })
  const error = script.runInThisContext()
  if (error && error instanceof Error) {
    const remoteRootRegexp = new RegExp(
      escapeRegexpSpecialCharacters(`${server.origin}/`),
      "g",
    )
    error.stack = error.stack.replace(remoteRootRegexp, rootDirectoryUrl)
    error.message = error.message.replace(remoteRootRegexp, rootDirectoryUrl)
  }
  return transformErrorHook(error)
}
