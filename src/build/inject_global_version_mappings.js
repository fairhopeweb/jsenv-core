// https://bundlers.tooling.report/hashing/avoid-cascade/

import { createMagicSource } from "@jsenv/sourcemap"
import {
  parseHtmlString,
  injectScriptNodeAsEarlyAsPossible,
  createHtmlNode,
  stringifyHtmlAst,
} from "@jsenv/ast"

import { isWebWorkerUrlInfo } from "@jsenv/core/src/kitchen/web_workers.js"

export const injectVersionMappings = async ({
  urlInfo,
  kitchen,
  versionMappings,
  minification,
}) => {
  const injector = injectors[urlInfo.type]
  if (injector) {
    const { content, sourcemap } = await injector(urlInfo, {
      versionMappings,
      minification,
    })
    kitchen.urlInfoTransformer.applyFinalTransformations(urlInfo, {
      content,
      sourcemap,
    })
  }
}

const injectors = {
  html: (urlInfo, { versionMappings, minification }) => {
    // ideally we would inject an importmap but browser support is too low
    // (even worse for worker/service worker)
    // so for now we inject code into entry points
    const htmlAst = parseHtmlString(urlInfo.content, {
      storeOriginalPositions: false,
    })
    injectScriptNodeAsEarlyAsPossible(
      htmlAst,
      createHtmlNode({
        tagName: "script",
        textContent: generateClientCodeForVersionMappings(versionMappings, {
          globalName: "window",
          minify: minification || minification.js_classic,
        }),
      }),
      "jsenv:versioning",
    )
    return {
      content: stringifyHtmlAst(htmlAst),
    }
  },
  js_classic: (urlInfo, { versionMappings, minification }) => {
    return jsInjector(urlInfo, {
      versionMappings,
      minify: minification || minification.js_classic,
    })
  },
  js_module: (urlInfo, { versionMappings, minification }) => {
    return jsInjector(urlInfo, {
      versionMappings,
      minify: minification || minification.js_module,
    })
  },
}

const jsInjector = (urlInfo, { versionMappings, minify }) => {
  const magicSource = createMagicSource(urlInfo.content)
  magicSource.prepend(
    generateClientCodeForVersionMappings(versionMappings, {
      globalName: isWebWorkerUrlInfo(urlInfo) ? "self" : "window",
      minify,
    }),
  )
  return magicSource.toContentAndSourcemap()
}

const generateClientCodeForVersionMappings = (
  versionMappings,
  { globalName, minify },
) => {
  if (minify) {
    return `;(function(){var m = ${JSON.stringify(
      versionMappings,
    )}; ${globalName}.__v__ = function (s) { return m[s] || s }; })();`
  }
  return `
;(function() {

var __versionMappings__ = ${JSON.stringify(versionMappings, null, "  ")};
${globalName}.__v__ = function (specifier) {
  return __versionMappings__[specifier] || specifier
};

})();

`
}
