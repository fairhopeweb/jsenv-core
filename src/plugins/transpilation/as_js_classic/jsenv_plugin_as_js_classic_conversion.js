// propagate ?as_js_classic to referenced urls
// and perform the conversion during fetchUrlContent

import { injectQueryParams } from "@jsenv/urls"
import { convertJsModuleToJsClassic } from "./convert_js_module_to_js_classic.js"

export const jsenvPluginAsJsClassicConversion = ({
  systemJsInjection,
  systemJsClientFileUrl,
  generateJsClassicFilename,
}) => {
  const shouldPropagateJsClassic = (reference, context) => {
    const parentUrlInfo = context.urlGraph.getUrlInfo(reference.parentUrl)
    if (!parentUrlInfo) {
      return false
    }
    return new URL(parentUrlInfo.url).searchParams.has("as_js_classic")
  }
  const markAsJsClassicProxy = (reference) => {
    reference.expectedType = "js_classic"
    reference.filename = generateJsClassicFilename(reference.url)
  }
  const turnIntoJsClassicProxy = (reference) => {
    const urlTransformed = injectQueryParams(reference.url, {
      as_js_classic: "",
    })
    markAsJsClassicProxy(reference)
    return urlTransformed
  }

  return {
    name: "jsenv:as_js_classic_conversion",
    appliesDuring: "*",
    redirectUrl: (reference, context) => {
      if (new URL(reference.url).searchParams.has("as_js_classic")) {
        markAsJsClassicProxy(reference)
        return null
      }
      if (
        reference.type === "js_import_export" ||
        reference.subtype === "system_register_arg" ||
        reference.subtype === "system_import_arg"
      ) {
        // We want to propagate transformation of js module to js classic to:
        // - import specifier (static/dynamic import + re-export)
        // - url specifier when inside System.register/_context.import()
        //   (because it's the transpiled equivalent of static and dynamic imports)
        // And not other references otherwise we could try to transform inline resources
        // or specifiers inside new URL()...
        if (shouldPropagateJsClassic(reference, context)) {
          return turnIntoJsClassicProxy(reference, context)
        }
      }
      return null
    },
    fetchUrlContent: async (urlInfo, context) => {
      const [jsModuleReference, jsModuleUrlInfo] =
        context.getWithoutSearchParam({
          urlInfo,
          context,
          searchParam: "as_js_classic",
          // override the expectedType to "js_module"
          // because when there is ?as_js_classic it means the underlying resource
          // is a js_module
          expectedType: "js_module",
        })
      if (!jsModuleReference) {
        return null
      }
      await context.fetchUrlContent(jsModuleUrlInfo, {
        reference: jsModuleReference,
      })
      if (context.scenarios.dev) {
        context.referenceUtils.found({
          type: "js_import_export",
          subtype: jsModuleReference.subtype,
          specifier: jsModuleReference.url,
          expectedType: "js_module",
        })
      }
      const { content, sourcemap } = await convertJsModuleToJsClassic({
        systemJsInjection,
        systemJsClientFileUrl,
        urlInfo,
        jsModuleUrlInfo,
      })
      return {
        content,
        contentType: "text/javascript",
        type: "js_classic",
        originalUrl: jsModuleUrlInfo.originalUrl,
        originalContent: jsModuleUrlInfo.originalContent,
        sourcemap,
      }
    },
  }
}
