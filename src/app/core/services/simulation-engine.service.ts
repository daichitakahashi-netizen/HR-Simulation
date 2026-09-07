import { Injectable } from '@angular/core';
import munkres from 'munkres-js';
import {
  Employee,
  Department,
  AllocationResult,
  DepartmentResult,
  SimulationSummary,
  EvaluationWeights,
  DepartmentConfig,
  ShortageCorrection,
  SurplusCorrection,
  DepartmentObjective,
} from '../models/simulation.model';
import {
  EVALUATION_WEIGHTS,
  DEPARTMENT_CONFIGS,
  SHORTAGE_CORRECTIONS,
  SURPLUS_CORRECTIONS,
  CONSTRAINTS,
} from '../../shared/constants/simulation.constants';

@Injectable({
  providedIn: 'root',
})
export class SimulationEngineService {
  private readonly evaluationWeights = EVALUATION_WEIGHTS;
  private readonly departmentConfigs = DEPARTMENT_CONFIGS;
  private readonly shortageCorrections = SHORTAGE_CORRECTIONS;
  private readonly surplusCorrections = SURPLUS_CORRECTIONS;
  private readonly constraints = CONSTRAINTS;

  // Calculate employee contribution to a department
  calculateEmployeeContribution(
    employee: Employee,
    department: string
  ): number {
    const weights = this.evaluationWeights[department];
    return (
      employee.sales * weights.sales +
      employee.management * weights.management +
      employee.development * weights.development +
      employee.nurture * weights.nurture
    );
  }

  // Calculate department capability (sum of employee contributions)
  calculateDepartmentCapability(
    employees: Employee[],
    department: string
  ): number {
    return employees.reduce(
      (sum, emp) => sum + this.calculateEmployeeContribution(emp, department),
      0
    );
  }

  // Calculate basic revenue for a department
  calculateBaseRevenue(departmentCapability: number, department: string): number {
    const config = this.departmentConfigs[department];
    return config.baseRevenue * (1 + (departmentCapability / 100) * config.growthRate);
  }

  // Calculate dynamic appropriate headcount
  calculateAppropriateHeadcount(
    totalEmployees: number,
    department: string
  ): number {
    if (totalEmployees === 110) {
      const headcounts: Record<string, number> = {
        A: 44,
        B: 38,
        C: 28,
      };
      return headcounts[department];
    }
    const config = this.departmentConfigs[department];
    return config.standardHeadcount * (totalEmployees / 100);
  }

  // Calculate fulfillment rate
  calculateFulfillmentRate(
    allocatedCount: number,
    appropriateHeadcount: number
  ): number {
    return appropriateHeadcount > 0 ? allocatedCount / appropriateHeadcount : 0;
  }

  // Get shortage correction coefficient
  getShortageCoefficient(
    fulfillmentRate: number,
    department: string
  ): number {
    for (const correction of this.shortageCorrections) {
      if (fulfillmentRate >= correction.fulfillmentRate) {
        return correction.coefficients[department];
      }
    }
    return 0.3; // fallback
  }

  // Get surplus correction coefficient
  getSurplusCoefficient(fulfillmentRate: number): number {
    for (const correction of this.surplusCorrections) {
      if (fulfillmentRate <= correction.maxFulfillmentRate) {
        return correction.coefficient;
      }
    }
    return 0.8; // fallback
  }

  // Calculate cost (personnel cost * PERSONNEL_COST_MULTIPLIER / 100) to convert to 100 million yen units
  calculateCost(personnelCosts: number[]): number {
    return (personnelCosts.reduce((sum, cost) => sum + cost, 0) * this.constraints.PERSONNEL_COST_MULTIPLIER) / 100;
  }

  // Calculate profit
  calculateProfit(finalRevenue: number, cost: number): number {
    return finalRevenue - cost;
  }

  // Calculate department result
  calculateDepartmentResult(
    employees: Employee[],
    allocatedCount: number,
    department: string,
    totalEmployees: number
  ): DepartmentResult {
    const employeeContributions = employees.map((emp) =>
      this.calculateEmployeeContribution(emp, department)
    );
    const departmentCapability = employeeContributions.reduce(
      (sum, contrib) => sum + contrib,
      0
    );
    const baseRevenue = this.calculateBaseRevenue(
      departmentCapability,
      department
    );
    const appropriateHeadcount = this.calculateAppropriateHeadcount(
      totalEmployees,
      department
    );
    const fulfillmentRate = this.calculateFulfillmentRate(
      allocatedCount,
      appropriateHeadcount
    );
    const shortageCoefficient = this.getShortageCoefficient(
      fulfillmentRate,
      department
    );
    const surplusCoefficient = this.getSurplusCoefficient(fulfillmentRate);
    const finalRevenue = baseRevenue * shortageCoefficient * surplusCoefficient;
    const personnelCosts = employees.map((emp) => emp.personnelCost);
    const cost = this.calculateCost(personnelCosts);
    const profit = this.calculateProfit(finalRevenue, cost);

    return {
      allocatedEmployees: allocatedCount,
      employeeContributions,
      departmentCapability,
      baseRevenue,
      fulfillmentRate,
      appropriateHeadcount,
      shortageCoefficient,
      surplusCoefficient,
      finalRevenue,
      cost,
      profit,
      personnelCosts,
      allocatedEmployeeIds: employees.map((emp) => emp.id),
    };
  }

