import { fetchJson } from "../../browser-utils/fetchJson.js"
import { computeCompileIdFromGroupId } from "../computeCompileIdFromGroupId.js"
import { resolveBrowserGroup } from "../resolveBrowserGroup.js"

export const scanBrowserRuntimeFeatures = async ({
  coverageInstrumentationRequired = true,
  failFastOnFeatureDetection = false,
} = {}) => {
  const { outDirectoryRelativeUrl } = await fetchJson(
    "/.jsenv/compile-meta.json",
  )
  const groupMapUrl = `/${outDirectoryRelativeUrl}groupMap.json`
  const envFileUrl = `/${outDirectoryRelativeUrl}env.json`
  const [groupMap, envJson] = await Promise.all([
    fetchJson(groupMapUrl),
    fetchJson(envFileUrl),
  ])

  const compileId = computeCompileIdFromGroupId({
    groupId: resolveBrowserGroup(groupMap),
    groupMap,
  })
  const groupInfo = groupMap[compileId]
  const { inlineImportMapIntoHTML, customCompilerNames, convertPatterns } =
    envJson

  const featuresReport = {
    babelPluginRequiredNames: babelPluginRequiredNamesFromGroupInfo(groupInfo, {
      coverageInstrumentationRequired,
    }),
    ...(await getFeaturesReport({
      failFastOnFeatureDetection,
      groupInfo,
      inlineImportMapIntoHTML,
      customCompilerNames,
      coverageInstrumentationRequired,
    })),
    customCompilerNames,
    convertPatterns,
  }

  const canAvoidCompilation =
    featuresReport.convertPatterns.length === 0 &&
    featuresReport.customCompilerNames.length === 0 &&
    featuresReport.jsenvPluginRequiredNames.length === 0 &&
    featuresReport.babelPluginRequiredNames.length === 0 &&
    featuresReport.importmapSupported &&
    featuresReport.dynamicImportSupported &&
    featuresReport.topLevelAwaitSupported

  return {
    featuresReport,
    canAvoidCompilation,
    inlineImportMapIntoHTML,
    outDirectoryRelativeUrl,
    compileId,
  }
}

const getFeaturesReport = async ({
  failFastOnFeatureDetection,
  groupInfo,
  inlineImportMapIntoHTML,
}) => {
  const featuresReport = {
    jsenvPluginRequiredNames: [],
    importmapSupported: undefined,
    dynamicImportSupported: undefined,
    topLevelAwaitSupported: undefined,
  }

  const jsenvPluginRequiredNames = groupInfo.jsenvPluginRequiredNameArray
  featuresReport.jsenvPluginRequiredNames = jsenvPluginRequiredNames
  if (jsenvPluginRequiredNames.length > 0 && failFastOnFeatureDetection) {
    return featuresReport
  }

  // start testing importmap support first and not in paralell
  // so that there is not module script loaded beore importmap is injected
  // it would log an error in chrome console and return undefined
  const importmapSupported = await supportsImportmap({
    // chrome supports inline but not remote importmap
    // https://github.com/WICG/import-maps/issues/235

    // at this stage we won't know if the html file will use
    // an importmap or not and if that importmap is inline or specified with an src
    // so we should test if browser support local and remote importmap.
    // But there exploring server can inline importmap by transforming html
    // and in that case we can test only the local importmap support
    // so we test importmap support and the remote one
    remote: !inlineImportMapIntoHTML,
  })
  featuresReport.importmapSupported = importmapSupported
  if (!importmapSupported && failFastOnFeatureDetection) {
    return featuresReport
  }

  const dynamicImportSupported = await supportsDynamicImport()
  featuresReport.dynamicImportSupported = dynamicImportSupported
  if (!dynamicImportSupported && failFastOnFeatureDetection) {
    return featuresReport
  }

  const topLevelAwaitSupported = await supportsTopLevelAwait()
  featuresReport.topLevelAwaitSupported = topLevelAwaitSupported
  return featuresReport
}

const babelPluginRequiredNamesFromGroupInfo = (
  groupInfo,
  { coverageInstrumentationRequired },
) => {
  const { babelPluginRequiredNameArray } = groupInfo

  const babelPluginRequiredNames = babelPluginRequiredNameArray.slice()

  // When instrumentation CAN be handed by playwright
  // https://playwright.dev/docs/api/class-chromiumcoverage#chromiumcoveragestartjscoverageoptions
  // coverageInstrumentationRequired is false and "transform-instrument" becomes non mandatory
  const transformInstrumentIndex = babelPluginRequiredNames.indexOf(
    "transform-instrument",
  )
  if (transformInstrumentIndex > -1 && !coverageInstrumentationRequired) {
    babelPluginRequiredNames.splice(transformInstrumentIndex, 1)
  }

  return babelPluginRequiredNames
}

const supportsImportmap = async ({ remote = true } = {}) => {
  const specifier = jsToTextUrl(`export default false`)

  const importMap = {
    imports: {
      [specifier]: jsToTextUrl(`export default true`),
    },
  }

  const importmapScript = document.createElement("script")
  const importmapString = JSON.stringify(importMap, null, "  ")
  importmapScript.type = "importmap"
  if (remote) {
    importmapScript.src = `data:application/json;base64,${window.btoa(
      importmapString,
    )}`
  } else {
    importmapScript.textContent = importmapString
  }

  document.body.appendChild(importmapScript)

  const scriptModule = document.createElement("script")
  scriptModule.type = "module"
  scriptModule.src = jsToTextUrl(
    `import supported from "${specifier}"; window.__importmap_supported = supported`,
  )

  return new Promise((resolve, reject) => {
    scriptModule.onload = () => {
      const supported = window.__importmap_supported
      delete window.__importmap_supported
      document.body.removeChild(scriptModule)
      document.body.removeChild(importmapScript)
      resolve(supported)
    }
    scriptModule.onerror = () => {
      document.body.removeChild(scriptModule)
      document.body.removeChild(importmapScript)
      reject()
    }
    document.body.appendChild(scriptModule)
  })
}

const jsToTextUrl = (js) => {
  return `data:text/javascript;base64,${window.btoa(js)}`
}

const supportsDynamicImport = async () => {
  const moduleSource = jsToTextUrl(`export default 42`)
  try {
    const namespace = await import(moduleSource)
    return namespace.default === 42
  } catch (e) {
    return false
  }
}

const supportsTopLevelAwait = async () => {
  const moduleSource = jsToTextUrl(`export default await Promise.resolve(42)`)
  try {
    const namespace = await import(moduleSource)
    return namespace.default === 42
  } catch (e) {
    return false
  }
}
