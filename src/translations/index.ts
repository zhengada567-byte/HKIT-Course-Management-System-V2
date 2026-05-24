import { en } from "./en";
import { zhHant } from "./zhHant";

export const translations = {
  en,
  zhHant,
};

export type TranslationKey = keyof typeof en;
