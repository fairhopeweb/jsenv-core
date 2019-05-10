import { assert } from "@dmail/assert"
import { hrefToFolderJsenvRelative } from "../../../src/hrefToFolderJsenvRelative.js"
import { ROOT_FOLDER } from "../../../src/ROOT_FOLDER.js"
import { startCompileServer } from "../../../index.js"
import { fetch } from "../fetch.js"

const rimraf = import.meta.require("rimraf")

const testFolderRelative = hrefToFolderJsenvRelative(import.meta.url)
const projectFolder = ROOT_FOLDER
const compileInto = `${testFolderRelative}/.dist`

const compileServer = await startCompileServer({
  projectFolder,
  compileInto,
  verbose: false,
})

await new Promise((resolve, reject) =>
  rimraf(`${projectFolder}/${compileInto}`, (error) => {
    if (error) reject(error)
    else resolve()
  }),
)
const firstResponse = await fetch(
  `${compileServer.origin}/${compileInto}/otherwise/${testFolderRelative}/file.js`,
)
const secondResponse = await fetch(
  `${compileServer.origin}/${compileInto}/otherwise/${testFolderRelative}/file.js`,
  {
    headers: {
      "if-none-match": firstResponse.headers.etag[0],
    },
  },
)
const actual = {
  status: secondResponse.status,
  statusText: secondResponse.statusText,
  headers: secondResponse.headers,
}
const expected = {
  status: 304,
  statusText: "Not Modified",
  headers: actual.headers,
}

assert({
  actual,
  expected,
})
