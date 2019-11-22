/* eslint-disable import/max-dependencies */
import { readFileSync } from "fs"
import { createCancellationToken } from "@jsenv/cancellation"
import { composeTwoImportMaps, normalizeImportMap, resolveImport } from "@jsenv/import-map"
import { generateImportMapForPackage } from "@jsenv/node-module-import-map"
import { registerFileLifecycle } from "@jsenv/file-watcher"
import {
  jsenvAccessControlAllowedHeaders,
  startServer,
  firstService,
  serveFile,
  urlToContentType,
} from "@jsenv/server"
import { createLogger } from "@jsenv/logger"
import { COMPILE_DIRECTORY } from "internal/CONSTANTS.js"
import {
  resolveFileUrl,
  fileUrlToPath,
  urlToRelativeUrl,
  resolveDirectoryUrl,
} from "internal/urlUtils.js"
import { writeFileContent, removeDirectory } from "internal/filesystemUtils.js"
import { jsenvCoreDirectoryUrl } from "internal/jsenvCoreDirectoryUrl.js"
import { readProjectImportMap } from "internal/readProjectImportMap/readProjectImportMap.js"
import { generateGroupMap } from "internal/generateGroupMap/generateGroupMap.js"
import { jsenvBabelPluginCompatMap } from "src/jsenvBabelPluginCompatMap.js"
import { jsenvBrowserScoreMap } from "src/jsenvBrowserScoreMap.js"
import { jsenvNodeVersionScoreMap } from "src/jsenvNodeVersionScoreMap.js"
import { jsenvBabelPluginMap } from "src/jsenvBabelPluginMap.js"
import { cleanCompileDirectoryIfObsolete } from "./compile-directory/cleanCompileDirectoryIfObsolete.js"
import { serveBrowserPlatform } from "./serveBrowserPlatform.js"
import { serveNodePlatform } from "./serveNodePlatform.js"
import { serveCompiledJs } from "./serveCompiledJs.js"
import { urlIsAsset } from "./urlIsAsset.js"

