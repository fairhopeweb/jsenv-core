export const jsenvPluginImportScriptsBundler = () => {
  return {
    name: "jsenv:import_scripts_bundler",
    bundle: {
      js_classic: async (workerUrlInfos, { urlGraph }) => {
        const bundleResult = {}
        workerUrlInfos.forEach((workerUrlInfo) => {
          const magicSource = createMagicSource(workerUrlInfo.content)
          const visitDependencies = (urlInfo) => {
            urlInfo.dependencies.forEach((dependencyUrl) => {
              const dependencyUrlInfo = urlGraph.getUrlInfo(dependencyUrl)
              // what if there was some sourcemap for this urlInfo?
              // we should compose it too
              magicSource.append(dependencyUrlInfo.content)
              visitDependencies(dependencyUrlInfo)
            })
          }
          visitDependencies(workerUrlInfo)
          const { content, sourcemap } = magicSource.toContentAndSourcemap()
          bundleResult[workerUrlInfo.url] = {
            type: "worker_classic",
            content,
            sourcemap,
          }
        })
        return bundleResult
      },
    },
  }
}

export const parseWorkerClassicUrlMentions = () => {
  // use babel_plugin_inline_worker_imports.js
  return {}
}
