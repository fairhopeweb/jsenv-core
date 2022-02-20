import { resolveUrl } from "@jsenv/filesystem"
import { moveImportMap, composeTwoImportMaps } from "@jsenv/importmap"
import { createDetailedMessage } from "@jsenv/logger"

import { fetchUrl } from "@jsenv/core/src/internal/fetching.js"
import {
  findNodes,
  injectBeforeFirstHeadScript,
  getHtmlNodeAttributeByName,
  getHtmlNodeTextNode,
  createHtmlNode,
  setHtmlNodeText,
} from "@jsenv/core/src/internal/transform_html/html_ast.js"
import { inlineScript } from "@jsenv/core/src/internal/transform_html/html_inlining.js"
import { getDefaultImportmap } from "@jsenv/core/src/internal/import_resolution/importmap_default.js"

export const mutateImportmapScripts = async ({
  logger,
  projectDirectoryUrl,
  compileDirectoryUrl,
  url,
  canUseScriptTypeImportmap,
  htmlAst,
}) => {
  const importmapScripts = findNodes(htmlAst, (node) => {
    if (node.nodeName !== "script") return false
    const typeAttribute = getHtmlNodeAttributeByName(node, "type")
    const type = typeAttribute ? typeAttribute.value : "application/javascript"
    return type === "importmap"
  })
  const importmapFromJsenv = getDefaultImportmap(url, {
    projectDirectoryUrl,
    compileDirectoryUrl,
  })
  // in case there is no importmap, force the presence
  // so that "@jsenv/core/" are still remapped
  if (importmapScripts.length === 0) {
    const importmapAsText = JSON.stringify(importmapFromJsenv, null, "  ")
    injectBeforeFirstHeadScript(
      htmlAst,
      createHtmlNode({
        "tagName": "script",
        "type": canUseScriptTypeImportmap ? "importmap" : "systemjs-importmap",
        "textContent": importmapAsText,
        "data-injected": "",
      }),
    )
    return {
      url: null,
      sourceText: null,
      text: importmapAsText,
    }
  }
  if (importmapScripts.length > 1) {
    logger.error("HTML file must contain max 1 importmap")
  }
  const firstImportmapScript = importmapScripts[0]
  const srcAttribute = getHtmlNodeAttributeByName(firstImportmapScript, "src")
  const src = srcAttribute ? srcAttribute.value : ""
  if (src) {
    const importmapUrl = resolveUrl(src, url)
    const importmapResponse = await fetchUrl(importmapUrl)
    let sourceText
    let importmapFromHtml
    if (importmapResponse.status === 200) {
      sourceText = await importmapResponse.text()
      importmapFromHtml = JSON.parse(sourceText)
      importmapFromHtml = moveImportMap(importmapFromHtml, importmapUrl, url)
    } else {
      sourceText = null
      importmapFromHtml = {}
      logger.warn(
        createDetailedMessage(
          importmapResponse.status === 404
            ? `importmap script file cannot be found.`
            : `importmap script file unexpected response status (${importmapResponse.status}).`,
          {
            "importmap url": importmapUrl,
            "html url": url,
          },
        ),
      )
    }
    const importmap = composeTwoImportMaps(
      importmapFromJsenv,
      importmapFromHtml,
    )
    const importmapAsText = JSON.stringify(importmap, null, "  ")
    inlineScript(firstImportmapScript, importmapAsText)
    if (!canUseScriptTypeImportmap) {
      const typeAttribute = getHtmlNodeAttributeByName(
        firstImportmapScript,
        "type",
      )
      typeAttribute.value = "systemjs-importmap"
    }
    return {
      url: importmapUrl,
      sourceText,
      text: importmapAsText,
    }
  }
  const sourceText = getHtmlNodeTextNode(firstImportmapScript).value
  const importmapFromHtml = JSON.parse(sourceText)
  const importmap = composeTwoImportMaps(importmapFromJsenv, importmapFromHtml)
  const importmapAsText = JSON.stringify(importmap, null, "  ")
  setHtmlNodeText(firstImportmapScript, importmapAsText)
  if (!canUseScriptTypeImportmap) {
    const typeAttribute = getHtmlNodeAttributeByName(
      firstImportmapScript,
      "type",
    )
    typeAttribute.value = "systemjs-importmap"
  }
  return {
    url: null,
    sourceText,
    text: importmapAsText,
  }
}
