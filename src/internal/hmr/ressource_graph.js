import { resolveUrl, urlToRelativeUrl } from "@jsenv/filesystem"

export const createRessourceGraph = ({ projectDirectoryUrl }) => {
  const ressources = {}
  const getRessourceByUrl = (url) => ressources[url]
  const reuseOrCreateRessource = (url) => {
    const existingRessource = getRessourceByUrl(url)
    if (existingRessource) return existingRessource
    const ressource = createRessource(url)
    ressources[url] = ressource
    return ressource
  }

  const applyImportmapResolution = (specifier, baseUrl) => {
    // const ressourceReferencingUrl = ressources[importerUrl]
    // if (ressourceReferencingUrl) {
    //   // TODO: find first html file importing this js file and use importmap
    //   eventually found in that html file
    // }
    return resolveUrl(specifier, baseUrl)
  }
  const applyUrlResolution = (specifier, baseUrl) => {
    return resolveUrl(specifier, baseUrl)
  }

  const injectHmrIntoUrl = (url) => {
    const ressource = ressources[url]
    if (!ressource) {
      return null
    }
    const urlObject = new URL(url)
    urlObject.searchParams.set("hmr", ressource.hmrTimestamp)
    return String(urlObject)
  }

  const updateRessourceDependencies = ({
    url,
    type,
    dependencyUrls,
    importMetaHotDecline,
    importMetaHotAcceptSelf,
    importMetaHotAcceptDependencies,
  }) => {
    const existingRessource = getRessourceByUrl(url)
    const ressource =
      existingRessource || (ressources[url] = createRessource(url))
    const notUsedAnymore = []
    if (type !== undefined) {
      ressource.type = type
    }
    if (dependencyUrls !== undefined) {
      if (existingRessource) {
        const oldDependencyUrls = Array.from(
          existingRessource.dependencies,
        ).filter((depUrl) => !dependencyUrls.includes(depUrl))
        oldDependencyUrls.forEach((oldDependencyUrl) => {
          const oldDependency = ressources[oldDependencyUrl]
          if (oldDependency) {
            oldDependency.dependents.delete(url)
            if (oldDependency.dependents.size === 0) {
              notUsedAnymore.push(oldDependencyUrl)
            }
          }
        })
      }
      dependencyUrls.forEach((dependencyUrl) => {
        const dependency = reuseOrCreateRessource(dependencyUrl)
        ressource.dependencies.add(url)
        dependency.dependents.add(url)
      })
    }
    if (importMetaHotDecline !== undefined) {
      ressource.importMetaHotDecline = importMetaHotDecline
    }
    if (importMetaHotAcceptSelf !== undefined) {
      ressource.importMetaHotAcceptSelf = importMetaHotAcceptSelf
    }
    if (importMetaHotAcceptDependencies !== undefined) {
      ressource.importMetaHotAcceptDependencies =
        importMetaHotAcceptDependencies
    }
    return notUsedAnymore
  }

  const getReloadInstruction = (urlModified) => {
    const ressource = getRessourceByUrl(urlModified)
    if (!ressource) {
      return null
    }
    updateHmrTimestamp(ressource)
    const updatePropagationResult = propagateUpdate(ressource)
    if (updatePropagationResult.declined) {
      return {
        type: "full_reload",
        reason: updatePropagationResult.reason,
        declinedBy: updatePropagationResult.declinedBy
          ? urlToRelativeUrl(
              updatePropagationResult.declinedBy,
              projectDirectoryUrl,
            )
          : undefined,
      }
    }
    return {
      type: "hot_reload",
      timestamp: Date.now(),
      updates: updatePropagationResult.boundaries.map(
        ({ boundary, acceptedBy }) => {
          return {
            type: ressources[boundary].type,
            url: urlToRelativeUrl(boundary, projectDirectoryUrl),
            acceptedBy: urlToRelativeUrl(acceptedBy, projectDirectoryUrl),
          }
        },
      ),
    }
  }

  const updateHmrTimestamp = (ressource, hmr) => {
    const seen = []
    const iterate = (url) => {
      if (seen.includes(url)) {
        return
      }
      seen.push(url)
      const ressource = ressources[url]
      ressource.hmrTimestamp = hmr
      ressource.dependents.forEach((dependentUrl) => {
        const dependent = ressources[dependentUrl]
        if (!dependent.importMetaHotAcceptDependencies.includes(url)) {
          iterate(dependentUrl, hmr)
        }
      })
    }
    iterate(ressource.url)
  }

  const propagateUpdate = (ressource) => {
    const iterate = (ressource, trace) => {
      if (ressource.importMetaHotAcceptSelf) {
        return {
          accepted: true,
          boundaries: [
            {
              boundary: ressource.url,
              acceptedBy: ressource.url,
            },
          ],
        }
      }
      const { dependents } = ressource
      const boundaries = []
      for (const dependentUrl of dependents) {
        const dependent = ressources[dependentUrl]
        if (dependent.importMetaHotDecline) {
          return {
            declined: true,
            reason: `found "import.meta.hot.decline()" while propagating update`,
            declinedBy: dependentUrl,
          }
        }
        if (dependent.importMetaHotAcceptDependencies.includes(ressource.url)) {
          boundaries.push({
            boundary: dependentUrl,
            acceptedBy: ressource.url,
          })
          continue
        }
        if (trace.includes(dependentUrl)) {
          return {
            declined: true,
            reason: "circular dependency",
            declinedBy: dependentUrl,
          }
        }
        const dependentPropagationResult = iterate(dependent, [
          ...trace,
          dependentUrl,
        ])
        if (dependentPropagationResult.declined) {
          return dependentPropagationResult
        }
        boundaries.push(...dependentPropagationResult.boundaries)
      }
      if (boundaries.length === 0) {
        return {
          declined: true,
          reason: `nothing calls "import.meta.hot.accept()" while propagating update`,
        }
      }
      return {
        accepted: true,
        boundaries,
      }
    }
    const trace = []
    return iterate(ressource, trace)
  }

  return {
    applyImportmapResolution,
    applyUrlResolution,
    getRessourceByUrl,
    updateRessourceDependencies,
    getReloadInstruction,
    injectHmrIntoUrl,
  }
}

const createRessource = (url) => {
  return {
    url,
    type: "",
    hmrTimestamp: 0,
    dependencies: new Set(),
    dependents: new Set(),
    hotAcceptSelf: false,
    hotAcceptDependencies: [],
  }
}
