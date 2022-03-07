import { fetchFileSystem, serveDirectory } from "@jsenv/server"
import { urlIsInsideOf } from "@jsenv/filesystem"

import { moveUrl } from "@jsenv/core/src/utils/url_utils.js"

import { createKitchen } from "./kitchen/kitchen.js"
import { parseUserAgentHeader } from "./user_agent.js"

export const createFileService = ({
  signal,
  logger,
  projectDirectoryUrl,
  scenario,
  plugins,
  sourcemapInjection,
  ressourceGraph,
  longTermCache = false, // will become true once things get more stable
}) => {
  const kitchen = createKitchen({
    signal,
    logger,
    projectDirectoryUrl,
    scenario,
    plugins,
    sourcemapInjection,
    ressourceGraph,
  })
  return async (request) => {
    // serve file inside ".jsenv" directory
    const requestFileUrl = new URL(
      request.ressource.slice(1),
      projectDirectoryUrl,
    ).href
    if (urlIsInsideOf(requestFileUrl, kitchen.jsenvDirectoryUrl)) {
      return fetchFileSystem(requestFileUrl, {
        headers: request.headers,
      })
    }
    const { runtimeName, runtimeVersion } = parseUserAgentHeader(
      request.headers["user-agent"],
    )
    const runtimeSupport = {
      [runtimeName]: runtimeVersion,
    }
    const parentUrl = inferParentFromRequest(request, projectDirectoryUrl)
    const url = await kitchen.resolveSpecifier({
      parentUrl,
      specifierType: "http_request",
      specifier: request.ressource,
    })
    const urlSite = ressourceGraph.getUrlSite(parentUrl, url)
    const { error, response, contentType, content } = await kitchen.cookUrl({
      outDirectoryName: `${runtimeName}@${runtimeVersion}`,
      runtimeSupport,
      parentUrl,
      urlSite,
      url,
    })
    if (error) {
      if (error.code === "PARSE_ERROR") {
        // let the browser re-throw the syntax error
        logger.error(error.message)
        return {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-length": Buffer.byteLength(content),
            "cache-control": "no-store",
          },
          body: content,
        }
      }
      if (error.code === "NOT_ALLOWED") {
        if (error.cause && error.cause.code === "EISDIR") {
          return serveDirectory(url, {
            headers: {
              accept: "text/html",
            },
            canReadDirectory: true,
            rootDirectoryUrl: projectDirectoryUrl,
          })
        }
        return {
          status: 403,
          statusText: error.reason,
        }
      }
      if (error.code === "NOT_FOUND") {
        return {
          status: 404,
          statusText: error.reason,
          statusMessage: error.message,
        }
      }
      return {
        status: 500,
        statusText: error.reason,
      }
    }
    if (response) {
      return response
    }
    return {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": Buffer.byteLength(content),
        "cache-control": determineCacheControlResponseHeader({
          url,
          longTermCache,
        }),
      },
      body: content,
    }
  }
}

const inferParentFromRequest = (request, projectDirectoryUrl) => {
  const { referer } = request.headers
  if (!referer) {
    return projectDirectoryUrl
  }
  return moveUrl(referer, request.origin, projectDirectoryUrl)
}

const determineCacheControlResponseHeader = ({ url, longTermCache }) => {
  const { searchParams } = new URL(url)
  // When url is versioned and no hmr on it, put it in browser cache for 30 days
  if (longTermCache && searchParams.has("v") && !searchParams.has("hmr")) {
    return `private,max-age=${SECONDS_IN_30_DAYS},immutable`
  }
  return `private,max-age=0,must-revalidate`
}
const SECONDS_IN_30_DAYS = 60 * 60 * 24 * 30
