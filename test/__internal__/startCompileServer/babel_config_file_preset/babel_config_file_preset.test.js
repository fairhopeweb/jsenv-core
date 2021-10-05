import { assert } from "@jsenv/assert"
import { resolveUrl, urlToRelativeUrl } from "@jsenv/filesystem"
import { fetchUrl } from "@jsenv/server"

import { startCompileServer } from "@jsenv/core/src/internal/compiling/startCompileServer.js"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import { jsenvRuntimeSupportDuringDev } from "@jsenv/core/src/jsenvRuntimeSupportDuringDev.js"
import { COMPILE_ID_OTHERWISE } from "@jsenv/core/src/internal/CONSTANTS.js"
import { COMPILE_SERVER_TEST_PARAMS } from "../TEST_PARAMS_COMPILE_SERVER.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(
  testDirectoryUrl,
  jsenvCoreDirectoryUrl,
)
const filename = `file.jsx`
const fileRelativeUrl = `${testDirectoryRelativeUrl}${filename}`
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv/`

// syntax error when syntax-jsx is not enabled
{
  const compileServer = await startCompileServer({
    ...COMPILE_SERVER_TEST_PARAMS,
    jsenvDirectoryRelativeUrl,
    runtimeSupport: jsenvRuntimeSupportDuringDev,
    babelConfigFileUrl: undefined,
  })
  const compiledFileRelativeUrl = `${jsenvDirectoryRelativeUrl}out/${COMPILE_ID_OTHERWISE}/${fileRelativeUrl}`
  const fileServerUrl = `${compileServer.origin}/${compiledFileRelativeUrl}`
  const response = await fetchUrl(fileServerUrl)
  const responseBodyAsJson = await response.json()

  const actual = {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    responseIncludesJsxNotEnabled: responseBodyAsJson.message.includes(
      `Support for the experimental syntax 'jsx' isn't currently enabled`,
    ),
  }
  const expected = {
    status: 500,
    statusText: "parse error",
    contentType: "application/json",
    responseIncludesJsxNotEnabled: true,
  }
  assert({ actual, expected })
}

// ok when syntax-jsx plugin is enabled
{
  const compileServer = await startCompileServer({
    ...COMPILE_SERVER_TEST_PARAMS,
    babelConfigFileUrl: new URL("./babel.config.cjs", import.meta.url),
    jsenvDirectoryRelativeUrl,
    runtimeSupport: jsenvRuntimeSupportDuringDev,
  })
  const compiledFileRelativeUrl = `${jsenvDirectoryRelativeUrl}out/${COMPILE_ID_OTHERWISE}/${fileRelativeUrl}`
  const fileServerUrl = `${compileServer.origin}/${compiledFileRelativeUrl}`
  const response = await fetchUrl(fileServerUrl)

  const actual = {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
  }
  const expected = {
    status: 200,
    statusText: "OK",
    contentType: "application/javascript",
  }
  assert({ actual, expected })
}
