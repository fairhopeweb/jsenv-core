export const compareTwoUrlPaths = (url, otherUrl) => {
  if (url === otherUrl) {
    return true
  }
  const urlObject = new URL(url)
  const otherUrlObject = new URL(otherUrl)
  return (
    urlObject.origin === otherUrlObject.origin &&
    urlObject.pathname === otherUrlObject.pathname
  )
}

export const injectQuery = (url, query) => {
  const urlObject = new URL(url)
  const { searchParams } = urlObject
  Object.keys(query).forEach((key) => {
    searchParams.set(key, query[key])
  })
  return String(urlObject)
}
