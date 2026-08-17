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

  // Calculate cost (personnel cost * 3)
  calculateCost(personnelCosts: number[]): number {
    return personnelCosts.reduce((sum, cost) => sum + cost, 0) * 3;
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

  // Run simulation
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
}
