export type AnalysisInput = {
  problemDescription: string;
  codeSnippet?: string;
  errorMessage?: string;
  context?: string;
};

export type FreeAnalysisResponse = {
  what_happened: string;
  what_matters: string[];
  what_to_do_next: string[];
  upgrade_hint: string;
};