export const formatError = (
  error,
  { rootDirectoryUrl, errorBaseUrl, openInEditor, url, line, column },
) => {
  let { message, stack } = normalizeErrorParts(error)
  let errorDetailsPromiseReference = { current: null }
  let tip = `Reported by the browser while executing <code>${window.location.pathname}${window.location.search}</code>.`
  let errorUrlSite

  const errorMeta = extractErrorMeta(error)

  const resolveUrlSite = ({ url, line, column }) => {
    const inlineUrlMatch = url.match(/@L([0-9]+)\-L([0-9]+)\.[\w]+$/)
    if (inlineUrlMatch) {
      const htmlUrl = url.slice(0, inlineUrlMatch.index)
      const tagLine = parseInt(inlineUrlMatch[1])
      const tagColumn = parseInt(inlineUrlMatch[2])
      url = htmlUrl
      line = tagLine + parseInt(line) - 1
      if (error.name === "SyntaxError") {
        if (
          errorMeta.type === "export_missing" &&
          errorMeta.browser === "firefox"
        ) {
          // inline import not found needs line+1 on firefox
          line++
        } else if (errorMeta.type === undefined) {
          // syntax error on inline script need line-1 for some reason
          line--
        }
      }
      column = tagColumn + parseInt(column)
    }

    let urlObject = new URL(url)
    if (urlObject.origin === window.origin) {
      urlObject = new URL(
        `${urlObject.pathname.slice(1)}${urlObject.search}`,
        rootDirectoryUrl,
      )
    }
    if (urlObject.href.startsWith("file:")) {
      const atFsIndex = urlObject.pathname.indexOf("/@fs/")
      if (atFsIndex > -1) {
        const afterAtFs = urlObject.pathname.slice(atFsIndex + "/@fs/".length)
        url = new URL(afterAtFs, "file:///").href
      } else {
        url = urlObject.href
      }
    } else {
      url = urlObject.href
    }

    return {
      url,
      line,
      column,
    }
  }

  const generateClickableText = (text) => {
    const textWithHtmlLinks = makeLinksClickable(text, {
      createLink: (url, { line, column }) => {
        const urlSite = resolveUrlSite({ url, line, column })
        if (!errorUrlSite && text === stack) {
          onErrorLocated(urlSite)
        }
        if (errorBaseUrl) {
          if (urlSite.url.startsWith(rootDirectoryUrl)) {
            urlSite.url = `${errorBaseUrl}${urlSite.url.slice(
              rootDirectoryUrl.length,
            )}`
          } else {
            urlSite.url = "file:///mocked_for_snapshots"
          }
        }
        const urlWithLineAndColumn = formatUrlWithLineAndColumn(urlSite)
        return {
          href:
            url.startsWith("file:") && openInEditor
              ? `javascript:window.fetch('/__open_in_editor__/${urlWithLineAndColumn}')`
              : urlSite.url,
          text: urlWithLineAndColumn,
        }
      },
    })
    return textWithHtmlLinks
  }

  const formatErrorText = ({ message, stack, codeFrame }) => {
    let text
    if (message && stack) {
      text = `${generateClickableText(message)}\n${generateClickableText(
        stack,
      )}`
    } else if (stack) {
      text = generateClickableText(stack)
    } else {
      text = generateClickableText(message)
    }
    if (codeFrame) {
      text += `\n\n${generateClickableText(codeFrame)}`
    }
    return text
  }

  const onErrorLocated = (urlSite) => {
    errorUrlSite = urlSite
    errorDetailsPromiseReference.current = (async () => {
      if (error.name === "SyntaxError" && typeof urlSite.line === "number") {
        const response = await window.fetch(
          `/__get_code_frame__/${formatUrlWithLineAndColumn(urlSite)}`,
        )
        const codeFrame = await response.text()
        return {
          codeFrame: formatErrorText({ message: codeFrame }),
        }
      }
      // for 404 and 500 we can recognize the message

      const response = await window.fetch(`/__get_error_cause__/${urlSite.url}`)
      if (response.status !== 200) {
        return null
      }
      const causeInfo = await response.json()
      if (!causeInfo) {
        return null
      }

      const causeText =
        causeInfo.code === "NOT_FOUND"
          ? formatErrorText({
              message: causeInfo.reason,
              stack: causeInfo.codeFrame,
            })
          : formatErrorText({
              message: causeInfo.stack,
              stack: causeInfo.codeFrame,
            })
      return {
        cause: causeText,
      }
    })()
  }

  // error.stack is more reliable than url/line/column reported on window error events
  // so use it only when error.stack is not available
  if (
    url &&
    !stack &&
    // ignore window.reportError() it gives no valuable info
    !url.endsWith("html_supervisor_installer.js")
  ) {
    onErrorLocated(resolveUrlSite({ url, line, column }))
  } else if (errorMeta.url) {
    onErrorLocated(resolveUrlSite(errorMeta))
  }

  return {
    theme:
      error && error.cause && error.cause.code === "PARSE_ERROR"
        ? "light"
        : "dark",
    title: "An error occured",
    text: formatErrorText({ message, stack }),
    tip: `${tip}
    <br />
    Click outside to close.`,
    errorDetailsPromise: errorDetailsPromiseReference.current,
  }
}