  // Run simulation with allocated employee IDs
  simulateWithAllocation(
    employees: Employee[],
    allocatedIds: Record<string, string[]>,
    totalEmployees: number
  ): AllocationResult {
    const result: AllocationResult = {
      allocation: {
        A: allocatedIds['A'].length,
        B: allocatedIds['B'].length,
        C: allocatedIds['C'].length,
      },
      department: {},
      summary: {
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        isBelowPreviousYearRevenue: false,
      },
    };

    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;

    // Calculate for each department
    for (const dept of Object.values(Department)) {
      const deptEmployeeIds = allocatedIds[dept] || [];
      const deptEmployees = employees.filter((emp) =>
        deptEmployeeIds.includes(emp.id)
      );
      const allocatedCount = deptEmployees.length;

      const deptResult = this.calculateDepartmentResult(
        deptEmployees,
        allocatedCount,
        dept,
        totalEmployees
      );

      result.department[dept] = deptResult;
      totalRevenue += deptResult.finalRevenue;
      totalCost += deptResult.cost;
      totalProfit += deptResult.profit;
    }

    result.summary = {
      totalRevenue,
      totalCost,
      totalProfit,
      isBelowPreviousYearRevenue: totalRevenue < 58,
    };

    return result;
  }

  // Run simulation (legacy - kept for compatibility)
  simulate(
    employees: Employee[],
    allocation: Record<string, number>,
    totalEmployees: number
  ): AllocationResult {
    const result: AllocationResult = {
      allocation,
      department: {},
      summary: {
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        isBelowPreviousYearRevenue: false,
      },
    };

    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let employeeIndex = 0;

    // Calculate for each department
    for (const dept of Object.values(Department)) {
      const allocatedCount = allocation[dept] || 0;
      const deptEmployees = employees.slice(
        employeeIndex,
        employeeIndex + allocatedCount
      );
      employeeIndex += allocatedCount;

      const deptResult = this.calculateDepartmentResult(
        deptEmployees,
        allocatedCount,
        dept,
        totalEmployees
      );

      result.department[dept] = deptResult;
      totalRevenue += deptResult.finalRevenue;
      totalCost += deptResult.cost;
      totalProfit += deptResult.profit;
    }

    result.summary = {
      totalRevenue,
      totalCost,
      totalProfit,
      isBelowPreviousYearRevenue: totalRevenue < 58,
    };

    return result;
  }

  runOptimalSimulation(
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees?: Record<string, string>
  ): AllocationResult {
    const patterns = this.generateValidAllocationPatterns(totalEmployees);
    const contributions = this.precomputeContributions(employees);

    let bestResult: AllocationResult | null = null;
    let bestScore = -Infinity;
    let lastValidResult: AllocationResult | null = null;

    for (const pattern of patterns) {
      if (!this.validateLockedEmployees(pattern, lockedEmployees)) {
        continue;
      }

      const { matrix, deptMapping } = this.buildCostMatrix(
        employees,
        pattern,
        contributions,
        totalEmployees,
        objective,
        lockedEmployees
      );

      const allocation = this.solveHungarianAndGetAllocation(employees, matrix, deptMapping);
      const result = this.simulateAllocationIds(employees, allocation, totalEmployees);
      lastValidResult = result;
      const score = this.calculateObjectiveScore(result, objective);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      } else if (Math.abs(score - bestScore) < 1e-8 && bestResult) {
        // タイブレーク: 主目的の値が同等の場合、全社売上が最大となるパターンを優先選出する
        if (result.summary.totalRevenue > bestResult.summary.totalRevenue) {
          bestScore = score;
          bestResult = result;
        }
      }
    }

    // bestScoreが -Infinity の場合（すべてのパターンが制約を満たさない）、最後の結果を返す
    if (!isFinite(bestScore) && lastValidResult) {
      return lastValidResult;
    }

