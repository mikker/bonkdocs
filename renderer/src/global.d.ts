declare global {
  interface Window {
    Pear: {
      reload: () => void
      teardown: (callback: () => void | Promise<void>) => void
      config: {
        [key: string]: any
      }
    }
  }

  const Pear: Window['Pear']

  namespace JSX {
    interface IntrinsicElements {
      'pear-ctrl': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
    }
  }
}

declare module 'pear-updates' {
  export default function updates(
    callback: (update: {
      diff: Array<{ key: string; [key: string]: any }>
      [key: string]: any
    }) => void
  ): void
}

declare module 'pear-run' {
  interface Worker {
    destroy: () => Promise<void>
    [key: string]: any
  }
  function run(path: string): Worker
  export default run
}

declare module 'framed-stream' {
  class FramedStream {
    constructor(stream: any)
    [key: string]: any
  }
  export default FramedStream
}

declare module '../../../spec/hrpc/index.js' {
  class HRPC {
    constructor(stream: any)
    [key: string]: any
  }
  export default HRPC
}

export {}
