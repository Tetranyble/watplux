"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export type EditableSiteCopy = {
  key: string;
  namespace: string;
  label: string;
  value: string;
  description: string | null;
  multiline: boolean;
};

type Values = Record<string, string>;

export function SiteCopyManager({
  namespace,
  entries,
}: {
  namespace: string;
  entries: EditableSiteCopy[];
}) {
  return <SiteCopySection namespace={namespace} entries={entries} />;
}

function SiteCopySection({
  namespace,
  entries,
}: {
  namespace: string;
  entries: EditableSiteCopy[];
}) {
  const [saving, setSaving] = useState(false);
  const defaults = useMemo(
    () => Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
    [entries],
  );
  const { register, getValues, formState, reset, handleSubmit } =
    useForm<Values>({
      defaultValues: defaults,
      mode: "onChange",
    });

  async function save(values: Values) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/site-copy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: entries.map((entry) => ({
            key: entry.key,
            value: values[entry.key] ?? "",
          })),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Could not save website copy.");
      reset(getValues());
      toast.success("Website copy saved", {
        description: `${entries.length} ${namespace} entries were updated.`,
      });
    } catch (error) {
      toast.error("Could not save website copy", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form
        onSubmit={handleSubmit(save)}
        className="flex flex-col gap-(--card-spacing)"
      >
        <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="capitalize">{namespace}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {entries.length} editable entries
            </p>
          </div>
          <Button
            type="submit"
            className="w-full sm:w-auto"
            disabled={saving || !formState.isDirty || !formState.isValid}
          >
            <Save aria-hidden="true" />
            {saving ? "Saving…" : "Save section"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          {entries.map((entry) => (
            <div
              key={entry.key}
              className={
                entry.multiline ? "space-y-2 lg:col-span-2" : "space-y-2"
              }
            >
              <Label htmlFor={entry.key}>{entry.label}</Label>
              {entry.multiline ? (
                <Textarea
                  id={entry.key}
                  rows={4}
                  {...register(entry.key, { required: "Copy is required." })}
                />
              ) : (
                <Input
                  id={entry.key}
                  {...register(entry.key, { required: "Copy is required." })}
                />
              )}
              <p className="text-xs text-muted-foreground">
                {entry.description ?? <code>{entry.key}</code>}
              </p>
              {formState.errors[entry.key]?.message ? (
                <p className="text-xs text-destructive">
                  {formState.errors[entry.key]?.message}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </form>
    </Card>
  );
}
