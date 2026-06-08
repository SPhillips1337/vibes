import React, { useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';

interface Props {
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

export function EnhancedTextInput({ defaultValue = '', placeholder = '', onChange, onSubmit }: Props) {
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
      if (cursorOffset < value.length) {
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
      return placeholder ? chalk.dim(placeholder) : chalk.inverse(' ');
    }
    let result = '';
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      result += i === cursorOffset ? chalk.inverse(char) : char;
    }
    if (cursorOffset === value.length) {
      result += chalk.inverse(' ');
    }
    return result;
  })();

  return React.createElement(Text, {}, renderedValue);
}
