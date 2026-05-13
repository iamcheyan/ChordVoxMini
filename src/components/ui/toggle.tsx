import React from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export const Toggle = ({ checked, onChange, disabled = false }: ToggleProps) => {
  const getTrackClasses = () => {
    if (disabled) {
      return checked
        ? "bg-zinc-300 border-zinc-400"
        : "bg-zinc-100 border-zinc-200 dark:bg-zinc-800/50 dark:border-zinc-700";
    }
    return checked
      ? "bg-primary border-primary hover:bg-primary/90"
      : "bg-zinc-200 border-zinc-300 hover:bg-blue-50 hover:border-blue-400 dark:bg-zinc-800 dark:border-zinc-700 dark:hover:bg-blue-900/20";
  };

  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 ${getTrackClasses()} ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full transition-all duration-150 border ${
          checked ? "translate-x-6" : "translate-x-1"
        } ${
          disabled
            ? "bg-zinc-500 border-zinc-600 dark:bg-zinc-400 dark:border-zinc-500"
            : "bg-background border-transparent"
        }`}
      />
    </button>
  );
};