export const startCompileServer = async ({
  cancellationToken = createCancellationToken(),
  compileServerLogLevel,

  // js compile options
  transformTopLevelAwait = true,
  transformModuleIntoSystemFormat = true,

  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl = "./.jsenv/",
  jsenvDirectoryClean = false,

  writeOnFilesystem = true,
  useFilesystemAsCache = true,

  importMapFileUrl,
  importDefaultExtension,
  importReplaceMap = {},
  importFallbackMap = {},

  env = {},

  babelPluginMap = jsenvBabelPluginMap,
  convertMap = {},

  // options related to the server itself
  protocol = "http",
  privateKey,
  certificate,
  ip = "127.0.0.1",
  port = 0,
  keepProcessAlive = false,
  stopOnPackageVersionChange = false,

  // this callback will be called each time a projectFile was
  // used to respond to a request
  // each time an execution needs a project file this callback
  // will be called.
  projectFileRequestedCallback = undefined,
  projectFilePredicate = () => true,

  // remaining options are complex or private
  compileGroupCount = 1,
  babelCompatMap = jsenvBabelPluginCompatMap,
  browserScoreMap = jsenvBrowserScoreMap,
  nodeVersionScoreMap = jsenvNodeVersionScoreMap,
  platformAlwaysInsidePlatformScoreMap = false,
  browserPlatformFileUrl = resolveFileUrl(
    "./src/internal/compiling/platform-service/createBrowserPlatform/index.js",
    jsenvCoreDirectoryUrl,
  ),
  nodePlatformFileUrl = resolveFileUrl(
    "./src/internal/compiling/platform-service/createNodePlatform/index.js",
    jsenvCoreDirectoryUrl,
  ),
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(`projectDirectoryUrl must be a string. got ${projectDirectoryUrl}`)
  }

  if (typeof importMapFileUrl === "undefined") {
    importMapFileUrl = resolveFileUrl("./importMap.json", projectDirectoryUrl)
  }

  if (typeof jsenvDirectoryRelativeUrl !== "string") {
    throw new TypeError(
      `jsenvDirectoryRelativeUrl must be a string. got ${jsenvDirectoryRelativeUrl}`,
    )
  }
  const jsenvDirectoryUrl = resolveDirectoryUrl(jsenvDirectoryRelativeUrl, projectDirectoryUrl)
  if (!jsenvDirectoryUrl.startsWith(projectDirectoryUrl)) {
    throw new TypeError(`jsenv directory must be inside project directory
    --- jsenv directory url ---
    ${jsenvDirectoryUrl}
    --- project directory url ---
    ${projectDirectoryUrl}`)
  }
  // to normalize the value
  jsenvDirectoryRelativeUrl = urlToRelativeUrl(jsenvDirectoryUrl, projectDirectoryUrl)

  if (typeof browserPlatformFileUrl !== "string") {
    throw new TypeError(`browserPlatformFileUrl must be a string. got ${browserPlatformFileUrl}`)
  }
  if (!browserPlatformFileUrl.startsWith(projectDirectoryUrl)) {
    throw new TypeError(`browserPlatformFileUrl must be inside projectDirectoryUrl.
--- browser platform file url ---
${browserPlatformFileUrl}
--- project directory url ---
${projectDirectoryUrl}`)
  }

  if (typeof nodePlatformFileUrl !== "string") {
    throw new TypeError(`nodePlatformFileUrl must be a string. got ${nodePlatformFileUrl}`)
  }
  if (!nodePlatformFileUrl.startsWith(projectDirectoryUrl)) {
    throw new TypeError(`nodePlatformFileUrl must be inside projectDirectoryUrl.
--- node platform file url ---
${nodePlatformFileUrl}
--- project directory url ---
${projectDirectoryUrl}`)
  }

  const logger = createLogger({ logLevel: compileServerLogLevel })

  const importMapFileRelativeUrl = urlToRelativeUrl(importMapFileUrl, projectDirectoryUrl)
  const compileDirectoryUrl = resolveDirectoryUrl(COMPILE_DIRECTORY, jsenvDirectoryUrl)

  const groupMap = generateGroupMap({
    babelPluginMap,
    babelCompatMap,
    platformScoreMap: { ...browserScoreMap, node: nodeVersionScoreMap },
    groupCount: compileGroupCount,
    platformAlwaysInsidePlatformScoreMap,
  })

  const compileDirectoryMeta = {
    babelPluginMap,
    convertMap,
    groupMap,
  }
  if (jsenvDirectoryClean) {
    logger.info(`clean jsenv directory at ${jsenvDirectoryUrl}`)
    await removeDirectory(fileUrlToPath(jsenvDirectoryUrl))
  }
  await cleanCompileDirectoryIfObsolete({
    jsenvDirectoryUrl,
    compileDirectoryMeta,
    cleanCallback: (compileDirectoryPath) => {
      logger.info(`clean compile directory content at ${compileDirectoryPath}`)
    },
  })

  const packageFileUrl = resolveFileUrl("./package.json", jsenvCoreDirectoryUrl)
  const packageFilePath = fileUrlToPath(packageFileUrl)
  const packageVersion = readPackage(packageFilePath).version

  if (projectFileRequestedCallback) {
    if (typeof projectFileRequestedCallback !== "function") {
      throw new TypeError(
        `projectFileRequestedCallback must be a function, got ${projectFileRequestedCallback}`,
      )
    }
    const originalProjectFileRequestedCallback = projectFileRequestedCallback
    projectFileRequestedCallback = ({ relativeUrl, ...rest }) => {
      // I doubt an asset like .js.map will change
      // in theory a compilation asset should not change
      // if the source file did not change
      // so we can avoid watching compilation asset
      if (urlIsAsset(`${projectDirectoryUrl}${relativeUrl}`)) {
        return
      }

      if (projectFilePredicate(relativeUrl)) {
        originalProjectFileRequestedCallback({ relativeUrl, ...rest })
      }
    }
  } else {
    projectFileRequestedCallback = () => {}
  }

  const [compileServer, importMapForCompileServer] = await Promise.all([
    startServer({
      cancellationToken,
      logLevel: compileServerLogLevel,
      protocol,
      privateKey,
      certificate,
      ip,
      port,
      sendInternalErrorStack: true,
      requestToResponse: (request) =>
        firstService(
          () => {
            const { origin, ressource, method, headers } = request
            const requestUrl = `${origin}${ressource}`
            // serve asset files directly
            if (urlIsAsset(requestUrl)) {
              const fileUrl = resolveFileUrl(ressource.slice(1), projectDirectoryUrl)
              return serveFile(fileUrl, {
                method,
                headers,
              })
            }
            return null
          },
          () =>
            serveBrowserPlatform({
              cancellationToken,
              logger,

              projectDirectoryUrl,
              jsenvDirectoryRelativeUrl,
              compileDirectoryUrl,
              importDefaultExtension,
              browserPlatformFileUrl,

              babelPluginMap,
              projectFileRequestedCallback,
              compileServerOrigin: compileServer.origin,
              compileServerImportMap: importMapForCompileServer,
              request,
            }),
          () =>
            serveNodePlatform({
              cancellationToken,
              logger,

              projectDirectoryUrl,
              jsenvDirectoryRelativeUrl,
              compileDirectoryUrl,
              importDefaultExtension,
              nodePlatformFileUrl,

              babelPluginMap,
              projectFileRequestedCallback,
              compileServerOrigin: compileServer.origin,
              compileServerImportMap: importMapForCompileServer,
              request,
            }),
          () =>
            serveCompiledJs({
              cancellationToken,
              logger,

              projectDirectoryUrl,
              compileDirectoryUrl,
              importReplaceMap,
              importFallbackMap,

              transformTopLevelAwait,
              transformModuleIntoSystemFormat,
              groupMap,
              babelPluginMap,
              convertMap,
              projectFileRequestedCallback,
              request,
              useFilesystemAsCache,
              writeOnFilesystem,
            }),
          () =>
            serveProjectFiles({
              projectDirectoryUrl,
              projectFileRequestedCallback,
              importReplaceMap,
              importFallbackMap,
              request,
            }),
        ),
      accessControlAllowRequestOrigin: true,
      accessControlAllowRequestMethod: true,
      accessControlAllowRequestHeaders: true,
      accessControlAllowedRequestHeaders: [
        ...jsenvAccessControlAllowedHeaders,
        "x-jsenv-execution-id",
      ],
      accessControlAllowCredentials: true,
      keepProcessAlive,
    }),
    generateImportMapForCompileServer({
      logger,
      projectDirectoryUrl,
      jsenvDirectoryRelativeUrl,
      importMapFileUrl,
    }),
  ])

  const importMap = normalizeImportMap(importMapForCompileServer, compileServer.origin)

  env = {
    ...env,
    jsenvDirectoryRelativeUrl,
    importDefaultExtension,
  }

  // it would be better for perf to generated them on demand but for now that's good
  await Promise.all([
    writeFileContent(
      fileUrlToPath(resolveFileUrl("./importMap.json", jsenvDirectoryUrl)),
      JSON.stringify(importMapForCompileServer, null, "  "),
    ),
    writeFileContent(
      fileUrlToPath(resolveFileUrl("./groupMap.json", jsenvDirectoryUrl)),
      JSON.stringify(groupMap, null, "  "),
    ),
    writeFileContent(
      fileUrlToPath(resolveFileUrl("./env.js", jsenvDirectoryUrl)),
      Object.keys(env)
        .map(
          (key) => `
export const ${key} = ${JSON.stringify(env[key])}
`,
        )
        .join(""),
    ),
  ])

  importReplaceMap = resolveSpecifierMap(importReplaceMap, {
    compileServerOrigin: compileServer.origin,
    importMap,
    importDefaultExtension,
  })

  importFallbackMap = {
    // importMap is optional
    [`./${importMapFileRelativeUrl}`]: () => `{}`,
    ...importFallbackMap,
  }
  importFallbackMap = resolveSpecifierMap(importFallbackMap, {
    compileServerOrigin: compileServer.origin,
    importMap,
    importDefaultExtension,
  })

  if (stopOnPackageVersionChange) {
    const checkPackageVersion = () => {
      let packageObject
      try {
        packageObject = readPackage(packageFilePath)
      } catch (e) {
        // package json deleted ? not a problem
        // let's wait for it to show back
        if (e.code === "ENOENT") return
        // package.json malformed ? not a problem
        // let's wait for use to fix it or filesystem to finish writing the file
        if (e.name === "SyntaxError") return
        throw e
      }

      if (packageVersion !== packageObject.version) {
        compileServer.stop(STOP_REASON_PACKAGE_VERSION_CHANGED)
      }
    }

    const unregister = registerFileLifecycle(packageFilePath, {
      added: checkPackageVersion,
      updated: checkPackageVersion,
    })
    compileServer.stoppedPromise.then(
      () => {
        unregister()
      },
      () => {},
    )
  }

  return {
    ...compileServer,
    compileServerOrigin: compileServer.origin,
    compileServerImportMap: importMapForCompileServer,
    compileServerGroupMap: groupMap,
    compileServerJsenvDirectoryUrl: `${compileServer.origin}/${jsenvDirectoryRelativeUrl}`,
  }
}

