/*
 * Something to keep in mind:
 * When systemjs format is used by babel, it will generated UID based on
 * the import specifier:
 * https://github.com/babel/babel/blob/97d1967826077f15e766778c0d64711399e9a72a/packages/babel-plugin-transform-modules-systemjs/src/index.ts#L498
 * But at this stage import specifier are absolute file urls
 * So without minification these specifier are long and dependent
 * on where the files are on the filesystem.
 * This is mitigated by minification that will shorten them
 * But ideally babel should not generate this in the first place
 * and prefer to unique identifier based solely on the specifier basename for instance
 */

import { createRequire } from "node:module"
import { readFileSync, urlToFilename, urlIsInsideOf } from "@jsenv/filesystem"

import { requireBabelPlugin } from "@jsenv/babel-plugins"
import { applyBabelPlugins } from "@jsenv/utils/js_ast/apply_babel_plugins.js"
import { injectQueryParams } from "@jsenv/utils/urls/url_utils.js"
import { createMagicSource } from "@jsenv/utils/sourcemap/magic_source.js"
import { composeTwoSourcemaps } from "@jsenv/utils/sourcemap/sourcemap_composition_v3.js"
import { fetchOriginalUrlInfo } from "@jsenv/utils/graph/fetch_original_url_info.js"

import { jsenvRootDirectoryUrl } from "@jsenv/core/src/jsenv_root_directory_url.js"
import { babelPluginTransformImportMetaUrl } from "./helpers/babel_plugin_transform_import_meta_url.js"
import { jsenvPluginAsJsClassicHtml } from "./jsenv_plugin_script_type_module_as_classic.js"
import { jsenvPluginAsJsClassicWorkers } from "./jsenv_plugin_as_js_classic_workers.js"

const require = createRequire(import.meta.url)

export const jsenvPluginAsJsClassic = ({
  rootDirectoryUrl,
  systemJsInjection,
}) => {
  const preferSourceFiles =
    rootDirectoryUrl === jsenvRootDirectoryUrl ||
    urlIsInsideOf(rootDirectoryUrl, jsenvRootDirectoryUrl)
  const systemJsClientFileUrl = preferSourceFiles
    ? new URL("./client/s.js", import.meta.url).href
    : new URL("./dist/s.js", import.meta.url).href

  return [
    jsenvPluginAsJsClassicConversion({
      systemJsInjection,
      systemJsClientFileUrl,
    }),
    jsenvPluginAsJsClassicHtml({
      systemJsInjection,
      systemJsClientFileUrl,
      generateJsClassicFilename,
    }),
    jsenvPluginAsJsClassicWorkers({
      generateJsClassicFilename,
    }),
  ]
}

