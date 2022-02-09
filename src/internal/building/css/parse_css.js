import {
  urlToFilename,
  urlToRelativeUrl,
  resolveUrl,
  fileSystemPathToUrl,
} from "@jsenv/filesystem"

import {
  generateSourcemapUrl,
  getCssSourceMappingUrl,
  setCssSourceMappingUrl,
} from "@jsenv/core/src/internal/sourcemap_utils.js"

import { parseCssUrls } from "@jsenv/core/src/internal/transform_css/parse_css_urls.js"
import { replaceCssUrls } from "@jsenv/core/src/internal/transform_css/replace_css_urls.js"
import { moveCssUrls } from "@jsenv/core/src/internal/transform_css/move_css_urls.js"

import { getRessourceAsBase64Url } from "@jsenv/core/src/internal/building/ressource_builder_util.js"

export const parseCssRessource = async (
  cssRessource,
  { notifyReferenceFound },
  {
    sourceFileFetcher,
    asProjectUrl,
    asOriginalUrl,
    minify,
    minifyCssOptions,
    cssConcatenation,
  },
) => {
  const cssString = String(cssRessource.bufferBeforeBuild)
  const cssSourcemapUrl = getCssSourceMappingUrl(cssString)
  const cssUrl = cssRessource.url
  let map
  let content = cssString
  let sourcemapReference
  if (cssSourcemapUrl) {
    sourcemapReference = notifyReferenceFound({
      referenceLabel: "css sourcemaping comment",
      contentTypeExpected: ["application/json", "application/octet-stream"],
      ressourceSpecifier: cssSourcemapUrl,
      // we don't really know the line or column
      // but let's asusme it the last line and first column
      referenceLine: cssString.split(/\r?\n/).length - 1,
      referenceColumn: 0,
      isSourcemap: true,
    })
    await sourcemapReference.ressource.getBufferAvailablePromise()
    map = JSON.parse(String(sourcemapReference.ressource.bufferBeforeBuild))
  } else {
    sourcemapReference = notifyReferenceFound({
      referenceLabel: "css sourcemaping comment",
      contentType: "application/octet-stream",
      ressourceSpecifier: urlToRelativeUrl(
        generateSourcemapUrl(cssUrl),
        cssUrl,
      ),
      isPlaceholder: true,
      isSourcemap: true,
    })
  }

  const urlMentions = await parseCssUrls({
    url: cssUrl,
    content,
  })
  const urlNodeReferenceMapping = new Map()
  const atImportReferences = []
  urlMentions.forEach((urlMention) => {
    if (urlMention.specifier[0] === "#") {
      return
    }
    const urlReference = notifyReferenceFound({
      referenceLabel: urlMention.type === "@import" ? "css @import" : "css url",
      ressourceSpecifier: urlMention.specifier,
      ...cssNodeToReferenceLocation(urlMention.declarationNode),
    })
    urlNodeReferenceMapping.set(urlMention.urlNode, urlReference)
    if (urlMention.type === "@import") {
      atImportReferences.push(urlReference)
    }
  })

  return async ({ getUrlRelativeToImporter, buildDirectoryUrl }) => {
    const sourcemapRessource = sourcemapReference.ressource
    const cssCompiledUrl = cssRessource.url
    const cssOriginalUrl = asOriginalUrl(cssCompiledUrl)

    const replaceCssResult = await replaceCssUrls({
      urlVisitor: ({ urlNode, replace }) => {
        const nodeCandidates = Array.from(urlNodeReferenceMapping.keys())
        const urlNodeFound = nodeCandidates.find((urlNodeCandidate) =>
          isSameCssDocumentUrlNode(urlNodeCandidate, urlNode),
        )
        if (!urlNodeFound) {
          return
        }
        // url node nous dit quel référence y correspond
        const urlNodeReference = urlNodeReferenceMapping.get(urlNodeFound)
        const cssUrlRessource = urlNodeReference.ressource
        const { isExternal } = cssUrlRessource
        if (isExternal) {
          return
        }
        const { isInline } = cssUrlRessource
        if (isInline) {
          replace(getRessourceAsBase64Url(cssUrlRessource))
          return
        }
        replace(getUrlRelativeToImporter(cssUrlRessource))
      },
      cssConcatenation,
      cssConcatenationLoadImport: async (path) => {
        // const cssFileUrl = asProjectUrl(url)
        const importedCssFileUrl = fileSystemPathToUrl(path)
        const atImportReference = atImportReferences.find(
          (atImportReference) => {
            return (
              asProjectUrl(atImportReference.ressource.url) ===
              importedCssFileUrl
            )
          },
        )
        atImportReference.inlinedCallback()

        const from = resolveUrl(
          atImportReference.ressource.buildRelativeUrl,
          buildDirectoryUrl,
        )
        const to = resolveUrl(
          cssRessource.buildRelativeUrlWithoutHash,
          buildDirectoryUrl,
        )
        const content = String(atImportReference.ressource.bufferAfterBuild)
        const moveResult = await moveCssUrls({
          from,
          to,
          // moveCssUrls will change the css source code
          // Ideally we should update the sourcemap referenced by css
          // to target the one after css urls are moved.
          // It means we should force sourcemap ressource to the new one
          // until it's supported we prevent postcss from updating the
          // sourcemap comment, othwise css would reference a sourcemap
          // that won't by in the build directory
          sourcemapMethod: null,
          content,
        })
        return moveResult.content
      },
      cssMinification: minify,
      cssMinificationOptions: minifyCssOptions,
      url: asProjectUrl(cssCompiledUrl),
      map,
      content,
    })
    map = replaceCssResult.map
    content = replaceCssResult.content
    cssRessource.buildEnd(content)

    // In theory code should never be modified once buildEnd() is called
    // because buildRelativeUrl might be versioned based on file content
    // There is an exception for sourcemap because we want to update sourcemap.file
    // to the cached filename of the css file.
    // To achieve that we set/update the sourceMapping url comment in compiled css file.
    // This is totally fine to do that because sourcemap and css file lives togethers
    // so this comment changes nothing regarding cache invalidation and is not important
    // to decide buildRelativeUrl for this css file.
    const cssBuildUrl = resolveUrl(
      cssRessource.buildRelativeUrl,
      buildDirectoryUrl,
    )
    const sourcemapPrecomputedBuildUrl = generateSourcemapUrl(cssBuildUrl)
    map.file = urlToFilename(cssBuildUrl)
    if (map.sources) {
      map.sources = map.sources.map((source) => {
        const sourceUrl = resolveUrl(source, cssOriginalUrl)
        if (sourceFileFetcher.isFileUrlForRemoteUrl(sourceUrl)) {
          const sourceRemoteUrl =
            sourceFileFetcher.remoteUrlFromFileUrl(sourceUrl)
          return sourceRemoteUrl
        }
        const sourceUrlRelativeToSourceMap = urlToRelativeUrl(
          sourceUrl,
          sourcemapPrecomputedBuildUrl,
        )
        return sourceUrlRelativeToSourceMap
      })
    }
    const mapSource = JSON.stringify(map, null, "  ")
    sourcemapRessource.buildEnd(mapSource)

    const sourcemapBuildUrl = resolveUrl(
      sourcemapRessource.buildRelativeUrl,
      buildDirectoryUrl,
    )
    const sourcemapUrlForCss = urlToRelativeUrl(sourcemapBuildUrl, cssBuildUrl)
    const cssWithSourcemapComment = setCssSourceMappingUrl(
      content,
      sourcemapUrlForCss,
    )
    cssRessource.bufferAfterBuild = cssWithSourcemapComment
  }
}

