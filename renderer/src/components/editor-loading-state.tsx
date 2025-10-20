import { Skeleton } from '@/components/ui/skeleton'

const PARAGRAPH_COUNT = 4

export function EditorLoadingState() {
  return (
    <div className='flex h-full items-center justify-center p-8'>
      <div className='flex w-full max-w-3xl flex-col gap-8'>
        <div className='flex flex-col items-center gap-3'>
          <Skeleton className='h-8 w-3/4 max-w-xl' />
          <Skeleton className='h-4 w-2/3 max-w-md opacity-80' />
        </div>
        <div className='space-y-6'>
          {Array.from({ length: PARAGRAPH_COUNT }).map((_, index) => (
            <div key={index} className='space-y-3'>
              <Skeleton className='h-4 w-11/12' />
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-4 w-10/12' />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