const readPackage = (packagePath) => {
  const buffer = readFileSync(packagePath)
  const string = String(buffer)
  const packageObject = JSON.parse(string)
  return packageObject
}

export const STOP_REASON_PACKAGE_VERSION_CHANGED = {
  toString: () => `package version changed`,
}

const serveProjectFiles = async ({
  projectDirectoryUrl,
  projectFileRequestedCallback,
  importReplaceMap,
  importFallbackMap,
  request,
}) => {
  const { origin, ressource, method, headers } = request
  const requestUrl = `${origin}${ressource}`
  const relativeUrl = ressource.slice(1)

  projectFileRequestedCallback({
    relativeUrl,
    request,
  })

  const fileUrl = resolveFileUrl(relativeUrl, projectDirectoryUrl)
  const filePath = fileUrlToPath(fileUrl)

  if (requestUrl in importReplaceMap) {
    const body = await importReplaceMap[requestUrl]()
    return {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": urlToContentType(requestUrl),
        "content-length": Buffer.byteLength(body),
      },
      body,
    }
  }

  const responsePromise = serveFile(filePath, {
    method,
    headers,
  })

  if (requestUrl in importFallbackMap) {
    const response = await responsePromise
    if (response.status === 404) {
      const body = await importFallbackMap[requestUrl]()
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": urlToContentType(requestUrl),
          "content-length": Buffer.byteLength(body),
        },
        body,
      }
    }
    return response
  }

  return responsePromise
}

