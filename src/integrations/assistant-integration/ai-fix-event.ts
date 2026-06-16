export const AI_FIX_REQUEST_EVENT = 'pathfinder-ai-fix-request';

export interface AiFixRequestDetail {
  stepId?: string;
  renderedStepId?: string;
  refTarget?: string;
  action?: string;
  containerInfo?: {
    containerId: string;
    containerKind: 'multistep' | 'guided';
    subStepIndex: number;
  };
}
