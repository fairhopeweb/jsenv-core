/**

Finds all asset reference in html then update all references to target the files in dist/ when needed.

There is some cases where the asset won't be found and updated:
- inline styles
- inline attributes

Don't write the following for instance:

<div style="background:url('img.png')"></div>

Or be sure to also reference this url somewhere in the html file like

<link rel="preload" href="img.png" />

*/

import { urlToBasename, urlToRelativeUrl, resolveUrl, urlToParentUrl } from "@jsenv/util"

import {
  parseHtmlString,
  parseHtmlAstRessources,
  replaceHtmlNode,
  getHtmlNodeAttributeByName,
  stringifyHtmlAst,
  getUniqueNameForInlineHtmlNode,
  addHtmlNodeAttribute,
  removeHtmlNodeAttribute,
  setHtmlNodeText,
  getHtmlNodeTextNode,
  removeHtmlNodeText,
  parseSrcset,
  stringifySrcset,
} from "@jsenv/core/src/internal/compiling/compileHtml.js"
import { getTargetAsBase64Url } from "../asset-builder.util.js"
import { collectNodesMutations, htmlNodeToReferenceLocation } from "../parsing.utils.js"
import { collectSvgMutations } from "../svg/parseSvgAsset.js"
import { minifyHtml } from "./minifyHtml.js"

export const parseHtmlAsset = async (
  htmlTarget,
  notifiers,
  {
    minify,
    minifyHtmlOptions,
    htmlStringToHtmlAst = (htmlString) => parseHtmlString(htmlString),
    htmlAstToHtmlString = (htmlAst) => stringifyHtmlAst(htmlAst),
    ressourceHintNeverUsedCallback = () => {},
  } = {},
) => {
  const htmlString = String(htmlTarget.targetBuffer)
  const htmlAst = await htmlStringToHtmlAst(htmlString)
  const { links, styles, scripts, imgs, images, uses, sources } = parseHtmlAstRessources(htmlAst)

  const linksMutations = collectNodesMutations(links, notifiers, htmlTarget, [
    linkStylesheetHrefVisitor,
    (link, { notifyReferenceFound }) =>
      linkHrefVisitor(link, {
        notifyReferenceFound,
        ressourceHintNeverUsedCallback,
      }),
  ])
  const scriptsMutations = collectNodesMutations(scripts, notifiers, htmlTarget, [
    // regular javascript are not parseable by rollup
    // and we don't really care about there content
    // we will handle them as regular asset
    // but we still want to inline/minify/hash them for performance
    regularScriptSrcVisitor,
    regularScriptTextNodeVisitor,
    moduleScriptSrcVisitor,
    moduleScriptTextNodeVisitor,
    importmapScriptSrcVisitor,
    importmapScriptTextNodeVisitor,
  ])
  const stylesMutations = collectNodesMutations(styles, notifiers, htmlTarget, [
    styleTextNodeVisitor,
  ])
  const imgsSrcMutations = collectNodesMutations(imgs, notifiers, htmlTarget, [imgSrcVisitor])
  const imgsSrcsetMutations = collectNodesMutations(imgs, notifiers, htmlTarget, [srcsetVisitor])
  const sourcesSrcMutations = collectNodesMutations(sources, notifiers, htmlTarget, [
    sourceSrcVisitor,
  ])
  const sourcesSrcsetMutations = collectNodesMutations(sources, notifiers, htmlTarget, [
    srcsetVisitor,
  ])
  const svgMutations = collectSvgMutations({ images, uses }, notifiers, htmlTarget)

  const htmlMutations = [
    ...linksMutations,
    ...scriptsMutations,
    ...stylesMutations,
    ...imgsSrcMutations,
    ...imgsSrcsetMutations,
    ...sourcesSrcMutations,
    ...sourcesSrcsetMutations,
    ...svgMutations,
  ]

  return async (params) => {
    htmlMutations.forEach((mutationCallback) => {
      mutationCallback({
        ...params,
      })
    })

    const htmlAfterTransformation = htmlAstToHtmlString(htmlAst)
    return minify ? minifyHtml(htmlAfterTransformation, minifyHtmlOptions) : htmlAfterTransformation
  }
}

