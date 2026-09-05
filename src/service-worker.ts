/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') void self.skipWaiting()
})

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))
