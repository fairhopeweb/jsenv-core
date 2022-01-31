import { readFile } from "@jsenv/filesystem"

import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/jsenv_file_urls.js"

export const getJsenvBuildUrl = async (buildRelativeUrlWithoutHash) => {
  try {
    const manifest = await readFile(
      new URL("./dist/manifest.json", jsenvCoreDirectoryUrl),
      { as: "json" },
    )
    const buildRelativeUrl = manifest[buildRelativeUrlWithoutHash]
    return new URL(buildRelativeUrl, jsenvCoreDirectoryUrl).href
  } catch (e) {
    if (e.code === "ENOENT") {
      return null
    }
    throw e
  }
}
