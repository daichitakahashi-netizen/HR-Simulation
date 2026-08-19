import { EvaluationWeights, DepartmentConfig, ShortageCorrection, SurplusCorrection } from '../../core/models/simulation.model';

// 事業部ごとの評価重み
export const EVALUATION_WEIGHTS: Record<string, EvaluationWeights> = {
  A: { sales: 0.45, management: 0.35, development: 0.10, nurture: 0.10 },
  B: { sales: 0.35, management: 0.20, development: 0.30, nurture: 0.15 },
  C: { sales: 0.20, management: 0.10, development: 0.50, nurture: 0.20 },
};

// 事業部の基本設定
export const DEPARTMENT_CONFIGS: Record<string, DepartmentConfig> = {
  A: {
    baseRevenue: 10,
    growthRate: 0.06,
    standardHeadcount: 40,
    minHeadcount: 30,
  },
  B: {
    baseRevenue: 7,
    growthRate: 0.12,
    standardHeadcount: 35,
    minHeadcount: 20,
  },
  C: {
    baseRevenue: 2,
    growthRate: 0.25,
    standardHeadcount: 25,
    minHeadcount: 10,
  },
};

// 人員不足ペナルティ（不足補正係数）
export const SHORTAGE_CORRECTIONS: ShortageCorrection[] = [
  {
    fulfillmentRate: 1.0,
    coefficients: { A: 1.0, B: 1.0, C: 1.0 },
  },
  {
    fulfillmentRate: 0.9,
    coefficients: { A: 0.85, B: 0.9, C: 0.95 },
  },
  {
    fulfillmentRate: 0.8,
    coefficients: { A: 0.7, B: 0.8, C: 0.9 },
  },
  {
    fulfillmentRate: 0.7,
    coefficients: { A: 0.5, B: 0.65, C: 0.8 },
  },
  {
    fulfillmentRate: 0.0,
    coefficients: { A: 0.3, B: 0.5, C: 0.7 },
  },
];

// 人員過剰ペナルティ（過剰補正係数）
export const SURPLUS_CORRECTIONS: SurplusCorrection[] = [
  { maxFulfillmentRate: 1.2, coefficient: 1.0 },
  { maxFulfillmentRate: 1.4, coefficient: 0.95 },
  { maxFulfillmentRate: 1.6, coefficient: 0.9 },
  { maxFulfillmentRate: Infinity, coefficient: 0.8 },
];

// 制約条件
export const CONSTRAINTS = {
  MIN_TOTAL_REVENUE: 58, // 全社売上の最小値（億円）
  PERSONNEL_COST_MULTIPLIER: 3, // 人件費の倍率
};
