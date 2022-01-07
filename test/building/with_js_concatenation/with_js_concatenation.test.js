import { assert } from "@jsenv/assert"
import { resolveDirectoryUrl, urlToRelativeUrl } from "@jsenv/filesystem"

import { buildProject } from "@jsenv/core"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import {
  GENERATE_ESMODULE_BUILD_TEST_PARAMS,
  BROWSER_IMPORT_BUILD_TEST_PARAMS,
} from "@jsenv/core/test/TEST_PARAMS_BUILD_ESMODULE.js"
import { browserImportEsModuleBuild } from "@jsenv/core/test/browserImportEsModuleBuild.js"

const testDirectoryUrl = resolveDirectoryUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(
  testDirectoryUrl,
  jsenvCoreDirectoryUrl,
)
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv/`
const buildDirectoryRelativeUrl = `${testDirectoryRelativeUrl}dist/esmodule/`
const htmlFileRelativeUrl = `${testDirectoryRelativeUrl}with_js_concatenation.html`
const { projectBuildMappings } = await buildProject({
  ...GENERATE_ESMODULE_BUILD_TEST_PARAMS,
  // logLevel: "debug",
  jsenvDirectoryRelativeUrl,
  buildDirectoryRelativeUrl,
  entryPoints: {
    [`./${htmlFileRelativeUrl}`]: "main.html",
  },
  // minify: true,
})

// assert only 2 files, 1 html, 1 js, are generated even if there is two js file used
{
  const actual = Object.keys(projectBuildMappings)
  const expected = [
    `${testDirectoryRelativeUrl}main.js`,
    `${testDirectoryRelativeUrl}with_js_concatenation.html`,
  ]
  assert({ actual, expected })
}

{
  const mainJsRelativeUrl =
    projectBuildMappings[`${testDirectoryRelativeUrl}main.js`]
  const { namespace } = await browserImportEsModuleBuild({
    ...BROWSER_IMPORT_BUILD_TEST_PARAMS,
    testDirectoryRelativeUrl,
    jsFileRelativeUrl: `./${mainJsRelativeUrl}`,
    // debug: true,
  })

  const actual = namespace
  const expected = { value: 42 }
  assert({ actual, expected })
}
