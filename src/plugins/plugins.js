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
import { jsenvPluginImportAssertions } from "./import_assertions/jsenv_plugin_import_assertions.js"
import { jsenvPluginImportMetaScenarios } from "./import_meta_scenarios/jsenv_plugin_import_meta_scenarios.js"
import { jsenvPluginInjectGlobals } from "./inject_globals/jsenv_plugin_inject_globals.js"
import { jsenvPluginJsModuleAsJsClassic } from "./js_module_as_js_classic/jsenv_plugin_js_module_as_js_classic.js"
import { jsenvPluginBabel } from "./babel/jsenv_plugin_babel.js"

import { jsenvPluginBundling } from "./bundling/jsenv_plugin_bundling.js"
import { jsenvPluginMinification } from "./minification/jsenv_plugin_minification.js"

export const getCorePlugins = ({
  htmlSupervisor,
  nodeEsmResolution,
  fileSystemMagicResolution,
  babel,
  injectedGlobals,
  jsModuleAsJsClassic = {},
  minification = false,
  bundling = false,
} = {}) => {
  return [
    ...(jsModuleAsJsClassic
      ? [jsenvPluginJsModuleAsJsClassic(jsModuleAsJsClassic)]
      : []),
    jsenvPluginImportAssertions(),
    jsenvPluginHtmlSupervisor(htmlSupervisor), // before inline as it turns inline <script> into <script src>
    jsenvPluginInline(), // before "file urls" to resolve and load inline urls
    jsenvPluginImportmap(), // before node esm to handle bare specifiers before node esm
    jsenvPluginFileUrls(),
    jsenvPluginHttpUrls(),
    jsenvPluginLeadingSlash(),
    jsenvPluginNodeEsmResolution(nodeEsmResolution), // before url resolution to handle "js_import_export" resolution
    jsenvPluginUrlResolution(),
    jsenvPluginFileSystemMagic(fileSystemMagicResolution),
    jsenvPluginUrlVersion(),
    jsenvPluginInjectGlobals(injectedGlobals),
    jsenvPluginCommonJsGlobals(),
    jsenvPluginImportMetaScenarios(),
    // jsenvPluginWorkers(),
    jsenvPluginBabel(babel),

    jsenvPluginBundling(bundling),
    jsenvPluginMinification(minification),
  ]
}
