import { assert } from "@dmail/assert"
import { importMetaURLToFolderJsenvRelativePath } from "../../../src/import-meta-url-to-folder-jsenv-relative-path.js"
import { startCompileServer } from "../../../index.js"
import { COMPILE_SERVER_TEST_PARAM } from "../compile-server-test-param.js"
import { fetch } from "../fetch.js"

const folderJsenvRelativePath = importMetaURLToFolderJsenvRelativePath(import.meta.url)
const compileIntoRelativePath = `${folderJsenvRelativePath}/.dist`
const compileId = "best"
const fileRelativePath = `${folderJsenvRelativePath}/commonjs.js`

const compileServer = await startCompileServer({
  ...COMPILE_SERVER_TEST_PARAM,
  compileIntoRelativePath,
  convertMap: {
    // get codefrom commonjs-converter to be able to return what we need here
    "/commonjs.js": () => {},
  },
})

const response = await fetch(
  `${compileServer.origin}${compileIntoRelativePath}/${compileId}${fileRelativePath}`,
)
const actual = {
  status: response.status,
  statusText: response.statusText,
  headers: response.headers,
}
const expected = {
  status: 200,
  statusText: "OK",
  headers: {
    ...actual.headers,
    "content-type": ["application/javascript"],
  },
}

assert({
  actual,
  expected,
})
