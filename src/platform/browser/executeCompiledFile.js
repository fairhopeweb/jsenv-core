import { genericExecuteCompiledFile } from "../genericExecuteCompiledFile.js"
import { filenameRelativeToSourceHref } from "../filenameRelativeToSourceHref.js"
import { loadBrowserImporter } from "./loadBrowserImporter.js"
import { rejectionValueToMeta } from "./rejectionValueToMeta.js"

export const executeCompiledFile = ({
  compileInto,
  compileServerOrigin,
  filenameRelative,
  collectNamespace,
  collectCoverage,
}) =>
  genericExecuteCompiledFile({
    loadImporter: () => loadBrowserImporter({ compileInto, compileServerOrigin }),
    compileInto,
    compileServerOrigin,
    filenameRelative,
    collectNamespace,
    collectCoverage,
    readCoverage,
    onError: (error) => {
      displayErrorInDocument(error, { compileInto, compileServerOrigin, filenameRelative })
      displayErrorInConsole(error)
    },
    transformError: exceptionToObject,
  })

const readCoverage = () => window.__coverage__

const exceptionToObject = (exception) => {
  // if (error && error.code === "MODULE_INSTANTIATE_ERROR") {
  //   return exceptionToObject(error.error)
  // }

  // we need to convert error to an object to make it stringifiable
  if (exception && exception instanceof Error) {
    const object = {}
    Object.getOwnPropertyNames(exception).forEach((name) => {
      object[name] = exception[name]
    })
    return object
  }

  return {
    message: exception,
  }
}

const displayErrorInDocument = (error, { compileInto, compileServerOrigin, filenameRelative }) => {
  const meta = rejectionValueToMeta(error, {
    compileInto,
    compileServerOrigin,
  })

  const knownFileError = meta.file && !meta.importerFile
  const knownImportError = meta.file && meta.importerFile

  const css = `
    .jsenv-console pre {
      overflow: auto;
      /* avoid scrollbar to hide the text behind it */
      padding-top: 20px;
      padding-right: 20px;
      padding-bottom: 20px;
    }

    .jsenv-console pre[data-theme="dark"] {
      background: transparent;
      border: 1px solid black
    }

    .jsenv-console pre[data-theme="light"] {
      background: #1E1E1E;
      border: 1px solid white;
      color: #EEEEEE;
    }

    .jsenv-console pre[data-theme="light"] a {
      color: inherit;
    }
    `

  const html = `
      <style type="text/css">${css}></style>
      <div class="jsenv-console">
        <h1>
        ${
          // eslint-disable-next-line no-nested-ternary
          knownFileError
            ? createHTMLForKnownFileError({ file: meta.file, compileServerOrigin })
            : knownImportError
            ? createHTMLForKnownImportError({
                file: meta.file,
                importerFile: meta.importerFile,
                compileServerOrigin,
              })
            : createHTMLForUnknownError({ mainFile: filenameRelative, compileServerOrigin })
        }
        </h1>
        <pre data-theme="${meta.dataTheme || "dark"}">${meta.data}</pre>
      </div>
      `
  appendHMTLInside(html, document.body)
}

const displayErrorInConsole = (error) => {
  console.error(error)
}

const createHTMLForKnownFileError = ({
  file,
  compileServerOrigin,
}) => `error with imported file.<br/>
file: ${convertFileToLink({ file, compileServerOrigin })}`

const createHTMLForKnownImportError = ({
  file,
  importerFile,
  compileServerOrigin,
}) => `error with imported file.<br />
file: ${convertFileToLink({ file, compileServerOrigin })}
imported by: ${convertFileToLink({ file: importerFile, compileServerOrigin })}`

const createHTMLForUnknownError = ({
  mainFile,
  compileServerOrigin,
}) => `error during execution.<br />
main file: ${convertFileToLink({ file: mainFile, compileServerOrigin })}`

const convertFileToLink = ({ file, compileServerOrigin }) =>
  `<a href="${filenameRelativeToSourceHref({
    compileServerOrigin,
    filenameRelative: file,
  })}">${file}</a>`

const appendHMTLInside = (html, parentNode) => {
  const temoraryParent = document.createElement("div")
  temoraryParent.innerHTML = html
  transferChildren(temoraryParent, parentNode)
}

const transferChildren = (fromNode, toNode) => {
  while (fromNode.firstChild) {
    toNode.appendChild(fromNode.firstChild)
  }
}
