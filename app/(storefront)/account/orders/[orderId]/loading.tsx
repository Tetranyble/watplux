import { Skeleton } from "@/components/ui/skeleton";

export default function OrderDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Skeleton className="mb-6 h-8 w-48" />
      <Skeleton className="mb-8 h-40" />
      <Skeleton className="h-24" />
    </div>
  );
}
