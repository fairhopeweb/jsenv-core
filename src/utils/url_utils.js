import {
  urlToRelativeUrl,
  resolveUrl,
  urlToOrigin,
  urlToExtension,
  urlToRessource,
} from "@jsenv/filesystem"

// TODO: move "filesystemRootUrl" and "moveUrl" to @jsenv/filesystem
export const filesystemRootUrl =
  process.platform === "win32" ? `file///${process.cwd()[0]}:/` : "file:///"

// I would expect moveUrl to move url trying to keep it relative to the destination
// TODO: rename this function moveAbsoluteUrl and write a moveUrl which tries to keep url relative
export const moveUrl = (url, from, to) => {
  const relativeUrl = urlToRelativeUrl(url, from)
  return resolveUrl(relativeUrl, to)
}

export const asUrlWithoutSearch = (url) => {
  const urlObject = new URL(url)
  urlObject.search = ""
  return urlObject.href
}

export const isValidUrl = (url) => {
  try {
    // eslint-disable-next-line no-new
    new URL(url)
    return true
  } catch (e) {
    return false
  }
}

export const injectQueryParamsIntoSpecifier = (specifier, params) => {
  if (isValidUrl(specifier)) {
    return injectQueryParams(specifier, params)
  }
  const [beforeQuestion, afterQuestion = ""] = specifier.split("?")
  const searchParams = new URLSearchParams(afterQuestion)
  Object.keys(params).forEach((key) => {
    searchParams.set(key, params[key])
  })
  const paramsString = searchParams.toString().replace(/[=](?=&|$)/g, "")
  if (paramsString) {
    return `${beforeQuestion}?${paramsString}`
  }
  return specifier
}

export const injectQueryParams = (url, params) => {
  const urlObject = new URL(url)
  Object.keys(params).forEach((key) => {
    urlObject.searchParams.set(key, params[key])
  })
  const urlWithParams = urlObject.href
  // injectQueryParams('http://example.com/file.js', { hmr: '' })
  // returns
  // "http://example.com/file.js?hmr="
  // It is technically valid but "=" signs hurts readability
  return urlWithParams.replace(/[=](?=&|$)/g, "")
}

export const setUrlExtension = (url, extension) => {
  const origin = urlToOrigin(url)
  const currentExtension = urlToExtension(url)
  const ressource = urlToRessource(url)
  const [pathname, search] = ressource.split("?")
  const pathnameWithoutExtension = currentExtension
    ? pathname.slice(0, -currentExtension.length)
    : pathname
  const newPathname = `${pathnameWithoutExtension}${extension}`
  return `${origin}${newPathname}${search ? `?${search}` : ""}`
}

export const setUrlFilename = (url, filename) => {
  const urlObject = new URL(url)
  let { origin, search, hash } = urlObject
  // origin is "null" for "file://" urls with Node.js
  if (origin === "null" && urlObject.href.startsWith("file:")) {
    origin = "file://"
  }
  const parentPathname = new URL("./", urlObject).pathname
  return `${origin}${parentPathname}${filename}${search}${hash}`
}
