import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="gap-2">
        <CardDescription className="text-xs font-semibold uppercase tracking-[0.1em]">
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-bold tracking-tight sm:text-3xl">
          {value}
        </CardTitle>
        {hint ? (
          <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
        ) : null}
      </CardHeader>
    </Card>
  );
}
