import { AllocationResult, AllocationMap, Employee, DepartmentObjective, SatisfactionSecondaryObjective } from './simulation.model';

// ---- 経年タレントマネジメント実務機能（/hr-planning） ----
// Firestore document hierarchy: /scenarios/{scenarioId}/years/{year}

export interface Scenario {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  currentYear: number;
}

export interface DepartmentRevenues {
  A: number;
  B: number;
  C: number;
}

export interface YearDocument {
  year: number;
  objective: DepartmentObjective;
  satisfactionSecondaryObjective?: SatisfactionSecondaryObjective;
  baseRevenues: DepartmentRevenues;
  results?: AllocationResult; // 100名結果
  results110?: AllocationResult; // 110名（100名+固定追加10名）結果
  employees: Employee[]; // 100名（基準社員データ）
  additionalEmployees?: Employee[]; // 110名体制で結合する固定追加10名（成長率反映済み）
  userNotes?: string;
  memberMode?: 100 | 110;
}

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
  name?: string;
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
  allocation?: AllocationMap;
  allocationResult?: AllocationResult;
  employeeCount?: number;
  userNotes?: string;
  allocatedEmployeeIds?: Record<string, string[]>;
}
