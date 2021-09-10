// disabled until npm link works again in github workflow

import { assert } from "@jsenv/assert"
import {
  resolveUrl,
  urlToRelativeUrl,
  readFile,
  urlToBasename,
} from "@jsenv/filesystem"

import { buildProject } from "@jsenv/core"
import { jsenvCoreDirectoryUrl } from "@jsenv/core/src/internal/jsenvCoreDirectoryUrl.js"
import { jsenvCompilerForSass } from "@jsenv/core/packages/jsenv-sass/main.js"
import { GENERATE_ESMODULE_BUILD_TEST_PARAMS } from "@jsenv/core/test/TEST_PARAMS_BUILD_ESMODULE.js"

const testDirectoryUrl = resolveUrl("./", import.meta.url)
const testDirectoryRelativeUrl = urlToRelativeUrl(
  testDirectoryUrl,
  jsenvCoreDirectoryUrl,
)
const testDirectoryname = urlToBasename(testDirectoryRelativeUrl)
const jsenvDirectoryRelativeUrl = `${testDirectoryRelativeUrl}.jsenv/`
const buildDirectoryRelativeUrl = `${testDirectoryRelativeUrl}dist/esmodule/`
const mainFilename = `${testDirectoryname}.html`
const entryPointMap = {
  [`./${testDirectoryRelativeUrl}${mainFilename}`]: "./main.html",
}

const { buildMappings } = await buildProject({
  ...GENERATE_ESMODULE_BUILD_TEST_PARAMS,
  // logLevel: "debug",
  jsenvDirectoryRelativeUrl,
  buildDirectoryRelativeUrl,
  entryPointMap,
  customCompilers: {
    ...jsenvCompilerForSass,
  },
})

const mainScssBuildRelativeUrl =
  buildMappings[`${testDirectoryRelativeUrl}main.scss`]
const mainScssBuildUrl = resolveUrl(
  `./dist/esmodule/${mainScssBuildRelativeUrl}`,
  import.meta.url,
)
const mainScssSource = await readFile(mainScssBuildUrl, { as: "string" })

// ensure scss was transformed to css
const actual = mainScssSource.includes("$color")
const expected = false
assert({ actual, expected })
