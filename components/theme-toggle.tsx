"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-10"
        aria-label="Change color theme"
        disabled
      >
        <Sun className="size-4" aria-hidden="true" />
      </Button>
    );
  }

  const selectedTheme = theme ?? "system";
  const ThemeIcon =
    selectedTheme === "system"
      ? Monitor
      : selectedTheme === "dark"
        ? Moon
        : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label={`Color theme: ${selectedTheme}`}
          />
        }
      >
        <ThemeIcon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-48 border border-border bg-background p-1.5 text-foreground shadow-lg"
      >
        <DropdownMenuRadioGroup
          value={selectedTheme}
          onValueChange={(value) => setTheme(String(value))}
        >
          <DropdownMenuRadioItem
            value="light"
            closeOnClick
            className="gap-3 px-3 py-2.5"
          >
            <Sun className="size-4 text-muted-foreground" aria-hidden="true" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="dark"
            closeOnClick
            className="gap-3 px-3 py-2.5"
          >
            <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="system"
            closeOnClick
            className="gap-3 px-3 py-2.5"
          >
            <Monitor
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
