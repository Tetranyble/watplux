"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  type Control,
  type FieldPath,
  type FieldValues,
  useController,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
};

type FieldShellProps = {
  id: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
};

export function FieldShell({
  id,
  label,
  description,
  error,
  required,
  children,
  className,
}: FieldShellProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div
      className={cn("grid gap-1.5", className)}
      data-invalid={Boolean(error)}
    >
      {label ? (
        <Label htmlFor={id} className={cn(error && "text-destructive")}>
          {label}
          {required ? (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children}
      {description ? (
        <p
          id={descriptionId}
          className="text-xs leading-5 text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs font-medium text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BaseControlledProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label?: string;
  description?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
};

type ControlledInputProps<T extends FieldValues> = BaseControlledProps<T> &
  Omit<
    React.ComponentProps<typeof Input>,
    "name" | "value" | "defaultValue" | "onChange" | "disabled"
  > & {
    emptyAsUndefined?: boolean;
    emptyAsNull?: boolean;
    valueAsNumber?: boolean;
  };

export function ControlledInput<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  required,
  emptyAsUndefined = false,
  emptyAsNull = false,
  valueAsNumber = false,
  ...inputProps
}: ControlledInputProps<T>) {
  const {
    field: { name: fieldName, ref: fieldRef, value, onBlur, onChange },
    fieldState,
  } = useController({ control, name });
  const id = inputProps.id ?? String(name).replace(/\./g, "-");
  const describedBy =
    [
      description ? `${id}-description` : null,
      fieldState.error ? `${id}-error` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <FieldShell
      id={id}
      label={label}
      description={description}
      error={fieldState.error?.message}
      required={required}
      className={className}
    >
      <Input
        {...inputProps}
        id={id}
        name={fieldName}
        ref={fieldRef}
        disabled={disabled}
        value={value == null ? "" : String(value)}
        onBlur={onBlur}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "" && emptyAsNull) {
            onChange(null);
            return;
          }
          if (emptyAsUndefined && raw === "") {
            onChange(undefined);
            return;
          }
          if (valueAsNumber) {
            onChange(raw === "" ? undefined : Number(raw));
            return;
          }
          onChange(raw);
        }}
        aria-invalid={fieldState.invalid}
        aria-describedby={describedBy}
      />
    </FieldShell>
  );
}

type ControlledTextareaProps<T extends FieldValues> = BaseControlledProps<T> &
  Omit<
    React.ComponentProps<typeof Textarea>,
    "name" | "value" | "defaultValue" | "onChange" | "disabled"
  > & {
    emptyAsUndefined?: boolean;
    emptyAsNull?: boolean;
  };

export function ControlledTextarea<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  required,
  emptyAsUndefined = false,
  emptyAsNull = false,
  ...props
}: ControlledTextareaProps<T>) {
  const {
    field: { name: fieldName, ref: fieldRef, value, onBlur, onChange },
    fieldState,
  } = useController({ control, name });
  const id = props.id ?? String(name).replace(/\./g, "-");
  return (
    <FieldShell
      id={id}
      label={label}
      description={description}
      error={fieldState.error?.message}
      required={required}
      className={className}
    >
      <Textarea
        {...props}
        id={id}
        name={fieldName}
        ref={fieldRef}
        disabled={disabled}
        value={value == null ? "" : String(value)}
        onBlur={onBlur}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(
            raw === "" && emptyAsNull
              ? null
              : raw === "" && emptyAsUndefined
                ? undefined
                : raw,
          );
        }}
        aria-invalid={fieldState.invalid}
        aria-describedby={
          fieldState.error
            ? `${id}-error`
            : description
              ? `${id}-description`
              : undefined
        }
      />
    </FieldShell>
  );
}

type ControlledSelectProps<T extends FieldValues> = BaseControlledProps<T> & {
  options: readonly SelectOption[];
  placeholder?: string;
  clearValue?: string;
  clearLabel?: string;
  clearResult?: "null" | "undefined" | "value";
  emptyAsUndefined?: boolean;
  triggerClassName?: string;
};

