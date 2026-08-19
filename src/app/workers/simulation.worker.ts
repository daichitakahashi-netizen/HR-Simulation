/// <reference lib="webworker" />

import { Employee, AllocationResult, DepartmentResult, DepartmentObjective } from '../core/models/simulation.model';
import { EVALUATION_WEIGHTS, DEPARTMENT_CONFIGS, SHORTAGE_CORRECTIONS, SURPLUS_CORRECTIONS, CONSTRAINTS } from '../shared/constants/simulation.constants';

interface WorkerMessage {
  employees: Employee[];
  objective: DepartmentObjective;
  totalEmployees: number;
  lockedEmployees?: Record<string, string>;
}

interface AllocationPattern {
  A: number;
  B: number;
  C: number;
}

class HybridSimulationEngine {
  private evaluationWeights = EVALUATION_WEIGHTS;
  private departmentConfigs = DEPARTMENT_CONFIGS;
  private shortageCorrections = SHORTAGE_CORRECTIONS;
  private surplusCorrections = SURPLUS_CORRECTIONS;
  private constraints = CONSTRAINTS;

  calculateEmployeeContribution(employee: Employee, department: string): number {
    const weights = this.evaluationWeights[department];
    return (
      employee.sales * weights.sales +
      employee.management * weights.management +
      employee.development * weights.development +
      employee.nurture * weights.nurture
    );
  }

  calculateDepartmentCapability(employees: Employee[], department: string): number {
    return employees.reduce(
      (sum, emp) => sum + this.calculateEmployeeContribution(emp, department),
      0
    );
  }

  calculateBaseRevenue(departmentCapability: number, department: string): number {
    const config = this.departmentConfigs[department];
    return config.baseRevenue * (1 + (departmentCapability / 100) * config.growthRate);
  }

  calculateAppropriateHeadcount(totalEmployees: number, department: string): number {
    const config = this.departmentConfigs[department];
    return config.standardHeadcount * (totalEmployees / 100);
  }

  calculateFulfillmentRate(allocatedCount: number, appropriateHeadcount: number): number {
    return appropriateHeadcount > 0 ? allocatedCount / appropriateHeadcount : 0;
  }

  getShortageCoefficient(fulfillmentRate: number, department: string): number {
    for (const correction of this.shortageCorrections) {
      if (fulfillmentRate >= correction.fulfillmentRate) {
        return correction.coefficients[department];
      }
    }
    return 0.3;
  }

  getSurplusCoefficient(fulfillmentRate: number): number {
    for (const correction of this.surplusCorrections) {
      if (fulfillmentRate <= correction.maxFulfillmentRate) {
        return correction.coefficient;
      }
    }
    return 0.8;
  }

  calculateCost(personnelCosts: number[]): number {
    return (personnelCosts.reduce((sum, cost) => sum + cost, 0) * this.constraints.PERSONNEL_COST_MULTIPLIER) / 100;
  }

  calculateProfit(finalRevenue: number, cost: number): number {
    return finalRevenue - cost;
  }

