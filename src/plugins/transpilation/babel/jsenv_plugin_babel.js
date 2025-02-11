import { applyBabelPlugins } from "@jsenv/ast"
import { URL_META } from "@jsenv/url-meta"

import { babelPluginInstrument } from "@jsenv/core/src/test/coverage/babel_plugin_instrument.js"
import { RUNTIME_COMPAT } from "@jsenv/core/src/kitchen/compat/runtime_compat.js"
import { getBaseBabelPluginStructure } from "./helpers/babel_plugin_structure.js"
import { babelPluginBabelHelpersAsJsenvImports } from "./helpers/babel_plugin_babel_helpers_as_jsenv_imports.js"
import { babelPluginNewStylesheetAsJsenvImport } from "./new_stylesheet/babel_plugin_new_stylesheet_as_jsenv_import.js"
import { babelPluginGlobalThisAsJsenvImport } from "./global_this/babel_plugin_global_this_as_jsenv_import.js"
import { babelPluginRegeneratorRuntimeAsJsenvImport } from "./regenerator_runtime/babel_plugin_regenerator_runtime_as_jsenv_import.js"

export const jsenvPluginBabel = ({
  getCustomBabelPlugins,
  babelHelpersAsImport = true,
} = {}) => {
  const transformWithBabel = async (urlInfo, context) => {
    const isJsModule = urlInfo.type === "js_module"

    const isSupported = (feature) =>
      RUNTIME_COMPAT.isSupported(context.clientRuntimeCompat, feature)
    const getImportSpecifier = (clientFileUrl) => {
      const [reference] = context.referenceUtils.inject({
        type: "js_import",
        expectedType: "js_module",
        specifier: clientFileUrl,
      })
      return JSON.parse(reference.generatedSpecifier)
    }

    const babelPluginStructure = getBaseBabelPluginStructure({
      url: urlInfo.url,
      isSupported,
      isJsModule,
      getImportSpecifier,
    })
    if (context.dev) {
      const requestHeaders = context.request.headers
      if (requestHeaders["x-coverage-instanbul"]) {
        const coverageConfig = JSON.parse(
          requestHeaders["x-coverage-instanbul"],
        )
        const associations = URL_META.resolveAssociations(
          { cover: coverageConfig },
          context.rootDirectoryUrl,
        )
        if (
          URL_META.applyAssociations({ url: urlInfo.url, associations }).cover
        ) {
          babelPluginStructure["transform-instrument"] = [babelPluginInstrument]
        }
      }
    }
    if (getCustomBabelPlugins) {
      Object.assign(babelPluginStructure, getCustomBabelPlugins(context))
    }

    if (isJsModule && babelHelpersAsImport) {
      if (!isSupported("global_this")) {
        babelPluginStructure["global-this-as-jsenv-import"] = [
          babelPluginGlobalThisAsJsenvImport,
          {
            getImportSpecifier,
          },
        ]
      }
      if (!isSupported("async_generator_function")) {
        babelPluginStructure["regenerator-runtime-as-jsenv-import"] = [
          babelPluginRegeneratorRuntimeAsJsenvImport,
          {
            getImportSpecifier,
          },
        ]
      }
      if (!isSupported("new_stylesheet")) {
        babelPluginStructure["new-stylesheet-as-jsenv-import"] = [
          babelPluginNewStylesheetAsJsenvImport,
          {
            getImportSpecifier,
          },
        ]
      }
      if (Object.keys(babelPluginStructure).length > 0) {
        babelPluginStructure["babel-helper-as-jsenv-import"] = [
          babelPluginBabelHelpersAsJsenvImports,
          {
            getImportSpecifier,
          },
        ]
      }
    }
    // otherwise, concerning global_this, and new_stylesheet we must inject the code
    // (we cannot inject an import)

    const babelPlugins = Object.keys(babelPluginStructure).map(
      (babelPluginName) => babelPluginStructure[babelPluginName],
    )
    const { code, map } = await applyBabelPlugins({
      babelPlugins,
      urlInfo,
    })
    return {
      content: code,
      sourcemap: map,
    }
  }
  return {
    name: "jsenv:babel",
    appliesDuring: "*",
    finalizeUrlContent: {
      js_classic: transformWithBabel,
      js_module: transformWithBabel,
    },
  }
}
