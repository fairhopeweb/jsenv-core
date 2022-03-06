// https://github.com/vitejs/vite/blob/main/packages/vite/src/node/plugins/resolve.ts

import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { urlToExtension } from "@jsenv/filesystem"

import { applyFileSystemMagicResolution } from "@jsenv/core/packages/node-esm-resolution/main.js"

export const jsenvPluginFileSystemMagic = ({
  magicExtensions = ["inherit"],
  magicDirectoryIndex = true,
  preservesSymlink = true,
} = {}) => {
  return {
    name: "jsenv:filesystem_magic",
    appliesDuring: "*",
    resolve: async ({ resolve, parentUrl }) => {
      const url = await resolve()
      // http, https, data, about, etc
      if (!url.startsWith("file:")) {
        return url
      }
      const urlObject = new URL(url)
      const { search, hash } = urlObject
      urlObject.search = ""
      urlObject.hash = ""
      const filesystemResolution = applyFileSystemMagicResolution(
        urlObject.href,
        {
          magicDirectoryIndex,
          magicExtensions: getExtensionsToTry(magicExtensions, parentUrl),
        },
      )
      if (!filesystemResolution.found) {
        // we throw early the ENOENT so that we know in advance this file won't be found
        // it generate better error because we can display
        // more context when trying to resolve the specifier found in a file
        throw filesystemResolution.lastENOENTError
      }
      const fileUrlRaw = filesystemResolution.url
      const fileUrl = `${fileUrlRaw}${search}${hash}`
      if (preservesSymlink) {
        return fileUrl
      }
      const realPath = realpathSync(urlObject)
      const realFileUrl = `${pathToFileURL(realPath)}${search}${hash}`
      return realFileUrl
    },
  }
}

const getExtensionsToTry = (magicExtensions, importer) => {
  const extensionsSet = new Set()
  magicExtensions.forEach((magicExtension) => {
    if (magicExtension === "inherit") {
      const importerExtension = urlToExtension(importer)
      extensionsSet.add(importerExtension)
    } else {
      extensionsSet.add(magicExtension)
    }
  })
  return Array.from(extensionsSet.values())
}