/**
 * generateImportMapForCompileServer allows the following:
 *
 * import importMap from '/.jsenv/importMap.json'
 *
 * returns jsenv internal importMap and
 *
 * import importMap from '/importMap.json'
 *
 * returns the project importMap.
 * Note that if importMap file does not exists an empty object is returned.
 * Note that if project uses a custom importMapFileRelativeUrl jsenv internal import map
 * remaps '/importMap.json' to the real importMap
 *
 * This pattern exists so that jsenv can resolve some dynamically injected import such as
 *
 * @jsenv/core/helpers/regenerator-runtime/regenerator-runtime.js
 */
const generateImportMapForCompileServer = async ({
  logger,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  importMapFileUrl,
}) => {
  const importMapFileRelativeUrl = urlToRelativeUrl(importMapFileUrl, projectDirectoryUrl)
  const importMapForJsenvCore = await generateImportMapForPackage({
    logger,
    projectDirectoryPath: fileUrlToPath(jsenvCoreDirectoryUrl),
    rootProjectDirectoryPath: fileUrlToPath(projectDirectoryUrl),
  })
  const importMapInternal = {
    imports: {
      ...(jsenvDirectoryRelativeUrl === ".jsenv/"
        ? {}
        : {
            "/.jsenv/": `./${jsenvDirectoryRelativeUrl}`,
          }),
      // in case importMapFileRelativeUrl is not the default
      // redirect /importMap.json to the proper location
      // well fuck it won't be compiled to something
      // with this approach
      ...(importMapFileRelativeUrl === "importMap.json"
        ? {}
        : {
            // but it means importMap.json is not
            // gonna hit compile server
            "/importMap.json": `./${importMapFileRelativeUrl}`,
          }),
    },
  }
  const importMapForProject = await readProjectImportMap({
    logger,
    projectDirectoryUrl,
    jsenvProjectDirectoryUrl: jsenvCoreDirectoryUrl,
    importMapFileUrl,
  })
  const importMap = [importMapForJsenvCore, importMapInternal, importMapForProject].reduce(
    (previous, current) => composeTwoImportMaps(previous, current),
    {},
  )
  return importMap
}

const resolveSpecifierMap = (
  specifierMap,
  { compileServerOrigin, importMap, importDefaultExtension },
) => {
  const specifierMapResolved = {}
  Object.keys(specifierMap).forEach((specifier) => {
    const specifierUrl = resolveImport({
      specifier,
      importer: `${compileServerOrigin}/`,
      importMap,
      defaultExtension: importDefaultExtension,
    })
    specifierMapResolved[specifierUrl] = specifierMap[specifier]
  })
  return specifierMapResolved
}
