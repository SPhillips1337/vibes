import React, { useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';

interface Props {
  defaultValue?: string;
  placeholder?: string;
  maxWidth?: number;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

export function getInputViewport(valueLength: number, cursorOffset: number, maxWidth?: number) {
  if (!maxWidth) return { start: 0, end: valueLength };

  const contentWidth = Math.max(1, maxWidth - 1);
  const maxStart = Math.max(0, valueLength - contentWidth);
  const start = Math.max(0, Math.min(cursorOffset - contentWidth + 1, maxStart));
  return { start, end: start + contentWidth };
}

export function EnhancedTextInput({ defaultValue = '', placeholder = '', maxWidth, onChange, onSubmit }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [cursorOffset, setCursorOffset] = useState(defaultValue.length);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    onChange?.(value);
  }, [value, onChange]);

  useEffect(() => {
    setValue(defaultValue);
    setCursorOffset(defaultValue.length);
  }, [defaultValue]);

  useInput((input, key) => {
    if (key.home) {
      setCursorOffset(0);
      return;
    }
    if (key.end) {
      setCursorOffset(value.length);
      return;
    }
    if (key.leftArrow) {
      setCursorOffset(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset(prev => Math.min(value.length, prev + 1));
      return;
    }
    if (key.return) {
      onSubmit?.(value);
      return;
    }
    if (key.backspace) {
      if (cursorOffset > 0) {
        setValue(prev => prev.slice(0, cursorOffset - 1) + prev.slice(cursorOffset));
        setCursorOffset(prev => prev - 1);
      }
      return;
    }
    if (key.delete) {
      // If cursor is at end, this is probably a terminal that maps Backspace
      // to key.delete — treat as backward-delete instead of no-op.
      if (cursorOffset >= value.length) {
        if (cursorOffset > 0) {
          setValue(prev => prev.slice(0, cursorOffset - 1) + prev.slice(cursorOffset));
          setCursorOffset(prev => prev - 1);
        }
      } else {
        setValue(prev => prev.slice(0, cursorOffset) + prev.slice(cursorOffset + 1));
      }
      return;
    }
    if (input) {
      setValue(prev => prev.slice(0, cursorOffset) + input + prev.slice(cursorOffset));
      setCursorOffset(prev => prev + input.length);
    }
  });

  const renderedValue = (() => {
    if (value.length === 0) {
      const visiblePlaceholder = maxWidth ? placeholder.slice(0, Math.max(1, maxWidth)) : placeholder;
      return visiblePlaceholder ? chalk.dim(visiblePlaceholder) : chalk.inverse(' ');
    }

    const { start, end } = getInputViewport(value.length, cursorOffset, maxWidth);
    let result = '';
    for (let i = start; i < Math.min(value.length, end); i++) {
      const char = value[i];
      result += i === cursorOffset ? chalk.inverse(char) : char;
    }
    if (cursorOffset === value.length && (!maxWidth || result.length < maxWidth)) {
      result += chalk.inverse(' ');
    }
    return result;
  })();

  return React.createElement(Text, { wrap: 'truncate-end' }, renderedValue);
}
