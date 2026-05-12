declare global {
  interface Window {
    bridge: {
      pkg: () => Record<string, any>
      applyUpdate: () => Promise<unknown>
      appRestart: () => Promise<unknown>
      onPearEvent: (
        name: string,
        listener: (eventName?: string) => void
      ) => () => void
      startWorker: (specifier: string) => Promise<unknown>
      onWorkerIPC: (
        specifier: string,
        listener: (data: Uint8Array) => void
      ) => () => void
      onWorkerExit: (
        specifier: string,
        listener: (code: number) => void
      ) => () => void
      writeWorkerIPC: (specifier: string, data: Uint8Array) => Promise<unknown>
    }
  }
}

declare module '../../../packages/bonkdocs-core/hrpc.js' {
  class HRPC {
    constructor(stream: any)
    [key: string]: any
  }
  export default HRPC
}

export {}
