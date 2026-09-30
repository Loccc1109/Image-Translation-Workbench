export type Stage = 'idle' | 'pending' | 'running' | 'done' | 'failed';
export type Check = 'idle' | 'pending' | 'passed' | 'failed' | 'unknown' | 'error';
export interface Item {
  id: string; name: string; relativePath: string; prompt: string; generatedPrompt: string;
  promptStatus: Stage; imageStatus: Stage; validationStatus: Check; validationReason: string;
  error: string; errorCode: string; retryAt: string; hasResult: boolean; version: string;
  sourceUrl: string; resultUrl: string;
}
export interface Task { id: string; language: string; createdAt: string; updatedAt: string; busy: boolean; items: Item[] }
export interface TaskSummary { id: string; language: string; createdAt: string; count: number; done: number }
export interface Settings {
  geminiBaseUrl: string; geminiModel: string; geminiAuth: 'bearer' | 'google' | 'custom'; geminiAuthHeader: string;
  geminiKeySet: boolean; extraInstruction: string; imageBaseUrl: string; imageModel: string; imageKeySet: boolean;
  size: string; resolution: string; quality: string; downloadWidth: number; downloadHeight: number; checkModel: boolean; promptConcurrency: number;
  imageConcurrency: number; pollSeconds: number; timeoutMinutes: number; autoPrompt: boolean; autoGenerate: boolean;
}
