import { urlToRelativeUrl, urlToFileSystemPath } from "@jsenv/filesystem"

import { require } from "@jsenv/core/src/internal/require.js"

import { babelTransform } from "./babel_transform.js"
import { babelPluginsFromBabelPluginMap } from "./babel_plugin_map.js"
import { babelHelperNameFromUrl } from "./babel_helper.js"

import { babelPluginBabelHelpersAsJsenvImports } from "./babel_plugin_babel_helpers_as_jsenv_imports.js"
import { babelPluginTransformImportMeta } from "./babel_plugin_transform_import_meta.js"
import { babelPluginSystemJsPrepend } from "./babel_plugin_systemjs_prepend.js"

export const transformJs = async ({
  projectDirectoryUrl,
  url,

  babelPluginMap,
  moduleOutFormat = "esmodule",
  importMetaFormat = moduleOutFormat,
  importMetaHot = false,
  babelHelpersInjectionAsImport = moduleOutFormat === "esmodule",
  prependSystemJs,
  topLevelAwait,
  sourcemapEnabled = true,

  map,
  ast,
  code,
}) => {
  if (typeof projectDirectoryUrl !== "string") {
    throw new TypeError(
      `projectDirectoryUrl must be a string, got ${projectDirectoryUrl}`,
    )
  }
  if (typeof babelPluginMap !== "object") {
    throw new TypeError(
      `babelPluginMap must be an object, got ${babelPluginMap}`,
    )
  }
  if (typeof code === "undefined") {
    throw new TypeError(`code missing, received ${code}`)
  }
  if (typeof url !== "string") {
    throw new TypeError(`url must be a string, got ${url}`)
  }
  if (babelHelpersInjectionAsImport && moduleOutFormat !== "esmodule") {
    throw new Error(
      `babelHelpersInjectionAsImport can be enabled only when "moduleOutFormat" is "esmodule"`,
    )
  }
  const relativeUrl = url.startsWith(projectDirectoryUrl)
    ? urlToRelativeUrl(url, projectDirectoryUrl)
    : undefined

  const inputPath = computeInputPath(url)
  // https://babeljs.io/docs/en/options
  const options = {
    filename: inputPath,
    filenameRelative: relativeUrl,
    inputSourceMap: map,
    configFile: false,
    babelrc: false, // trust only these options, do not read any babelrc config file
    ast: true,
    sourceMaps: sourcemapEnabled,
    sourceFileName: inputPath,
    // https://babeljs.io/docs/en/options#parseropts
    parserOpts: {
      allowAwaitOutsideFunction:
        topLevelAwait === undefined ||
        topLevelAwait === "return" ||
        topLevelAwait === "simple" ||
        topLevelAwait === "ignore",
    },
    generatorOpts: {
      compact: false,
    },
  }
  const babelHelperName = babelHelperNameFromUrl(url)
  // to prevent typeof circular dependency
  if (babelHelperName === "typeof") {
    const babelPluginMapWithoutTransformTypeOf = { ...babelPluginMap }
    delete babelPluginMapWithoutTransformTypeOf["transform-typeof-symbol"]
    babelPluginMap = babelPluginMapWithoutTransformTypeOf
  }
  babelPluginMap = {
    "transform-import-meta": [
      babelPluginTransformImportMeta,
      { importMetaFormat, importMetaHot },
    ],
    ...babelPluginMap,
    ...(babelHelpersInjectionAsImport
      ? {
          "babel-helpers-as-jsenv-imports": [
            babelPluginBabelHelpersAsJsenvImports,
          ],
        }
      : {}),
  }
  if (moduleOutFormat === "systemjs") {
    const transformModulesSystemJs = require("@babel/plugin-transform-modules-systemjs")
    babelPluginMap = {
      ...babelPluginMap,
      "transform-modules-systemjs": [transformModulesSystemJs],
    }
  }
  if (prependSystemJs) {
    babelPluginMap = {
      ...babelPluginMap,
      "systemjs-prepend": [babelPluginSystemJsPrepend],
    }
  }

  const asyncToPromise = babelPluginMap["transform-async-to-promises"]
  if (topLevelAwait && asyncToPromise) {
    asyncToPromise.options.topLevelAwait = topLevelAwait
  }
  const babelTransformReturnValue = await babelTransform({
    ast,
    code,
    options: {
      ...options,
      plugins: babelPluginsFromBabelPluginMap(babelPluginMap),
    },
  })
  code = babelTransformReturnValue.code
  map = babelTransformReturnValue.map
  ast = babelTransformReturnValue.ast
  const { metadata } = babelTransformReturnValue
  return { code, map, metadata, ast }
}

const computeInputPath = (url) => {
  if (url.startsWith("file://")) {
    return urlToFileSystemPath(url)
  }
  return url
}