const cssNodeToReferenceLocation = (node) => {
  const { line, column } = node.source.start
  return {
    referenceLine: line,
    referenceColumn: column,
  }
}

const isSameCssDocumentUrlNode = (firstUrlNode, secondUrlNode) => {
  if (!compareUrlNodeTypes(firstUrlNode.type, secondUrlNode.type)) {
    return false
  }
  if (!compareUrlNodeValue(firstUrlNode.value, secondUrlNode.value)) {
    return false
  }
  // maybe this sourceIndex should be removed in case there is some css transformation one day?
  // it does not seems to change though as if it was refering the original file source index
  if (firstUrlNode.sourceIndex !== secondUrlNode.sourceIndex) {
    return false
  }
  return true
}

// minification may change url node type from string to word
// that's still the same node
const compareUrlNodeTypes = (firstUrlNodeType, secondUrlNodeType) => {
  if (firstUrlNodeType === secondUrlNodeType) {
    return true
  }
  if (firstUrlNodeType === "word" && secondUrlNodeType === "string") {
    return true
  }
  if (firstUrlNodeType === "string" && secondUrlNodeType === "word") {
    return true
  }
  return false
}

// minification may change url node value from './whatever.png' to 'whatever.png'
// the value still revolves to the same ressource
const compareUrlNodeValue = (firstUrlNodeValue, secondUrlNodeValue) => {
  const firstValueNormalized = urlToRelativeUrl(
    resolveUrl(firstUrlNodeValue, "file:///"),
    "file:///",
  )
  const secondValueNormalized = urlToRelativeUrl(
    resolveUrl(secondUrlNodeValue, "file:///"),
    "file:///",
  )
  return firstValueNormalized === secondValueNormalized
}
