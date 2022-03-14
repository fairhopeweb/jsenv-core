/*
 *
 */

import { writeFileSync } from "node:fs"
import {
  assertAndNormalizeDirectoryUrl,
  ensureEmptyDirectory,
} from "@jsenv/filesystem"
import { createLogger } from "@jsenv/logger"

import { createUrlGraph } from "@jsenv/core/src/utils/url_graph/url_graph.js"
import { loadUrlGraph } from "@jsenv/core/src/utils/url_graph/url_graph_load.js"
import { createTaskLog } from "@jsenv/core/src/utils/logs/task_log.js"
import { createUrlGraphSummary } from "@jsenv/core/src/utils/url_graph/url_graph_report.js"
import { sortUrlGraphByDependencies } from "@jsenv/core/src/utils/url_graph/url_graph_sort.js"
import { createUrlVersionGenerator } from "@jsenv/core/src/utils/url_version_generator.js"

import { createKitchen } from "../omega/kitchen/kitchen.js"
import { parseUrlMentions } from "../omega/url_mentions/parse_url_mentions.js"
import { createBuilUrlsGenerator } from "./build_urls_generator.js"
import { buildWithRollup } from "./build_with_rollup.js"

export const build = async ({
  signal = new AbortController().signal,
  logLevel = "info",
  sourceDirectoryUrl,
  buildDirectoryUrl,
  entryPoints = {},
  // for now it's here but I think preview will become an other script
  // that will just pass different options to build project
  // and this function will be agnostic about "preview" concept
  isPreview = false,
  plugins = [],
  runtimeSupport = {
    android: "0.0.0",
    chrome: "0.0.0",
    edge: "0.0.0",
    electron: "0.0.0",
    firefox: "0.0.0",
    ios: "0.0.0",
    opera: "0.0.0",
    rhino: "0.0.0",
    safari: "0.0.0",
  },
  sourcemapInjection = isPreview ? "comment" : false,

  urlVersioning = true,
  lineBreakNormalization = process.platform === "win32",

  writeOnFileSystem = false,
  buildDirectoryClean = true,
  baseUrl = "/",
}) => {
  const logger = createLogger({ logLevel })
  sourceDirectoryUrl = assertAndNormalizeDirectoryUrl(sourceDirectoryUrl)
  assertEntryPoints({ entryPoints })
  buildDirectoryUrl = assertAndNormalizeDirectoryUrl(buildDirectoryUrl)

  const sourceGraph = createUrlGraph({
    rootDirectoryUrl: sourceDirectoryUrl,
  })
  const loadSourceGraphLog = createTaskLog("load source graph")
  let urlCount = 0
  const sourceKitchen = createKitchen({
    signal,
    logger,
    rootDirectoryUrl: sourceDirectoryUrl,
    urlGraph: sourceGraph,
    plugins: [
      ...plugins,
      {
        name: "jsenv:build_log",
        appliesDuring: { build: true },
        cooked: () => {
          urlCount++
          loadSourceGraphLog.setRightText(urlCount)
        },
      },
    ],
    scenario: "build",
    sourcemapInjection,
  })
  let sourceEntryUrls
  try {
    sourceEntryUrls = Object.keys(entryPoints).map((key) =>
      sourceKitchen.resolveSpecifier({
        parentUrl: sourceDirectoryUrl,
        specifierType: "entry_point",
        specifier: key,
      }),
    )
    await loadUrlGraph({
      urlGraph: sourceGraph,
      kitchen: sourceKitchen,
      outDirectoryName: "build",
      runtimeSupport,
      startLoading: (cook) => {
        sourceEntryUrls.forEach((entryUrl) => {
          return cook({
            urlTrace: {
              type: "parameter",
              value: `"entryPoints" parameter to build`,
            },
            url: entryUrl,
          })
        })
      },
    })
  } catch (e) {
    loadSourceGraphLog.fail()
    throw e
  }
  // here we can perform many checks such as ensuring ressource hints are used
  loadSourceGraphLog.done()
  logger.info(createUrlGraphSummary(sourceGraph, { title: "source files" }))

  const jsModulesUrlsToBuild = []
  const cssUrlsToBuild = []
  sourceEntryUrls.forEach((entryPointUrl) => {
    const entryPointUrlInfo = sourceGraph.getUrlInfo(entryPointUrl)
    if (entryPointUrlInfo.type === "html") {
      entryPointUrlInfo.dependencies.forEach((dependencyUrl) => {
        const dependencyUrlInfo = sourceGraph.getUrlInfo(dependencyUrl)
        if (dependencyUrlInfo.type === "js_module") {
          jsModulesUrlsToBuild.push(dependencyUrl)
          return
        }
        if (dependencyUrlInfo.type === "css") {
          cssUrlsToBuild.push(dependencyUrl)
          return
        }
      })
      return
    }
    if (entryPointUrlInfo.type === "js_module") {
      jsModulesUrlsToBuild.push(entryPointUrlInfo.url)
      return
    }
    if (entryPointUrlInfo.type === "css") {
      cssUrlsToBuild.push(entryPointUrlInfo.url)
      return
    }
  })
  const buildUrlInfos = {}
  // in the future this should be done in a "bundle" hook
  if (jsModulesUrlsToBuild.length) {
    const rollupBuildLog = createTaskLog(`building js modules with rollup`)
    try {
      const rollupBuild = await buildWithRollup({
        signal,
        logger,
        sourceDirectoryUrl,
        buildDirectoryUrl,
        sourceGraph,
        jsModulesUrlsToBuild,

        runtimeSupport,
        sourcemapInjection,
      })
      const { jsModuleInfos } = rollupBuild
      Object.keys(jsModuleInfos).forEach((url) => {
        const jsModuleInfo = jsModuleInfos[url]
        buildUrlInfos[url] = {
          type: "js_module",
          contentType: "application/javascript",
          content: jsModuleInfo.content,
          sourcemap: jsModuleInfo.sourcemap,
        }
      })
    } catch (e) {
      rollupBuildLog.fail()
      throw e
    }
    rollupBuildLog.done()
  }
  if (cssUrlsToBuild.length) {
    // on pourrait concat + minify en utilisant post css
  }
  // TODO: minify html, svg, json
  // in the future this should be done in a "optimize" hook

  const buildUrlsGenerator = createBuilUrlsGenerator({
    buildDirectoryUrl,
  })
  const buildGraph = createUrlGraph({
    rootDirectoryUrl: buildDirectoryUrl,
  })
  const buildUrlMappings = {}
  const buildKitchen = createKitchen({
    rootDirectoryUrl: sourceDirectoryUrl,
    urlGraph: buildGraph,
    baseUrl,
    injectJsenvPlugins: false,
    plugins: [
      // truc a fix: lorsque l'url démarre par "/" resolve + redirect n'est pas appelé
      // c'est pas bon
      // en tous cas pour le build on veut vraiment voir passer toutes les urls
      {
        name: "jsenv:postbuild",
        appliesDuring: { postbuild: true },
        resolve: ({ parentUrl, specifier }) => {
          const url = new URL(specifier, parentUrl).href
          return url
        },
        redirect: ({ specifierType, url }) => {
          const urlInfo = buildUrlInfos[url] || sourceGraph.getUrlInfo(url)
          const buildUrl = buildUrlsGenerator.generate(
            url,
            specifierType === "entry_point" || urlInfo.type === "js_module"
              ? "/"
              : "assets/",
          )
          buildUrlMappings[buildUrl] = url
          return buildUrl
        },
        load: ({ url }) => {
          const sourceUrl = buildUrlMappings[url]
          const urlInfo =
            buildUrlInfos[sourceUrl] || sourceGraph.getUrlInfo(sourceUrl)
          return {
            contentType: urlInfo.contentType,
            content: urlInfo.content,
            sourcemap: urlInfo.sourcemap,
          }
        },
      },
    ],
    scenario: "postbuild",
  })
  const loadBuilGraphLog = createTaskLog("load build graph")
  try {
    const buildEntryUrls = Object.keys(entryPoints).map((key) =>
      buildKitchen.resolveSpecifier({
        parentUrl: sourceDirectoryUrl,
        specifierType: "entry_point",
        specifier: key,
      }),
    )
    await loadUrlGraph({
      urlGraph: buildGraph,
      kitchen: buildKitchen,
      outDirectoryName: "postbuild",
      startLoading: (cook) => {
        buildEntryUrls.forEach((entryUrl) => {
          cook({
            urlTrace: {
              type: "parameter",
              value: `"entryPoints" parameter to build`,
            },
            url: entryUrl,
          })
        })
      },
    })
  } catch (e) {
    loadBuilGraphLog.fail()
    throw e
  }
  loadBuilGraphLog.done()

  if (urlVersioning) {
    const urlVersioningLog = createTaskLog("inject version in urls")
    try {
      const urlsSorted = sortUrlGraphByDependencies(buildGraph)
      urlsSorted.forEach((url) => {
        const urlInfo = buildGraph.getUrlInfo(url)
        const urlVersionGenerator = createUrlVersionGenerator()
        urlVersionGenerator.augmentWithContent({
          content: urlInfo.content,
          contentType: urlInfo.contentType,
          lineBreakNormalization,
        })
        urlInfo.dependencies.forEach((dependencyUrl) => {
          const dependencyUrlInfo = buildGraph.getUrlInfo(dependencyUrl)
          if (dependencyUrlInfo.version) {
            urlVersionGenerator.augmentWithDependencyVersion(
              dependencyUrlInfo.version,
            )
          } else {
            // because all dependencies are know, if the dependency has no version
            // it means there is a circular dependency between this file
            // and it's dependency
            // in that case we'll use the dependency content
            urlVersionGenerator.augmentWithContent({
              content: dependencyUrlInfo.content,
              contentType: dependencyUrlInfo.contentType,
              lineBreakNormalization,
            })
          }
        })
        urlInfo.version = urlVersionGenerator.generate()
      })
      // replace all urls to inject versions
      await Promise.all(
        urlsSorted.map(async (url) => {
          const urlInfo = buildGraph.getUrlInfo(url)
          const { urlMentions, replaceUrls } = await parseUrlMentions({
            url: urlInfo.url,
            type: urlInfo.type,
            content: urlInfo.content,
          })
          const replacements = {}
          urlMentions.forEach((urlMention) => {
            // TODO: if url mention is versioned
            // (all urls are, oh yeah but no, not import meta url, not dynamic imports)
            // static import we have no choice until importmap is supported
            // the rest must use versioned url
          })
          const { content } = await replaceUrls(replacements)
          urlInfo.content = content
        }),
      )
    } catch (e) {
      urlVersioningLog.fail()
      throw e
    }
    urlVersioningLog.done()
  }

  if (writeOnFileSystem) {
    if (buildDirectoryClean) {
      await ensureEmptyDirectory(buildDirectoryUrl)
    }
    const buildRelativeUrls = Object.keys(buildFileContents)
    buildRelativeUrls.forEach((buildRelativeUrl) => {
      writeFileSync(
        new URL(buildRelativeUrl, buildDirectoryUrl),
        buildFileContents[buildRelativeUrl],
      )
    })
  }

  /* :check: build done in 1s
   * --- 1 build file ----
   * dist/file.js (10ko)
   * --- build summary ---
   * - build files: 1 (10 ko)
   * - build sourcemap files: none
   * ----------------------
   */
  return null
}

const assertEntryPoints = ({ entryPoints }) => {
  if (typeof entryPoints !== "object" || entryPoints === null) {
    throw new TypeError(`entryPoints must be an object, got ${entryPoints}`)
  }
  const keys = Object.keys(entryPoints)
  keys.forEach((key) => {
    if (!key.startsWith("./")) {
      throw new TypeError(
        `unexpected key in entryPoints, all keys must start with ./ but found ${key}`,
      )
    }
    const value = entryPoints[key]
    if (typeof value !== "string") {
      throw new TypeError(
        `unexpected value in entryPoints, all values must be strings found ${value} for key ${key}`,
      )
    }
    if (value.includes("/")) {
      throw new TypeError(
        `unexpected value in entryPoints, all values must be plain strings (no "/") but found ${value} for key ${key}`,
      )
    }
  })
}
