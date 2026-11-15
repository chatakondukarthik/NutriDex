import { cn } from "@/lib/cn";

/** A single shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton", className)} />;
}

/** A card-shaped placeholder, used by the route-level loading files. */
export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-surface p-5 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SkeletonHeading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-36" />
      <Skeleton className="h-3 w-52" />
    </div>
  );
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-3", index % 3 === 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonBar() {
  return <Skeleton className="h-2 w-full rounded-full" />;
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
