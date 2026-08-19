// Employee abilities
export interface EmployeeAbilities {
  sales: number; // 営業力 (0-100)
  management: number; // 管理力 (0-100)
  development: number; // 開拓力 (0-100)
  nurture: number; // 育成力 (0-100)
}

// Employee data
export interface Employee extends EmployeeAbilities {
  id: string;
  personnelCost: number; // 人件費 (1-20)
}

// Department types
export enum Department {
  A = 'A',
  B = 'B',
  C = 'C',
}

// Allocation mapping: department -> employee count
export type AllocationMap = Record<string, number>;

// Evaluation weights per ability and department
export interface EvaluationWeights {
  sales: number;
  management: number;
  development: number;
  nurture: number;
}

// Department weights mapping
export type DepartmentWeights = Record<string, EvaluationWeights>;

// Department configuration
export interface DepartmentConfig {
  baseRevenue: number; // 基準売上 (unit: 100M yen)
  growthRate: number; // 成長係数
  standardHeadcount: number; // 基準適正人数 (at 100 employees)
  minHeadcount: number; // 最低配置人数
}

// Department configuration mapping
export type DepartmentConfigs = Record<string, DepartmentConfig>;

// Shortage penalty correction coefficient
export interface ShortageCorrection {
  fulfillmentRate: number;
  coefficients: Record<string, number>; // dept -> coefficient
}

// Surplus penalty correction coefficient
export interface SurplusCorrection {
  maxFulfillmentRate: number;
  coefficient: number;
}

// Calculation results
export interface AllocationResult {
  allocation: Record<string, number>; // department -> allocated employees
  department: {
    [key: string]: DepartmentResult;
  };
  summary: SimulationSummary;
}

export interface DepartmentResult {
  allocatedEmployees: number;
  employeeContributions: number[]; // 社員貢献度 array
  departmentCapability: number; // 事業部能力値
  baseRevenue: number; // 基本売上
  fulfillmentRate: number; // 充足率
  appropriateHeadcount: number; // 動的スケーリング後の適正人数
  shortageCoefficient: number; // 不足補正係数
  surplusCoefficient: number; // 過剰補正係数
  finalRevenue: number; // 最終売上
  cost: number; // コスト (人件費 × 3)
  profit: number; // 利益
  personnelCosts: number[]; // 配置された社員の人件費 array
  allocatedEmployeeIds: string[]; // 配置された社員ID
}

export interface SimulationSummary {
  totalRevenue: number; // 全社売上
  totalCost: number; // 全社コスト
  totalProfit: number; // 全社利益
  isBelowPreviousYearRevenue?: boolean; // 前年度売上（58億円）を下回っているかどうか
}

// Simulation parameters
export interface SimulationParams {
  employees: Employee[];
  allocation: Record<string, number>; // department -> allocated employees
  totalEmployees: number; // 全社員数 (for dynamic scaling)
}

// Department objective
export type DepartmentObjective = 'totalRevenue' | 'departmentAProfitMaximize' | 'departmentBRevenueMaximize' | 'departmentCRevenueMaximize';
