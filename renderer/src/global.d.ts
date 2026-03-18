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
      onWorkerStdout: (
        specifier: string,
        listener: (data: Uint8Array) => void
      ) => () => void
      onWorkerStderr: (
        specifier: string,
        listener: (data: Uint8Array) => void
      ) => () => void
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

    Pear: {
      reload: () => void
      teardown: (callback: () => void | Promise<void>) => void
      config: {
        [key: string]: any
      }
    }
  }

  const Pear: Window['Pear']
}

declare module '../../../spec/hrpc/index.js' {
  class HRPC {
    constructor(stream: any)
    [key: string]: any
  }
  export default HRPC
}

export {}
