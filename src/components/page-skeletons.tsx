import {
  Skeleton,
  SkeletonBar,
  SkeletonCard,
  SkeletonHeading,
  SkeletonLines,
  SkeletonRows,
} from "@/components/skeleton";

function Status({ label }: { label: string }) {
  return (
    <span className="sr-only" role="status">
      {label}
    </span>
  );
}

export function DiarySkeleton() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-6" aria-busy="true">
      <Status label="Loading diary" />
      <div className="mb-4 flex items-end justify-between gap-3">
        <SkeletonHeading />
        <Skeleton className="h-3 w-32" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_420px] lg:items-start">
        <SkeletonCard>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-56" />
          <Skeleton className="mt-4 h-11 w-full rounded-xl" />
          <div className="mt-4 space-y-4">
            <SkeletonRows count={6} />
          </div>
        </SkeletonCard>

        <div className="space-y-4">
          <SkeletonCard>
            <div className="flex items-baseline justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="mt-4 h-9 w-32" />
            <SkeletonBar />
            <div className="mt-5 space-y-5">
              {Array.from({ length: 3 }, (_, group) => (
                <div key={group}>
                  <Skeleton className="mb-2 h-2.5 w-16" />
                  <SkeletonRows count={4} />
                </div>
              ))}
            </div>
          </SkeletonCard>
          <SkeletonCard>
            <Skeleton className="h-4 w-20" />
            <div className="mt-3">
              <SkeletonLines count={3} />
            </div>
          </SkeletonCard>
        </div>
      </div>
    </main>
  );
}

export function PlanSkeleton() {
  return (
    <main className="mx-auto max-w-7xl px-5 py-6" aria-busy="true">
      <Status label="Loading plan" />
      <div className="mb-4 flex items-end justify-between gap-3">
        <SkeletonHeading />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>

      <SkeletonCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-8 w-44 rounded-lg" />
          <Skeleton className="h-8 w-56 rounded-lg" />
        </div>
        <Skeleton className="mt-3 h-3 w-72" />
        <div className="mt-3 flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-40 rounded-lg" />
          ))}
        </div>
      </SkeletonCard>

      {/* Day-chip strip + single day below xl; the full seven-column
          week at xl and up (mirrors plan-board's breakpoint). */}
      <section className="mt-4 pb-1 xl:hidden">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: 7 }, (_, day) => (
            <Skeleton key={day} className="h-11 w-[74px] shrink-0 rounded-xl" />
          ))}
        </div>
        <div className="mx-auto mt-2 max-w-2xl rounded-xl border border-line bg-surface p-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="mt-2 h-5 w-16" />
          <SkeletonBar />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }, (_, slot) => (
              <div key={slot} className="rounded-lg border border-dashed border-line p-1">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="mt-1.5 h-9 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-4 hidden overflow-x-auto pb-1 xl:block">
        <div className="grid min-w-[960px] grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, day) => (
            <div key={day} className="rounded-xl border border-line bg-surface p-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="mt-2 h-5 w-16" />
              <SkeletonBar />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 4 }, (_, slot) => (
                  <div key={slot} className="rounded-lg border border-dashed border-line p-1">
                    <Skeleton className="h-2.5 w-14" />
                    <Skeleton className="mt-1.5 h-9 w-full rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_420px]">
        <SkeletonCard>
          <Skeleton className="h-4 w-24" />
          <div className="mt-4">
            <SkeletonLines count={4} />
          </div>
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-4 h-9 w-24" />
          <SkeletonBar />
          <div className="mt-5">
            <SkeletonRows count={8} />
          </div>
        </SkeletonCard>
      </div>
    </main>
  );
}

export function ProfileSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6" aria-busy="true">
      <Status label="Loading profile" />
      <SkeletonHeading />
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        <SkeletonCard>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-64" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index}>
                <Skeleton className="mb-1 h-2.5 w-20" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-4 h-9 w-28 rounded-lg" />
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-3 h-20 w-full rounded-xl" />
          <div className="mt-4">
            <SkeletonRows count={7} />
          </div>
        </SkeletonCard>
      </div>
    </main>
  );
}

export function RecipesSkeleton() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-6" aria-busy="true">
      <Status label="Loading recipes" />
      <div className="flex items-end justify-between gap-3">
        <SkeletonHeading />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index}>
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-8 rounded-md" />
            </div>
            <Skeleton className="mt-4 h-6 w-24" />
            <Skeleton className="mt-2 h-3 w-20" />
          </SkeletonCard>
        ))}
      </div>
    </main>
  );
}

export function RecipeSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-6" aria-busy="true">
      <Status label="Loading recipe" />
      <SkeletonHeading />
      <div className="mt-4 grid gap-4 sm:grid-cols-[1.1fr_1fr]">
        <SkeletonCard>
          <Skeleton className="h-10 w-32" />
          <Skeleton className="mt-3 h-3 w-48" />
          <div className="mt-5">
            <SkeletonRows count={6} />
          </div>
        </SkeletonCard>
        <SkeletonCard>
          <Skeleton className="h-3 w-32" />
          <div className="mt-3">
            <SkeletonLines count={4} />
          </div>
        </SkeletonCard>
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonCard key={index}>
            <Skeleton className="h-4 w-40" />
            <div className="mt-3">
              <SkeletonRows count={2} />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </main>
  );
}
