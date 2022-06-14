import { build } from "@jsenv/core"

const jsenvRootDirectoryUrl = new URL("../../", import.meta.url)
const jsenvDistDirectoryUrl = new URL("./dist/", jsenvRootDirectoryUrl)

await build({
  rootDirectoryUrl: jsenvRootDirectoryUrl,
  buildDirectoryUrl: jsenvDistDirectoryUrl,
  entryPoints: {
    "./main.js": "main.js",
  },
  baseUrl: "./",
  // sourcemaps: "file",
  minification: false,
  versioning: false,
  assetManifest: false,
  runtimeCompat: {
    node: "16.14",
  },
  directoryReferenceAllowed: true,
  urlAnalysis: {
    // for now ignore all node_modules
    // ideally later we'll selectively allow some node_modules
    // to be bundled and move them to "@jsenv/core" devDependencies
    include: {
      "**/*": true,
      "**/node_modules/": false,
      "**/node_modules/@jsenv/babel-plugins/": true,
    },
  },
  bundling: {
    js_module: {
      babelHelpersChunk: false,
    },
  },
})

// "s.js" is used in the build files, it must be compatible as much as possible
// so we convert async/await, arrow function, ... to be compatible with
// old browsers
// await build({
//   rootDirectoryUrl: jsenvRootDirectoryUrl,
//   buildDirectoryUrl: jsenvDistDirectoryUrl,
//   entryPoints: {
//     "./src/plugins/transpilation/as_js_classic/client/s.js":
//       "s.js?as_js_classic",
//   },
//   buildDirectoryClean: false,
//   runtimeCompat: {
//     chrome: "0",
//     firefox: "0",
//   },
//   baseUrl: "./",
//   sourcemaps: "file",
//   minification: false,
//   versioning: false,
//   assetManifest: false,
// })
