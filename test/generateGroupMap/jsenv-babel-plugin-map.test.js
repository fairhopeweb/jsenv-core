import { assert } from "@jsenv/assert"
import { jsenvBabelPluginMap } from "../../index.js"
import { generateGroupMap } from "../../src/internal/generateGroupMap/generateGroupMap.js"
import { jsenvBrowserScoreMap } from "../../src/jsenvBrowserScoreMap.js"
import { jsenvNodeVersionScoreMap } from "../../src/jsenvNodeVersionScoreMap.js"

{
  const actual = generateGroupMap({
    babelPluginMap: jsenvBabelPluginMap,
    platformScoreMap: { ...jsenvBrowserScoreMap, node: jsenvNodeVersionScoreMap },
    groupCount: 2,
  })
  const expected = {
    best: {
      babelPluginRequiredNameArray: [
        "proposal-json-strings",
        "proposal-optional-catch-binding",
        "proposal-unicode-property-regex",
        "syntax-object-rest-spread",
        "syntax-optional-catch-binding",
        "transform-dotall-regex",
      ],
      jsenvPluginRequiredNameArray: [],
      platformCompatMap: {
        chrome: "60",
        firefox: "55",
        electron: "2.1",
        opera: "47",
        node: "8.3",
      },
    },
    otherwise: {
      babelPluginRequiredNameArray: Object.keys(jsenvBabelPluginMap),
      jsenvPluginRequiredNameArray: [],
      platformCompatMap: {},
    },
  }
  assert({ actual, expected })
}
