import { jsenvPluginLeadingSlash } from "@jsenv/core/src/omega/plugins/leading_slash/jsenv_plugin_leading_slash.js"
import { jsenvPluginImportmap } from "@jsenv/core/src/omega/plugins/importmap/jsenv_plugin_importmap.js"
import { jsenvPluginUrlResolution } from "@jsenv/core/src/omega/plugins/url_resolution/jsenv_plugin_url_resolution.js"
import { jsenvPluginNodeEsmResolution } from "@jsenv/core/src/omega/plugins/node_esm_resolution/jsenv_plugin_node_esm_resolution.js"
import { jsenvPluginDataUrls } from "@jsenv/core/src/omega/plugins/data_urls/jsenv_plugin_data_urls.js"
import { jsenvPluginFileUrls } from "@jsenv/core/src/omega/plugins/file_urls/jsenv_plugin_file_urls.js"
import { jsenvPluginFileSystemMagic } from "@jsenv/core/src/omega/plugins/filesystem_magic/jsenv_plugin_filesystem_magic.js"
import { jsenvPluginInlineRessources } from "@jsenv/core/src/omega/plugins/inline_ressources/jsenv_plugin_inline_ressources.js"
import { jsenvPluginAutoreload } from "@jsenv/core/src/omega/plugins/autoreload/jsenv_plugin_autoreload.js"
import { jsenvPluginHtmlSupervisor } from "@jsenv/core/src/omega/plugins/html_supervisor/jsenv_plugin_html_supervisor.js"
import { jsenvPluginCommonJsGlobals } from "@jsenv/core/src/omega/plugins/commonjs_globals/jsenv_plugin_commonjs_globals.js"
import { jsenvPluginImportAssertions } from "@jsenv/core/src/omega/plugins/import_assertions/jsenv_plugin_import_assertions.js"
import { jsenvPluginImportMetaScenarios } from "@jsenv/core/src/omega/plugins/import_meta_scenarios/jsenv_plugin_import_meta_scenarios.js"
import { jsenvPluginBabel } from "@jsenv/core/src/omega/plugins/babel/jsenv_plugin_babel.js"

export const getJsenvPlugins = ({ rootDirectoryUrl }) => {
  const asFewAsPossible = false // useful during dev
  return [
    // url resolution
    jsenvPluginLeadingSlash(),
    ...(asFewAsPossible ? [] : [jsenvPluginInlineRessources()]), // must come first to resolve inline urls
    jsenvPluginImportmap(), // must come before node esm to handle bare specifiers before node esm
    jsenvPluginNodeEsmResolution({
      rootDirectoryUrl,
    }), // must come before url resolution to handle "js_import_export" resolution
    jsenvPluginUrlResolution(),
    ...(asFewAsPossible ? [] : [jsenvPluginFileSystemMagic()]),
    // url loading
    jsenvPluginDataUrls(),
    jsenvPluginFileUrls(),
    // content transformation
    ...(asFewAsPossible ? [] : [jsenvPluginAutoreload()]),
    ...(asFewAsPossible ? [] : [jsenvPluginHtmlSupervisor()]),
    ...(asFewAsPossible ? [] : [jsenvPluginCommonJsGlobals()]),
    ...(asFewAsPossible ? [] : [jsenvPluginImportAssertions()]),
    ...(asFewAsPossible ? [] : [jsenvPluginImportMetaScenarios()]),
    jsenvPluginBabel(),
  ]
}
