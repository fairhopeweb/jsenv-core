import {
  parseLinkNode,
  getHtmlNodeAttributeByName,
} from "@jsenv/core/src/internal/transform_html/html_ast.js"
import { htmlAttributeSrcSet } from "@jsenv/core/src/internal/transform_html/html_attribute_src_set.js"

export const updateHtmlHotMeta = ({ ressourceGraph, url, urlMentions }) => {
  const dependencyUrls = []
  const hotAcceptDependencies = []
  urlMentions.forEach(({ specifier, hotAccepted }) => {
    const ressourceUrl = ressourceGraph.applyUrlResolution(specifier, url)
    // adding url to "dependencyUrls" means html uses an url
    // and should reload (hot or full) when an url changes
    dependencyUrls.push(ressourceUrl)
    // Adding url to "hotAcceptDependencies" means html hot_reload these ressources:
    // something like this: link.href = `${link.href}?hmr=${Date.now()}`)
    // If some url must trigger a full reload of the html page it should be excluded from
    // "hotAcceptDependencies".
    // There is some "smart" default applied in "collectHtmlDependenciesFromAst"
    // to decide what should hot reload / fullreload:
    // By default:
    //   - hot reload on <img src="./image.png" />
    //   - fullreload on <script src="./file.js" />
    // Can be controlled by [hot-decline] and [hot-accept]:
    //   - fullreload on <img src="./image.png" hot-decline />
    //   - hot reload on <script src="./file.js" hot-accept />
    if (hotAccepted) {
      hotAcceptDependencies.push(ressourceUrl)
    }
  })
  ressourceGraph.updateRessourceDependencies({
    url,
    type: "html",
    dependencyUrls,
    hotAcceptSelf: false,
    hotAcceptDependencies,
  })
  return dependencyUrls
}

export const collectHtmlUrlMentions = (htmlAst, url) => {
  const htmlUrlMentions = []
  const addDependency = ({ node, attribute, specifier, hotAccepted }) => {
    // ignore local url specifier (<use href="#logo"> or <a href="#">)
    if (specifier[0] === "#") {
      return
    }
    htmlUrlMentions.push({
      htmlNode: node,
      attribute,
      specifier,
      hotAccepted,
    })
  }
  const onNode = (node, { hotAccepted }) => {
    if (node.nodeName === "link") {
      if (hotAccepted === undefined) {
        const { isStylesheet, isRessourceHint } = parseLinkNode(node)
        if (isStylesheet) {
          // stylesheets can be hot replaced by default
          hotAccepted = true
        } else if (isRessourceHint) {
          // for ressource hints html will be notified the underlying ressource has changed
          // but we won't do anything (if the ressource is deleted we should?)
          hotAccepted = true
        }
      }
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "href",
        hotAccepted,
      })
      return
    }
    // if (node.nodeName === "style") {
    //   // styles.push(node)
    //   return
    // }
    if (node.nodeName === "script") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "src",
        hotAccepted:
          hotAccepted === undefined
            ? // script cannot hotreload by default
              false
            : hotAccepted,
      })
      return
    }
    if (node.nodeName === "a") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "href",
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
    }
    if (node.nodeName === "img") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "src",
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
      visitSrcset({
        node,
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
      return
    }
    if (node.nodeName === "source") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "src",
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
      visitSrcset({
        node,
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
      return
    }
    // svg <image> tag
    if (node.nodeName === "image") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "href",
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
      return
    }
    if (node.nodeName === "use") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "href",
        hotAccepted: hotAccepted === undefined ? true : hotAccepted,
      })
      return
    }
  }
  const visitAttributeAsUrlSpecifier = ({
    node,
    attributeName,
    hotAccepted,
  }) => {
    const attribute = getHtmlNodeAttributeByName(node, attributeName)
    const value = attribute ? attribute.value : undefined
    if (value) {
      addDependency({
        node,
        attribute,
        specifier:
          attributeName === "content-src" ? new URL(value, url).href : value,
        hotAccepted,
      })
    } else if (attributeName === "src") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "content-src",
        hotAccepted,
      })
    } else if (attributeName === "href") {
      visitAttributeAsUrlSpecifier({
        node,
        attributeName: "content-href",
        hotAccepted,
      })
    }
  }
  const visitSrcset = ({ node, hotAccepted }) => {
    const srcsetAttribute = getHtmlNodeAttributeByName(node, "srcset")
    const srcset = srcsetAttribute ? srcsetAttribute.value : undefined
    if (srcset) {
      const srcCandidates = htmlAttributeSrcSet.parse(srcset)
      srcCandidates.forEach((srcCandidate) => {
        addDependency({
          node,
          attribute: srcsetAttribute,
          specifier: srcCandidate.specifier,
          hotAccepted,
        })
      })
    }
  }
  const getNodeContext = (node) => {
    const context = {}
    const hotAcceptAttribute = getHtmlNodeAttributeByName(node, "hot-accept")
    if (hotAcceptAttribute) {
      context.hotAccepted = true
    }
    const hotDeclineAttribute = getHtmlNodeAttributeByName(node, "hot-decline")
    if (hotDeclineAttribute) {
      context.hotAccepted = false
    }
    return context
  }
  const iterate = (node, context) => {
    context = {
      ...context,
      ...getNodeContext(node),
    }
    onNode(node, context)
    const { childNodes } = node
    if (childNodes) {
      let i = 0
      while (i < childNodes.length) {
        const childNode = childNodes[i++]
        iterate(childNode, context)
      }
    }
  }
  iterate(htmlAst, {})
  return htmlUrlMentions
}
