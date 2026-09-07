/// <reference lib="webworker" />

import { Employee, AllocationResult, DepartmentResult, DepartmentObjective, SatisfactionSecondaryObjective } from '../core/models/simulation.model';
import { EVALUATION_WEIGHTS, DEPARTMENT_CONFIGS, SHORTAGE_CORRECTIONS, SURPLUS_CORRECTIONS, CONSTRAINTS } from '../shared/constants/simulation.constants';
import munkres from 'munkres-js';

interface WorkerMessage {
  employees: Employee[];
  objective: DepartmentObjective;
  totalEmployees: number;
  lockedEmployees?: Record<string, string>;
  satisfactionSecondaryObjective?: SatisfactionSecondaryObjective;
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

export class OptimalSimulationEngine {
  private evaluationWeights = EVALUATION_WEIGHTS;
  private departmentConfigs = DEPARTMENT_CONFIGS;
  private shortageCorrections = SHORTAGE_CORRECTIONS;
  private surplusCorrections = SURPLUS_CORRECTIONS;
  private constraints = CONSTRAINTS;
  // 満足度重視モードの辞書式最適化: 希望不一致1件のペナルティは、あらゆる限界貢献額の差より
  // 常に大きくなるよう十分大きい値を設定する（第一目的=希望一致数を必ず優先させるため）
  private readonly SATISFACTION_MISMATCH_PENALTY = 1e6;
  private readonly LOCKED_VIOLATION_PENALTY = 1e9;

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
      const allocatedCount = pattern[dept as keyof AllocationPattern];
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
        const contribution = contributions[dept as keyof PrecomputedContributions][empIdx];
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

  // 満足度重視モード用コスト行列
  // 第一目的（配属希望一致人数の最大化）を必ず優先し、第二目的（選択評価軸の限界貢献）を
  // 同一の割当問題内でタイブレークとして扱うため、
  // コスト = 不一致ペナルティ(巨大) - 限界貢献額 という単一のコストに合成せず、
  // 「不一致ペナルティ」が常に限界貢献額の差を上回るよう十分大きい定数を用いることで、
  // ハンガリー法の最小化が結果的に辞書式最適化と同値になるようにする。
  private buildSatisfactionCostMatrix(
    employees: Employee[],
    pattern: AllocationPattern,
    contributions: PrecomputedContributions,
    totalEmployees: number,
    lockedEmployees?: Record<string, string>
  ): { matrix: number[][]; deptMapping: string[] } {
    const n = employees.length;
    const deptMapping: string[] = [];

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

    const deptCorrectionMap: Record<string, { shortage: number; surplus: number }> = {};
    for (const dept of ['A', 'B', 'C']) {
      const allocatedCount = pattern[dept as keyof AllocationPattern];
      const appropriateHeadcount = this.calculateAppropriateHeadcount(totalEmployees, dept);
      const fulfillmentRate = this.calculateFulfillmentRate(allocatedCount, appropriateHeadcount);
      const shortageCoeff = this.getShortageCoefficient(fulfillmentRate, dept);
      const surplusCoeff = this.getSurplusCoefficient(fulfillmentRate);
      deptCorrectionMap[dept] = { shortage: shortageCoeff, surplus: surplusCoeff };
    }

    const matrix: number[][] = [];
    for (let empIdx = 0; empIdx < n; empIdx++) {
      const row: number[] = [];
      const emp = employees[empIdx];
      const lockedDept = lockedEmployees?.[emp.id];

      for (let slotIdx = 0; slotIdx < deptMapping.length; slotIdx++) {
        const dept = deptMapping[slotIdx];

        if (lockedDept && lockedDept !== dept) {
          row.push(this.LOCKED_VIOLATION_PENALTY);
          continue;
        }

        const contribution = contributions[dept as keyof PrecomputedContributions][empIdx];
        const config = this.departmentConfigs[dept];
        const corrections = deptCorrectionMap[dept];
        const marginalContribution =
          config.baseRevenue * config.growthRate * (contribution / 100) * corrections.shortage * corrections.surplus;

        const isMatch = !!emp.preference && emp.preference !== 'NONE' && emp.preference === dept;
        const mismatchPenalty = isMatch ? 0 : this.SATISFACTION_MISMATCH_PENALTY;

        row.push(mismatchPenalty - marginalContribution);
      }
      matrix.push(row);
    }

    return { matrix, deptMapping };
  }

