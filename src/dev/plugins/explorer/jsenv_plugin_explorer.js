import { readFileSync } from "node:fs"
import { URL_META, DataUrl } from "@jsenv/urls"
import { collectFiles } from "@jsenv/filesystem"

import { CONTENT_TYPE } from "@jsenv/utils/content_type/content_type.js"

export const jsenvPluginExplorer = ({ groups }) => {
  const htmlClientFileUrl = new URL("./client/explorer.html", import.meta.url)
  const faviconClientFileUrl = new URL("./client/jsenv.png", import.meta.url)

  return {
    name: "jsenv:explorer",
    appliesDuring: {
      dev: true,
    },
    serve: async (request, { rootDirectoryUrl }) => {
      if (request.ressource !== "/") {
        return null
      }
      let associationsForExplorable = {}
      Object.keys(groups).forEach((groupName) => {
        const groupConfig = groups[groupName]
        associationsForExplorable[groupName] = {
          "**/.jsenv/": false, // avoid visting .jsenv directory in jsenv itself
          ...groupConfig,
        }
      })
      associationsForExplorable = URL_META.resolveAssociations(
        associationsForExplorable,
        rootDirectoryUrl,
      )
      const matchingFileResultArray = await collectFiles({
        directoryUrl: rootDirectoryUrl,
        associations: associationsForExplorable,
        predicate: (meta) =>
          Object.keys(meta).some((group) => Boolean(meta[group])),
      })
      const files = matchingFileResultArray.map(({ relativeUrl, meta }) => ({
        relativeUrl,
        meta,
      }))
      let html = String(readFileSync(new URL(htmlClientFileUrl)))
      html = html.replace(
        "virtual:FAVICON_HREF",
        DataUrl.stringify({
          contentType: CONTENT_TYPE.fromUrlExtension(faviconClientFileUrl),
          base64Flag: true,
          data: readFileSync(new URL(faviconClientFileUrl)).toString("base64"),
        }),
      )
      html = html.replace(
        "SERVER_PARAMS",
        JSON.stringify(
          {
            rootDirectoryUrl,
            groups,
            files,
          },
          null,
          "  ",
        ),
      )
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html",
          "content-length": Buffer.byteLength(html),
        },
        body: html,
      }
    },
  }
}