// propagate ?as_js_classic to referenced urls
// and perform the conversion during fetchUrlContent
const jsenvPluginAsJsClassicConversion = ({
  systemJsInjection,
  systemJsClientFileUrl,
}) => {
  const propagateJsClassicSearchParam = (reference, context) => {
    const parentUrlInfo = context.urlGraph.getUrlInfo(reference.parentUrl)
    if (
      !parentUrlInfo ||
      !new URL(parentUrlInfo.url).searchParams.has("as_js_classic")
    ) {
      return null
    }
    const urlTransformed = injectQueryParams(reference.url, {
      as_js_classic: "",
    })
    reference.filename = generateJsClassicFilename(reference.url)
    return urlTransformed
  }

  return {
    name: "jsenv:as_js_classic_conversion",
    appliesDuring: "*",
    redirectUrl: {
      // We want to propagate transformation of js module to js classic to:
      // - import specifier (static/dynamic import + re-export)
      // - url specifier when inside System.register/_context.import()
      //   (because it's the transpiled equivalent of static and dynamic imports)
      // And not other references otherwise we could try to transform inline ressources
      // or specifiers inside new URL()...
      js_import_export: propagateJsClassicSearchParam,
      js_url_specifier: (reference, context) => {
        if (
          reference.subtype === "system_register_arg" ||
          reference.subtype === "system_import_arg"
        ) {
          return propagateJsClassicSearchParam(reference, context)
        }
        return null
      },
    },
    fetchUrlContent: async (urlInfo, context) => {
      const originalUrlInfo = await fetchOriginalUrlInfo({
        urlInfo,
        context,
        searchParam: "as_js_classic",
        // override the expectedType to "js_module"
        // because when there is ?as_js_classic it means the underlying ressource
        // is a js_module
        expectedType: "js_module",
      })
      if (!originalUrlInfo) {
        return null
      }
      const isJsEntryPoint =
        // in general html files are entry points
        // but during build js can be sepcified as an entry point
        // (meaning there is no html file where we can inject systemjs)
        // in that case we need to inject systemjs in the js file
        originalUrlInfo.data.isEntryPoint ||
        // In thoose case we need to inject systemjs the worker js file
        originalUrlInfo.data.isWebWorkerEntryPoint
      // if it's an entry point without dependency (it does not use import)
      // then we can use UMD, otherwise we have to use systemjs
      // because it is imported by systemjs
      const jsClassicFormat =
        isJsEntryPoint && !originalUrlInfo.data.usesImport ? "umd" : "system"
      const { content, sourcemap } = await convertJsModuleToJsClassic({
        systemJsInjection,
        systemJsClientFileUrl,
        urlInfo: originalUrlInfo,
        isJsEntryPoint,
        jsClassicFormat,
      })
      urlInfo.data.jsClassicFormat = jsClassicFormat
      return {
        type: "js_classic",
        contentType: "text/javascript",
        content,
        sourcemap,
      }
    },
  }
}

const generateJsClassicFilename = (url) => {
  const filename = urlToFilename(url)
  let [basename, extension] = splitFileExtension(filename)
  const { searchParams } = new URL(url)
  if (
    searchParams.has("as_json_module") ||
    searchParams.has("as_css_module") ||
    searchParams.has("as_text_module")
  ) {
    extension = ".js"
  }
  return `${basename}.es5${extension}`
}

const splitFileExtension = (filename) => {
  const dotLastIndex = filename.lastIndexOf(".")
  if (dotLastIndex === -1) {
    return [filename, ""]
  }
  return [filename.slice(0, dotLastIndex), filename.slice(dotLastIndex)]
}

const convertJsModuleToJsClassic = async ({
  systemJsInjection,
  systemJsClientFileUrl,
  urlInfo,
  isJsEntryPoint,
  jsClassicFormat,
}) => {
  const { code, map } = await applyBabelPlugins({
    babelPlugins: [
      ...(jsClassicFormat === "system"
        ? [
            // propposal-dynamic-import required with systemjs for babel8:
            // https://github.com/babel/babel/issues/10746
            require("@babel/plugin-proposal-dynamic-import"),
            [
              requireBabelPlugin("babel-plugin-transform-async-to-promises"),
              {
                topLevelAwait: "return",
              },
            ],
            require("@babel/plugin-transform-modules-systemjs"),
          ]
        : [
            [
              requireBabelPlugin("babel-plugin-transform-async-to-promises"),
              {
                topLevelAwait: "simple",
              },
            ],
            babelPluginTransformImportMetaUrl,
            require("@babel/plugin-transform-modules-umd"),
          ]),
    ],
    urlInfo,
  })
  if (systemJsInjection && jsClassicFormat === "system" && isJsEntryPoint) {
    const magicSource = createMagicSource(code)
    const systemjsCode = readFileSync(systemJsClientFileUrl, { as: "string" })
    magicSource.prepend(`${systemjsCode}\n\n`)
    const { content, sourcemap } = magicSource.toContentAndSourcemap()
    return {
      content,
      sourcemap: await composeTwoSourcemaps(map, sourcemap),
    }
  }
  return {
    content: code,
    sourcemap: map,
  }
}
