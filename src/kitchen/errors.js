import { createDetailedMessage } from "@jsenv/log"
import { stringifyUrlSite } from "@jsenv/urls"

export const createResolveUrlError = ({
  pluginController,
  reference,
  error,
}) => {
  const createFailedToResolveUrlError = ({
    code = error.code || "RESOLVE_URL_ERROR",
    reason,
    ...details
  }) => {
    const resolveError = new Error(
      createDetailedMessage(`Failed to resolve url reference`, {
        reason,
        ...details,
        "specifier": `"${reference.specifier}"`,
        "specifier trace": reference.trace.message,
        ...detailsFromPluginController(pluginController),
      }),
    )
    resolveError.name = "RESOLVE_URL_ERROR"
    resolveError.code = code
    resolveError.reason = reason
    resolveError.asResponse = error.asResponse
    return resolveError
  }
  if (error.message === "NO_RESOLVE") {
    return createFailedToResolveUrlError({
      reason: `no plugin has handled the specifier during "resolveUrl" hook`,
    })
  }
  return createFailedToResolveUrlError({
    reason: `An error occured during specifier resolution`,
    ...detailsFromValueThrown(error),
  })
}

export const createFetchUrlContentError = ({
  pluginController,
  reference,
  urlInfo,
  error,
}) => {
  const createFailedToFetchUrlContentError = ({
    code = error.code || "FETCH_URL_CONTENT_ERROR",
    reason,
    ...details
  }) => {
    const fetchError = new Error(
      createDetailedMessage(`Failed to fetch url content`, {
        reason,
        ...details,
        "url": urlInfo.url,
        "url reference trace": reference.trace.message,
        ...detailsFromPluginController(pluginController),
      }),
    )
    fetchError.name = "FETCH_URL_CONTENT_ERROR"
    fetchError.code = code
    fetchError.reason = reason
    fetchError.url = urlInfo.url
    if (code === "PARSE_ERROR") {
      fetchError.traceUrl = error.traceUrl
      fetchError.traceLine = error.traceLine
      fetchError.traceColumn = error.traceColumn
      fetchError.traceMessage = error.traceMessage
    } else {
      fetchError.traceUrl = reference.trace.url
      fetchError.traceLine = reference.trace.line
      fetchError.traceColumn = reference.trace.column
      fetchError.traceMessage = reference.trace.message
    }
    fetchError.asResponse = error.asResponse
    return fetchError
  }

  if (error.code === "EPERM") {
    return createFailedToFetchUrlContentError({
      code: "NOT_ALLOWED",
      reason: `not allowed to read entry on filesystem`,
    })
  }
  if (error.code === "DIRECTORY_REFERENCE_NOT_ALLOWED") {
    return createFailedToFetchUrlContentError({
      code: "DIRECTORY_REFERENCE_NOT_ALLOWED",
      reason: `found a directory on filesystem`,
    })
  }
  if (error.code === "ENOENT") {
    return createFailedToFetchUrlContentError({
      code: "NOT_FOUND",
      reason: "no entry on filesystem",
    })
  }
  if (error.code === "PARSE_ERROR") {
    return createFailedToFetchUrlContentError({
      "code": "PARSE_ERROR",
      "reason": error.reason,
      "parse error message": error.cause.message,
      "parse error trace": error.traceMessage,
    })
  }
  return createFailedToFetchUrlContentError({
    reason: `An error occured during "fetchUrlContent"`,
    ...detailsFromValueThrown(error),
  })
}

export const createTransformUrlContentError = ({
  pluginController,
  reference,
  urlInfo,
  error,
}) => {
  const createFailedToTransformError = ({
    code = error.code || "TRANSFORM_URL_CONTENT_ERROR",
    reason,
    ...details
  }) => {
    const transformError = new Error(
      createDetailedMessage(
        `"transformUrlContent" error on "${urlInfo.type}"`,
        {
          reason,
          ...details,
          "url": urlInfo.url,
          "url reference trace": reference.trace.message,
          ...detailsFromPluginController(pluginController),
        },
      ),
    )
    transformError.name = "TRANSFORM_URL_CONTENT_ERROR"
    transformError.code = code
    transformError.reason = reason
    transformError.stack = error.stack
    transformError.url = urlInfo.url
    transformError.traceUrl = reference.trace.url
    transformError.traceLine = reference.trace.line
    transformError.traceColumn = reference.trace.column
    transformError.traceMessage = reference.trace.message
    if (code === "PARSE_ERROR") {
      transformError.reason = `parse error on ${urlInfo.type}`
      transformError.cause = error
      if (urlInfo.isInline) {
        transformError.traceLine = reference.trace.line + error.line - 1
        transformError.traceColumn = reference.trace.column + error.column
        transformError.traceMessage = stringifyUrlSite({
          url: urlInfo.inlineUrlSite.url,
          line: transformError.traceLine,
          column: transformError.traceColumn,
          content: urlInfo.inlineUrlSite.content,
        })
      } else {
        transformError.traceLine = error.line
        transformError.traceColumn = error.column
        transformError.traceMessage = stringifyUrlSite({
          url: urlInfo.url,
          line: error.line - 1,
          column: error.column,
          content: urlInfo.content,
        })
      }
    }
    transformError.asResponse = error.asResponse
    return transformError
  }
  return createFailedToTransformError({
    reason: `"transformUrlContent" error on "${urlInfo.type}"`,
    ...detailsFromValueThrown(error),
  })
}

export const createFinalizeUrlContentError = ({
  pluginController,
  reference,
  urlInfo,
  error,
}) => {
  const finalizeError = new Error(
    createDetailedMessage(`"finalizeUrlContent" error on "${urlInfo.type}"`, {
      ...detailsFromValueThrown(error),
      "url": urlInfo.url,
      "url reference trace": reference.trace.message,
      ...detailsFromPluginController(pluginController),
    }),
  )
  if (error && error instanceof Error) {
    finalizeError.cause = error
  }
  finalizeError.name = "FINALIZE_URL_CONTENT_ERROR"
  finalizeError.reason = `"finalizeUrlContent" error on "${urlInfo.type}"`
  finalizeError.asResponse = error.asResponse
  return finalizeError
}

const detailsFromPluginController = (pluginController) => {
  const currentPlugin = pluginController.getCurrentPlugin()
  if (!currentPlugin) {
    return null
  }
  return { "plugin name": `"${currentPlugin.name}"` }
}

const detailsFromValueThrown = (valueThrownByPlugin) => {
  if (valueThrownByPlugin && valueThrownByPlugin instanceof Error) {
    return {
      "error stack": valueThrownByPlugin.stack,
    }
  }
  if (valueThrownByPlugin === undefined) {
    return {
      error: "undefined",
    }
  }
  return {
    error: JSON.stringify(valueThrownByPlugin),
  }
}
