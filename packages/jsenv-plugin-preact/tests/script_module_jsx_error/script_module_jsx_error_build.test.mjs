import { assert } from "@jsenv/assert"
import { build } from "@jsenv/core"

const test = async (params) => {
  await build({
    logLevel: "warn",
    rootDirectoryUrl: new URL("./client/", import.meta.url),
    buildDirectoryUrl: new URL("./dist/", import.meta.url),
    entryPoints: {
      "./main.noeslint.html": "main.html",
    },
    minification: false,
    writeGeneratedFiles: true,
    ...params,
  })
}

try {
  await test({
    runtimeCompat: {
      chrome: "64",
    },
  })
  throw new Error("should throw")
} catch (e) {
  const actual = {
    stackStartsWithUnexpectedToken: e.stack.startsWith(
      "Error: Unexpected token (9:15)",
    ),
  }
  const expected = {
    stackStartsWithUnexpectedToken: true,
  }
  assert({ actual, expected })
}