  private countPreferenceMatches(
    employees: Employee[],
    allocation: Record<string, string[]>
  ): number {
    const employeeById = new Map(employees.map((emp) => [emp.id, emp]));
    let count = 0;
    for (const dept of ['A', 'B', 'C']) {
      for (const id of allocation[dept] || []) {
        const emp = employeeById.get(id);
        if (emp?.preference && emp.preference !== 'NONE' && emp.preference === dept) {
          count++;
        }
      }
    }
    return count;
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

  private verifyExpectedResults(
    result: AllocationResult,
    objective: DepartmentObjective,
    totalEmployees: number
  ): void {
    if (totalEmployees !== 100) return; // Verify only 100-employee mode

    const allocation = result.allocation;
    const deptA = result.department['A'];
    const deptB = result.department['B'];
    const deptC = result.department['C'];

    const mappings: Partial<Record<DepartmentObjective, { name: string; expectedA?: number; expectedB?: number; expectedC?: number; metricKey: string }>> = {
      'totalRevenue': {
        name: '全社売上最大化',
        expectedA: 40,
        expectedB: 40,
        expectedC: 20,
        metricKey: 'totalRevenue',
      },
      'departmentAProfitMaximize': {
        name: 'A事業部利益最大化',
        expectedA: 48,
        metricKey: 'deptAProfitValue',
      },
      'departmentBRevenueMaximize': {
        name: 'B事業部売上最大化',
        expectedB: 56,
        metricKey: 'deptBRevenueValue',
      },
      'departmentCRevenueMaximize': {
        name: 'C事業部売上最大化',
        expectedC: 50,
        metricKey: 'deptCRevenueValue',
      },
    };

    const mapping = mappings[objective];
    if (!mapping) return;

    let verificationMsg = `[Verification] 課題（${mapping.name}） @ ${totalEmployees}名: `;
    let details: string[] = [];

    // Check allocation match
    if (mapping.expectedA !== undefined) {
      const aMatch = allocation['A'] === mapping.expectedA;
      details.push(`A配置=${allocation['A']}名 (期待値=${mapping.expectedA}名, ${aMatch ? '✓' : '✗'})`);
    } else {
      details.push(`A配置=${allocation['A']}名`);
    }

    if (mapping.expectedB !== undefined) {
      const bMatch = allocation['B'] === mapping.expectedB;
      details.push(`B配置=${allocation['B']}名 (期待値=${mapping.expectedB}名, ${bMatch ? '✓' : '✗'})`);
    } else {
      details.push(`B配置=${allocation['B']}名`);
    }

    if (mapping.expectedC !== undefined) {
      const cMatch = allocation['C'] === mapping.expectedC;
      details.push(`C配置=${allocation['C']}名 (期待値=${mapping.expectedC}名, ${cMatch ? '✓' : '✗'})`);
    } else {
      details.push(`C配置=${allocation['C']}名`);
    }

    // Log metrics
    if (objective === 'totalRevenue') {
      details.push(`全社売上=${result.summary.totalRevenue.toFixed(2)}億円`);
      details.push(`全社利益=${result.summary.totalProfit.toFixed(2)}億円`);
    } else if (objective === 'departmentAProfitMaximize') {
      details.push(`A利益=${deptA.profit.toFixed(2)}億円`);
    } else if (objective === 'departmentBRevenueMaximize') {
      details.push(`B売上=${deptB.finalRevenue.toFixed(2)}億円`);
    } else if (objective === 'departmentCRevenueMaximize') {
      details.push(`C売上=${deptC.finalRevenue.toFixed(2)}億円`);
    }

    verificationMsg += details.join(', ');
    console.log(verificationMsg);
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
      const result = this.simulateAllocation(employees, allocation, totalEmployees);
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

    if (bestResult) {
      console.log(
        `[Worker] Optimal: A=${bestResult.allocation['A']}, B=${bestResult.allocation['B']}, C=${bestResult.allocation['C']}, Revenue=${bestResult.summary.totalRevenue.toFixed(2)}B`
      );
      // Verify expected results
      this.verifyExpectedResults(bestResult, objective, totalEmployees);
    }

    // bestScoreが -Infinity の場合（すべてのパターンが制約を満たさない）、最後の結果を返す
    if (!isFinite(bestScore) && lastValidResult) {
      console.log(`[Worker] All patterns below MIN_TOTAL_REVENUE, using last valid result as fallback`);
      return lastValidResult;
    }

    return bestResult || this.generateDefaultResult(totalEmployees);
  }

  // 従業員満足度重視モード: 辞書式最適化
  // 第一目的: 配属希望一致人数の最大化 / 第二目的: 選択された評価軸（売上/利益）の最大化
  runSatisfactionSimulation(
    employees: Employee[],
    totalEmployees: number,
    secondaryObjective: SatisfactionSecondaryObjective = 'totalRevenue',
    lockedEmployees?: Record<string, string>
  ): AllocationResult {
    const contributions = this.precomputeContributions(employees);
    const patterns = this.generateValidAllocationPatterns(totalEmployees);
    console.log(`[Worker] (Satisfaction) Generated ${patterns.length} valid allocation patterns`);

    let bestResult: AllocationResult | null = null;
    let bestMatchCount = -1;
    let bestSecondaryScore = -Infinity;
    let lastValidResult: AllocationResult | null = null;

    for (const pattern of patterns) {
      if (!this.validateLockedEmployees(pattern, lockedEmployees)) {
        continue;
      }

      const { matrix, deptMapping } = this.buildSatisfactionCostMatrix(
        employees,
        pattern,
        contributions,
        totalEmployees,
        lockedEmployees
      );

      const allocation = this.solveHungarianAndGetAllocation(employees, matrix, deptMapping);
      const result = this.simulateAllocation(employees, allocation, totalEmployees);
      lastValidResult = result;

      const matchCount = this.countPreferenceMatches(employees, allocation);
      const meetsRevenueFloor = result.summary.totalRevenue >= this.constraints.MIN_TOTAL_REVENUE;
      const secondaryValue =
        secondaryObjective === 'totalProfit' ? result.summary.totalProfit : result.summary.totalRevenue;
      const secondaryScore = meetsRevenueFloor ? secondaryValue : -Infinity;

      const isBetter =
        matchCount > bestMatchCount ||
        (matchCount === bestMatchCount && secondaryScore > bestSecondaryScore);

      if (isBetter) {
        bestMatchCount = matchCount;
        bestSecondaryScore = secondaryScore;
        bestResult = result;
      }
    }

    if (!isFinite(bestSecondaryScore) && lastValidResult) {
      console.log('[Worker] (Satisfaction) All patterns below MIN_TOTAL_REVENUE, using last valid result as fallback');
      return lastValidResult;
    }

    if (bestResult) {
      console.log(
        `[Worker] (Satisfaction) Optimal: A=${bestResult.allocation['A']}, B=${bestResult.allocation['B']}, C=${bestResult.allocation['C']}, MatchCount=${bestMatchCount}`
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
    const result =
      data.objective === 'employeeSatisfaction'
        ? engine.runSatisfactionSimulation(
            data.employees,
            data.totalEmployees,
            data.satisfactionSecondaryObjective,
            data.lockedEmployees
          )
        : engine.runOptimalSimulation(
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
