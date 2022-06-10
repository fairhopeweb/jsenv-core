import { jsenvPluginUrlAnalysis } from "../plugins/url_analysis/jsenv_plugin_url_analysis.js"
import { jsenvPluginLeadingSlash } from "./leading_slash/jsenv_plugin_leading_slash.js"
import { jsenvPluginImportmap } from "./importmap/jsenv_plugin_importmap.js"
import { jsenvPluginUrlResolution } from "./url_resolution/jsenv_plugin_url_resolution.js"
import { jsenvPluginNodeEsmResolution } from "./node_esm_resolution/jsenv_plugin_node_esm_resolution.js"
import { jsenvPluginUrlVersion } from "./url_version/jsenv_plugin_url_version.js"
import { jsenvPluginFileUrls } from "./file_urls/jsenv_plugin_file_urls.js"
import { jsenvPluginHttpUrls } from "./http_urls/jsenv_plugin_http_urls.js"
import { jsenvPluginFileSystemMagic } from "./filesystem_magic/jsenv_plugin_filesystem_magic.js"
import { jsenvPluginInline } from "./inline/jsenv_plugin_inline.js"
import { jsenvPluginHtmlSupervisor } from "./html_supervisor/jsenv_plugin_html_supervisor.js"
import { jsenvPluginCommonJsGlobals } from "./commonjs_globals/jsenv_plugin_commonjs_globals.js"
import { jsenvPluginImportMetaScenarios } from "./import_meta_scenarios/jsenv_plugin_import_meta_scenarios.js"
import { jsenvPluginInjectGlobals } from "./inject_globals/jsenv_plugin_inject_globals.js"
import { jsenvPluginTranspilation } from "./transpilation/jsenv_plugin_transpilation.js"
import { jsenvPluginNodeRuntime } from "./node_runtime/jsenv_plugin_node_runtime.js"
// build only
import { jsenvPluginBundling } from "./bundling/jsenv_plugin_bundling.js"
import { jsenvPluginMinification } from "./minification/jsenv_plugin_minification.js"
// autoreload
import { jsenvPluginImportMetaHot } from "./import_meta_hot/jsenv_plugin_import_meta_hot.js"
import { jsenvPluginAutoreload } from "./autoreload/jsenv_plugin_autoreload.js"
import { jsenvPluginCacheControl } from "./cache_control/jsenv_plugin_cache_control.js"

export const getCorePlugins = ({
  rootDirectoryUrl,
  urlGraph,
  scenario,
  runtimeCompat,

  htmlSupervisor,
  nodeEsmResolution,
  fileSystemMagicResolution,
  injectedGlobals,
  transpilation = true,
  minification = false,
  bundling = false,

  clientAutoreload = false,
  clientFileChangeCallbackList,
  clientFilesPruneCallbackList,
} = {}) => {
  if (htmlSupervisor === true) {
    htmlSupervisor = {}
  }
  if (nodeEsmResolution === true) {
    nodeEsmResolution = {}
  }
  return [
    jsenvPluginUrlAnalysis(),
    jsenvPluginTranspilation({
      rootDirectoryUrl,
      ...transpilation,
    }),
    ...(htmlSupervisor
      ? [
          jsenvPluginHtmlSupervisor({
            rootDirectoryUrl,
            ...htmlSupervisor,
          }),
        ]
      : []), // before inline as it turns inline <script> into <script src>
    jsenvPluginInline(), // before "file urls" to resolve and load inline urls
    jsenvPluginImportmap(), // before node esm to handle bare specifiers before node esm
    jsenvPluginFileUrls(),
    jsenvPluginHttpUrls(),
    jsenvPluginLeadingSlash(),
    // before url resolution to handle "js_import_export" resolution
    jsenvPluginNodeEsmResolution({
      rootDirectoryUrl,
      runtimeCompat,
      ...nodeEsmResolution,
    }),
    jsenvPluginUrlResolution(),
    jsenvPluginFileSystemMagic(fileSystemMagicResolution),
    jsenvPluginUrlVersion(),
    jsenvPluginInjectGlobals(injectedGlobals),
    jsenvPluginCommonJsGlobals(),
    jsenvPluginImportMetaScenarios(),

    jsenvPluginNodeRuntime({ runtimeCompat }),
    jsenvPluginBundling(bundling),
    jsenvPluginMinification(minification),

    jsenvPluginImportMetaHot({
      rootDirectoryUrl,
    }),
    ...(clientAutoreload
      ? [
          jsenvPluginAutoreload({
            rootDirectoryUrl,
            urlGraph,
            scenario,
            clientFileChangeCallbackList,
            clientFilesPruneCallbackList,
          }),
        ]
      : []),
    jsenvPluginCacheControl(),
  ]
}
