import { useEffect, useRef, useState, type FormEvent } from 'react';

/**
 * A USB barcode scanner types the code like a keyboard and presses Enter.
 * This field keeps the focus (unless another input is being used), so the picker never has to click
 * into it, and clears itself after each code. Typing a code and Enter works the same way.
 */
export function ScanInput({
  onScan,
  placeholder = 'Scan a barcode or type it and press Enter',
  disabled = false,
  autoFocus = true,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus || disabled) {
      return;
    }
    input.current?.focus();
    // Take the focus back after a click elsewhere, but not from other text fields.
    const refocus = () => {
      const active = document.activeElement;
      if (!active || active === document.body || active.tagName === 'BUTTON') {
        input.current?.focus();
      }
    };
    const timer = setInterval(refocus, 800);
    return () => clearInterval(timer);
  }, [autoFocus, disabled]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = value.trim();
    if (code) {
      onScan(code);
    }
    setValue('');
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="Barcode"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-xl border-2 border-zinc-900 bg-white px-4 py-3 font-mono text-xl tracking-wide outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal focus:ring-4 focus:ring-zinc-200 disabled:border-zinc-300 disabled:bg-zinc-100"
      />
    </form>
  );
}
