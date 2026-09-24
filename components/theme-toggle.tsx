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
import { interpolateCopy } from "@/src/modules/site-copy/copy";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type ThemeCopy = {
  changeAria: string;
  current: string;
  light: string;
  dark: string;
  system: string;
};

const adminCopy: ThemeCopy = {
  changeAria: "Change color theme",
  current: "Color theme: {theme}",
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ThemeToggle({ copy = adminCopy }: { copy?: ThemeCopy }) {
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
        aria-label={copy.changeAria}
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
            aria-label={interpolateCopy(copy.current, { theme: selectedTheme })}
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
            {copy.light}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem
            value="dark"
            closeOnClick
            className="gap-3 px-3 py-2.5"
          >
            <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
            {copy.dark}
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
            {copy.system}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
