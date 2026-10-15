/// <reference types="vite/client" />

import type { CadDocument } from './core/model'
import type { performanceReport } from './runtime/performance'

declare global {
  interface Window {
    __PARALLAX_TEST__?: Readonly<{ performanceReport: typeof performanceReport; document: () => CadDocument }>
  }
}
