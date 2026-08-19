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

  // Step 2: 各パターンに対して最適な割り当て（社員の最適配置）を実行
  allocateEmployeesToPattern(
    employees: Employee[],
    pattern: AllocationPattern,
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees?: Record<string, string>
  ): Record<string, string[]> {
    const allocation: Record<string, Record<string, boolean>> = {
      A: {},
      B: {},
      C: {},
    };
    const allocatedEmployeeIds = new Set<string>();

    // First, allocate locked employees
    if (lockedEmployees) {
      for (const [empId, dept] of Object.entries(lockedEmployees)) {
        allocation[dept][empId] = true;
        allocatedEmployeeIds.add(empId);
      }
    }

    // Calculate contribution scores for each employee to each department
    const contributionScores = new Map<string, Map<string, number>>();
    ['A', 'B', 'C'].forEach((dept) => {
      const deptScores = new Map<string, number>();
      employees.forEach((emp) => {
        deptScores.set(emp.id, this.calculateEmployeeContribution(emp, dept));
      });
      contributionScores.set(dept, deptScores);
    });

    // Allocate employees by score to each department
    const departments = ['A', 'B', 'C'] as const;
    const allocations = [pattern.A, pattern.B, pattern.C];

    for (let deptIdx = 0; deptIdx < departments.length; deptIdx++) {
      const dept = departments[deptIdx];
      const requiredCount = allocations[deptIdx];
      const allocatedCount = Object.keys(allocation[dept]).length;
      const remaining = requiredCount - allocatedCount;

      if (remaining <= 0) continue;

      const deptScores = contributionScores.get(dept)!;

      const sortedEmployees = employees
        .filter((emp) => !allocatedEmployeeIds.has(emp.id))
        .sort((a, b) => (deptScores.get(b.id) || 0) - (deptScores.get(a.id) || 0));

      for (let i = 0; i < remaining && i < sortedEmployees.length; i++) {
        const emp = sortedEmployees[i];
        allocation[dept][emp.id] = true;
        allocatedEmployeeIds.add(emp.id);
      }
    }

    return {
      A: Object.keys(allocation['A']),
      B: Object.keys(allocation['B']),
      C: Object.keys(allocation['C']),
    };
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

    let bestResult: AllocationResult | null = null;
    let bestScore = -Infinity;

    // Step 2 & 3: 各パターンに対して最適割り当てと制約チェックを実施
    for (const pattern of patterns) {
      const allocatedIds = this.allocateEmployeesToPattern(
        employees,
        pattern,
        objective,
        totalEmployees,
        lockedEmployees
      );

      const result = this.simulateAllocation(employees, allocatedIds, totalEmployees);

      // 制約チェック：全社売上が58億円を上回ること
      if (result.summary.totalRevenue <= this.constraints.MIN_TOTAL_REVENUE) {
        continue;
      }

      // 目的に応じたスコア計算
      let score = 0;
      if (objective === 'totalRevenue') {
        score = result.summary.totalRevenue;
      } else if (objective === 'departmentAProfitMaximize') {
        score = result.department['A'].profit;
      } else if (objective === 'departmentBRevenueMaximize') {
        score = result.department['B'].finalRevenue;
      } else if (objective === 'departmentCRevenueMaximize') {
        score = result.department['C'].finalRevenue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }

    // フォールバック：制約を満たすパターンがない場合、最も制約に近いパターンを返す
    if (!bestResult) {
      for (const pattern of patterns) {
        const allocatedIds = this.allocateEmployeesToPattern(
          employees,
          pattern,
          objective,
          totalEmployees,
          lockedEmployees
        );
        const result = this.simulateAllocation(employees, allocatedIds, totalEmployees);

        let score = 0;
        if (objective === 'totalRevenue') {
          score = result.summary.totalRevenue;
        } else if (objective === 'departmentAProfitMaximize') {
          score = result.department['A'].profit;
        } else if (objective === 'departmentBRevenueMaximize') {
          score = result.department['B'].finalRevenue;
        } else if (objective === 'departmentCRevenueMaximize') {
          score = result.department['C'].finalRevenue;
        }

        if (score > bestScore) {
          bestScore = score;
          bestResult = result;
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