export function ControlledSelect<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  required,
  options,
  placeholder,
  clearValue,
  clearLabel = "None",
  clearResult,
  emptyAsUndefined = false,
  triggerClassName,
}: ControlledSelectProps<T>) {
  const { field, fieldState } = useController({ control, name });
  const id = String(name).replace(/\./g, "-");
  const rawValue = field.value == null ? "" : String(field.value);
  const selectValue = rawValue || clearValue || undefined;

  return (
    <FieldShell
      id={id}
      label={label}
      description={description}
      error={fieldState.error?.message}
      required={required}
      className={className}
    >
      <Select
        value={selectValue}
        disabled={disabled}
        onValueChange={(value) => {
          if (clearValue && value === clearValue) {
            const result =
              clearResult ?? (emptyAsUndefined ? "undefined" : "null");
            field.onChange(
              result === "value"
                ? clearValue
                : result === "undefined"
                  ? undefined
                  : null,
            );
          } else {
            field.onChange(value);
          }
          field.onBlur();
        }}
      >
        <SelectTrigger
          id={id}
          className={cn("w-full", triggerClassName)}
          aria-invalid={fieldState.invalid}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {clearValue ? (
            <SelectItem value={clearValue}>{clearLabel}</SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

export function ControlledCheckbox<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  compact = false,
}: BaseControlledProps<T> & { compact?: boolean }) {
  const { field, fieldState } = useController({ control, name });
  const id = String(name).replace(/\./g, "-");
  return (
    <FieldShell
      id={id}
      description={description}
      error={fieldState.error?.message}
      className={className}
    >
      <div
        className={cn(
          "flex gap-2.5 rounded-lg border bg-card",
          compact ? "h-8 items-center px-2.5" : "items-start p-3",
        )}
      >
        <Checkbox
          id={id}
          checked={Boolean(field.value)}
          disabled={disabled}
          onCheckedChange={(checked) => field.onChange(Boolean(checked))}
          aria-invalid={fieldState.invalid}
        />
        <Label htmlFor={id} className="cursor-pointer font-normal leading-4">
          {label}
        </Label>
      </div>
    </FieldShell>
  );
}

/**
 * Searchable RHF select composed from Watplux's shadcn primitives. It is
 * intentionally dependency-free: no second combobox library is introduced.
 */
export function ControlledSearchSelect<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
  disabled,
  required,
  options,
  placeholder = "Select an option",
  clearValue,
  clearLabel = "None",
  clearResult,
  emptyAsUndefined = false,
}: ControlledSelectProps<T>) {
  const { field, fieldState } = useController({ control, name });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const id = String(name).replace(/\./g, "-");
  const current = field.value == null ? "" : String(field.value);
  const selected = options.find((option) => option.value === current);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [options, query]);

  function choose(value: string | null, isClear = false) {
    if (isClear) {
      const result = clearResult ?? (emptyAsUndefined ? "undefined" : "null");
      field.onChange(
        result === "value"
          ? clearValue
          : result === "undefined"
            ? undefined
            : null,
      );
    } else {
      field.onChange(value);
    }
    field.onBlur();
    setOpen(false);
    setQuery("");
  }

  return (
    <FieldShell
      id={id}
      label={label}
      description={description}
      error={fieldState.error?.message}
      required={required}
      className={className}
    >
      <div
        ref={rootRef}
        className="relative"
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
            field.onBlur();
          }
        }}
      >
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-invalid={fieldState.invalid}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "w-full justify-between font-normal",
            fieldState.invalid && "border-destructive ring-destructive/20",
          )}
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected?.label ??
              (clearValue && (current === clearValue || !current)
                ? clearLabel
                : placeholder)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
        {open ? (
          <div className="absolute z-50 mt-1 w-full min-w-56 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <div className="flex items-center gap-2 border-b px-2 pb-1.5">
              <Search className="size-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                }}
                placeholder="Search…"
                className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
            </div>
            <div
              id={`${id}-listbox`}
              className="max-h-64 overflow-y-auto py-1"
              role="listbox"
            >
              {clearValue ? (
                <Button
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={!current || current === clearValue}
                  onClick={() => choose(null, true)}
                  className="h-auto w-full justify-start gap-2 px-2 py-2 font-normal"
                >
                  <Check
                    className={cn(
                      "size-4",
                      current && current !== clearValue
                        ? "opacity-0"
                        : "opacity-100",
                    )}
                  />
                  {clearLabel}
                </Button>
              ) : null}
              {filtered.map((option) => (
                <Button
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={current === option.value}
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => choose(option.value)}
                  className="h-auto w-full justify-start gap-2 px-2 py-2 font-normal"
                >
                  <Check
                    className={cn(
                      "size-4",
                      current === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </Button>
              ))}
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No matching options.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </FieldShell>
  );
}
