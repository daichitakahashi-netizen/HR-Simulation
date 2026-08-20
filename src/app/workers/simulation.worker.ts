/// <reference lib="webworker" />

import { Employee, AllocationResult, DepartmentResult, DepartmentObjective } from '../core/models/simulation.model';
import { EVALUATION_WEIGHTS, DEPARTMENT_CONFIGS, SHORTAGE_CORRECTIONS, SURPLUS_CORRECTIONS, CONSTRAINTS } from '../shared/constants/simulation.constants';
import munkres from 'munkres-js';

interface WorkerMessage {
  employees: Employee[];
  objective: DepartmentObjective;
  totalEmployees: number;
  lockedEmployees?: Record<string, string>;
  requestId: number;
}

interface AllocationPattern {
  A: number;
  B: number;
  C: number;
}

interface PrecomputedContributions {
  A: number[];
  B: number[];
  C: number[];
}

class OptimalSimulationEngine {
  private evaluationWeights = EVALUATION_WEIGHTS;
  private departmentConfigs = DEPARTMENT_CONFIGS;
  private shortageCorrections = SHORTAGE_CORRECTIONS;
  private surplusCorrections = SURPLUS_CORRECTIONS;
  private constraints = CONSTRAINTS;

  private precomputeContributions(employees: Employee[]): PrecomputedContributions {
    const contributions: PrecomputedContributions = { A: [], B: [], C: [] };
    for (const dept of ['A', 'B', 'C']) {
      contributions[dept as keyof PrecomputedContributions] = employees.map(
        (emp) => this.calculateEmployeeContribution(emp, dept)
      );
    }
    return contributions;
  }

  private calculateEmployeeContribution(employee: Employee, department: string): number {
    const weights = this.evaluationWeights[department];
    return (
      employee.sales * weights.sales +
      employee.management * weights.management +
      employee.development * weights.development +
      employee.nurture * weights.nurture
    );
  }

  private calculateBaseRevenue(departmentCapability: number, department: string): number {
    const config = this.departmentConfigs[department];
    return config.baseRevenue * (1 + (departmentCapability / 100) * config.growthRate);
  }

  private calculateAppropriateHeadcount(totalEmployees: number, department: string): number {
    const config = this.departmentConfigs[department];
    return config.standardHeadcount * (totalEmployees / 100);
  }

  private calculateFulfillmentRate(allocatedCount: number, appropriateHeadcount: number): number {
    return appropriateHeadcount > 0 ? allocatedCount / appropriateHeadcount : 0;
  }

  private getShortageCoefficient(fulfillmentRate: number, department: string): number {
    for (const correction of this.shortageCorrections) {
      if (fulfillmentRate >= correction.fulfillmentRate) {
        return correction.coefficients[department];
      }
    }
    return 0.3;
  }

  private getSurplusCoefficient(fulfillmentRate: number): number {
    for (const correction of this.surplusCorrections) {
      if (fulfillmentRate <= correction.maxFulfillmentRate) {
        return correction.coefficient;
      }
    }
    return 0.8;
  }

  private calculateCost(personnelCosts: number[]): number {
    return (personnelCosts.reduce((sum, cost) => sum + cost, 0) * this.constraints.PERSONNEL_COST_MULTIPLIER) / 100;
  }

  private calculateProfit(finalRevenue: number, cost: number): number {
    return finalRevenue - cost;
  }

