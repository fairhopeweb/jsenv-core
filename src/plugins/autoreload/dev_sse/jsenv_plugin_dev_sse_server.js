import { urlToRelativeUrl } from "@jsenv/urls"

export const jsenvPluginDevSSEServer = ({
  clientFileChangeCallbackList,
  clientFilesPruneCallbackList,
}) => {
  return {
    name: "jsenv:sse_server",
    appliesDuring: { dev: true },
    registerServerEvents: (
      { sendServerEvent },
      { rootDirectoryUrl, urlGraph },
    ) => {
      const notifyDeclined = ({ cause, reason, declinedBy }) => {
        sendServerEvent({
          type: "reload",
          data: JSON.stringify({
            cause,
            type: "full",
            typeReason: reason,
            declinedBy,
          }),
        })
      }
      const notifyAccepted = ({ cause, reason, instructions }) => {
        sendServerEvent({
          type: "reload",
          data: JSON.stringify({
            cause,
            type: "hot",
            typeReason: reason,
            hotInstructions: instructions,
          }),
        })
      }
      const propagateUpdate = (firstUrlInfo) => {
        const iterate = (urlInfo, trace) => {
          if (urlInfo.data.hotAcceptSelf) {
            return {
              accepted: true,
              reason:
                urlInfo === firstUrlInfo
                  ? `file accepts hot reload`
                  : `a dependent file accepts hot reload`,
              instructions: [
                {
                  type: urlInfo.type,
                  boundary: urlToRelativeUrl(urlInfo.url, rootDirectoryUrl),
                  acceptedBy: urlToRelativeUrl(urlInfo.url, rootDirectoryUrl),
                },
              ],
            }
          }
          const { dependents } = urlInfo
          const instructions = []
          for (const dependentUrl of dependents) {
            const dependentUrlInfo = urlGraph.getUrlInfo(dependentUrl)
            if (dependentUrlInfo.data.hotDecline) {
              return {
                declined: true,
                reason: `a dependent file declines hot reload`,
                declinedBy: dependentUrl,
              }
            }
            const { hotAcceptDependencies = [] } = dependentUrlInfo.data
            if (hotAcceptDependencies.includes(urlInfo.url)) {
              instructions.push({
                type: dependentUrlInfo.type,
                boundary: urlToRelativeUrl(dependentUrl, rootDirectoryUrl),
                acceptedBy: urlToRelativeUrl(urlInfo.url, rootDirectoryUrl),
              })
              continue
            }
            if (trace.includes(dependentUrl)) {
              return {
                declined: true,
                reason: "circular dependency",
                declinedBy: urlToRelativeUrl(dependentUrl, rootDirectoryUrl),
              }
            }
            const dependentPropagationResult = iterate(dependentUrlInfo, [
              ...trace,
              dependentUrl,
            ])
            if (dependentPropagationResult.accepted) {
              instructions.push(...dependentPropagationResult.instructions)
              continue
            }
            if (
              // declined explicitely by an other file, it must decline the whole update
              dependentPropagationResult.declinedBy
            ) {
              return dependentPropagationResult
            }
            // declined by absence of boundary, we can keep searching
            continue
          }
          if (instructions.length === 0) {
            return {
              declined: true,
              reason: `there is no file accepting hot reload while propagating update`,
            }
          }
          return {
            accepted: true,
            reason: `${instructions.length} dependent file(s) accepts hot reload`,
            instructions,
          }
        }
        const trace = []
        return iterate(firstUrlInfo, trace)
      }
      clientFileChangeCallbackList.push(({ url, event }) => {
        const urlInfo = urlGraph.getUrlInfo(url)
        // file not part of dependency graph
        if (!urlInfo) {
          return
        }
        const relativeUrl = urlToRelativeUrl(url, rootDirectoryUrl)
        const hotUpdate = propagateUpdate(urlInfo)
        if (hotUpdate.declined) {
          notifyDeclined({
            cause: `${relativeUrl} ${event}`,
            reason: hotUpdate.reason,
            declinedBy: hotUpdate.declinedBy,
          })
        } else {
          notifyAccepted({
            cause: `${relativeUrl} ${event}`,
            reason: hotUpdate.reason,
            instructions: hotUpdate.instructions,
          })
        }
      })
      clientFilesPruneCallbackList.push(({ prunedUrlInfos, firstUrlInfo }) => {
        const mainHotUpdate = propagateUpdate(firstUrlInfo)
        const cause = `following files are no longer referenced: ${prunedUrlInfos.map(
          (prunedUrlInfo) =>
            urlToRelativeUrl(prunedUrlInfo.url, rootDirectoryUrl),
        )}`
        // now check if we can hot update the main ressource
        // then if we can hot update all dependencies
        if (mainHotUpdate.declined) {
          notifyDeclined({
            cause,
            reason: mainHotUpdate.reason,
            declinedBy: mainHotUpdate.declinedBy,
          })
          return
        }
        // main can hot update
        let i = 0
        const instructions = []
        while (i < prunedUrlInfos.length) {
          const prunedUrlInfo = prunedUrlInfos[i++]
          if (prunedUrlInfo.data.hotDecline) {
            notifyDeclined({
              cause,
              reason: `a pruned file declines hot reload`,
              declinedBy: urlToRelativeUrl(prunedUrlInfo.url, rootDirectoryUrl),
            })
            return
          }
          instructions.push({
            type: "prune",
            boundary: urlToRelativeUrl(prunedUrlInfo.url, rootDirectoryUrl),
            acceptedBy: urlToRelativeUrl(firstUrlInfo.url, rootDirectoryUrl),
          })
        }
        notifyAccepted({
          cause,
          reason: mainHotUpdate.reason,
          instructions,
        })
      })
    },
    serve: (request, { rootDirectoryUrl, urlGraph }) => {
      if (request.ressource === "/__graph__") {
        const graphJson = JSON.stringify(urlGraph.toJSON(rootDirectoryUrl))
        return {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(graphJson),
          },
          body: graphJson,
        }
      }
      return null
    },
  }
}
