import { fetchUrl } from "@jsenv/core/src/internal/browser_utils/fetch_browser.js"
import { inferContextFrom, createUrlContext } from "../url_context.js"

import { getRessourceResponseError } from "./ressource_response_error.js"
import { unevalException } from "./uneval_exception.js"
import { displayErrorInDocument } from "./error_in_document.js"
import { displayErrorNotification } from "./error_in_notification.js"

export const initHtmlSupervisor = ({ errorTransformer } = {}) => {
  const scriptExecutionResults = {}

  const urlContext = createUrlContext(
    inferContextFrom({
      url: window.location.href,
    }),
  )

  let collectCalled = false
  let pendingExecutionCount = 0
  let resolveScriptExecutionsPromise
  const scriptExecutionsPromise = new Promise((resolve) => {
    resolveScriptExecutionsPromise = resolve
  })
  const onExecutionStart = (name) => {
    scriptExecutionResults[name] = null // ensure execution order is reflected into the object
    pendingExecutionCount++
    performance.mark(`execution_start`)
  }
  const onExecutionSettled = (name, executionResult) => {
    performance.measure(`execution`, `execution_start`)
    scriptExecutionResults[name] = executionResult
    pendingExecutionCount--
    if (pendingExecutionCount === 0 && collectCalled) {
      resolveScriptExecutionsPromise()
    }
  }
  const addExecution = async ({
    src,
    currentScript,
    promise,
    improveErrorWithFetch = false,
  }) => {
    onExecutionStart(src)
    promise.then(
      (namespace) => {
        const executionResult = {
          status: "completed",
          namespace,
          coverage: window.__coverage__,
        }
        onExecutionSettled(src, executionResult)
      },
      async (e) => {
        const executionResult = {
          status: "errored",
          error: e,
          coverage: window.__coverage__,
        }
        let errorExposureInConsole = true
        if (e.name === "SyntaxError") {
          errorExposureInConsole = false
        }
        if (improveErrorWithFetch) {
          const errorFromServer = await getErrorFromServer({
            src,
            urlContext,
          })
          if (errorFromServer) {
            executionResult.error = errorFromServer
            if (
              errorFromServer.cause &&
              errorFromServer.cause.code === "PARSE_ERROR"
            ) {
              errorExposureInConsole = false
            }
          }
        }
        if (errorTransformer) {
          try {
            executionResult.error = await errorTransformer(e)
          } catch (e) {}
        }

        onExecutionSettled(src, executionResult)
        onExecutionError(executionResult, {
          currentScript,
          errorExposureInConsole,
        })
      },
    )
  }

  const collectScriptResults = async () => {
    collectCalled = true
    if (pendingExecutionCount === 0) {
      resolveScriptExecutionsPromise()
    } else {
      await scriptExecutionsPromise
    }

    let status = "completed"
    let exceptionSource = ""
    Object.keys(scriptExecutionResults).forEach((key) => {
      const scriptExecutionResult = scriptExecutionResults[key]
      if (scriptExecutionResult.status === "errored") {
        status = "errored"
        exceptionSource = scriptExecutionResult.exceptionSource
      }
    })
    return {
      status,
      ...(status === "errored" ? { exceptionSource } : {}),
      startTime: getNavigationStartTime(),
      endTime: Date.now(),
      scriptExecutionResults,
    }
  }

  return {
    addExecution,
    collectScriptResults,
  }
}

const getErrorFromServer = async ({ src, urlContext }) => {
  const urlObject = new URL(src, window.location.href)
  const urlWithoutInspect = urlObject.href
  urlObject.searchParams.set("__inspect__", "")
  const url = urlObject.href
  let response
  try {
    response = await fetchUrl(url)
  } catch (e) {
    e.code = "NETWORK_FAILURE"
    return e
  }
  if (response.status !== 200) {
    return null
  }
  if (response.headers["content-type"] !== "application/json") {
    return null
  }
  const realResponseData = await response.json()
  const responseError = await getRessourceResponseError({
    urlContext,
    contentTypeExpected: "application/javascript",
    type: "js_module",
    url: urlWithoutInspect,
    // at some point the importer is the HTML of course but here "importer"
    // means "last ressource to import that file before encountering an error"
    // so it might be an intermediate file.
    // I guess this information is available server side and could be returned
    // inside the __inspect__ response
    // importerUrl: window.location.href,
    response: {
      status: realResponseData.status,
      statustext: realResponseData.statusText,
      headers: realResponseData.headers,
      json: () => JSON.parse(realResponseData.body),
    },
  })
  return responseError
}

const onExecutionError = (
  executionResult,
  {
    currentScript,
    errorExposureInConsole = true,
    errorExposureInNotification = false,
    errorExposureInDocument = true,
  },
) => {
  const error = executionResult.error
  if (error && error.code === "NETWORK_FAILURE") {
    if (currentScript) {
      const errorEvent = new Event("error")
      currentScript.dispatchEvent(errorEvent)
    }
  } else if (typeof error === "object") {
    const globalErrorEvent = new Event("error")
    globalErrorEvent.filename = error.filename
    globalErrorEvent.lineno = error.line || error.lineno
    globalErrorEvent.colno = error.column || error.columnno
    globalErrorEvent.message = error.message
    window.dispatchEvent(globalErrorEvent)
  }
  if (errorExposureInConsole) {
    if (typeof window.reportError === "function") {
      window.reportError(error)
    } else {
      console.error(error)
    }
  }
  if (errorExposureInNotification) {
    displayErrorNotification(error)
  }
  if (errorExposureInDocument) {
    displayErrorInDocument(error)
  }
  executionResult.exceptionSource = unevalException(error)
  delete executionResult.error
}

const getNavigationStartTime = () => {
  try {
    return window.performance.timing.navigationStart
  } catch (e) {
    return Date.now()
  }
}
