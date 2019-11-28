export const remapCallSite = async (
  callSite,
  { filePathToSourceMapConsumer, resolveUrl, readErrorStack, onFailure },
) => {
  if (callSite.isNative()) {
    return callSite
  }

  // Most call sites will return the source file from getFileName(), but code
  // passed to eval() ending in "//# sourceURL=..." will return the source file
  // from getScriptNameOrSourceURL() instead
  const source = callSite.getFileName() || callSite.getScriptNameOrSourceURL()
  if (source) {
    const line = callSite.getLineNumber()
    const column = callSite.getColumnNumber() - 1
    const originalPosition = await remapSourcePosition({
      source,
      line,
      column,
      resolveUrl,
      filePathToSourceMapConsumer,
      readErrorStack,
      onFailure,
    })

    const callSiteClone = cloneCallSite(callSite)

    callSiteClone.getFunctionName = () => originalPosition.name || callSite.getFunctionName()
    callSiteClone.getFileName = () => originalPosition.source
    callSiteClone.getLineNumber = () => originalPosition.line
    callSiteClone.getColumnNumber = () => originalPosition.column + 1
    callSiteClone.getScriptNameOrSourceURL = () => originalPosition.source

    return callSiteClone
  }

  // Code called using eval() needs special handling
  if (callSite.isEval()) {
    const origin = callSite.getEvalOrigin()
    if (origin) {
      const callSiteClone = cloneCallSite(callSite)
      const originalEvalOrigin = await remapEvalOrigin(origin, {
        resolveUrl,
        filePathToSourceMapConsumer,
        readErrorStack,
        onFailure,
      })
      callSiteClone.getEvalOrigin = () => originalEvalOrigin
      return callSiteClone
    }
    return callSite
  }

  // If we get here then we were unable to change the source position
  return callSite
}

const cloneCallSite = (callSite) => {
  const callSiteClone = {}
  methods.forEach((name) => {
    callSiteClone[name] = () => callSite[name]()
  })
  callSiteClone.toString = () => callSiteToFunctionCall(callSiteClone)

  return callSiteClone
}

const methods = [
  "getColumnNumber",
  "getEvalOrigin",
  "getFileName",
  "getFunction",
  "getFunctionName",
  "getLineNumber",
  "getMethodName",
  "getPosition",
  "getScriptNameOrSourceURL",
  "getThis",
  "getTypeName",
  "isConstructor",
  "isEval",
  "isNative",
  "isToplevel",
  "toString",
]

const callSiteToFunctionCall = (callSite) => {
  const fileLocation = callSiteToFileLocation(callSite)
  const isConstructor = callSite.isConstructor()
  const isMethodCall = !callSite.isToplevel() && !isConstructor

  if (isMethodCall) {
    return `${callSiteToMethodCall(callSite)} (${fileLocation})`
  }

  const functionName = callSite.getFunctionName()
  if (isConstructor) {
    return `new ${functionName || "<anonymous>"} (${fileLocation})`
  }

  if (functionName) {
    return `${functionName} (${fileLocation})`
  }

  return `${fileLocation}`
}

const callSiteToMethodCall = (callSite) => {
  const functionName = callSite.getFunctionName()
  const typeName = callSiteToType(callSite)

  if (!functionName) {
    return `${typeName}.<anonymous>`
  }

  const methodName = callSite.getMethodName()
  const as = generateAs({ methodName, functionName })

  if (typeName && !functionName.startsWith(typeName)) {
    return `${typeName}.${functionName}${as}`
  }

  return `${functionName}${as}`
}

const generateAs = ({ methodName, functionName }) => {
  if (!methodName) return ""
  if (functionName.indexOf(`.${methodName}`) === functionName.length - methodName.length - 1)
    return ""
  return ` [as ${methodName}]`
}

const callSiteToType = (callSite) => {
  const typeName = callSite.getTypeName()
  // Fixes shim to be backward compatible with Node v0 to v4
  if (typeName === "[object Object]") {
    return "null"
  }
  return typeName
}

const callSiteToFileLocation = (callSite) => {
  if (callSite.isNative()) return "native"

  const sourceFile = callSiteToSourceFile(callSite)
  const lineNumber = callSite.getLineNumber()
  if (lineNumber === null) {
    return sourceFile
  }

  const columnNumber = callSite.getColumnNumber()
  if (!columnNumber) {
    return `${sourceFile}:${lineNumber}`
  }

  return `${sourceFile}:${lineNumber}:${columnNumber}`
}

const callSiteToSourceFile = (callSite) => {
  const fileName = callSite.getScriptNameOrSourceURL()

  if (fileName) {
    return fileName
  }

  // Source code does not originate from a file and is not native, but we
  // can still get the source position inside the source string, e.g. in
  // an eval string.
  if (callSite.isEval()) {
    return `${callSite.getEvalOrigin()}, <anonymous>`
  }

  return "<anonymous>"
}

// Parses code generated by FormatEvalOrigin(), a function inside V8:
// https://code.google.com/p/v8/source/browse/trunk/src/messages.js
const remapEvalOrigin = async (origin, { resolveUrl, filePathToSourceMapConsumer, onFailure }) => {
  // Most eval() calls are in this format
  const topLevelEvalMatch = /^eval at ([^(]+) \((.+):(\d+):(\d+)\)$/.exec(origin)
  if (topLevelEvalMatch) {
    const source = topLevelEvalMatch[2]
    const line = Number(topLevelEvalMatch[3])
    const column = topLevelEvalMatch[4] - 1
    const originalPosition = await remapSourcePosition({
      source,
      line,
      column,
      resolveUrl,
      filePathToSourceMapConsumer,
      onFailure,
    })
    return `eval at ${topLevelEvalMatch[1]} (${originalPosition.source}:${
      originalPosition.line
    }:${originalPosition.column + 1})`
  }

  // Parse nested eval() calls using recursion
  const nestedEvalMatch = /^eval at ([^(]+) \((.+)\)$/.exec(origin)
  if (nestedEvalMatch) {
    const originalEvalOrigin = await remapEvalOrigin(nestedEvalMatch[2], {
      resolveUrl,
      filePathToSourceMapConsumer,
      onFailure,
    })
    return `eval at ${nestedEvalMatch[1]} (${originalEvalOrigin})`
  }

  // Make sure we still return useful information if we didn't find anything
  return origin
}

const remapSourcePosition = async ({
  source,
  line,
  column,
  resolveUrl,
  filePathToSourceMapConsumer,
  readErrorStack,
  onFailure,
}) => {
  const position = { source, line, column }

  const sourceMapConsumer = await filePathToSourceMapConsumer(source)

  if (!sourceMapConsumer) return position

  try {
    const originalPosition = sourceMapConsumer.originalPositionFor(position)

    // Only return the original position if a matching line was found. If no
    // matching line is found then we return position instead, which will cause
    // the stack trace to print the path and line for the compiled file. It is
    // better to give a precise location in the compiled file than a vague
    // location in the original file.
    const originalSource = originalPosition.source

    if (originalSource === null) return position
    originalPosition.source = resolveUrl({
      type: "file-original",
      specifier: originalSource,
      importer: source,
    })

    return originalPosition
  } catch (e) {
    onFailure(`error while remapping position.
--- error stack ---
${readErrorStack(e)}
--- source ---
${source}
--- line ---
${line}
--- column ---
${column}`)
    return position
  }
}
