export type EventMessage = {
  workflowId: string;
  userId: string;
  triggerType: "event";
  triggerData: {
    contractAddress?: string;
    eventName?: string;
    transactionHash?: string;
    blockNumber?: number;
    args?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

export type Workflow = {
  id: string;
  enabled: boolean;
  userId: string;
};
