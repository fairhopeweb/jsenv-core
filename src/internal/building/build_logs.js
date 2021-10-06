import { getHtmlNodeLocation } from "@jsenv/core/src/internal/compiling/compileHtml.js"
import { setANSIColor, ANSI_GREY, okSign } from "../logs/log_style.js"
import { byteAsFileSize } from "../logs/byteAsFileSize.js"
import { msAsDuration } from "../logs/msAsDuration.js"
import { stringifyUrlSite } from "./url_trace.js"

export const formatUseImportMapFromHtml = (importMapInfoFromHtml) => {
  return `
use importmap from html ${showHtmlSourceLocation(importMapInfoFromHtml)}`
}

export const formatImportmapOutsideCompileDirectory = ({
  importMapInfo,
  compileDirectoryUrl,
}) => {
  return `
WARNING: importmap file is outside compile directory.
That's unusual you should certainly make importmap file relative.
${showHtmlSourceLocation(importMapInfo)}
--- compile directory url ---
${compileDirectoryUrl}
`
}

export const formatRessourceHintNeverUsedWarning = (linkInfo) => {
  return `
WARNING: Ressource never used for ${
    linkInfo.rel
  } link in ${showHtmlSourceLocation(linkInfo)}
`
}

export const formatBuildDoneInfo = ({
  buildStats,
  buildDirectoryRelativeUrl,
}) => {
  return `${formatBuildDoneDetails({ buildStats, buildDirectoryRelativeUrl })}
${formatBuildSummary({ buildStats })}
${okSign} build end
`
}

const formatBuildDoneDetails = ({ buildStats, buildDirectoryRelativeUrl }) => {
  const { buildFileSizes } = buildStats
  const buildFiles = Object.keys(buildFileSizes).map((key) => {
    const buildFileSize = buildFileSizes[key]
    return `${buildDirectoryRelativeUrl}${key} (${byteAsFileSize(
      buildFileSize,
    )})`
  })
  const buildFileCount = buildFiles.length

  const { buildSourcemapFileSizes } = buildStats
  const sourcemapFiles = Object.keys(buildSourcemapFileSizes).map((key) => {
    const buildSourcemapFileSize = buildSourcemapFileSizes[key]
    return `${buildDirectoryRelativeUrl}${key} (${byteAsFileSize(
      buildSourcemapFileSize,
    )})`
  })
  const sourcemapFileCount = sourcemapFiles.length

  const buildFilesDescription =
    buildFileCount === 1
      ? "file in the build: 1"
      : `files in the build: ${buildFileCount}`

  const buildSourcemapFilesDescription =
    sourcemapFileCount === 0
      ? ""
      : sourcemapFileCount === 1
      ? "sourcemap file in the build: 1"
      : `sourcemap files in the build: ${sourcemapFileCount}`

  let message = `--- ${buildFilesDescription} ---
${buildFiles.join("\n")}`

  if (buildSourcemapFilesDescription) {
    message += `
--- ${buildSourcemapFilesDescription} ---
${sourcemapFiles.join("\n")}`
  }

  return message
}

const formatBuildSummary = ({ buildStats }) => {
  const {
    buildDuration,
    projectFileSizes,
    projectTotalFileSize,
    buildFileSizes,
    buildTotalFileSize,
  } = buildStats

  const projectFileCount = Object.keys(projectFileSizes).length
  const buildFileCount = Object.keys(buildFileSizes).length

  return `------- build summary -------
${setANSIColor(
  `project files:`,
  ANSI_GREY,
)} ${projectFileCount} (${byteAsFileSize(projectTotalFileSize)})
${setANSIColor(`build files:`, ANSI_GREY)} ${buildFileCount} (${byteAsFileSize(
    buildTotalFileSize,
  )})
${setANSIColor(`build duration:`, ANSI_GREY)} ${msAsDuration(buildDuration)}
------------------------------`
}

const showHtmlSourceLocation = ({
  htmlNode,
  htmlUrl,
  htmlSource,
  htmlAttributeName,
}) => {
  const { line, column } =
    getHtmlNodeLocation(htmlNode, htmlAttributeName) || {}

  return stringifyUrlSite({
    url: htmlUrl,
    line,
    column,
    source: htmlSource,
  })
}
