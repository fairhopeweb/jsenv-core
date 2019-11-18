import { fileUrlToPath } from "internal/urlUtils.js"
import { readFileContent } from "internal/filesystemUtils.js"
import { resolveMetaJsonFileUrl } from "./locaters.js"

export const readMeta = async ({
  logger,
  projectDirectoryUrl,
  originalFileRelativePath,
  compiledFileRelativePath,
}) => {
  const metaJsonFileUrl = resolveMetaJsonFileUrl({
    projectDirectoryUrl,
    compiledFileRelativePath,
  })
  const metaJsonFilePath = fileUrlToPath(metaJsonFileUrl)

  try {
    const metaJsonString = await readFileContent(metaJsonFilePath)
    const metaJsonObject = JSON.parse(metaJsonString)
    const relativePathToProjectDirectoryFromMeta = metaJsonObject.originalFileRelativePath
    if (relativePathToProjectDirectoryFromMeta !== originalFileRelativePath) {
      logger.info(
        createRelativePathToProjectDirectoryChangedMessage({
          relativePathToProjectDirectoryFromMeta,
          originalFileRelativePath,
          metaJsonFilePath,
        }),
      )
      return null
    }
    return metaJsonObject
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null
    }

    if (error && error.name === "SyntaxError") {
      logger.error(
        createCacheSyntaxErrorMessage({
          syntaxError: error,
          metaJsonFilePath,
        }),
      )
      return null
    }

    throw error
  }
}

const createRelativePathToProjectDirectoryChangedMessage = ({
  relativePathToProjectDirectoryFromMeta,
  originalFileRelativePath,
  metaJsonFilePath,
}) => `unexpected originalFileRelativePath in meta.json
--- originalFileRelativePath in meta.json ---
${relativePathToProjectDirectoryFromMeta}
--- originalFileRelativePath ---
${originalFileRelativePath}
--- meta.json path ---
${metaJsonFilePath}`

const createCacheSyntaxErrorMessage = ({ syntaxError, metaJsonFilePath }) => `cache syntax error
--- syntax error stack ---
${syntaxError.stack}
--- meta.json path ---
${metaJsonFilePath}`
