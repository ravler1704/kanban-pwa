import { createContext } from 'react';

/** (card) → whether its board lets cards be marked done (a board setting). */
export const DoneMarks = createContext(() => true);
