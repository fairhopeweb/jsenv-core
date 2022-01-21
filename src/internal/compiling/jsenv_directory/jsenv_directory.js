import {
  resolveUrl,
  readFile,
  writeFile,
  ensureEmptyDirectory,
} from "@jsenv/filesystem"

import { compareCompileContexts } from "./compile_context.js"
import { compareCompileProfiles } from "./compile_profile.js"

export const setupJsenvDirectory = async ({
  logger,
  projectDirectoryUrl,
  jsenvDirectoryRelativeUrl,
  jsenvDirectoryClean,
  compileServerCanWriteOnFilesystem,
  compileContext,
}) => {
  const jsenvDirectoryUrl = resolveUrl(
    jsenvDirectoryRelativeUrl,
    projectDirectoryUrl,
  )
  const compileDirectories = {}
  const jsenvDirectoryMeta = {
    compileContext,
    compileDirectories,
  }
  if (compileServerCanWriteOnFilesystem) {
    if (jsenvDirectoryClean) {
      await ensureEmptyDirectory(jsenvDirectoryUrl)
    }
    await applyFileSystemEffects({
      logger,
      jsenvDirectoryUrl,
      jsenvDirectoryMeta,
    })
  }

  const updateJsenvDirectoryMetaFile = async () => {
    await writeFile(
      resolveUrl("__jsenv_meta__.json", jsenvDirectoryUrl),
      JSON.stringify(jsenvDirectoryMeta, null, "  "),
    )
  }

  /*
   * This function try to reuse existing compiled id
   * (the goal being to reuse file that would be in a corresponding compile directory)
   * To decide if we reuse a compile directory we need to know
   * how the files inside that directory where generated
   * and if what we want matches what we have, the compile id is reused
   *
   * Note: some parameters means only a subset of files would be invalid
   * but to keep things simple the whole directory is ignored
   */
  const getOrCreateCompileId = async ({
    runtimeName,
    runtimeVersion,
    compileProfile,
  }) => {
    // TODO: decide when we can return null
    // depending on the compileProfile
    const existingCompileIds = Object.keys(compileDirectories)
    const existingCompileId = existingCompileIds.find((compileIdCandidate) => {
      const compileDirectoryCandidate = compileDirectories[compileIdCandidate]
      return compareCompileProfiles(
        compileDirectoryCandidate.compileProfile,
        compileProfile,
      )
    })
    const runtime = `${runtimeName}@${runtimeVersion}`
    if (existingCompileId) {
      const compileDirectory = compileDirectories[existingCompileId]
      const { runtimes } = compileDirectory.runtimes
      if (!runtimes.includes(runtime)) {
        runtimes.push(runtime)
        await updateJsenvDirectoryMetaFile()
      }
      return existingCompileId
    }
    const compileIdBase = generateCompileId({ compileProfile })
    let compileId = compileIdBase
    let integer = 1
    while (existingCompileIds.includes(compileId)) {
      compileId = `${compileIdBase}${integer}`
      integer++
    }
    compileDirectories[compileId] = {
      compileProfile,
      runtimes: [runtime],
    }
    await updateJsenvDirectoryMetaFile()
    return compileId
  }
  return {
    jsenvDirectoryMeta,
    getOrCreateCompileId,
  }
}

const generateCompileId = ({ compileProfile }) => {
  if (compileProfile.requiredFeatureNames.includes("transform-instrument")) {
    return `out_instrumented`
  }
  return `out`
}

const applyFileSystemEffects = async ({
  logger,
  jsenvDirectoryUrl,
  jsenvDirectoryMeta,
}) => {
  const jsenvDirectoryMetaFileUrl = resolveUrl(
    "__jsenv_meta__.json",
    jsenvDirectoryUrl,
  )
  const writeOnFileSystem = async () => {
    await ensureEmptyDirectory(jsenvDirectoryUrl)
    await writeFile(
      jsenvDirectoryMetaFileUrl,
      JSON.stringify(jsenvDirectoryMeta, null, "  "),
    )
    logger.debug(`-> ${jsenvDirectoryMetaFileUrl}`)
  }
  try {
    const source = await readFile(jsenvDirectoryMetaFileUrl)
    if (source === "") {
      logger.warn(
        `out directory meta file is empty ${jsenvDirectoryMetaFileUrl}`,
      )
      await writeOnFileSystem()
      return
    }
    const jsenvDirectoryMetaPrevious = JSON.parse(source)
    if (
      !compareCompileContexts(
        jsenvDirectoryMetaPrevious.compileContext,
        jsenvDirectoryMeta.compileContext,
      )
    ) {
      logger.debug(
        `Cleaning ${jsenvDirectoryUrl} directory because compile context has changed`,
      )
      await writeOnFileSystem()
      return
    }
    // reuse existing compile directories
    jsenvDirectoryMeta.compileDirectories =
      jsenvDirectoryMetaPrevious.compileDirectories
  } catch (e) {
    if (e.code === "ENOENT") {
      await writeOnFileSystem()
      return
    }
    if (e.name === "SyntaxError") {
      logger.warn(`Syntax error while parsing ${jsenvDirectoryMetaFileUrl}`)
      await writeOnFileSystem()
      return
    }
    throw e
  }
}