  calculateDepartmentResult(
    employees: Employee[],
    allocatedCount: number,
    department: string,
    totalEmployees: number
  ): DepartmentResult {
    const employeeContributions = employees.map((emp) =>
      this.calculateEmployeeContribution(emp, department)
    );
    const departmentCapability = employeeContributions.reduce((sum, contrib) => sum + contrib, 0);
    const baseRevenue = this.calculateBaseRevenue(departmentCapability, department);
    const appropriateHeadcount = this.calculateAppropriateHeadcount(totalEmployees, department);
    const fulfillmentRate = this.calculateFulfillmentRate(allocatedCount, appropriateHeadcount);
    const shortageCoefficient = this.getShortageCoefficient(fulfillmentRate, department);
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

  // Step 1: 制約のクリア - 最低配置人数を満たし、合計100/110名となる人数構成パターンをすべて洗い出す
  generateValidAllocationPatterns(totalEmployees: number): AllocationPattern[] {
    const minHeadcounts = {
      A: Math.ceil(this.departmentConfigs['A'].minHeadcount * (totalEmployees / 100)),
      B: Math.ceil(this.departmentConfigs['B'].minHeadcount * (totalEmployees / 100)),
      C: Math.ceil(this.departmentConfigs['C'].minHeadcount * (totalEmployees / 100)),
    };

    const patterns: AllocationPattern[] = [];

    // Generate all valid patterns where A + B + C = totalEmployees
    // and each department meets minimum requirements
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

  // Step 2: 多様な初期配置を生成（貪欲法を排除）
  private generateDiverseInitialAllocations(
    employees: Employee[],
    pattern: AllocationPattern,
    lockedEmployees?: Record<string, string>
  ): Record<string, string[]>[] {
    const initialAllocations: Record<string, string[]>[] = [];
    const unlockedEmployees = employees.filter(
      (emp) => !lockedEmployees || !lockedEmployees[emp.id]
    );

    // Strategy 1: Multiple random allocations (30 iterations)
    for (let i = 0; i < 30; i++) {
      const shuffled = [...unlockedEmployees].sort(() => Math.random() - 0.5);
      const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

      // Place locked employees first
      if (lockedEmployees) {
        for (const [empId, dept] of Object.entries(lockedEmployees)) {
          allocation[dept].push(empId);
        }
      }

      // Allocate remaining in random order
      let idx = 0;
      for (const dept of ['A', 'B', 'C']) {
        const needed = pattern[dept as keyof AllocationPattern] - allocation[dept].length;
        for (let j = 0; j < needed && idx < shuffled.length; j++) {
          allocation[dept].push(shuffled[idx].id);
          idx++;
        }
      }
      initialAllocations.push(allocation);
    }

    // Strategy 2: Stratified random allocations (10 iterations)
    for (let i = 0; i < 10; i++) {
      const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

      // Place locked employees
      if (lockedEmployees) {
        for (const [empId, dept] of Object.entries(lockedEmployees)) {
          allocation[dept].push(empId);
        }
      }

      const availableEmployees = new Set(unlockedEmployees.map((e) => e.id));
      for (const dept of ['A', 'B', 'C']) {
        const needed = pattern[dept as keyof AllocationPattern] - allocation[dept].length;
        const candidates = Array.from(availableEmployees);

        for (let j = 0; j < needed && candidates.length > 0; j++) {
          const randomIndex = Math.floor(Math.random() * candidates.length);
          const empId = candidates[randomIndex];
          allocation[dept].push(empId);
          availableEmployees.delete(empId);
          candidates.splice(randomIndex, 1);
        }
      }
      initialAllocations.push(allocation);
    }

    // Strategy 3: Round-robin allocation
    {
      const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

      if (lockedEmployees) {
        for (const [empId, dept] of Object.entries(lockedEmployees)) {
          allocation[dept].push(empId);
        }
      }

      const depts = ['A', 'B', 'C'] as const;
      let deptIdx = 0;

      for (const emp of unlockedEmployees) {
        let assigned = false;
        for (let attempts = 0; attempts < 3; attempts++) {
          const dept = depts[deptIdx];
          if (
            allocation[dept].length <
            pattern[dept as keyof AllocationPattern]
          ) {
            allocation[dept].push(emp.id);
            assigned = true;
            deptIdx = (deptIdx + 1) % 3;
            break;
          }
          deptIdx = (deptIdx + 1) % 3;
        }
        if (!assigned) {
          for (const dept of depts) {
            if (
              allocation[dept].length <
              pattern[dept as keyof AllocationPattern]
            ) {
              allocation[dept].push(emp.id);
              break;
            }
          }
        }
      }
      initialAllocations.push(allocation);
    }

    return initialAllocations;
  }

  // 局所探索：スワップベースで改善
  private improveViaLocalSearch(
    employees: Employee[],
    allocation: Record<string, string[]>,
    objective: DepartmentObjective,
    pattern: AllocationPattern,
    maxIterations: number = 200
  ): Record<string, string[]> {
    let currentAllocation = JSON.parse(JSON.stringify(allocation));
    let currentResult = this.simulateAllocation(
      employees,
      currentAllocation,
      employees.length
    );
    let currentScore = this.calculateObjectiveScore(currentResult, objective);

    let improved = true;
    let iterations = 0;
    const tolerance = 1e-8;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      const depts = ['A', 'B', 'C'];

      // Try swapping employees between departments
      for (let i = 0; i < depts.length; i++) {
        for (let j = i + 1; j < depts.length; j++) {
          const dept1 = depts[i];
          const dept2 = depts[j];

          for (let k = 0; k < currentAllocation[dept1].length; k++) {
            for (let l = 0; l < currentAllocation[dept2].length; l++) {
              const testAllocation = JSON.parse(
                JSON.stringify(currentAllocation)
              );
              const temp = testAllocation[dept1][k];
              testAllocation[dept1][k] = testAllocation[dept2][l];
              testAllocation[dept2][l] = temp;

              const testResult = this.simulateAllocation(
                employees,
                testAllocation,
                employees.length
              );
              const testScore = this.calculateObjectiveScore(
                testResult,
                objective
              );

              if (testScore > currentScore + tolerance) {
                currentAllocation = testAllocation;
                currentScore = testScore;
                currentResult = testResult;
                improved = true;
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }

    return currentAllocation;
  }

  private calculateObjectiveScore(
    result: AllocationResult,
    objective: DepartmentObjective
  ): number {
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

  // Step 2: 各パターンに対して最適な割り当て（社員の最適配置）を実行
  private optimizeAllocationForPattern(
    employees: Employee[],
    pattern: AllocationPattern,
    objective: DepartmentObjective,
    lockedEmployees?: Record<string, string>
  ): { allocation: Record<string, string[]>; score: number } {
    // Validate locked employees against pattern
    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    if (lockedEmployees) {
      for (const dept of Object.values(lockedEmployees)) {
        if (lockedCounts[dept] !== undefined) {
          lockedCounts[dept]++;
        }
      }
    }

    // Check if locked allocation exceeds pattern
    for (const dept of ['A', 'B', 'C']) {
      if (lockedCounts[dept] > pattern[dept as keyof AllocationPattern]) {
        return {
          allocation: { A: [], B: [], C: [] },
          score: -Infinity,
        };
      }
    }

    const initialAllocations = this.generateDiverseInitialAllocations(
      employees,
      pattern,
      lockedEmployees
    );

    let bestAllocation: Record<string, string[]> = { A: [], B: [], C: [] };
    let bestScore = -Infinity;
    let bestResult: AllocationResult | null = null;

    for (const initAllocation of initialAllocations) {
      const improvedAllocation = this.improveViaLocalSearch(
        employees,
        initAllocation,
        objective,
        pattern,
        200
      );

      const result = this.simulateAllocation(employees, improvedAllocation, employees.length);
      const score = this.calculateObjectiveScore(result, objective);

      if (score > bestScore) {
        bestScore = score;
        bestAllocation = improvedAllocation;
        bestResult = result;
      } else if (
        Math.abs(score - bestScore) < 1e-8 &&
        bestResult !== null
      ) {
        const currentA = result.department['A'].finalRevenue;
        const bestA = bestResult.department['A'].finalRevenue;
        if (currentA > bestA) {
          bestScore = score;
          bestAllocation = improvedAllocation;
          bestResult = result;
        }
      }
    }

    return { allocation: bestAllocation, score: bestScore };
  }

  // Step 3: シミュレーション実行
  simulateAllocation(
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
      const deptEmployees = employees.filter((emp) => deptEmployeeIds.includes(emp.id));
      const allocatedCount = deptEmployees.length;

      const deptResult = this.calculateDepartmentResult(
        deptEmployees,
        allocatedCount,
        dept,
        totalEmployees
      );

      result.department[dept] = {
        ...deptResult,
        allocatedEmployeeIds: deptEmployeeIds,
      };
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

  // メイン：ハイブリッド計算アルゴリズム
  runHybridSimulation(
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees?: Record<string, string>
  ): AllocationResult {
    // Step 1: 制約のクリア - 有効な人数構成パターンをすべて生成
    const patterns = this.generateValidAllocationPatterns(totalEmployees);

    let bestAllocation: Record<string, string[]> = { A: [], B: [], C: [] };
    let bestScore = -Infinity;
    let bestResult: AllocationResult | null = null;

    // Step 2 & 3: 各パターンに対して最適割り当てを実施
    for (const pattern of patterns) {
      const { allocation, score } = this.optimizeAllocationForPattern(
        employees,
        pattern,
        objective,
        lockedEmployees
      );

      if (score === -Infinity) {
        continue; // Skip invalid patterns
      }

      const result = this.simulateAllocation(employees, allocation, totalEmployees);

      // 制約チェック：全社売上が58億円を上回ること
      if (result.summary.totalRevenue > this.constraints.MIN_TOTAL_REVENUE) {
        if (score > bestScore) {
          bestScore = score;
          bestAllocation = allocation;
          bestResult = result;
        }
      }
    }

    // フォールバック：制約を満たすパターンがない場合、最高スコアパターンを返す
    if (!bestResult) {
      bestScore = -Infinity;
      for (const pattern of patterns) {
        const { allocation, score } = this.optimizeAllocationForPattern(
          employees,
          pattern,
          objective,
          lockedEmployees
        );

        if (score > bestScore) {
          bestScore = score;
          bestAllocation = allocation;
          bestResult = this.simulateAllocation(
            employees,
            allocation,
            totalEmployees
          );
        }
      }
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
        A: {
          allocatedEmployees: minHeadcounts.A,
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
          allocatedEmployees: minHeadcounts.B,
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
          allocatedEmployees: minHeadcounts.C,
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

const engine = new HybridSimulationEngine();

// Listen for messages from the main thread
addEventListener('message', ({ data }: MessageEvent<WorkerMessage>) => {
  try {
    const result = engine.runHybridSimulation(
      data.employees,
      data.objective,
      data.totalEmployees,
      data.lockedEmployees
    );

    postMessage(result);
  } catch (error) {
    postMessage({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});
