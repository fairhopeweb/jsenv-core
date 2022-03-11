import { applyBabelPlugins } from "@jsenv/core/src/utils/js_ast/apply_babel_plugins.js"
import { createMagicSource } from "@jsenv/core/src/utils/sourcemap/magic_source.js"

import { babelPluginMetadataUrlMentions } from "./babel_plugin_metadata_url_mentions.js"
import { babelPluginMetadataImportMetaHot } from "./babel_plugin_metadata_import_meta_hot.js"

export const parseJsModuleUrlMentions = async ({
  urlMentionHandlers,
  asClientUrl,
  parentUrlSite,
  url,
  type,
  content,
}) => {
  if (type !== "js_module") {
    return null
  }
  const { metadata } = await applyBabelPlugins({
    babelPlugins: [
      [babelPluginMetadataUrlMentions],
      [babelPluginMetadataImportMetaHot],
    ],
    parentUrlSite,
    url,
    content,
  })
  const { urlMentions, hotDecline, hotAcceptSelf, hotAcceptDependencies } =
    metadata
  return {
    urlMentions,
    getHotInfo: () => {
      return {
        hotDecline,
        hotAcceptSelf,
        hotAcceptDependencies,
      }
    },
    transformUrlMentions: () => {
      const magicSource = createMagicSource({ url, content })
      urlMentions.forEach((urlMention) => {
        const handler = urlMentionHandlers[urlMention.type]
        if (handler) {
          handler({ url, urlMention, magicSource })
        } else {
          const clientUrl = asClientUrl(urlMention.url)
          const replacement = JSON.stringify(clientUrl)
          const { start, end } = urlMention
          magicSource.replace({
            start,
            end,
            replacement,
          })
        }
      })
      return magicSource.toContentAndSourcemap()
    },
  }
}
