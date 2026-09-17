# Watplux UI & Form System

Watplux uses one UI language across storefront and admin. SVITES was reviewed for composition patterns, but Watplux keeps its own domain boundaries and visual identity.

## Required primitives

Visible interactive controls must come from `components/ui/*` (the project's shadcn layer): `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Dialog`, `Card`, `Alert`, `Table`, and related primitives. Feature code must not style raw `<input>`, `<select>`, `<textarea>`, or `<button>` elements directly.

Native browser capabilities may still exist *inside* a shadcn wrapper (for example the file input rendered by `Input type="file"`).

## Radius hierarchy

Corner radius communicates component scale rather than varying by feature:

- form controls and compact interactive items: 4px;
- mobile controls and menu items: at least 44px tall/tappable, with compact
  sizing permitted from the `sm` breakpoint upward;
- compact panels, alerts and table shells: 6px;
- standard cards, dialogs, menus and toolbars: 8px;
- prominent surfaces and large media containers: 12px;
- pills and circular affordances: fully rounded.

Use the shared `rounded-*` scale so these values remain centralized. Avoid arbitrary radius values in feature code.

## Forms

Meaningful mutating forms use:

1. the domain's existing Zod schema where one exists;
2. React Hook Form;
3. `mode: "onChange"` and `reValidateMode: "onChange"`;
4. shared controlled fields from `components/forms/controlled-fields.tsx`;
5. server validation/use-cases as the authoritative boundary.

Client validation improves feedback; it never replaces server validation.

`emptyAsUndefined` means “leave optional value unspecified”. `emptyAsNull` means “explicitly clear an existing nullable value”. Update forms must choose the correct semantic rather than treating an empty field ambiguously.

## Shared compositions

- `ResourceToolbar`: search + create composition for manageable resources.
- `QueryFilterForm`: URL-backed list filters using React Hook Form and shadcn controls.
- `ControlledSearchSelect`: searchable selection without introducing a second form library.
- `UrlDialog` / `useUrlDialog`: create/edit dialogs represented in the URL with `?dialog=...` and optional `item=...`; browser Back closes/restores dialogs naturally.
- `ConfirmDialog`: destructive confirmation; do not use `window.confirm`.
- `FormServerError` / `FormServerSuccess`: consistent server feedback.
- `MediaImageField`: controlled catalog-media input/upload composition.

## Dialog rule

Use a URL-controlled dialog when create/edit is contextual and does not deserve a full page. Keep full pages for complex flows such as full product creation/editing, checkout, or service-request intake.

Destructive confirmation dialogs are transient and do not need URL state.

## Filters

List filtering is URL-controlled so results remain bookmarkable/shareable. Filter forms may use RHF without a domain Zod schema when they merely serialize query parameters, but validation should be added when ranges or typed constraints matter (the storefront product filters validate price/power ranges in real time).

## Enforcement

Run:

```bash
npm run audit:ui
```

The audit rejects raw visible HTML controls outside the shadcn primitive layer, `window.confirm`, manual `FormData(event.currentTarget)` form scraping, and RHF forms without on-change mode.

## Mutation feedback and toaster

Watplux uses the Base UI toast manager from `components/ui/toast.tsx`, matching the interaction pattern proven in the SVITES project. The provider is mounted once in the root layout so storefront and admin actions share the same feedback layer.

Use inline field messages for validation tied to a specific control. Use `toast.success`, `toast.error`, `toast.warning`, or `toast.info` for mutation outcomes and server/network failures. Do not place large form-level success/error alert blocks above long forms; they move content, are easy to miss after scrolling, and create inconsistent layouts.

Typical mutation flow:

```tsx
try {
  await save(values)
  toast.success("Product saved.")
} catch (error) {
  toast.error("Could not save product", {
    description: error instanceof Error ? error.message : "Please try again.",
  })
}
```

The submit button still communicates pending state. Toasts report the outcome; React Hook Form/Zod reports field-level validity in real time.
