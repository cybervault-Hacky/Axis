import { Search, X } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { classNames } from "../../lib/classNames";
import { Button } from "./Button";

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  onClear?: () => void;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, label, value, onClear, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasValue = typeof value === "string" && value.length > 0;

  return (
    <div className={classNames("search-field", className)}>
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <Search size={16} aria-hidden="true" />
      <input ref={ref} id={inputId} type="search" value={value} {...props} />
      {hasValue && onClear && (
        <Button
          variant="quiet"
          size="icon"
          className="search-field__clear"
          onClick={onClear}
          aria-label="Clear search"
        >
          <X size={14} />
        </Button>
      )}
    </div>
  );
});
