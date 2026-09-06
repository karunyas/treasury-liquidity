import React, { useRef, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Polished, accessible dropdown component with:
 * - Smooth transitions (opacity-0 scale-95 to opacity-100 scale-100)
 * - Clean trigger button with hover and focus states
 * - Refined dropdown list with shadow and rounded corners
 * - Full keyboard navigation support
 * - Complete ARIA attributes for screen readers
 */
export const Dropdown: React.FC<DropdownProps> = ({
  value,
  onChange,
  options,
  label,
  placeholder = "Select an option",
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node) &&
        listRef.current &&
        !listRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      // Open dropdown on Space or Enter
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      // Open on ArrowDown
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
        setHighlightedIndex(0);
      }
      return;
    }

    // Keyboard navigation when dropdown is open
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < options.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          const selected = options[highlightedIndex];
          if (selected) onChange(selected.value);
          setIsOpen(false);
          setHighlightedIndex(-1);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
      case " ":
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < options.length) {
          const selected = options[highlightedIndex];
          if (selected) onChange(selected.value);
          setIsOpen(false);
          setHighlightedIndex(-1);
        }
        break;
      default:
        break;
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[role='option']");
      const highlightedItem = items[highlightedIndex] as HTMLElement;
      highlightedItem?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return (
    <div className="dropdown">
      {label && <label className="dropdown-label">{label}</label>}

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) setHighlightedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label || "Select option"}
        className="dropdown-trigger"
      >
        <span className={selectedOption ? undefined : "dropdown-trigger-placeholder"}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          size={18}
          className={isOpen ? "dropdown-chevron dropdown-chevron-open" : "dropdown-chevron"}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <ul ref={listRef} role="listbox" aria-label={label || "Options"} className="dropdown-menu">
          {options.map((option, idx) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={value === option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                  setHighlightedIndex(-1);
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
                onMouseLeave={() => setHighlightedIndex(-1)}
                className={
                  value === option.value
                    ? "dropdown-option dropdown-option-selected"
                    : highlightedIndex === idx
                      ? "dropdown-option dropdown-option-highlighted"
                      : "dropdown-option"
                }
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
