import { urlToOrigin, urlToExtension, urlToRessource } from "@jsenv/filesystem"

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

// normalize url search params:
// Using URLSearchParams to alter the url search params
// can result into "file:///file.css?css_module"
// becoming "file:///file.css?css_module="
// we want to get rid of the "=" and consider it's the same url
export const normalizeUrl = (url) => {
  if (url.includes("?")) {
    // disable on data urls (would mess up base64 encoding)
    if (url.startsWith("data:")) {
      return url
    }
    return url.replace(/[=](?=&|$)/g, "")
  }
  return url
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
  const paramsString = searchParams.toString()
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
  return urlWithParams
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

export const ensurePathnameTrailingSlash = (url) => {
  const urlObject = new URL(url)
  const { pathname } = urlObject
  if (pathname.endsWith("/")) {
    return url
  }
  let { origin } = urlObject
  // origin is "null" for "file://" urls with Node.js
  if (origin === "null" && urlObject.href.startsWith("file:")) {
    origin = "file://"
  }
  const { search, hash } = urlObject
  return `${origin}${pathname}/${search}${hash}`
}

export const asUrlUntilPathname = (url) => {
  const urlObject = new URL(url)
  let { origin, pathname } = urlObject
  // origin is "null" for "file://" urls with Node.js
  if (origin === "null" && urlObject.href.startsWith("file:")) {
    origin = "file://"
  }
  const urlUntilPathname = `${origin}${pathname}`
  return urlUntilPathname
}
