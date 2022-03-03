import { applyBabelPlugins } from "#omega/internal/js_ast/apply_babel_plugins.js"

import { getBaseBabelPluginStructure } from "./babel_plugin_structure.js"
import { babelPluginImportAssertions } from "./import_assertions/babel_plugin_import_assertions.js"
import { convertCssTextToJavascriptModule } from "./import_assertions/css_module.js"
import { convertJsonTextToJavascriptModule } from "./import_assertions/json_module.js"
import { babelPluginNewStylesheetAsJsenvImport } from "./new_stylesheet/babel_plugin_new_stylesheet_as_jsenv_import.js"
import { babelPluginGlobalThisAsJsenvImport } from "./global_this/babel_plugin_global_this_as_jsenv_import.js"
import { babelPluginRegeneratorRuntimeAsJsenvImport } from "./regenerator_runtime/babel_plugin_regenerator_runtime_as_jsenv_import.js"
import { babelPluginBabelHelpersAsJsenvImports } from "./babel_helper/babel_plugin_babel_helpers_as_jsenv_imports.js"

export const jsenvPluginBabel = () => {
  const babel = {
    name: "jsenv:babel",
    appliesDuring: "*",
    transform: {
      js_module: async ({ isSupportedOnRuntime, url, content }) => {
        const babelPluginStructure = getBaseBabelPluginStructure({
          url,
          isSupportedOnRuntime,
        })
        const importTypes = []
        if (!isSupportedOnRuntime("import_type_json")) {
          importTypes.push("json")
        }
        if (!isSupportedOnRuntime("import_type_css")) {
          importTypes.push("css")
        }
        if (importTypes.length > 0) {
          babelPluginStructure["transform-import-assertions"] = [
            babelPluginImportAssertions,
            {
              importTypes,
            },
          ]
        }
        if (!isSupportedOnRuntime("global_this")) {
          babelPluginStructure["global-this-as-jsenv-import"] =
            babelPluginGlobalThisAsJsenvImport
        }
        if (!isSupportedOnRuntime("async_generator_function")) {
          babelPluginStructure["regenerator-runtime-as-jsenv-import"] =
            babelPluginRegeneratorRuntimeAsJsenvImport
        }
        if (!isSupportedOnRuntime("new_stylesheet")) {
          babelPluginStructure["new-stylesheet-as-jsenv-import"] =
            babelPluginNewStylesheetAsJsenvImport
        }
        const babelPlugins = Object.keys(babelPluginStructure).map(
          (babelPluginName) => babelPluginStructure[babelPluginName],
        )
        if (babelPlugins.length) {
          babelPlugins.push(babelPluginBabelHelpersAsJsenvImports)
        }
        const { code, map } = await applyBabelPlugins({
          babelPlugins,
          url,
          content,
        })
        return {
          content: code,
          sourcemap: map,
        }
      },
      js_classic: async () => {
        // TODO (same but some babel plugins configured differently)
        // and forward that into to applyBabelPlugins
        return null
      },
    },
  }
  const importTypeJson = {
    name: "jsenv:import_type_json",
    appliesDuring: "*",
    transform: ({ url, content }) => {
      if (new URL(url).searchParams.get("import_type") !== "json") {
        return null
      }
      return convertJsonTextToJavascriptModule({
        content,
      })
    },
  }
  const importTypeCss = {
    name: "jsenv:import_type_css",
    appliesDuring: "*",
    transform: ({ url, content }) => {
      if (new URL(url).searchParams.get("import_type") !== "css") {
        return null
      }
      return convertCssTextToJavascriptModule({
        url,
        content,
      })
    },
  }
  // maybe add importTypeText (but this will force )
  return [babel, importTypeJson, importTypeCss]
}