  private calculateDepartmentResult(
    employees: Employee[],
    allocatedIds: string[],
    department: string,
    totalEmployees: number
  ): DepartmentResult {
    const allocatedCount = allocatedIds.length;
    const deptEmployees = employees.filter((emp) => allocatedIds.includes(emp.id));
    const employeeContributions = deptEmployees.map((emp) =>
      this.calculateEmployeeContribution(emp, department)
    );
    const departmentCapability = employeeContributions.reduce((sum, contrib) => sum + contrib, 0);
    const baseRevenue = this.calculateBaseRevenue(departmentCapability, department);
    const appropriateHeadcount = this.calculateAppropriateHeadcount(totalEmployees, department);
    const fulfillmentRate = this.calculateFulfillmentRate(allocatedCount, appropriateHeadcount);
    const shortageCoefficient = this.getShortageCoefficient(fulfillmentRate, department);
    const surplusCoefficient = this.getSurplusCoefficient(fulfillmentRate);
    const finalRevenue = baseRevenue * shortageCoefficient * surplusCoefficient;
    const personnelCosts = deptEmployees.map((emp) => emp.personnelCost);
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
      allocatedEmployeeIds: allocatedIds,
    };
  }

  private generateValidAllocationPatterns(totalEmployees: number): AllocationPattern[] {
    const minHeadcounts = {
      A: Math.ceil(this.departmentConfigs['A'].minHeadcount * (totalEmployees / 100)),
      B: Math.ceil(this.departmentConfigs['B'].minHeadcount * (totalEmployees / 100)),
      C: Math.ceil(this.departmentConfigs['C'].minHeadcount * (totalEmployees / 100)),
    };

    const patterns: AllocationPattern[] = [];
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
    pattern: AllocationPattern,
    contributions: PrecomputedContributions,
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

    const deptIndexMap: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < deptMapping.length; i++) {
      deptIndexMap[deptMapping[i]]++;
    }

    for (let empIdx = 0; empIdx < n; empIdx++) {
      const row: number[] = [];
      const emp = employees[empIdx];
      const lockedDept = lockedEmployees?.[emp.id];

      for (let slotIdx = 0; slotIdx < deptMapping.length; slotIdx++) {
        const dept = deptMapping[slotIdx];
        const contribution = contributions[dept as keyof PrecomputedContributions][empIdx];

        if (lockedDept && lockedDept !== dept) {
          row.push(1000000);
        } else if (!lockedDept) {
          row.push(-contribution);
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
    pattern: AllocationPattern,
    lockedEmployees?: Record<string, string>
  ): boolean {
    if (!lockedEmployees) return true;

    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const dept of Object.values(lockedEmployees)) {
      lockedCounts[dept]++;
    }

    for (const dept of ['A', 'B', 'C']) {
      if (lockedCounts[dept] > pattern[dept as keyof AllocationPattern]) {
        return false;
      }
    }
    return true;
  }

  private simulateAllocation(
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
      const deptResult = this.calculateDepartmentResult(
        employees,
        allocatedIds[dept] || [],
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
      isBelowPreviousYearRevenue: totalRevenue < this.constraints.MIN_TOTAL_REVENUE,
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

  runOptimalSimulation(
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees?: Record<string, string>
  ): AllocationResult {
    const contributions = this.precomputeContributions(employees);
    const patterns = this.generateValidAllocationPatterns(totalEmployees);
    console.log(`[Worker] Generated ${patterns.length} valid allocation patterns`);

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
      const result = this.simulateAllocation(employees, allocation, totalEmployees);
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

    if (bestResult) {
      console.log(
        `[Worker] Optimal: A=${bestResult.allocation['A']}, B=${bestResult.allocation['B']}, C=${bestResult.allocation['C']}, Revenue=${bestResult.summary.totalRevenue.toFixed(2)}B`
      );
    }

    return bestResult || this.generateDefaultResult(totalEmployees);
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
        A: { allocatedEmployees: 0, employeeContributions: [], departmentCapability: 0, baseRevenue: 0, fulfillmentRate: 0, appropriateHeadcount: 0, shortageCoefficient: 0.3, surplusCoefficient: 1.0, finalRevenue: 0, cost: 0, profit: 0, personnelCosts: [], allocatedEmployeeIds: [] },
        B: { allocatedEmployees: 0, employeeContributions: [], departmentCapability: 0, baseRevenue: 0, fulfillmentRate: 0, appropriateHeadcount: 0, shortageCoefficient: 0.5, surplusCoefficient: 1.0, finalRevenue: 0, cost: 0, profit: 0, personnelCosts: [], allocatedEmployeeIds: [] },
        C: { allocatedEmployees: 0, employeeContributions: [], departmentCapability: 0, baseRevenue: 0, fulfillmentRate: 0, appropriateHeadcount: 0, shortageCoefficient: 0.7, surplusCoefficient: 1.0, finalRevenue: 0, cost: 0, profit: 0, personnelCosts: [], allocatedEmployeeIds: [] },
      },
      summary: { totalRevenue: 0, totalCost: 0, totalProfit: 0, isBelowPreviousYearRevenue: true },
    };
  }
}

const engine = new OptimalSimulationEngine();

addEventListener('message', ({ data }: MessageEvent<WorkerMessage>) => {
  console.log('[Worker] Received message:', {
    employees: data.employees?.length,
    objective: data.objective,
    totalEmployees: data.totalEmployees,
  });

  try {
    const result = engine.runOptimalSimulation(
      data.employees,
      data.objective,
      data.totalEmployees,
      data.lockedEmployees
    );

    console.log('[Worker] Simulation complete, posting result');
    postMessage({
      type: 'SUCCESS',
      data: result,
      requestId: data.requestId,
    });
  } catch (error) {
    console.error('[Worker] Error during simulation:', error);
    postMessage({
      type: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      stack: error instanceof Error ? error.stack : '',
      requestId: data.requestId,
    });
  }
});
