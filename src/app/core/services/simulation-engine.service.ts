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
    };

    return result;
  }

  // Get allocated employees mapping
  getAllocatedEmployeeMapping(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string> = {}
  ): Record<string, string[]> {
    const totalEmployeeCount = employees.length;
    const allocation: Record<string, Record<string, boolean>> = {
      A: {},
      B: {},
      C: {},
    };
    const allocatedEmployeeIds = new Set<string>();

    // Step 0: Lock specified employees
    for (const [empId, dept] of Object.entries(lockedEmployees)) {
      if (allocation[dept]) {
        allocation[dept][empId] = true;
        allocatedEmployeeIds.add(empId);
      }
    }

    // Step 1: Calculate contribution scores
    const contributionScores = new Map<string, Map<string, number>>();
    ['A', 'B', 'C'].forEach((dept) => {
      const deptScores = new Map<string, number>();
      employees.forEach((emp) => {
        deptScores.set(emp.id, this.calculateEmployeeContribution(emp, dept));
      });
      contributionScores.set(dept, deptScores);
    });

    // Step 2: Ensure minimum allocation
    for (const dept of ['A', 'B', 'C']) {
      const scaledMinimum =
        this.departmentConfigs[dept].minHeadcount *
        (totalEmployeeCount / 100);
      const deptScores = contributionScores.get(dept)!;
      const currentAllocated = Object.keys(allocation[dept]).length;

      const sortedEmployees = employees
        .filter((emp) => !allocatedEmployeeIds.has(emp.id))
        .sort(
          (a, b) =>
            (deptScores.get(b.id) || 0) - (deptScores.get(a.id) || 0)
        );

      for (let i = 0; i < scaledMinimum - currentAllocated && i < sortedEmployees.length; i++) {
        const emp = sortedEmployees[i];
        allocation[dept][emp.id] = true;
        allocatedEmployeeIds.add(emp.id);
      }
    }

    // Step 3: Allocate remaining employees
    const remainingEmployees = employees.filter(
      (emp) => !allocatedEmployeeIds.has(emp.id)
    );

    for (const emp of remainingEmployees) {
      let bestDept = 'A';
      let bestScore = -Infinity;

      for (const dept of ['A', 'B', 'C']) {
        const testAllocation: Record<string, Record<string, boolean>> = {
          A: { ...allocation['A'] },
          B: { ...allocation['B'] },
          C: { ...allocation['C'] },
        };
        testAllocation[dept][emp.id] = true;

        const allocationCount: Record<string, number> = {
          A: Object.keys(testAllocation['A']).length,
          B: Object.keys(testAllocation['B']).length,
          C: Object.keys(testAllocation['C']).length,
        };

        const deptEmployeesA = employees.filter((e) => testAllocation['A'][e.id]);
        const deptEmployeesB = employees.filter((e) => testAllocation['B'][e.id]);
        const deptEmployeesC = employees.filter((e) => testAllocation['C'][e.id]);

        const resultA = this.calculateDepartmentResult(deptEmployeesA, allocationCount['A'], 'A', totalEmployeeCount);
        const resultB = this.calculateDepartmentResult(deptEmployeesB, allocationCount['B'], 'B', totalEmployeeCount);
        const resultC = this.calculateDepartmentResult(deptEmployeesC, allocationCount['C'], 'C', totalEmployeeCount);

        let score = 0;
        if (objective === 'totalRevenue') {
          score = resultA.finalRevenue + resultB.finalRevenue + resultC.finalRevenue;
        } else if (objective === 'departmentAProfitMaximize') {
          score = resultA.profit;
        } else if (objective === 'departmentBRevenueMaximize') {
          score = resultB.finalRevenue;
        } else if (objective === 'departmentCRevenueMaximize') {
          score = resultC.finalRevenue;
        }

        if (score > bestScore) {
          bestScore = score;
          bestDept = dept;
        }
      }

      allocation[bestDept][emp.id] = true;
    }

    return {
      A: Object.keys(allocation['A']),
      B: Object.keys(allocation['B']),
      C: Object.keys(allocation['C']),
    };
  }

  // Calculate optimal allocation using greedy algorithm
  calculateOptimalAllocation(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string> = {}
  ): Record<string, number> {
    const totalEmployeeCount = employees.length;

    // Step 0: Lock specified employees to their designated departments
    const allocation: Record<string, Record<string, boolean>> = {
      A: {},
      B: {},
      C: {},
    };
    const allocatedEmployeeIds = new Set<string>();

    for (const [empId, dept] of Object.entries(lockedEmployees)) {
      if (allocation[dept]) {
        allocation[dept][empId] = true;
        allocatedEmployeeIds.add(empId);
      }
    }

    // Step 1: Calculate contribution scores for each employee to each department
    const contributionScores = new Map<string, Map<string, number>>();
    ['A', 'B', 'C'].forEach((dept) => {
      const deptScores = new Map<string, number>();
      employees.forEach((emp) => {
        deptScores.set(emp.id, this.calculateEmployeeContribution(emp, dept));
      });
      contributionScores.set(dept, deptScores);
    });

    // Step 2: Ensure minimum allocation for each department
    for (const dept of ['A', 'B', 'C']) {
      const scaledMinimum =
        this.departmentConfigs[dept].minHeadcount *
        (totalEmployeeCount / 100);
      const deptScores = contributionScores.get(dept)!;
      const currentAllocated = Object.keys(allocation[dept]).length;

      const sortedEmployees = employees
        .filter((emp) => !allocatedEmployeeIds.has(emp.id))
        .sort(
          (a, b) =>
            (deptScores.get(b.id) || 0) - (deptScores.get(a.id) || 0)
        );

      for (let i = 0; i < scaledMinimum - currentAllocated && i < sortedEmployees.length; i++) {
        const emp = sortedEmployees[i];
        allocation[dept][emp.id] = true;
        allocatedEmployeeIds.add(emp.id);
      }
    }

    // Step 3: Allocate remaining employees based on objective
    const remainingEmployees = employees.filter(
      (emp) => !allocatedEmployeeIds.has(emp.id)
    );

    for (const emp of remainingEmployees) {
      let bestDept = 'A';
      let bestScore = -Infinity;

      for (const dept of ['A', 'B', 'C']) {
        // Create test allocation
        const testAllocation: Record<string, Record<string, boolean>> = {
          A: { ...allocation['A'] },
          B: { ...allocation['B'] },
          C: { ...allocation['C'] },
        };
        testAllocation[dept][emp.id] = true;

        // Convert to allocation count
        const allocationCount: Record<string, number> = {
          A: Object.keys(testAllocation['A']).length,
          B: Object.keys(testAllocation['B']).length,
          C: Object.keys(testAllocation['C']).length,
        };

        // Get employees for each department
        const deptEmployeesA = employees.filter(
          (e) => testAllocation['A'][e.id]
        );
        const deptEmployeesB = employees.filter(
          (e) => testAllocation['B'][e.id]
        );
        const deptEmployeesC = employees.filter(
          (e) => testAllocation['C'][e.id]
        );

        // Calculate results for test allocation
        const resultA = this.calculateDepartmentResult(
          deptEmployeesA,
          allocationCount['A'],
          'A',
          totalEmployeeCount
        );
        const resultB = this.calculateDepartmentResult(
          deptEmployeesB,
          allocationCount['B'],
          'B',
          totalEmployeeCount
        );
        const resultC = this.calculateDepartmentResult(
          deptEmployeesC,
          allocationCount['C'],
          'C',
          totalEmployeeCount
        );

        let score = 0;
        if (objective === 'totalRevenue') {
          score =
            resultA.finalRevenue +
            resultB.finalRevenue +
            resultC.finalRevenue;
        } else if (objective === 'departmentAProfitMaximize') {
          score = resultA.profit;
        } else if (objective === 'departmentBRevenueMaximize') {
          score = resultB.finalRevenue;
        } else if (objective === 'departmentCRevenueMaximize') {
          score = resultC.finalRevenue;
        }

        if (score > bestScore) {
          bestScore = score;
          bestDept = dept;
        }
      }

      allocation[bestDept][emp.id] = true;
    }

    // Convert allocation map to count format
    const result: Record<string, number> = {
      A: Object.keys(allocation['A']).length,
      B: Object.keys(allocation['B']).length,
      C: Object.keys(allocation['C']).length,
    };

    return result;
  }
}
