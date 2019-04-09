import { isNativeBrowserModuleBareSpecifier } from "/node_modules/@jsenv/module-resolution/src/isNativeBrowserModuleBareSpecifier.js"
import { createImportFromGlobalRollupPlugin } from "../import-from-global-rollup-plugin/index.js"
import { createJsenvRollupPlugin } from "../jsenv-rollup-plugin/index.js"

export const computeRollupOptionsWithBalancing = ({
  cancellationToken,
  importMap,
  projectFolder,
  into,
  entryPointMap,
  babelConfigMap,
  groupMap,
  compileId,
  log,
  minify,
}) => {
  const dir = `${projectFolder}/${into}/${compileId}`

  const importFromGlobalRollupPlugin = createImportFromGlobalRollupPlugin({
    platformGlobalName: "window",
  })

  const jsenvRollupPlugin = createJsenvRollupPlugin({
    cancellationToken,
    importMap,
    projectFolder,
    dir,
    featureNameArray: groupMap[compileId].incompatibleNameArray,
    babelConfigMap,
    minify,
    target: "browser",
  })

  log(`
bundle entry points for browser with balancing.
compileId: ${compileId}
entryPointArray: ${Object.keys(entryPointMap)}
dir: ${dir}
minify: ${minify}
`)

  return {
    rollupParseOptions: {
      input: entryPointMap,
      plugins: [importFromGlobalRollupPlugin, jsenvRollupPlugin],
      external: (id) => isNativeBrowserModuleBareSpecifier(id),
    },
    rollupGenerateOptions: {
      dir,
      format: "system",
      // entryFileNames: `./${compileId}-[name].js`,
      sourcemap: true,
      sourceMapExcludeSources: true,
    },
  }
}
