// reactapp/src/activeModel.ts
// FIMSIM-FE58: the wizard publishes the open project's model so the header
// can wear a badge beside the logo (Parvaneh lost track of which model she
// was in; the step-card eyebrow badge was missed).
import { createContext, useContext } from 'react';
import type { ModelId } from './steps';

export interface ActiveModel {
  model: ModelId | null;
  setModel: (m: ModelId | null) => void;
}

export const ActiveModelContext = createContext<ActiveModel>({
  model: null,
  setModel: () => undefined,
});

export const useActiveModel = () => useContext(ActiveModelContext);
