/* eslint-disable import/max-dependencies */
import {
  namedValueDescriptionToMetaDescription,
  selectAllFileInsideFolder,
  pathnameToMeta,
} from "@dmail/project-structure"
import { fileWrite } from "@dmail/helper"
import { executePlan } from "../executePlan/index.js"
import { executeDescriptionToExecutionPlan } from "../executeDescriptionToExecutionPlan.js"
import {
  catchAsyncFunctionCancellation,
  createProcessInterruptionCancellationToken,
} from "../cancellationHelper.js"
import { createInstrumentPlugin } from "./createInstrumentPlugin.js"
import { executionPlanResultToCoverageMap } from "./executionPlanResultToCoverageMap/index.js"
import { relativePathToEmptyCoverage } from "./relativePathToEmptyCoverage.js"
import { generateCoverageHTML } from "./generateCoverageHTML.js"
import { generateCoverageLog } from "./generateCoverageLog.js"
import {
  DEFAULT_COMPILE_INTO_RELATIVE_PATH,
  DEFAULT_IMPORT_MAP_RELATIVE_PATH,
  DEFAULT_BROWSER_GROUP_RESOLVER_RELATIVE_PATH,
  DEFAULT_NODE_GROUP_RESOLVER_RELATIVE_PATH,
  DEFAULT_COVERAGE_RELATIVE_PATH,
  DEFAULT_COVER_DESCRIPTION,
  DEFAULT_EXECUTE_DESCRIPTION,
  DEFAULT_BABEL_CONFIG_MAP,
  DEFAULT_MAX_PARALLEL_EXECUTION,
} from "./cover-constant.js"
import {
  operatingSystemFilenameToPathname,
  pathnameToOperatingSystemFilename,
} from "../operating-system-filename.js"

