import { basename } from "path"
import { assert } from "@jsenv/assert"
import { resolveDirectoryUrl, urlToRelativeUrl } from "@jsenv/filesystem"
import { buildProject } from "@jsenv/core"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import {
  GENERATE_COMMONJS_BUILD_TEST_PARAMS,
  REQUIRE_COMMONJS_BUILD_TEST_PARAMS,
} from "@jsenv/core/test/TEST_PARAMS_BUILD_COMMONJS.js"
import { requireCommonJsBuild } from "@jsenv/core/test/requireCommonJsBuild.js"

const testDirectoryUrl = resolveDirectoryUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(
  testDirectoryUrl,
  jsenvCoreDirectoryUrl,
)
const testDirectoryname = basename(testDirectoryRelativeUrl)
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv`
const buildDirectoryRelativeUrl = `${testDirectoryRelativeUrl}dist/commonjs`
const mainFilename = `${testDirectoryname}.js`

await buildProject({
  ...GENERATE_COMMONJS_BUILD_TEST_PARAMS,
  jsenvDirectoryRelativeUrl,
  buildDirectoryRelativeUrl,
  entryPoints: {
    [`./${testDirectoryRelativeUrl}${mainFilename}`]: "main.cjs",
  },
})

const { namespace: actual } = await requireCommonJsBuild({
  ...REQUIRE_COMMONJS_BUILD_TEST_PARAMS,
  buildDirectoryRelativeUrl,
})
const expected = {}
assert({ actual, expected })
