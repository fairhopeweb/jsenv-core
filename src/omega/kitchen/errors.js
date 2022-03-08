import { fileURLToPath } from "node:url"
import { createDetailedMessage } from "@jsenv/logger"

export const createLoadError = ({ error, context, pluginController }) => {
  const createFailedToLoadError = ({ code, reason, ...details }) => {
    const loadError = new Error(
      createDetailedMessage(`Failed to load url`, {
        reason,
        ...details,
        url: context.url,
        ...detailsFromUrlSite(context.urlSite),
        ...detailsFromPluginController(pluginController),
      }),
    )
    loadError.name = "LOAD_ERROR"
    loadError.code = code
    loadError.reason = reason
    loadError.cause = error
    return loadError
  }

  if (error.message === "NO_LOAD") {
    return createFailedToLoadError({
      code: "NOT_FOUND",
      reason: `no plugin has handled the url during "load" hook`,
    })
  }
  if (error.path === fileURLToPath(context.url)) {
    if (error.code === "EPERM") {
      return createFailedToLoadError({
        code: "NOT_ALLOWED",
        reason: `not allowed to read entry on filesystem`,
      })
    }
    if (error.code === "EISDIR") {
      return createFailedToLoadError({
        code: "NOT_ALLOWED",
        reason: `found a directory on filesystem`,
      })
    }
    if (error.code === "ENOENT") {
      return createFailedToLoadError({
        code: "NOT_FOUND",
        reason: "no entry on filesystem",
      })
    }
  }
  return createFailedToLoadError({
    reason: `An error occured during "load"`,
    ...detailsFromValueThrown(error),
  })
}

export const createTransformError = ({ error, context, pluginController }) => {
  const createFailedToTransformError = ({ code, reason, ...details }) => {
    const loadError = new Error(
      createDetailedMessage(`Failed to transform ${context.type}`, {
        reason,
        ...details,
        url: context.url,
        ...detailsFromUrlSite(context.urlSite),
        ...detailsFromPluginController(pluginController),
      }),
    )
    loadError.name = "TRANSFORM_ERROR"
    loadError.code = code
    loadError.reason = reason
    loadError.cause = error
    return loadError
  }
  return createFailedToTransformError({
    reason: `An error occured during "transform"`,
    ...detailsFromValueThrown(error),
  })
}

const detailsFromUrlSite = (urlSite) => {
  if (!urlSite) {
    return null
  }
  if (urlSite.include(">")) {
    return { "referenced at": urlSite }
  }
  return { "referenced in": urlSite }
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
