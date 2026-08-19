import { Injectable } from '@angular/core';
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

  // Step 1: Generate all valid allocation patterns
  private generateAllocationPatterns(totalEmployees: number): Record<string, number>[] {
    const minHeadcounts: Record<string, number> = {
      A: Math.ceil(this.departmentConfigs['A'].minHeadcount * (totalEmployees / 100)),
      B: Math.ceil(this.departmentConfigs['B'].minHeadcount * (totalEmployees / 100)),
      C: Math.ceil(this.departmentConfigs['C'].minHeadcount * (totalEmployees / 100)),
    };

    const patterns: Record<string, number>[] = [];

    for (let a = minHeadcounts['A']; a <= totalEmployees - minHeadcounts['B'] - minHeadcounts['C']; a++) {
      for (let b = minHeadcounts['B']; b <= totalEmployees - a - minHeadcounts['C']; b++) {
        const c = totalEmployees - a - b;
        if (c >= minHeadcounts['C']) {
          patterns.push({ A: a, B: b, C: c });
        }
      }
    }

    return patterns;
  }

  // Calculate objective score for a given result
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

  // Generate initial allocations using various heuristics
  private generateInitialAllocations(
    employees: Employee[],
    pattern: Record<string, number>,
    lockedEmployees: Record<string, string>
  ): Record<string, string[]>[] {
    const initialAllocations: Record<string, string[]>[] = [];
    const unlockedEmployees = employees.filter(emp => !lockedEmployees[emp.id]);

    // Pre-calculate contribution scores
    const scores = new Map<string, Map<string, number>>();
    ['A', 'B', 'C'].forEach(dept => {
      const deptScores = new Map<string, number>();
      employees.forEach(emp => {
        deptScores.set(emp.id, this.calculateEmployeeContribution(emp, dept));
      });
      scores.set(dept, deptScores);
    });

    // Heuristic 1: Sort by combined score (sum of all departments)
    {
      const sorted = unlockedEmployees.map(emp => ({
        id: emp.id,
        combinedScore: (['A', 'B', 'C'] as const)
          .reduce((sum, dept) => sum + (scores.get(dept)?.get(emp.id) || 0), 0)
      })).sort((a, b) => b.combinedScore - a.combinedScore);

      const allocation = this.allocateFromSorted(
        sorted.map(x => x.id),
        pattern,
        lockedEmployees
      );
      initialAllocations.push(allocation);
    }

    // Heuristic 2-4: Sort by each department's score
    for (const targetDept of ['A', 'B', 'C']) {
      const sorted = unlockedEmployees.map(emp => ({
        id: emp.id,
        score: scores.get(targetDept)?.get(emp.id) || 0
      })).sort((a, b) => b.score - a.score);

      const allocation = this.allocateFromSorted(
        sorted.map(x => x.id),
        pattern,
        lockedEmployees
      );
      initialAllocations.push(allocation);
    }

    return initialAllocations;
  }

  // Allocate employees from a sorted list according to pattern
  private allocateFromSorted(
    sortedEmployeeIds: string[],
    pattern: Record<string, number>,
    lockedEmployees: Record<string, string>
  ): Record<string, string[]> {
    const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

    // Place locked employees
    for (const [empId, dept] of Object.entries(lockedEmployees)) {
      allocation[dept].push(empId);
    }

    // Place remaining employees
    const unallocatedIds = sortedEmployeeIds.filter(id => !lockedEmployees[id]);
    for (const empId of unallocatedIds) {
      // Find which department needs more employees
      for (const dept of ['A', 'B', 'C']) {
        if (allocation[dept].length < pattern[dept]) {
          allocation[dept].push(empId);
          break;
        }
      }
    }

    return allocation;
  }

  // Local search: improve allocation via swaps
  private improveAllocationViaLocalSearch(
    employees: Employee[],
    allocation: Record<string, string[]>,
    pattern: Record<string, number>,
    objective: DepartmentObjective,
    maxIterations: number = 50
  ): Record<string, string[]> {
    let currentAllocation = JSON.parse(JSON.stringify(allocation));
    let currentResult = this.simulateWithAllocation(employees, currentAllocation, employees.length);
    let currentScore = this.calculateObjectiveScore(currentResult, objective);

    let improved = true;
    let iterations = 0;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      const depts = ['A', 'B', 'C'];

      // Try swapping employees between departments
      for (let i = 0; i < depts.length && !improved; i++) {
        for (let j = i + 1; j < depts.length && !improved; j++) {
          const dept1 = depts[i];
          const dept2 = depts[j];

          // Sample swaps if arrays are large (optimization)
          const maxK = Math.min(currentAllocation[dept1].length, 10);
          const maxL = Math.min(currentAllocation[dept2].length, 10);

          for (let k = 0; k < maxK && !improved; k++) {
            for (let l = 0; l < maxL && !improved; l++) {
              const testAllocation = JSON.parse(JSON.stringify(currentAllocation));
              const temp = testAllocation[dept1][k];
              testAllocation[dept1][k] = testAllocation[dept2][l];
              testAllocation[dept2][l] = temp;

              const testResult = this.simulateWithAllocation(employees, testAllocation, employees.length);
              const testScore = this.calculateObjectiveScore(testResult, objective);

              if (testScore > currentScore + 0.0001) {
                currentAllocation = testAllocation;
                currentScore = testScore;
                currentResult = testResult;
                improved = true;
              }
            }
          }
        }
      }
    }

    return currentAllocation;
  }

  // Step 2: For a given pattern, find optimal employee allocation via exhaustive search over candidates
  private optimizeAllocationForPattern(
    employees: Employee[],
    pattern: Record<string, number>,
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string> = {}
  ): { allocation: Record<string, string[]>, score: number } {
    // Validate locked employees against pattern
    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const dept of Object.values(lockedEmployees)) {
      if (lockedCounts[dept] !== undefined) {
        lockedCounts[dept]++;
      }
    }

    // Check if locked allocation exceeds pattern
    for (const dept of ['A', 'B', 'C']) {
      if (lockedCounts[dept] > pattern[dept]) {
        // Return worst score to signal failure
        return { allocation: { A: [], B: [], C: [] }, score: -Infinity };
      }
    }

    // Generate multiple initial allocations
    const initialAllocations = this.generateInitialAllocations(
      employees,
      pattern,
      lockedEmployees
    );

    let bestAllocation: Record<string, string[]> = { A: [], B: [], C: [] };
    let bestScore = -Infinity;

    // Improve each initial allocation via local search
    for (const initAllocation of initialAllocations) {
      const improvedAllocation = this.improveAllocationViaLocalSearch(
        employees,
        initAllocation,
        pattern,
        objective,
        50
      );

      const result = this.simulateWithAllocation(employees, improvedAllocation, employees.length);
      const score = this.calculateObjectiveScore(result, objective);

      // Tiebreaker: prefer higher department A revenue
      if (score > bestScore ||
          (score === bestScore && result.department['A'].finalRevenue > this.simulateWithAllocation(employees, bestAllocation, employees.length).department['A'].finalRevenue)) {
        bestScore = score;
        bestAllocation = improvedAllocation;
      }
    }

    return { allocation: bestAllocation, score: bestScore };
  }

  // Validate locked employees against minimum headcount constraints
  private validateLockedEmployees(
    employees: Employee[],
    lockedEmployees: Record<string, string>
  ): { valid: boolean; error?: string } {
    const totalEmployees = employees.length;
    const minHeadcounts: Record<string, number> = {
      A: Math.ceil(this.departmentConfigs['A'].minHeadcount * (totalEmployees / 100)),
      B: Math.ceil(this.departmentConfigs['B'].minHeadcount * (totalEmployees / 100)),
      C: Math.ceil(this.departmentConfigs['C'].minHeadcount * (totalEmployees / 100)),
    };

    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const dept of Object.values(lockedEmployees)) {
      if (lockedCounts[dept] !== undefined) {
        lockedCounts[dept]++;
      }
    }

    // Check if locked counts exceed minimum headcount
    for (const dept of ['A', 'B', 'C']) {
      if (lockedCounts[dept] > totalEmployees - minHeadcounts['A'] - minHeadcounts['B'] - minHeadcounts['C'] + minHeadcounts[dept]) {
        return {
          valid: false,
          error: `Locked employees for department ${dept} (${lockedCounts[dept]}) exceed maximum allowed`
        };
      }
    }

    return { valid: true };
  }

  // Internal method: exhaustive search across all valid patterns
  private findOptimalAllocationInternal(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string> = {}
  ): Record<string, string[]> {
    // Validate locked employees first
    const validation = this.validateLockedEmployees(employees, lockedEmployees);
    if (!validation.valid) {
      throw new Error(`Lock constraint violation: ${validation.error}`);
    }

    const totalEmployeeCount = employees.length;
    const patterns = this.generateAllocationPatterns(totalEmployeeCount);

    let bestAllocation: Record<string, string[]> = { A: [], B: [], C: [] };
    let bestScore = -Infinity;
    let bestPatternIndex = 0;

    for (let idx = 0; idx < patterns.length; idx++) {
      const pattern = patterns[idx];
      const { allocation, score } = this.optimizeAllocationForPattern(
        employees,
        pattern,
        objective,
        lockedEmployees
      );

      if (score > bestScore) {
        bestScore = score;
        bestAllocation = allocation;
        bestPatternIndex = idx;
      }
    }

    return bestAllocation;
  }

  // Get allocated employees mapping
  getAllocatedEmployeeMapping(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string> = {}
  ): Record<string, string[]> {
    return this.findOptimalAllocationInternal(employees, objective, lockedEmployees);
  }

  // Calculate optimal allocation using exhaustive search
  calculateOptimalAllocation(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string> = {}
  ): Record<string, number> {
    const allocation = this.findOptimalAllocationInternal(employees, objective, lockedEmployees);

    return {
      A: allocation['A'].length,
      B: allocation['B'].length,
      C: allocation['C'].length,
    };
  }

  // Internal verification method for testing (100 employees, no locks, total revenue maximization)
  verifyOptimalAllocation(employees: Employee[]): {
    optimalAllocation: Record<string, number>;
    optimalRevenue: number;
    optimalProfit: number;
    localSolutionRevenue?: number;
    localSolutionProfit?: number;
    comparison: string[];
  } {
    if (employees.length !== 100) {
      throw new Error('Verification test requires exactly 100 employees');
    }

    // Test objective: total revenue maximization
    const objective: DepartmentObjective = 'totalRevenue';

    // Find optimal allocation
    const optimalAllocationIds = this.findOptimalAllocationInternal(employees, objective, {});
    const optimalResult = this.simulateWithAllocation(employees, optimalAllocationIds, 100);

    const optimalAllocation = {
      A: optimalAllocationIds['A'].length,
      B: optimalAllocationIds['B'].length,
      C: optimalAllocationIds['C'].length,
    };

    const comparison: string[] = [];
    comparison.push(`=== Optimal Allocation Verification (100 employees, Total Revenue Maximization) ===`);
    comparison.push(`Optimal Allocation: A=${optimalAllocation.A}, B=${optimalAllocation.B}, C=${optimalAllocation.C}`);
    comparison.push(`Optimal Total Revenue: ${optimalResult.summary.totalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`Optimal Total Profit: ${optimalResult.summary.totalProfit.toFixed(4)} (100M JPY)`);
    comparison.push(`Department A - Revenue: ${optimalResult.department['A'].finalRevenue.toFixed(4)}, Capability: ${optimalResult.department['A'].departmentCapability.toFixed(4)}, Fulfillment Rate: ${optimalResult.department['A'].fulfillmentRate.toFixed(4)}`);
    comparison.push(`Department B - Revenue: ${optimalResult.department['B'].finalRevenue.toFixed(4)}, Capability: ${optimalResult.department['B'].departmentCapability.toFixed(4)}, Fulfillment Rate: ${optimalResult.department['B'].fulfillmentRate.toFixed(4)}`);
    comparison.push(`Department C - Revenue: ${optimalResult.department['C'].finalRevenue.toFixed(4)}, Capability: ${optimalResult.department['C'].departmentCapability.toFixed(4)}, Fulfillment Rate: ${optimalResult.department['C'].fulfillmentRate.toFixed(4)}`);

    // For comparison: test a known local solution (48/42/10)
    let localSolutionRevenue: number | undefined;
    let localSolutionProfit: number | undefined;

    // Try to construct a 48/42/10 allocation if possible
    const localAllocationIds: Record<string, string[]> = { A: [], B: [], C: [] };
    for (let i = 0; i < Math.min(48, employees.length); i++) {
      localAllocationIds['A'].push(employees[i].id);
    }
    for (let i = 48; i < Math.min(90, employees.length); i++) {
      localAllocationIds['B'].push(employees[i].id);
    }
    for (let i = 90; i < employees.length; i++) {
      localAllocationIds['C'].push(employees[i].id);
    }

    const localResult = this.simulateWithAllocation(employees, localAllocationIds, 100);
    localSolutionRevenue = localResult.summary.totalRevenue;
    localSolutionProfit = localResult.summary.totalProfit;

    comparison.push(``);
    comparison.push(`=== Comparison with Local Solution (48/42/10) ===`);
    comparison.push(`Local Solution Revenue: ${localSolutionRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`Local Solution Profit: ${localSolutionProfit.toFixed(4)} (100M JPY)`);
    comparison.push(`Revenue Difference: ${(optimalResult.summary.totalRevenue - localSolutionRevenue).toFixed(4)} (Optimal is ${optimalResult.summary.totalRevenue > localSolutionRevenue ? 'better' : 'worse'})`);
    comparison.push(`Profit Difference: ${(optimalResult.summary.totalProfit - localSolutionProfit).toFixed(4)} (Optimal is ${optimalResult.summary.totalProfit > localSolutionProfit ? 'better' : 'worse'})`);

    return {
      optimalAllocation,
      optimalRevenue: optimalResult.summary.totalRevenue,
      optimalProfit: optimalResult.summary.totalProfit,
      localSolutionRevenue,
      localSolutionProfit,
      comparison,
    };
  }

  // Debug method: evaluate specific allocation pattern
  evaluateAllocationPattern(
    employees: Employee[],
    pattern: Record<string, number>,
    objective: DepartmentObjective = 'totalRevenue'
  ): {
    allocation: Record<string, number>;
    totalRevenue: number;
    totalProfit: number;
    departmentDetails: Record<string, any>;
  } {
    // Create a fixed allocation for testing
    const allocation: Record<string, string[]> = { A: [], B: [], C: [] };
    let idx = 0;

    for (const dept of ['A', 'B', 'C']) {
      const needed = pattern[dept];
      for (let i = 0; i < needed && idx < employees.length; i++) {
        allocation[dept].push(employees[idx].id);
        idx++;
      }
    }

    const result = this.simulateWithAllocation(employees, allocation, employees.length);

    return {
      allocation: {
        A: allocation['A'].length,
        B: allocation['B'].length,
        C: allocation['C'].length,
      },
      totalRevenue: result.summary.totalRevenue,
      totalProfit: result.summary.totalProfit,
      departmentDetails: {
        A: {
          revenue: result.department['A'].finalRevenue,
          capability: result.department['A'].departmentCapability,
          fulfillmentRate: result.department['A'].fulfillmentRate,
          shortageCoefficient: result.department['A'].shortageCoefficient,
          surplusCoefficient: result.department['A'].surplusCoefficient,
        },
        B: {
          revenue: result.department['B'].finalRevenue,
          capability: result.department['B'].departmentCapability,
          fulfillmentRate: result.department['B'].fulfillmentRate,
          shortageCoefficient: result.department['B'].shortageCoefficient,
          surplusCoefficient: result.department['B'].surplusCoefficient,
        },
        C: {
          revenue: result.department['C'].finalRevenue,
          capability: result.department['C'].departmentCapability,
          fulfillmentRate: result.department['C'].fulfillmentRate,
          shortageCoefficient: result.department['C'].shortageCoefficient,
          surplusCoefficient: result.department['C'].surplusCoefficient,
        },
      },
    };
  }
}
