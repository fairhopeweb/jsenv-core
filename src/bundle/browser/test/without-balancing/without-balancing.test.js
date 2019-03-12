import blockScoping from "@babel/plugin-transform-block-scoping"
import { projectFolder } from "../../../../projectFolder.js"
import { bundleBrowser } from "../../bundleBrowser.js"

bundleBrowser({
  projectFolder,
  into: "bundle/browser",
  globalPromiseName: "withoutBalancing",
  entryPointsDescription: {
    main: "src/bundle/browser/test/without-balancing/without-balancing.js",
  },
  babelPluginDescription: {
    "transform-block-scoping": [blockScoping],
  },
  compileGroupCount: 1,
  autoWrapEntryInPromise: true,
  verbose: true,
})
