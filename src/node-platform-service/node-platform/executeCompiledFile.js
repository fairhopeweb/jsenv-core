import { genericExecuteCompiledFile } from "../../platform/genericExecuteCompiledFile.js"
import { loadNodeImporter } from "./loadNodeImporter.js"

export const executeCompiledFile = ({
  compileInto,
  sourceOrigin,
  compileServerOrigin,
  filenameRelative,
  collectNamespace,
  collectCoverage,
}) =>
  genericExecuteCompiledFile({
    loadImporter: () => loadNodeImporter({ compileInto, sourceOrigin, compileServerOrigin }),
    compileInto,
    compileServerOrigin,
    filenameRelative,
    collectNamespace,
    collectCoverage,
    readCoverage,
    onError,
    transformError,
  })

const readCoverage = () => global.__coverage__

const onError = (error) => {
  console.error(error)
}

const transformError = (error) => {
  return error
}
