import { collectFiles } from "@jsenv/filesystem"
import { createDetailedMessage } from "@jsenv/log"

export const generateExecutionSteps = async (
  plan,
  { signal, rootDirectoryUrl },
) => {
  const fileResultArray = await collectFiles({
    signal,
    directoryUrl: rootDirectoryUrl,
    associations: { filePlan: plan },
    predicate: ({ filePlan }) => filePlan,
  })
  const executionSteps = []
  fileResultArray.forEach(({ relativeUrl, meta }) => {
    const fileExecutionSteps = generateFileExecutionSteps({
      fileRelativeUrl: relativeUrl,
      filePlan: meta.filePlan,
    })
    executionSteps.push(...fileExecutionSteps)
  })
  return executionSteps
}

export const generateFileExecutionSteps = ({ fileRelativeUrl, filePlan }) => {
  const fileExecutionSteps = []
  Object.keys(filePlan).forEach((executionName) => {
    const stepConfig = filePlan[executionName]
    if (stepConfig === null || stepConfig === undefined) {
      return
    }
    if (typeof stepConfig !== "object") {
      throw new TypeError(
        createDetailedMessage(
          `found unexpected value in plan, they must be object`,
          {
            ["file relative path"]: fileRelativeUrl,
            ["execution name"]: executionName,
            ["value"]: stepConfig,
          },
        ),
      )
    }
    fileExecutionSteps.push({
      executionName,
      fileRelativeUrl,
      ...stepConfig,
    })
  })
  return fileExecutionSteps
}
