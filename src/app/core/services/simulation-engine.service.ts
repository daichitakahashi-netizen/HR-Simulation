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

@Injectable({
  providedIn: 'root',
})
export class SimulationEngineService {
  private readonly evaluationWeights: Record<string, EvaluationWeights> = {
    A: { sales: 0.45, management: 0.35, development: 0.10, nurture: 0.10 },
    B: { sales: 0.35, management: 0.20, development: 0.30, nurture: 0.15 },
    C: { sales: 0.20, management: 0.10, development: 0.50, nurture: 0.20 },
  };

  private readonly departmentConfigs: Record<string, DepartmentConfig> = {
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

  private readonly shortageCorrections: ShortageCorrection[] = [
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

  private readonly surplusCorrections: SurplusCorrection[] = [
    { maxFulfillmentRate: 1.2, coefficient: 1.0 },
    { maxFulfillmentRate: 1.4, coefficient: 0.95 },
    { maxFulfillmentRate: 1.6, coefficient: 0.9 },
    { maxFulfillmentRate: Infinity, coefficient: 0.8 },
  ];

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

  // Calculate cost (personnel cost * 3 / 100) to convert to 100 million yen units
  calculateCost(personnelCosts: number[]): number {
    return (personnelCosts.reduce((sum, cost) => sum + cost, 0) * 3) / 100;
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

    for (const pattern of patterns) {
      if (!this.validateLockedEmployees(pattern, lockedEmployees)) {
        continue;
      }

      const { matrix, deptMapping } = this.buildCostMatrix(
        employees,
        pattern,
        contributions,
        lockedEmployees
      );

      const allocation = this.solveHungarianAndGetAllocation(employees, matrix, deptMapping);
      const result = this.simulateAllocationIds(employees, allocation, totalEmployees);
      const score = this.calculateObjectiveScore(result, objective);

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      } else if (Math.abs(score - bestScore) < 1e-8 && bestResult) {
        const currentA = result.department['A'].finalRevenue;
        const bestA = bestResult.department['A'].finalRevenue;
        if (currentA > bestA) {
          bestScore = score;
          bestResult = result;
        }
      }
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

    for (let empIdx = 0; empIdx < n; empIdx++) {
      const row: number[] = [];
      const emp = employees[empIdx];
      const lockedDept = lockedEmployees?.[emp.id];

      for (let slotIdx = 0; slotIdx < deptMapping.length; slotIdx++) {
        const dept = deptMapping[slotIdx];
        const contribution = contributions[dept][empIdx];

        if (lockedDept && lockedDept !== dept) {
          row.push(1000000);
        } else {
          row.push(-contribution);
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
