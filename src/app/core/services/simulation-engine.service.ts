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

  // Generate diverse initial allocations (eliminating greedy allocation based on sorted scores)
  private generateInitialAllocations(
    employees: Employee[],
    pattern: Record<string, number>,
    lockedEmployees: Record<string, string>
  ): Record<string, string[]>[] {
    const initialAllocations: Record<string, string[]>[] = [];
    const unlockedEmployees = employees.filter(emp => !lockedEmployees[emp.id]);

    // Random allocation strategy: generate multiple random shuffles
    // This avoids greedy score-based allocation and explores diverse patterns
    for (let iteration = 0; iteration < 50; iteration++) {
      // Create random permutation of unlocked employees
      const shuffled = [...unlockedEmployees].sort(() => Math.random() - 0.5);
      const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

      // Place locked employees first
      for (const [empId, dept] of Object.entries(lockedEmployees)) {
        allocation[dept].push(empId);
      }

      // Allocate remaining employees in random order
      let idx = 0;
      for (const dept of ['A', 'B', 'C']) {
        const needed = pattern[dept] - allocation[dept].length;
        for (let i = 0; i < needed && idx < shuffled.length; i++) {
          allocation[dept].push(shuffled[idx].id);
          idx++;
        }
      }

      initialAllocations.push(allocation);
    }

    // Add stratified random allocations: distribute by capability across departments
    for (let iteration = 0; iteration < 20; iteration++) {
      const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

      // Place locked employees
      for (const [empId, dept] of Object.entries(lockedEmployees)) {
        allocation[dept].push(empId);
      }

      // For each department, randomly select remaining employees needed
      const availableEmployees = new Set(unlockedEmployees.map(e => e.id));

      for (const dept of ['A', 'B', 'C']) {
        const needed = pattern[dept] - allocation[dept].length;
        const candidates = Array.from(availableEmployees);

        for (let i = 0; i < needed && candidates.length > 0; i++) {
          const randomIndex = Math.floor(Math.random() * candidates.length);
          const empId = candidates[randomIndex];
          allocation[dept].push(empId);
          availableEmployees.delete(empId);
          candidates.splice(randomIndex, 1);
        }
      }

      initialAllocations.push(allocation);
    }

    // Add round-robin allocation
    {
      const allocation: Record<string, string[]> = { A: [], B: [], C: [] };

      // Place locked employees
      for (const [empId, dept] of Object.entries(lockedEmployees)) {
        allocation[dept].push(empId);
      }

      const depts = ['A', 'B', 'C'];
      let deptIdx = 0;
      for (const emp of unlockedEmployees) {
        // Find next department that still needs employees
        let assigned = false;
        for (let attempts = 0; attempts < 3; attempts++) {
          const dept = depts[deptIdx];
          if (allocation[dept].length < pattern[dept]) {
            allocation[dept].push(emp.id);
            assigned = true;
            deptIdx = (deptIdx + 1) % 3;
            break;
          }
          deptIdx = (deptIdx + 1) % 3;
        }
        if (!assigned) {
          // Fallback: place in first available department
          for (const dept of depts) {
            if (allocation[dept].length < pattern[dept]) {
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

  // Local search: improve allocation via swaps and random restarts
  private improveAllocationViaLocalSearch(
    employees: Employee[],
    allocation: Record<string, string[]>,
    pattern: Record<string, number>,
    objective: DepartmentObjective,
    maxIterations: number = 200
  ): Record<string, string[]> {
    let currentAllocation = JSON.parse(JSON.stringify(allocation));
    let currentResult = this.simulateWithAllocation(employees, currentAllocation, employees.length);
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

          // Try all possible swaps between these two departments
          for (let k = 0; k < currentAllocation[dept1].length; k++) {
            for (let l = 0; l < currentAllocation[dept2].length; l++) {
              const testAllocation = JSON.parse(JSON.stringify(currentAllocation));
              const temp = testAllocation[dept1][k];
              testAllocation[dept1][k] = testAllocation[dept2][l];
              testAllocation[dept2][l] = temp;

              const testResult = this.simulateWithAllocation(employees, testAllocation, employees.length);
              const testScore = this.calculateObjectiveScore(testResult, objective);

              if (testScore > currentScore + tolerance) {
                currentAllocation = testAllocation;
                currentScore = testScore;
                currentResult = testResult;
                improved = true;
                break;  // Move to next iteration after finding improvement
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }

      // If no improvement from swaps, try perturbation and continue search
      if (!improved && iterations < maxIterations * 0.8) {
        // Gentle perturbation: swap a random pair of employees
        const dept1 = depts[Math.floor(Math.random() * 3)];
        const dept2 = depts[Math.floor(Math.random() * 3)];
        if (dept1 !== dept2 &&
            currentAllocation[dept1].length > 0 &&
            currentAllocation[dept2].length > 0) {
          const k = Math.floor(Math.random() * currentAllocation[dept1].length);
          const l = Math.floor(Math.random() * currentAllocation[dept2].length);

          const testAllocation = JSON.parse(JSON.stringify(currentAllocation));
          const temp = testAllocation[dept1][k];
          testAllocation[dept1][k] = testAllocation[dept2][l];
          testAllocation[dept2][l] = temp;

          const testResult = this.simulateWithAllocation(employees, testAllocation, employees.length);
          const testScore = this.calculateObjectiveScore(testResult, objective);

          // Accept perturbation even if not better (for exploration)
          if (testScore > currentScore - 0.01) {
            currentAllocation = testAllocation;
            currentScore = testScore;
            currentResult = testResult;
            improved = true;
          }
        }
      }
    }

    return currentAllocation;
  }

  // Step 2: For a given pattern, find optimal employee allocation via diverse search strategies
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

    // Generate diverse initial allocations (no greedy sorting)
    const initialAllocations = this.generateInitialAllocations(
      employees,
      pattern,
      lockedEmployees
    );

    let bestAllocation: Record<string, string[]> = { A: [], B: [], C: [] };
    let bestScore = -Infinity;
    let bestResult: AllocationResult | null = null;

    // Improve each initial allocation via local search with increased iterations
    for (const initAllocation of initialAllocations) {
      const improvedAllocation = this.improveAllocationViaLocalSearch(
        employees,
        initAllocation,
        pattern,
        objective,
        500  // Increased from 50 to 500 for more thorough exploration
      );

      const result = this.simulateWithAllocation(employees, improvedAllocation, employees.length);
      const score = this.calculateObjectiveScore(result, objective);

      // Tiebreaker: prefer higher department A revenue
      if (score > bestScore) {
        bestScore = score;
        bestAllocation = improvedAllocation;
        bestResult = result;
      } else if (score === bestScore && bestResult !== null) {
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
    comparison.push(`\n${'='.repeat(80)}`);
    comparison.push(`=== OPTIMAL ALLOCATION VERIFICATION (100 employees, Total Revenue Maximization) ===`);
    comparison.push(`${'='.repeat(80)}\n`);

    comparison.push(`📊 OPTIMAL SOLUTION:`);
    comparison.push(`  Allocation: A=${optimalAllocation.A}, B=${optimalAllocation.B}, C=${optimalAllocation.C}`);
    comparison.push(`  Total Revenue: ${optimalResult.summary.totalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Total Profit: ${optimalResult.summary.totalProfit.toFixed(4)} (100M JPY)`);
    comparison.push(`  Total Cost: ${optimalResult.summary.totalCost.toFixed(4)} (100M JPY)\n`);

    comparison.push(`Department A:`);
    comparison.push(`  Revenue: ${optimalResult.department['A'].finalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Capability: ${optimalResult.department['A'].departmentCapability.toFixed(4)}`);
    comparison.push(`  Fulfillment Rate: ${optimalResult.department['A'].fulfillmentRate.toFixed(4)} (${(optimalResult.department['A'].fulfillmentRate * 100).toFixed(1)}%)`);
    comparison.push(`  Shortage Coeff: ${optimalResult.department['A'].shortageCoefficient.toFixed(4)}`);
    comparison.push(`  Surplus Coeff: ${optimalResult.department['A'].surplusCoefficient.toFixed(4)}\n`);

    comparison.push(`Department B:`);
    comparison.push(`  Revenue: ${optimalResult.department['B'].finalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Capability: ${optimalResult.department['B'].departmentCapability.toFixed(4)}`);
    comparison.push(`  Fulfillment Rate: ${optimalResult.department['B'].fulfillmentRate.toFixed(4)} (${(optimalResult.department['B'].fulfillmentRate * 100).toFixed(1)}%)`);
    comparison.push(`  Shortage Coeff: ${optimalResult.department['B'].shortageCoefficient.toFixed(4)}`);
    comparison.push(`  Surplus Coeff: ${optimalResult.department['B'].surplusCoefficient.toFixed(4)}\n`);

    comparison.push(`Department C:`);
    comparison.push(`  Revenue: ${optimalResult.department['C'].finalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Capability: ${optimalResult.department['C'].departmentCapability.toFixed(4)}`);
    comparison.push(`  Fulfillment Rate: ${optimalResult.department['C'].fulfillmentRate.toFixed(4)} (${(optimalResult.department['C'].fulfillmentRate * 100).toFixed(1)}%)`);
    comparison.push(`  Shortage Coeff: ${optimalResult.department['C'].shortageCoefficient.toFixed(4)}`);
    comparison.push(`  Surplus Coeff: ${optimalResult.department['C'].surplusCoefficient.toFixed(4)}\n`);

    // For comparison: test known allocations
    let localSolutionRevenue: number | undefined;
    let localSolutionProfit: number | undefined;

    // Evaluate 48/42/10 allocation
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

    // Evaluate 40/40/20 allocation
    const expected40_40_20Ids: Record<string, string[]> = { A: [], B: [], C: [] };
    for (let i = 0; i < 40; i++) {
      expected40_40_20Ids['A'].push(employees[i].id);
    }
    for (let i = 40; i < 80; i++) {
      expected40_40_20Ids['B'].push(employees[i].id);
    }
    for (let i = 80; i < 100; i++) {
      expected40_40_20Ids['C'].push(employees[i].id);
    }

    const expected40_40_20Result = this.simulateWithAllocation(employees, expected40_40_20Ids, 100);

    comparison.push(`${'='.repeat(80)}`);
    comparison.push(`=== COMPARISON WITH REFERENCE ALLOCATIONS ===`);
    comparison.push(`${'='.repeat(80)}\n`);

    comparison.push(`❌ Local Solution (48/42/10) [Greedy-based]:`);
    comparison.push(`  Allocation: A=48, B=42, C=10`);
    comparison.push(`  Total Revenue: ${localSolutionRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Total Profit: ${localSolutionProfit.toFixed(4)} (100M JPY)\n`);

    comparison.push(`🎯 Expected Solution (40/40/20) [Design Master]:`);
    comparison.push(`  Allocation: A=40, B=40, C=20`);
    comparison.push(`  Total Revenue: ${expected40_40_20Result.summary.totalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Total Profit: ${expected40_40_20Result.summary.totalProfit.toFixed(4)} (100M JPY)\n`);

    comparison.push(`📈 Revenue Comparison:`);
    comparison.push(`  Optimal vs 48/42/10: ${(optimalResult.summary.totalRevenue - localSolutionRevenue).toFixed(4)} (Optimal is ${optimalResult.summary.totalRevenue > localSolutionRevenue ? '🔼 BETTER' : '🔽 WORSE'})`);
    comparison.push(`  Optimal vs 40/40/20: ${(optimalResult.summary.totalRevenue - expected40_40_20Result.summary.totalRevenue).toFixed(4)} (${optimalResult.summary.totalRevenue >= expected40_40_20Result.summary.totalRevenue ? 'Match or Better' : 'Below Expected'})\n`);

    // Assertion checks
    const expectedA = 40, expectedB = 40, expectedC = 20;
    const isCorrectAllocation = optimalAllocation.A === expectedA && optimalAllocation.B === expectedB && optimalAllocation.C === expectedC;
    const expectedRevenue = 61.54;
    const isCorrectRevenue = Math.abs(optimalResult.summary.totalRevenue - expectedRevenue) < 0.1;
    const isOptimalBetterThanLocal = optimalResult.summary.totalRevenue > localSolutionRevenue;

    comparison.push(`${'='.repeat(80)}`);
    comparison.push(`=== ASSERTION RESULTS ===`);
    comparison.push(`${'='.repeat(80)}\n`);

    comparison.push(`✓ Allocation Verification:`);
    comparison.push(`  Expected: A=${expectedA}, B=${expectedB}, C=${expectedC}`);
    comparison.push(`  Actual:   A=${optimalAllocation.A}, B=${optimalAllocation.B}, C=${optimalAllocation.C}`);
    comparison.push(`  Status: ${isCorrectAllocation ? '✅ PASS' : '❌ FAIL'}\n`);

    comparison.push(`✓ Revenue Target (≈ ${expectedRevenue} 100M JPY):`);
    comparison.push(`  Actual Revenue: ${optimalResult.summary.totalRevenue.toFixed(4)} (100M JPY)`);
    comparison.push(`  Difference from Target: ${Math.abs(optimalResult.summary.totalRevenue - expectedRevenue).toFixed(4)} (100M JPY)`);
    comparison.push(`  Status: ${isCorrectRevenue ? '✅ PASS' : '❌ FAIL'}\n`);

    comparison.push(`✓ Optimal Solution Quality:`);
    comparison.push(`  Optimal Revenue vs Greedy (48/42/10): ${optimalResult.summary.totalRevenue.toFixed(4)} > ${localSolutionRevenue.toFixed(4)}`);
    comparison.push(`  Revenue Gain: ${(optimalResult.summary.totalRevenue - localSolutionRevenue).toFixed(4)} (100M JPY)`);
    comparison.push(`  Status: ${isOptimalBetterThanLocal ? '✅ PASS' : '❌ FAIL'}\n`);

    // Final summary
    comparison.push(`${'='.repeat(80)}`);
    if (isCorrectAllocation && isOptimalBetterThanLocal) {
      comparison.push(`🎉 SUCCESS: Greedy allocation eliminated. Optimal solution found correctly!`);
    } else {
      comparison.push(`⚠️ WARNING: Expected (40/40/20) with revenue ≈ 61.54, but got different result.`);
    }
    comparison.push(`${'='.repeat(80)}\n`);

    if (!isCorrectAllocation) {
      console.warn(`⚠️ Allocation mismatch: Expected (40/40/20) but got (${optimalAllocation.A}/${optimalAllocation.B}/${optimalAllocation.C})`);
    }

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
