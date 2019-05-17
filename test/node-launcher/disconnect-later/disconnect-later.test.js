import { assert } from "@dmail/assert"
import { importMetaURLToFolderJsenvRelativePath } from "../../../src/import-meta-url-to-folder-jsenv-relative-path.js"
import { JSENV_PATH } from "../../../src/JSENV_PATH.js"
import { startCompileServer, launchAndExecute, launchNode } from "../../../index.js"

const folderJsenvRelativePath = importMetaURLToFolderJsenvRelativePath(import.meta.url)
const projectFolder = JSENV_PATH
const compileInto = `${folderJsenvRelativePath}/.dist`
const fileRelativePath = `${folderJsenvRelativePath}/disconnect-later.js`

const { origin: compileServerOrigin } = await startCompileServer({
  projectFolder,
  compileInto,
  logLevel: "off",
})

let called = false
const actual = await launchAndExecute({
  launch: (options) =>
    launchNode({
      ...options,
      projectFolder,
      compileServerOrigin,
      compileInto,
    }),
  fileRelativePath,
  disconnectAfterExecutedCallback: () => {
    called = true
  },
})
const expected = {
  status: "completed",
}
assert({ actual, expected })

process.on("exit", () => {
  assert({
    actual: called,
    expected: true,
  })
})
