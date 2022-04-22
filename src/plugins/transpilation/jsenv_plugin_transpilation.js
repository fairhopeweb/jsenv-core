/*
 * Transforms code to make it compatible with browser that would not be able to
 * run it otherwise. For instance:
 * - const -> var
 * - async/await -> promises
 * Anything that is not standard (import.meta.dev for instance) is outside the scope
 * of this plugin
 */

import { jsenvPluginCssParcel } from "./css_parcel/jsenv_plugin_css_parcel.js"
import { jsenvPluginImportAssertions } from "./import_assertions/jsenv_plugin_import_assertions.js"
import { jsenvPluginJsModuleAsJsClassic } from "./js_module_as_js_classic/jsenv_plugin_js_module_as_js_classic.js"
import { jsenvPluginBabel } from "./babel/jsenv_plugin_babel.js"

export const jsenvPluginTranspilation = ({
  importAssertions = true,
  css = true,
  jsModuleAsJsClassic = true,
  systemJsInjection = true,
  topLevelAwait = true,
  getCustomBabelPlugins,
}) => {
  return [
    // import assertions we want it all the time
    ...(importAssertions ? [jsenvPluginImportAssertions()] : []),
    // babel also so that rollup can bundle babel helpers for instance
    jsenvPluginBabel({
      topLevelAwait,
      getCustomBabelPlugins,
    }),
    // but the conversion from js_module to js_classic
    // we want to do it after bundling
    // so the build function will disable jsModuleAsJsClassic during build
    // and enable it manually during postbuild
    ...(jsModuleAsJsClassic
      ? [jsenvPluginJsModuleAsJsClassic({ systemJsInjection })]
      : []),
    ...(css ? [jsenvPluginCssParcel()] : []),
  ]
}
