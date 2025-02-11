import { DATA_URL } from "@jsenv/urls"
import { CONTENT_TYPE } from "@jsenv/utils/src/content_type/content_type.js"

export const jsenvPluginDataUrls = () => {
  return {
    name: "jsenv:data_urls",
    appliesDuring: "*",
    resolveUrl: (reference) => {
      if (!reference.specifier.startsWith("data:")) {
        return null
      }
      return reference.specifier
    },
    fetchUrlContent: (urlInfo) => {
      if (!urlInfo.url.startsWith("data:")) {
        return null
      }
      const {
        contentType,
        base64Flag,
        data: urlData,
      } = DATA_URL.parse(urlInfo.url)
      urlInfo.data.base64Flag = base64Flag
      return {
        content: contentFromUrlData({ contentType, base64Flag, urlData }),
        contentType,
      }
    },
    formatUrl: (reference, context) => {
      if (!reference.generatedUrl.startsWith("data:")) {
        return null
      }
      if (reference.type === "sourcemap_comment") {
        return null
      }
      return (async () => {
        const urlInfo = context.urlGraph.getUrlInfo(reference.url)
        await context.cook(urlInfo, { reference })
        if (urlInfo.originalContent === urlInfo.content) {
          return reference.generatedUrl
        }
        const specifier = DATA_URL.stringify({
          contentType: urlInfo.contentType,
          base64Flag: urlInfo.data.base64Flag,
          data: urlInfo.data.base64Flag
            ? dataToBase64(urlInfo.content)
            : String(urlInfo.content),
        })
        return specifier
      })()
    },
  }
}

const contentFromUrlData = ({ contentType, base64Flag, urlData }) => {
  if (CONTENT_TYPE.isTextual(contentType)) {
    if (base64Flag) {
      return base64ToString(urlData)
    }
    return urlData
  }
  if (base64Flag) {
    return base64ToBuffer(urlData)
  }
  return Buffer.from(urlData)
}

const base64ToBuffer = (base64String) => Buffer.from(base64String, "base64")
const base64ToString = (base64String) =>
  Buffer.from(base64String, "base64").toString("utf8")
const dataToBase64 = (data) => Buffer.from(data).toString("base64")
