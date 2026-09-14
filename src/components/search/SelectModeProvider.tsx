"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface SelectMode {
  selectMode: boolean;
  enter: () => void;
  exit: () => void;
}

const SelectModeContext = createContext<SelectMode | null>(null);

export function useSelectMode(): SelectMode {
  const context = useContext(SelectModeContext);
  if (!context) {
    throw new Error("useSelectMode は SelectModeProvider の中で使う");
  }
  return context;
}

export function SelectModeProvider({ children }: { children: ReactNode }) {
  const [selectMode, setSelectMode] = useState(false);

  const enter = useCallback(() => {
    setSelectMode(true);
  }, []);

  const exit = useCallback(() => {
    setSelectMode(false);
  }, []);

  return (
    <SelectModeContext.Provider value={{ selectMode, enter, exit }}>
      {children}
    </SelectModeContext.Provider>
  );
}
