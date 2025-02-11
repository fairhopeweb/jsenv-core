import { requireFromJsenv } from "@jsenv/core/src/require_from_jsenv.js"

export const composeTwoFileByFileIstanbulCoverages = (
  firstFileByFileIstanbulCoverage,
  secondFileByFileIstanbulCoverage,
) => {
  const fileByFileIstanbulCoverage = {}
  Object.keys(firstFileByFileIstanbulCoverage).forEach((key) => {
    fileByFileIstanbulCoverage[key] = firstFileByFileIstanbulCoverage[key]
  })
  Object.keys(secondFileByFileIstanbulCoverage).forEach((key) => {
    const firstCoverage = firstFileByFileIstanbulCoverage[key]
    const secondCoverage = secondFileByFileIstanbulCoverage[key]
    fileByFileIstanbulCoverage[key] = firstCoverage
      ? merge(firstCoverage, secondCoverage)
      : secondCoverage
  })

  return fileByFileIstanbulCoverage
}

const merge = (firstIstanbulCoverage, secondIstanbulCoverage) => {
  const { createFileCoverage } = requireFromJsenv("istanbul-lib-coverage")
  const istanbulFileCoverageObject = createFileCoverage(firstIstanbulCoverage)
  istanbulFileCoverageObject.merge(secondIstanbulCoverage)
  const istanbulCoverage = istanbulFileCoverageObject.toJSON()
  return istanbulCoverage
}