export const cover = async ({
  projectFolder,
  compileIntoRelativePath = DEFAULT_COMPILE_INTO_RELATIVE_PATH,
  importMapRelativePath = DEFAULT_IMPORT_MAP_RELATIVE_PATH,
  browserGroupResolverRelativePath = DEFAULT_BROWSER_GROUP_RESOLVER_RELATIVE_PATH,
  nodeGroupResolverRelativePath = DEFAULT_NODE_GROUP_RESOLVER_RELATIVE_PATH,
  coverageRelativePath = DEFAULT_COVERAGE_RELATIVE_PATH,
  // coverDescription could be deduced from passing
  // an entryPointMap and collecting all dependencies
  // for now we stick to coverDescription using project-structure api
  coverDescription = DEFAULT_COVER_DESCRIPTION,
  executeDescription = DEFAULT_EXECUTE_DESCRIPTION,
  babelConfigMap = DEFAULT_BABEL_CONFIG_MAP,
  compileGroupCount = 2,
  maxParallelExecution = DEFAULT_MAX_PARALLEL_EXECUTION,
  defaultAllocatedMsPerExecution = 20000,
  writeCoverageFile = true,
  logCoverageFilePath = true,
  logCoverageTable = false,
  writeCoverageHtmlFolder = false,
  updateProcessExitCode = true,
  throwUnhandled = true,
  compileServerLogLevel = "off",
  executionLogLevel = "log",
  collectNamespace = false,
  measureDuration = true,
  captureConsole = true,
}) => {
  if (!writeCoverageFile) {
    if (logCoverageTable)
      throw new Error(`logCoverageTable must be false when writeCoverageFile is false`)
    if (writeCoverageHtmlFolder)
      throw new Error(`writeCoverageHtmlFolder must be false when writeCoverageFile is false`)
  }

  const start = async () => {
    const projectPathname = operatingSystemFilenameToPathname(projectFolder)
    const cancellationToken = createProcessInterruptionCancellationToken()
    const coverMetaDescription = namedValueDescriptionToMetaDescription({
      cover: coverDescription,
    })

    const coverFilePredicate = (pathnameRelative) =>
      pathnameToMeta({
        pathname: `/${pathnameRelative}`,
        metaDescription: coverMetaDescription,
      }).cover === true

    ensureNoFileIsBothCoveredAndExecuted({ executeDescription, coverFilePredicate })

    const [{ planResult, planResultSummary }, relativePathToCoverArray] = await Promise.all([
      (async () => {
        const instrumentBabelPlugin = createInstrumentPlugin({
          predicate: (pathnameRelative) => coverFilePredicate(pathnameRelative),
        })

        const babelConfigMapWithInstrumentation = {
          ...babelConfigMap,
          "transform-instrument": [instrumentBabelPlugin],
        }

        const executionPlan = await executeDescriptionToExecutionPlan({
          cancellationToken,
          projectPathname,
          compileIntoRelativePath,
          importMapRelativePath,
          browserGroupResolverRelativePath,
          nodeGroupResolverRelativePath,
          babelConfigMap: babelConfigMapWithInstrumentation,
          compileGroupCount,
          executeDescription,
          defaultAllocatedMsPerExecution,
          compileServerLogLevel,
        })

        return executePlan(executionPlan, {
          cover: true,
          logLevel: executionLogLevel,
          cancellationToken,
          maxParallelExecution,
          measureDuration,
          captureConsole,
          collectNamespace,
        })
      })(),
      listRelativePathToCover({
        cancellationToken,
        projectPathname,
        coverDescription,
      }),
    ])

    const executionCoverageMap = executionPlanResultToCoverageMap(planResult)
    const relativePathMissingCoverageArray = relativePathToCoverArray.filter(
      (relativePathToCover) => relativePathToCover.slice(1) in executionCoverageMap === false,
    )

    const missedCoverageMap = {}
    await Promise.all(
      relativePathMissingCoverageArray.map(async (relativePathMissingCoverage) => {
        const emptyCoverage = await relativePathToEmptyCoverage({
          cancellationToken,
          projectPathname,
          relativePath: relativePathMissingCoverage,
        })
        missedCoverageMap[relativePathMissingCoverage.slice(1)] = emptyCoverage
        return emptyCoverage
      }),
    )

    const coverageMap = {
      ...executionCoverageMap,
      ...missedCoverageMap,
    }

    if (updateProcessExitCode) {
      if (planResultSummary.executionCount !== planResultSummary.completedCount) {
        process.exitCode = 1
      }
    }

    if (writeCoverageFile) {
      const coverageFilename = pathnameToOperatingSystemFilename(
        `${projectPathname}${coverageRelativePath}`,
      )

      await fileWrite(coverageFilename, JSON.stringify(coverageMap, null, "  "))
      if (logCoverageFilePath) {
        console.log(`-> ${coverageFilename}`)
      }
    }

    if (logCoverageTable) {
      generateCoverageLog(coverageMap)
    }
    if (writeCoverageHtmlFolder) {
      generateCoverageHTML(coverageMap)
    }

    return {
      planResult,
      planResultSummary,
      coverageMap,
    }
  }

  const promise = catchAsyncFunctionCancellation(start)
  if (!throwUnhandled) return promise
  return promise.catch((e) => {
    setTimeout(() => {
      throw e
    })
  })
}

const ensureNoFileIsBothCoveredAndExecuted = ({ executeDescription, coverFilePredicate }) => {
  const fileToExecuteAndCoverArray = Object.keys(executeDescription).filter((pathnameRelative) =>
    coverFilePredicate(pathnameRelative),
  )
  if (fileToExecuteAndCoverArray.length) {
    // I think it is an error, it would be strange, for a given file
    // to be both covered and executed
    throw new Error(`some file must both be covered and executed.
file to execute and cover: ${fileToExecuteAndCoverArray}`)
  }
}

const listRelativePathToCover = async ({
  cancellationToken,
  projectPathname,
  coverDescription,
}) => {
  const metaDescriptionForCover = namedValueDescriptionToMetaDescription({
    cover: coverDescription,
  })

  const relativePathToCoverArray = await selectAllFileInsideFolder({
    cancellationToken,
    pathname: projectPathname,
    metaDescription: metaDescriptionForCover,
    predicate: ({ cover }) => cover,
    transformFile: ({ filenameRelative }) => `/${filenameRelative}`,
  })

  return relativePathToCoverArray
}