const extractErrorMeta = (error) => {
  if (!error) {
    return {}
  }
  const { message } = error
  if (!message) {
    return {}
  }

  fetch_error: {
    // chrome
    if (message.startsWith("Failed to fetch dynamically imported module: ")) {
      const url = error.message.slice(
        "Failed to fetch dynamically imported module: ".length,
      )
      return {
        type: "dynamic_import_fetch_error",
        url,
      }
    }
    // firefox
    if (message === "error loading dynamically imported module") {
      return {
        type: "dynamic_import_fetch_error",
      }
    }
    // safari
    if (message === "Importing a module script failed.") {
      return {
        type: "dynamic_import_fetch_error",
      }
    }
  }

  export_missing: {
    // chrome
    if (message.includes("does not provide an export named")) {
      return {
        type: "export_missing",
      }
    }
    // firefox
    if (message.startsWith("import not found:")) {
      return {
        type: "export_missing",
        browser: "firefox",
      }
    }
    // safari
    if (message.startsWith("import binding name")) {
      return {
        type: "export_missing",
      }
    }
  }

  return {}
}

const formatUrlWithLineAndColumn = ({ url, line, column }) => {
  return line === undefined && column === undefined
    ? url
    : column === undefined
    ? `${url}:${line}`
    : `${url}:${line}:${column}`
}

const normalizeErrorParts = (error) => {
  if (error === undefined) {
    return {
      message: "undefined",
    }
  }
  if (error === null) {
    return {
      message: "null",
    }
  }
  if (typeof error === "string") {
    return {
      message: error,
    }
  }
  if (error instanceof Error) {
    if (error.name === "SyntaxError") {
      return {
        message: error.message,
      }
    }
    if (error.cause && error.cause.code === "PARSE_ERROR") {
      if (error.messageHTML) {
        return {
          message: error.messageHTML,
        }
      }
      return {
        message: error.message,
      }
    }
    // stackTrace formatted by V8
    if (Error.captureStackTrace) {
      return {
        message: error.message,
        stack: getErrorStackWithoutErrorMessage(error),
      }
    }
    return {
      message: error.message,
      stack: error.stack ? `  ${error.stack}` : null,
    }
  }
  if (typeof error === "object") {
    return error
  }
  return {
    message: JSON.stringify(error),
  }
}

const getErrorStackWithoutErrorMessage = (error) => {
  let stack = error.stack
  const messageInStack = `${error.name}: ${error.message}`
  if (stack.startsWith(messageInStack)) {
    stack = stack.slice(messageInStack.length)
  }
  const nextLineIndex = stack.indexOf("\n")
  if (nextLineIndex > -1) {
    stack = stack.slice(nextLineIndex + 1)
  }
  return stack
}

const makeLinksClickable = (string, { createLink = (url) => url }) => {
  // normalize line breaks
  string = string.replace(/\n/g, "\n")
  string = escapeHtml(string)
  // render links
  string = stringToStringWithLink(string, {
    transform: (url, { line, column }) => {
      const { href, text } = createLink(url, { line, column })
      return link({ href, text })
    },
  })
  return string
}

const escapeHtml = (string) => {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// `Error: yo
// at Object.execute (http://127.0.0.1:57300/build/src/__test__/file-throw.js:9:13)
// at doExec (http://127.0.0.1:3000/src/__test__/file-throw.js:452:38)
// at postOrderExec (http://127.0.0.1:3000/src/__test__/file-throw.js:448:16)
// at http://127.0.0.1:3000/src/__test__/file-throw.js:399:18`.replace(/(?:https?|ftp|file):\/\/(.*+)$/gm, (...args) => {
//   debugger
// })
const stringToStringWithLink = (
  source,
  {
    transform = (url) => {
      return {
        href: url,
        text: url,
      }
    },
  } = {},
) => {
  return source.replace(/(?:https?|ftp|file):\/\/\S+/gm, (match) => {
    let linkHTML = ""

    const lastChar = match[match.length - 1]

    // hotfix because our url regex sucks a bit
    const endsWithSeparationChar = lastChar === ")" || lastChar === ":"
    if (endsWithSeparationChar) {
      match = match.slice(0, -1)
    }

    const lineAndColumnPattern = /:([0-9]+):([0-9]+)$/
    const lineAndColumMatch = match.match(lineAndColumnPattern)
    if (lineAndColumMatch) {
      const lineAndColumnString = lineAndColumMatch[0]
      const lineNumber = lineAndColumMatch[1]
      const columnNumber = lineAndColumMatch[2]
      linkHTML = transform(match.slice(0, -lineAndColumnString.length), {
        line: lineNumber,
        column: columnNumber,
      })
    } else {
      const linePattern = /:([0-9]+)$/
      const lineMatch = match.match(linePattern)
      if (lineMatch) {
        const lineString = lineMatch[0]
        const lineNumber = lineMatch[1]
        linkHTML = transform(match.slice(0, -lineString.length), {
          line: lineNumber,
        })
      } else {
        linkHTML = transform(match, {})
      }
    }
    if (endsWithSeparationChar) {
      return `${linkHTML}${lastChar}`
    }
    return linkHTML
  })
}

const link = ({ href, text = href }) => `<a href="${href}">${text}</a>`
