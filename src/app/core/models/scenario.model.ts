export interface ScenarioDepartmentSummary {
  allocatedEmployees: number;
  departmentCapability: number;
  fulfillmentRate: number;
  finalRevenue: number;
  cost: number;
  profit: number;
}

export interface ScenarioSummary {
  id?: string;
  timestamp?: number;
  objective: string;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  departmentSummaries: {
    A: ScenarioDepartmentSummary;
    B: ScenarioDepartmentSummary;
    C: ScenarioDepartmentSummary;
  };
  decisionReason: string;
}