const regularScriptSrcVisitor = (script, { notifyReferenceFound }) => {
  const typeAttribute = getHtmlNodeAttributeByName(script, "type")
  if (
    typeAttribute &&
    (typeAttribute.value !== "text/javascript" || typeAttribute.value !== "application/javascript")
  ) {
    return null
  }
  const srcAttribute = getHtmlNodeAttributeByName(script, "src")
  if (!srcAttribute) {
    return null
  }

  const remoteScriptReference = notifyReferenceFound({
    referenceExpectedContentType: "application/javascript",
    referenceTargetSpecifier: srcAttribute.value,
    ...htmlNodeToReferenceLocation(script),
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    if (remoteScriptReference.target.targetIsExternal) {
      return
    }

    if (shouldInline({ reference: remoteScriptReference, htmlNode: script })) {
      removeHtmlNodeAttribute(script, srcAttribute)
      const { targetBuildBuffer } = remoteScriptReference.target
      setHtmlNodeText(script, targetBuildBuffer)
      return
    }

    const urlRelativeToImporter = getReferenceUrlRelativeToImporter(remoteScriptReference)
    srcAttribute.value = urlRelativeToImporter
  }
}

const regularScriptTextNodeVisitor = (script, { notifyReferenceFound }, htmlTarget, scripts) => {
  const typeAttribute = getHtmlNodeAttributeByName(script, "type")
  if (
    typeAttribute &&
    (typeAttribute.value !== "text/javascript" || typeAttribute.value !== "application/javascript")
  ) {
    return null
  }
  const srcAttribute = getHtmlNodeAttributeByName(script, "src")
  if (srcAttribute) {
    return null
  }
  const textNode = getHtmlNodeTextNode(script)
  if (!textNode) {
    return null
  }

  const jsReference = notifyReferenceFound({
    referenceExpectedContentType: "application/javascript",
    referenceTargetSpecifier: getUniqueNameForInlineHtmlNode(
      script,
      scripts,
      `${urlToBasename(htmlTarget.targetUrl)}.[id].js`,
    ),
    ...htmlNodeToReferenceLocation(script),

    targetContentType: "application/javascript",
    targetBuffer: Buffer.from(textNode.value),
    targetIsInline: true,
  })
  return () => {
    const { targetBuildBuffer } = jsReference.target
    textNode.value = targetBuildBuffer
  }
}

const moduleScriptSrcVisitor = (script, { format, notifyReferenceFound }) => {
  const typeAttribute = getHtmlNodeAttributeByName(script, "type")
  if (!typeAttribute) {
    return null
  }
  if (typeAttribute.value !== "module") {
    return null
  }
  const srcAttribute = getHtmlNodeAttributeByName(script, "src")
  if (!srcAttribute) {
    return null
  }

  const remoteScriptReference = notifyReferenceFound({
    referenceExpectedContentType: "application/javascript",
    referenceTargetSpecifier: srcAttribute.value,
    ...htmlNodeToReferenceLocation(script),

    targetIsJsModule: true,
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    if (format === "systemjs") {
      typeAttribute.value = "systemjs-module"
    }

    if (remoteScriptReference.target.targetIsExternal) {
      return
    }

    if (shouldInline({ reference: remoteScriptReference, htmlNode: script })) {
      // here put a warning if we cannot inline importmap because it would mess
      // the remapping (note that it's feasible) but not yet supported
      removeHtmlNodeAttribute(script, srcAttribute)
      const { targetBuildBuffer } = script.target
      setHtmlNodeText(script, targetBuildBuffer)
      return
    }

    const urlRelativeToImporter = getReferenceUrlRelativeToImporter(remoteScriptReference)
    const relativeUrlNotation = ensureRelativeUrlNotation(urlRelativeToImporter)
    srcAttribute.value = relativeUrlNotation
  }
}

const moduleScriptTextNodeVisitor = (
  script,
  { format, notifyReferenceFound },
  htmlTarget,
  scripts,
) => {
  const typeAttribute = getHtmlNodeAttributeByName(script, "type")
  if (!typeAttribute) {
    return null
  }
  if (typeAttribute.value !== "module") {
    return null
  }
  const srcAttribute = getHtmlNodeAttributeByName(script, "src")
  if (srcAttribute) {
    return null
  }
  const textNode = getHtmlNodeTextNode(script)
  if (!textNode) {
    return null
  }

  const jsReference = notifyReferenceFound({
    referenceExpectedContentType: "application/javascript",
    referenceTargetSpecifier: getUniqueNameForInlineHtmlNode(
      script,
      scripts,
      `${urlToBasename(htmlTarget.targetUrl)}.[id].js`,
    ),
    ...htmlNodeToReferenceLocation(script),

    targetContentType: "application/javascript",
    targetBuffer: textNode.value,
    targetIsJsModule: true,
    targetIsInline: true,
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    if (format === "systemjs") {
      typeAttribute.value = "systemjs-module"
    }
    const urlRelativeToImporter = getReferenceUrlRelativeToImporter(jsReference)
    const relativeUrlNotation = ensureRelativeUrlNotation(urlRelativeToImporter)
    removeHtmlNodeText(script)
    addHtmlNodeAttribute(script, { name: "src", value: relativeUrlNotation })
  }
}

const importmapScriptSrcVisitor = (script, { format, notifyReferenceFound }) => {
  const typeAttribute = getHtmlNodeAttributeByName(script, "type")
  if (!typeAttribute) {
    return null
  }
  if (typeAttribute.value !== "importmap") {
    return null
  }
  const srcAttribute = getHtmlNodeAttributeByName(script, "src")
  if (!srcAttribute) {
    return null
  }

  const importmapReference = notifyReferenceFound({
    referenceExpectedContentType: "application/importmap+json",
    referenceTargetSpecifier: srcAttribute.value,
    ...htmlNodeToReferenceLocation(script),

    // here we want to force the fileName for the importmap
    // so that we don't have to rewrite its content
    // the goal is to put the importmap at the same relative path
    // than in the project
    targetFileNamePattern: () => {
      const importmapReferenceUrl = importmapReference.referenceUrl
      const importmapTargetUrl = importmapReference.target.targetUrl
      const importmapUrlRelativeToImporter = urlToRelativeUrl(
        importmapTargetUrl,
        importmapReferenceUrl,
      )
      const importmapParentRelativeUrl = urlToRelativeUrl(
        urlToParentUrl(resolveUrl(importmapUrlRelativeToImporter, "file://")),
        "file://",
      )
      return `${importmapParentRelativeUrl}[name]-[hash][extname]`
    },
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    if (format === "systemjs") {
      typeAttribute.value = "systemjs-importmap"
    }

    if (importmapReference.target.targetIsExternal) {
      return
    }

    if (shouldInline({ reference: importmapReference, htmlNode: script })) {
      // here put a warning if we cannot inline importmap because it would mess
      // the remapping (note that it's feasible) but not yet supported
      removeHtmlNodeAttribute(script, srcAttribute)
      const { targetBuildBuffer } = importmapReference.target
      setHtmlNodeText(script, targetBuildBuffer)
      return
    }

    const urlRelativeToImporter = getReferenceUrlRelativeToImporter(importmapReference)
    srcAttribute.value = urlRelativeToImporter
  }
}

const importmapScriptTextNodeVisitor = (
  script,
  { format, notifyReferenceFound },
  htmlTarget,
  scripts,
) => {
  const typeAttribute = getHtmlNodeAttributeByName(script, "type")
  if (!typeAttribute) {
    return null
  }
  if (typeAttribute.value !== "importmap") {
    return null
  }
  const srcAttribute = getHtmlNodeAttributeByName(script, "src")
  if (srcAttribute) {
    return null
  }
  const textNode = getHtmlNodeTextNode(script)
  if (!textNode) {
    return null
  }

  const importmapReference = notifyReferenceFound({
    referenceExpectedContentType: "application/importmap+json",
    referenceTargetSpecifier: getUniqueNameForInlineHtmlNode(
      script,
      scripts,
      `${urlToBasename(htmlTarget.targetUrl)}.[id].importmap`,
    ),
    ...htmlNodeToReferenceLocation(script),

    targetContentType: "application/importmap+json",
    targetBuffer: Buffer.from(textNode.value),
    targetIsInline: true,
  })
  return () => {
    if (format === "systemjs") {
      typeAttribute.value = "systemjs-importmap"
    }

    const { targetBuildBuffer } = importmapReference.target
    textNode.value = targetBuildBuffer
  }
}

const linkStylesheetHrefVisitor = (link, { notifyReferenceFound }) => {
  const hrefAttribute = getHtmlNodeAttributeByName(link, "href")
  if (!hrefAttribute) {
    return null
  }
  const relAttribute = getHtmlNodeAttributeByName(link, "rel")
  if (!relAttribute) {
    return null
  }
  if (relAttribute.value !== "stylesheet") {
    return null
  }

  const cssReference = notifyReferenceFound({
    referenceExpectedContentType: "text/css",
    referenceTargetSpecifier: hrefAttribute.value,
    ...htmlNodeToReferenceLocation(link),
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    if (cssReference.target.targetIsExternal) {
      return
    }

    if (shouldInline({ reference: cssReference, htmlNode: link })) {
      const { targetBuildBuffer } = cssReference.target
      replaceHtmlNode(link, `<style>${targetBuildBuffer}</style>`)
      return
    }

    const urlRelativeToImporter = getReferenceUrlRelativeToImporter(cssReference)
    hrefAttribute.value = urlRelativeToImporter
  }
}

const linkHrefVisitor = (link, { notifyReferenceFound, ressourceHintNeverUsedCallback }) => {
  const hrefAttribute = getHtmlNodeAttributeByName(link, "href")
  if (!hrefAttribute) {
    return null
  }

  const relAttribute = getHtmlNodeAttributeByName(link, "rel")
  const rel = relAttribute ? relAttribute.value : undefined
  const referenceIsRessourceHint = ["preconnect", "dns-prefetch", "prefetch", "preload"].includes(
    rel,
  )

  let referenceExpectedContentType
  const typeAttribute = getHtmlNodeAttributeByName(link, "type")
  const type = typeAttribute ? typeAttribute.value : ""
  let targetIsJsModule = false
  if (type) {
    referenceExpectedContentType = type
  } else if (rel === "manifest") {
    referenceExpectedContentType = "application/manifest+json"
  } else if (rel === "modulepreload") {
    referenceExpectedContentType = "application/javascript"
    targetIsJsModule = true
  }

  const linkReference = notifyReferenceFound({
    referenceIsRessourceHint,
    referenceExpectedContentType,
    referenceTargetSpecifier: hrefAttribute.value,
    ...htmlNodeToReferenceLocation(link),
    targetUrlVersioningDisabled: referenceExpectedContentType === "application/manifest+json",
    targetIsJsModule,
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    const target = linkReference.target
    if (referenceIsRessourceHint) {
      const otherReferences = target.targetReferences.filter((targetReference) => {
        return !targetReference.referenceIsRessourceHint
      })
      if (otherReferences.length === 0) {
        ressourceHintNeverUsedCallback({
          htmlNode: link,
          rel,
          href: hrefAttribute.value,
        })
        // we could remove the HTML node but better keep it untouched and let user decide what to do
        return
      }
    }

    if (linkReference.target.targetIsExternal) {
      return
    }

    if (shouldInline({ reference: linkReference, htmlNode: link })) {
      replaceHtmlNode(link, `<link href="${getTargetAsBase64Url(linkReference.target)}" />`)
      return
    }

    const urlRelativeToImporter = getReferenceUrlRelativeToImporter(linkReference)
    hrefAttribute.value = urlRelativeToImporter
  }
}

const styleTextNodeVisitor = (style, { notifyReferenceFound }, htmlTarget, styles) => {
  const textNode = getHtmlNodeTextNode(style)
  if (!textNode) {
    return null
  }

  const inlineStyleReference = notifyReferenceFound({
    referenceExpectedContentType: "text/css",
    referenceTargetSpecifier: getUniqueNameForInlineHtmlNode(
      style,
      styles,
      `${urlToBasename(htmlTarget.targetUrl)}.[id].css`,
    ),
    ...htmlNodeToReferenceLocation(style),

    targetContentType: "text/css",
    targetBuffer: Buffer.from(textNode.value),
    targetIsInline: true,
  })
  return () => {
    const { targetBuildBuffer } = inlineStyleReference.target
    textNode.value = targetBuildBuffer
  }
}

const imgSrcVisitor = (img, { notifyReferenceFound }) => {
  const srcAttribute = getHtmlNodeAttributeByName(img, "src")
  if (!srcAttribute) {
    return null
  }

  const srcReference = notifyReferenceFound({
    referenceTargetSpecifier: srcAttribute.value,
    ...htmlNodeToReferenceLocation(img),
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    const srcNewValue = referenceToUrl({
      reference: srcReference,
      htmlNode: img,
      getReferenceUrlRelativeToImporter,
    })
    srcAttribute.value = srcNewValue
  }
}

const srcsetVisitor = (htmlNode, { notifyReferenceFound }) => {
  const srcsetAttribute = getHtmlNodeAttributeByName(htmlNode, "srcset")
  if (!srcsetAttribute) {
    return null
  }

  const srcsetParts = parseSrcset(srcsetAttribute.value)
  const srcsetPartsReferences = srcsetParts.map(({ specifier }) =>
    notifyReferenceFound({
      referenceTargetSpecifier: specifier,
      ...htmlNodeToReferenceLocation(htmlNode),
    }),
  )
  if (srcsetParts.length === 0) {
    return null
  }

  return ({ getReferenceUrlRelativeToImporter }) => {
    srcsetParts.forEach((srcsetPart, index) => {
      const reference = srcsetPartsReferences[index]
      srcsetPart.specifier = referenceToUrl({
        reference,
        htmlNode,
        getReferenceUrlRelativeToImporter,
      })
    })

    const srcsetNewValue = stringifySrcset(srcsetParts)
    srcsetAttribute.value = srcsetNewValue
  }
}

const sourceSrcVisitor = (source, { notifyReferenceFound }) => {
  const srcAttribute = getHtmlNodeAttributeByName(source, "src")
  if (!srcAttribute) {
    return null
  }

  const typeAttribute = getHtmlNodeAttributeByName(source, "type")
  const srcReference = notifyReferenceFound({
    referenceExpectedContentType: typeAttribute ? typeAttribute.value : undefined,
    referenceTargetSpecifier: srcAttribute.value,
    ...htmlNodeToReferenceLocation(source),
  })
  return ({ getReferenceUrlRelativeToImporter }) => {
    const srcNewValue = referenceToUrl({
      reference: srcReference,
      htmlNode: source,
      getReferenceUrlRelativeToImporter,
    })
    srcAttribute.value = srcNewValue
  }
}

const referenceToUrl = ({ reference, htmlNode, getReferenceUrlRelativeToImporter }) => {
  if (reference.target.targetIsExternal) {
    return reference.target.targetUrl
  }
  if (shouldInline({ reference, htmlNode })) {
    return getTargetAsBase64Url(reference.target)
  }
  return getReferenceUrlRelativeToImporter(reference)
}

// otherwise systemjs handle it as a bare import
const ensureRelativeUrlNotation = (relativeUrl) => {
  if (relativeUrl.startsWith("../")) {
    return relativeUrl
  }
  return `./${relativeUrl}`
}

const shouldInline = ({ reference, htmlNode }) => {
  const { target } = reference
  const { targetIsInline } = target
  if (targetIsInline) {
    return true
  }

  const jsenvForceInlineAttribute = getHtmlNodeAttributeByName(htmlNode, "data-jsenv-force-inline")
  if (jsenvForceInlineAttribute) {
    removeHtmlNodeAttribute(htmlNode, jsenvForceInlineAttribute)
    return true
  }
  return false
}
