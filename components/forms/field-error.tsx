import type { FieldError } from "react-hook-form";

export function FieldErrorMessage({
  error,
  id,
}: {
  error?: FieldError;
  id?: string;
}) {
  if (!error?.message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {error.message}
    </p>
  );
}