    return bestResult || this.generateDefaultResult(totalEmployees);
  }

  private precomputeContributions(employees: Employee[]): Record<string, number[]> {
    const contributions: Record<string, number[]> = { A: [], B: [], C: [] };
    for (const dept of ['A', 'B', 'C']) {
      contributions[dept] = employees.map((emp) =>
        this.calculateEmployeeContribution(emp, dept)
      );
    }
    return contributions;
  }

  private generateValidAllocationPatterns(
    totalEmployees: number
  ): Array<{ A: number; B: number; C: number }> {
    const minHeadcounts = {
      A: Math.ceil(this.departmentConfigs['A'].minHeadcount * (totalEmployees / 100)),
      B: Math.ceil(this.departmentConfigs['B'].minHeadcount * (totalEmployees / 100)),
      C: Math.ceil(this.departmentConfigs['C'].minHeadcount * (totalEmployees / 100)),
    };

    const patterns: Array<{ A: number; B: number; C: number }> = [];
    for (let a = minHeadcounts.A; a <= totalEmployees - minHeadcounts.B - minHeadcounts.C; a++) {
      for (let b = minHeadcounts.B; b <= totalEmployees - a - minHeadcounts.C; b++) {
        const c = totalEmployees - a - b;
        if (c >= minHeadcounts.C) {
          patterns.push({ A: a, B: b, C: c });
        }
      }
    }
    return patterns;
  }

  private buildCostMatrix(
    employees: Employee[],
    pattern: { A: number; B: number; C: number },
    contributions: Record<string, number[]>,
    totalEmployees: number,
    objective: DepartmentObjective,
    lockedEmployees?: Record<string, string>
  ): { matrix: number[][]; deptMapping: string[] } {
    const n = employees.length;
    const deptMapping: string[] = [];
    const matrix: number[][] = [];

    const slots: Array<{ dept: string; count: number }> = [
      { dept: 'A', count: pattern.A },
      { dept: 'B', count: pattern.B },
      { dept: 'C', count: pattern.C },
    ];

    for (const slot of slots) {
      for (let i = 0; i < slot.count; i++) {
        deptMapping.push(slot.dept);
      }
    }

    // 各事業部の不足補正・過剰補正を事前計算
    const deptCorrectionMap: Record<string, { shortage: number; surplus: number }> = {};
    for (const dept of ['A', 'B', 'C']) {
      const allocatedCount = pattern[dept as keyof typeof pattern];
      const appropriateHeadcount = this.calculateAppropriateHeadcount(totalEmployees, dept);
      const fulfillmentRate = this.calculateFulfillmentRate(allocatedCount, appropriateHeadcount);
      const shortageCoeff = this.getShortageCoefficient(fulfillmentRate, dept);
      const surplusCoeff = this.getSurplusCoefficient(fulfillmentRate);
      deptCorrectionMap[dept] = { shortage: shortageCoeff, surplus: surplusCoeff };
    }

    for (let empIdx = 0; empIdx < n; empIdx++) {
      const row: number[] = [];
      const emp = employees[empIdx];
      const lockedDept = lockedEmployees?.[emp.id];

      for (let slotIdx = 0; slotIdx < deptMapping.length; slotIdx++) {
        const dept = deptMapping[slotIdx];
        const contribution = contributions[dept][empIdx];
        const config = this.departmentConfigs[dept];
        const corrections = deptCorrectionMap[dept];

        // 限界貢献額 = 基準売上 * 成長係数 * (contribution / 100) * 不足補正 * 過剰補正
        const marginalContribution =
          config.baseRevenue * config.growthRate * (contribution / 100) * corrections.shortage * corrections.surplus;

        // A事業部利益最大化時は、A事業部の純利益貢献度（限界貢献額－人件費）で評価する
        let marginalValue = marginalContribution;
        if (objective === 'departmentAProfitMaximize') {
          if (dept === 'A') {
            const empCost = (emp.personnelCost * this.constraints.PERSONNEL_COST_MULTIPLIER) / 100;
            marginalValue = marginalContribution - empCost;
          } else {
            // 主目的（A事業部）以外は微小重みでタイブレークのみに寄与させ、
            // 他事業部の売上貢献額がハンガリー法で過剰評価されないようにする
            marginalValue = marginalContribution * 1e-6;
          }
        } else if (objective === 'departmentBRevenueMaximize' && dept !== 'B') {
          marginalValue = marginalContribution * 1e-6;
        } else if (objective === 'departmentCRevenueMaximize' && dept !== 'C') {
          marginalValue = marginalContribution * 1e-6;
        }

        if (lockedDept && lockedDept !== dept) {
          row.push(1000000);
        } else {
          row.push(-marginalValue);
        }
      }
      matrix.push(row);
    }

    return { matrix, deptMapping };
  }

  private solveHungarianAndGetAllocation(
    employees: Employee[],
    matrix: number[][],
    deptMapping: string[]
  ): Record<string, string[]> {
    const assignment = munkres(matrix);

    const allocation: Record<string, string[]> = { A: [], B: [], C: [] };
    for (const [empIdx, slotIdx] of assignment) {
      const dept = deptMapping[slotIdx];
      allocation[dept].push(employees[empIdx].id);
    }

    return allocation;
  }

  private validateLockedEmployees(
    pattern: { A: number; B: number; C: number },
    lockedEmployees?: Record<string, string>
  ): boolean {
    if (!lockedEmployees) return true;

    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const dept of Object.values(lockedEmployees)) {
      lockedCounts[dept]++;
    }

    for (const dept of ['A', 'B', 'C']) {
      if (lockedCounts[dept] > pattern[dept as keyof typeof pattern]) {
        return false;
      }
    }
    return true;
  }

  private simulateAllocationIds(
    employees: Employee[],
    allocatedIds: Record<string, string[]>,
    totalEmployees: number
  ): AllocationResult {
    const result: AllocationResult = {
      allocation: {
        A: allocatedIds['A'].length,
        B: allocatedIds['B'].length,
        C: allocatedIds['C'].length,
      },
      department: {},
      summary: {
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        isBelowPreviousYearRevenue: false,
      },
    };

    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;

    for (const dept of ['A', 'B', 'C']) {
      const deptEmployeeIds = allocatedIds[dept] || [];
      const deptEmployees = employees.filter((emp) =>
        deptEmployeeIds.includes(emp.id)
      );
      const allocatedCount = deptEmployees.length;

      const deptResult = this.calculateDepartmentResult(
        deptEmployees,
        allocatedCount,
        dept,
        totalEmployees
      );

      result.department[dept] = deptResult;
      totalRevenue += deptResult.finalRevenue;
      totalCost += deptResult.cost;
      totalProfit += deptResult.profit;
    }

    result.summary = {
      totalRevenue,
      totalCost,
      totalProfit,
      isBelowPreviousYearRevenue: totalRevenue < 58,
    };

    return result;
  }

  private calculateObjectiveScore(result: AllocationResult, objective: DepartmentObjective): number {
    // 全社売上が制約を満たさない場合はペナルティを課す
    if (result.summary.totalRevenue < this.constraints.MIN_TOTAL_REVENUE) {
      return -Infinity;
    }

    if (objective === 'totalRevenue') {
      return result.summary.totalRevenue;
    } else if (objective === 'departmentAProfitMaximize') {
      return result.department['A'].profit;
    } else if (objective === 'departmentBRevenueMaximize') {
      return result.department['B'].finalRevenue;
    } else if (objective === 'departmentCRevenueMaximize') {
      return result.department['C'].finalRevenue;
    }
    return result.summary.totalRevenue;
  }

  private generateDefaultResult(totalEmployees: number): AllocationResult {
    const minHeadcounts = {
      A: Math.ceil(this.departmentConfigs['A'].minHeadcount * (totalEmployees / 100)),
      B: Math.ceil(this.departmentConfigs['B'].minHeadcount * (totalEmployees / 100)),
      C: Math.ceil(this.departmentConfigs['C'].minHeadcount * (totalEmployees / 100)),
    };

    return {
      allocation: minHeadcounts,
      department: {
        A: {
          allocatedEmployees: 0,
          employeeContributions: [],
          departmentCapability: 0,
          baseRevenue: 0,
          fulfillmentRate: 0,
          appropriateHeadcount: 0,
          shortageCoefficient: 0.3,
          surplusCoefficient: 1.0,
          finalRevenue: 0,
          cost: 0,
          profit: 0,
          personnelCosts: [],
          allocatedEmployeeIds: [],
        },
        B: {
          allocatedEmployees: 0,
          employeeContributions: [],
          departmentCapability: 0,
          baseRevenue: 0,
          fulfillmentRate: 0,
          appropriateHeadcount: 0,
          shortageCoefficient: 0.5,
          surplusCoefficient: 1.0,
          finalRevenue: 0,
          cost: 0,
          profit: 0,
          personnelCosts: [],
          allocatedEmployeeIds: [],
        },
        C: {
          allocatedEmployees: 0,
          employeeContributions: [],
          departmentCapability: 0,
          baseRevenue: 0,
          fulfillmentRate: 0,
          appropriateHeadcount: 0,
          shortageCoefficient: 0.7,
          surplusCoefficient: 1.0,
          finalRevenue: 0,
          cost: 0,
          profit: 0,
          personnelCosts: [],
          allocatedEmployeeIds: [],
        },
      },
      summary: {
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        isBelowPreviousYearRevenue: true,
      },
    };
  }

}
