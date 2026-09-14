# Post-Phase 18 Toaster Polish

Watplux now uses the same Base UI toast-manager pattern as the SVITES reference project.

## Changes

- Replaced the Sonner wrapper with `components/ui/toast.tsx` built on `@base-ui/react/toast`.
- Mounted one global toaster in `app/layout.tsx` for storefront and admin routes.
- Added success, error, info, warning, and loading toast variants with semantic Watplux tokens.
- Removed large form-level server feedback blocks from authentication, account security, service request, checkout, product, brand, and category forms.
- Mutation/server errors now use compact toaster feedback while React Hook Form + Zod keep field errors beside their controls.
- Admin service-request transitions now report both success and failure through the same toaster.
- Existing cart, order, inventory, media, refund, catalog lifecycle, user-security, role, variant, specification, and image mutations were moved to the same toast implementation by changing the shared import.
- Removed the obsolete Sonner UI component and legacy form server-message component.
- Extended `audit:ui` so feature code cannot reintroduce direct Sonner usage or the old large form-level server-message pattern.

## UX contract

1. Field-specific validation stays inline and updates in real time.
2. Submit/action pending state stays on the initiating button/control.
3. Successful mutations use a success toast.
4. Server/network failures use an error toast, optionally with a concise description.
5. Persistent business states (for example payment failed or order cancelled) still belong in the page itself; the toaster does not replace durable page state.
