import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type MultiSelectOption = { value: string; label: string; hint?: string };

/**
 * Checklist-in-a-popover. Deliberately not a token/pill input: the selection is
 * already summarised in the filter chip row below the bar, and repeating it
 * inside the trigger makes the control grow and the header reflow — bad on a
 * screen staff keep open all day.
 *
 * The trigger stays a fixed width and reports a count instead.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  searchPlaceholder = "Search…",
  emptyText = "Nothing to choose from.",
  className,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  label: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 justify-between gap-2 whitespace-nowrap font-normal", className)}
        >
          <span className="truncate">
            {label}
            {selected.length > 0 && (
              <span className="tnum ml-1.5 text-muted-foreground [overflow-wrap:normal]">
                {selected.length}
              </span>
            )}
          </span>
          <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isOn = selected.includes(o.value);
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""}`} onSelect={() => toggle(o.value)}>
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
                        isOn ? "border-foreground bg-foreground text-background" : "border-border",
                      )}
                    >
                      {isOn && <Check aria-hidden className="h-3 w-3" />}
                    </div>
                    <span className="truncate" dir="auto">{o.label}</span>
                    {o.hint && (
                      <span className="ml-auto pl-2 text-xs text-muted-foreground">{o.hint}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
