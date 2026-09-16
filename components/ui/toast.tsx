"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

const manager = ToastPrimitive.createToastManager();

type ToastKind = "success" | "error" | "info" | "warning" | "loading";
type ToastOptions = { description?: string };

function addToast(type: ToastKind, title: string, options?: ToastOptions) {
  return manager.add({ title, description: options?.description, type });
}

const toast = Object.assign(manager, {
  success: (title: string, options?: ToastOptions) =>
    addToast("success", title, options),
  error: (title: string, options?: ToastOptions) =>
    addToast("error", title, options),
  info: (title: string, options?: ToastOptions) => addToast("info", title, options),
  warning: (title: string, options?: ToastOptions) =>
    addToast("warning", title, options),
  loading: (title: string, options?: ToastOptions) =>
    addToast("loading", title, options),
});

function ToastIcon({ type }: { type?: string }) {
  const common = "size-4 shrink-0";

  if (type === "success") {
    return (
      <CircleCheck
        aria-hidden="true"
        className={cn(common, "text-success")}
      />
    );
  }
  if (type === "error") {
    return (
      <OctagonX
        aria-hidden="true"
        className={cn(common, "text-destructive")}
      />
    );
  }
  if (type === "warning") {
    return (
      <TriangleAlert
        aria-hidden="true"
        className={cn(common, "text-warning")}
      />
    );
  }
  if (type === "info") {
    return (
      <Info aria-hidden="true" className={cn(common, "text-primary-emphasis")} />
    );
  }
  if (type === "loading") {
    return (
      <Loader2
        aria-hidden="true"
        className={cn(common, "animate-spin text-primary-emphasis")}
      />
    );
  }

  return null;
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return toasts.map((item) => (
    <ToastPrimitive.Root
      key={item.id}
      toast={item}
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none select-none",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
      )}
    >
      <ToastPrimitive.Content className="flex h-full items-center gap-3 overflow-hidden p-4">
        <ToastIcon type={item.type} />
        <div className="min-w-0 flex-1">
          <ToastPrimitive.Title className="text-sm font-semibold" />
          <ToastPrimitive.Description className="mt-1 text-sm text-muted-foreground" />
        </div>
        <ToastPrimitive.Close
          aria-label="Close notification"
          className="relative shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </ToastPrimitive.Close>
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  ));
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} {...props}>
      {children}
      <ToastPrimitive.Portal>
        <ToastPrimitive.Viewport className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full">
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  );
}

export { Toaster, toast };
