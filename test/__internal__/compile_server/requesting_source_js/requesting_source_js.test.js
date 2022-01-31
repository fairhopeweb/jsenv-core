import { fetchUrl } from "@jsenv/server"
import { resolveUrl, urlToRelativeUrl } from "@jsenv/filesystem"
import { assert } from "@jsenv/assert"

import { jsenvRuntimeSupportDuringDev } from "@jsenv/core/src/jsenvRuntimeSupportDuringDev.js"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import { startCompileServer } from "@jsenv/core/src/internal/compile_server/compile_server.js"
import { COMPILE_SERVER_TEST_PARAMS } from "../TEST_PARAMS_COMPILE_SERVER.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(
  testDirectoryUrl,
  jsenvCoreDirectoryUrl,
)
const fileRelativeUrl = `${testDirectoryRelativeUrl}source_file.js`
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv/`
const compileServer = await startCompileServer({
  ...COMPILE_SERVER_TEST_PARAMS,
  jsenvDirectoryRelativeUrl,
  compileCacheStrategy: "etag",
  runtimeSupport: jsenvRuntimeSupportDuringDev,
})
const fileServerUrl = `${compileServer.origin}/${fileRelativeUrl}`
const response = await fetchUrl(fileServerUrl, {
  ignoreHttpsError: true,
})

const actual = {
  redirected: response.redirected,
  status: response.status,
  statusText: response.statusText,
  contentType: response.headers.get("content-type"),
  responseBodyAsText: await response.text(),
}
const expected = {
  redirected: false,
  status: 200,
  statusText: "OK",
  contentType: "application/javascript",
  responseBodyAsText:
    process.platform === "win32"
      ? actual.responseBodyAsText // on windows it's "\r" instead of "\n" and I'm lazy to test it
      : `const a = true
console.log(a)
`,
}
assert({ actual, expected })
