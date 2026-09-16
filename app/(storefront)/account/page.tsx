import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarCheck,
  LogOut,
  PackageCheck,
  ShoppingCart,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import {
  logoutAction,
  logoutAllAction,
} from "@/app/(storefront)/account/actions";
import { AvatarUpload } from "@/app/(storefront)/account/avatar-upload";
import { ChangePasswordForm } from "@/app/(storefront)/account/change-password-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/session";
import { toSafeUser } from "@/src/modules/auth/types";

export const instant = false;

/**
 * Customer control centre. Authentication is resolved on the server through
 * Better Auth; this page never derives identity from browser-provided data.
 */
export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/account");

  const safeUser = toSafeUser(user);

  return (
    <div className="page-shell py-10 lg:py-14">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="outline" className="mb-3">
            Your account
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome back, {safeUser.name.split(" ")[0] || safeUser.name}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Track purchases, continue shopping, and manage the sessions
            connected to your account.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/products" />}>
          Browse products
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
        <div className="grid gap-5 sm:grid-cols-2">
          <Card className="sm:col-span-2">
            <CardHeader className="flex-row items-start gap-4 space-y-0">
              <div className="rounded-xl border bg-muted/40 p-3">
                <UserRound className="size-5" />
              </div>
              <div>
                <CardTitle>Account details</CardTitle>
                <CardDescription>
                  Your identity is managed securely through Better Auth.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <AvatarUpload
                  name={safeUser.name}
                  email={safeUser.email}
                  image={safeUser.image}
                />
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </p>
                <p className="mt-1 font-medium">{safeUser.name}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <p className="mt-1 break-all font-medium">{safeUser.email}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <PackageCheck className="mb-2 size-5" />
              <CardTitle className="text-lg">Your orders</CardTitle>
              <CardDescription>
                Review orders, payment attempts and delivery details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                nativeButton={false}
                render={<Link href="/account/orders" />}
              >
                View orders
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CalendarCheck className="mb-2 size-5" />
              <CardTitle className="text-lg">Service requests</CardTitle>
              <CardDescription>
                Track solar consultations and installation requests.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                nativeButton={false}
                render={<Link href="/account/service-requests" />}
              >
                View requests
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <ShoppingCart className="mb-2 size-5" />
              <CardTitle className="text-lg">Shopping cart</CardTitle>
              <CardDescription>
                Return to the cart you are building and continue to checkout.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                nativeButton={false}
                render={<Link href="/cart" />}
              >
                Open cart
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid h-fit gap-5">
          <Card>
            <CardHeader>
              <ShieldCheck className="mb-2 size-5" />
              <CardTitle>Password</CardTitle>
              <CardDescription>
                Changing it also revokes your other active sessions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>
                End this session or revoke every active session for your
                account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form action={logoutAction}>
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full justify-start gap-2"
                >
                  <LogOut className="size-4" /> Log out
                </Button>
              </form>
              <form action={logoutAllAction}>
                <Button type="submit" variant="destructive" className="w-full">
                  Log out of all devices
                </Button>
              </form>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Use “log out of all devices” if you no longer recognise a
                signed-in device.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
