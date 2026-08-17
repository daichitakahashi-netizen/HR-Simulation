import { Injectable, signal, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SimulationEngineService } from './simulation-engine.service';
import { CsvParserService } from './csv-parser.service';
import {
  Employee,
  AllocationMap,
  AllocationResult,
} from '../models/simulation.model';

@Injectable({
  providedIn: 'root',
})
export class SimulationStoreService {
  // State signals
  readonly employees = signal<Employee[]>([]);
  readonly allocation = signal<AllocationMap>({});
  readonly simulationResult = signal<AllocationResult | null>(null);
  readonly isLoading = signal(false);
  readonly selectedObjective = signal<string>('total_revenue');
  readonly employeeCount = signal<number>(100);
  readonly reasonText = signal<string>('');
  readonly lockedEmployees = signal<Record<string, string>>({}); // employeeId -> department

  constructor(
    private httpClient: HttpClient,
    private simulationEngineService: SimulationEngineService,
    private csvParserService: CsvParserService
  ) {
    // Effect to recalculate simulation when allocation or employees change
    effect(() => {
      const employees = this.employees();
      const allocation = this.allocation();

      // Only run simulation if we have employees and allocation
      if (employees.length > 0 && Object.keys(allocation).length > 0) {
        this.runSimulation(employees, allocation);
      }
    });

    // Effect to generate reason text after simulation result changes
    effect(() => {
      const result = this.simulationResult();
      const objective = this.selectedObjective();
      if (result) {
        const reason = this.generateReasonText(result, objective);
        this.reasonText.set(reason);
      }
    });
  }

  // Load initial data from CSV
  loadInitialData(): void {
    this.isLoading.set(true);
    const count = this.employeeCount();
    const csvFile = count === 110 ? 'assets/human_resources_110.csv' : 'assets/human_resources_100.csv';

    this.httpClient.get(csvFile, {
      responseType: 'text',
    }).subscribe({
      next: (csvText) => {
        let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);

        // If requesting 110 employees but file has fewer, add mock data
        if (count === 110 && parsedEmployees.length < 110) {
          parsedEmployees = this.addMockEmployees(parsedEmployees, 110 - parsedEmployees.length);
        }

        this.employees.set(parsedEmployees);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load CSV:', error);
        // Fallback: try 100 employee file or use mock data
        this.httpClient.get('assets/human_resources_100.csv', {
          responseType: 'text',
        }).subscribe({
          next: (csvText) => {
            let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);
            if (this.employeeCount() === 110) {
              parsedEmployees = this.addMockEmployees(parsedEmployees, 110 - parsedEmployees.length);
            }
            this.employees.set(parsedEmployees);
            this.isLoading.set(false);
          },
          error: () => {
            console.error('Failed to load fallback CSV');
            this.isLoading.set(false);
          },
        });
      },
    });
  }

  // Add mock employees to reach desired count
  private addMockEmployees(employees: Employee[], count: number): Employee[] {
    const mockEmployees: Employee[] = [...employees];
    for (let i = 0; i < count; i++) {
      mockEmployees.push({
        id: `mock_${Date.now()}_${i}`,
        sales: Math.floor(Math.random() * 100),
        management: Math.floor(Math.random() * 100),
        development: Math.floor(Math.random() * 100),
        nurture: Math.floor(Math.random() * 100),
        personnelCost: Math.floor(Math.random() * 20) + 1,
      });
    }
    return mockEmployees;
  }

  // Update allocation
  updateAllocation(allocation: AllocationMap): void {
    this.allocation.set(allocation);
  }

  // Update objective and recalculate allocation
  updateObjective(objective: string): void {
    this.selectedObjective.set(objective);
    const newAllocation = this.calculateAllocationForObjective(objective, this.employeeCount());
    this.updateAllocation(newAllocation);
  }

  // Calculate allocation based on objective using heuristic rules, respecting locked employees
  private calculateAllocationForObjective(objective: string, totalEmployees: number): AllocationMap {
    const locked = this.lockedEmployees();
    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };

    // Count locked employees per department
    Object.entries(locked).forEach(([, dept]) => {
      if (lockedCounts[dept] !== undefined) {
        lockedCounts[dept]++;
      }
    });

    const baseAllocation = totalEmployees === 100
      ? { A: 40, B: 35, C: 25 }
      : { A: 44, B: 39, C: 27 };

    let targetAllocation: AllocationMap;
    switch (objective) {
      case 'total_revenue':
        targetAllocation = baseAllocation;
        break;
      case 'a_profit':
        targetAllocation = totalEmployees === 100
          ? { A: 50, B: 30, C: 20 }
          : { A: 55, B: 33, C: 22 };
        break;
      case 'b_revenue':
        targetAllocation = totalEmployees === 100
          ? { A: 35, B: 45, C: 20 }
          : { A: 38, B: 50, C: 22 };
        break;
      case 'c_revenue':
        targetAllocation = totalEmployees === 100
          ? { A: 30, B: 30, C: 40 }
          : { A: 33, B: 33, C: 44 };
        break;
      default:
        targetAllocation = baseAllocation;
    }

    // Adjust allocation to respect locked employees
    const lockedTotal = Object.values(lockedCounts).reduce((a, b) => a + b, 0);
    const remainingEmployees = totalEmployees - lockedTotal;
    const baseTotal = Object.values(baseAllocation).reduce((a, b) => a + b, 0);

    // Scale target allocation proportionally for remaining employees
    const scaledAllocation: AllocationMap = {};
    let totalScaled = 0;

    Object.entries(targetAllocation).forEach(([dept, count]) => {
      const proportion = count / baseTotal;
      const scaledCount = Math.round(proportion * remainingEmployees);
      scaledAllocation[dept] = lockedCounts[dept] + scaledCount;
      totalScaled += scaledCount;
    });

    // Adjust for rounding errors
    const diff = totalEmployees - Object.values(scaledAllocation).reduce((a, b) => a + b, 0);
    if (diff !== 0) {
      // Add/subtract from the largest department
      const largestDept = Object.entries(scaledAllocation).sort(([, a], [, b]) => b - a)[0][0];
      scaledAllocation[largestDept] += diff;
    }

    return scaledAllocation;
  }

  // Set employee count and reload data
  setEmployeeCount(count: number): void {
    this.employeeCount.set(count);
    this.loadInitialData();
  }

  // Generate reason text based on simulation result and objective
  private generateReasonText(result: AllocationResult, objective: string): string {
    const deptA = result.department['A'];
    const deptB = result.department['B'];
    const deptC = result.department['C'];

    switch (objective) {
      case 'total_revenue':
        return `全社売上を最大化するため、各事業部に均衡した人数配置を実施しました。A事業部${deptA.allocatedEmployees}名、B事業部${deptB.allocatedEmployees}名、C事業部${deptC.allocatedEmployees}名の配置により、全社売上${result.summary.totalRevenue.toFixed(1)}を達成しました。`;

      case 'a_profit':
        return `A事業部の利益最大化を優先し、営業力および管理力の高い人材をA事業部に集中配置しました。A事業部${deptA.allocatedEmployees}名配置により、当部門の利益${deptA.profit.toFixed(1)}を達成。他事業部は最低限の配置としています。`;

      case 'b_revenue':
        return `B事業部の売上最大化を目指し、営業力が高い人材をB事業部に優先配置しました。B事業部${deptB.allocatedEmployees}名の集中投下により、当部門の売上${deptB.finalRevenue.toFixed(1)}を目指しています。`;

      case 'c_revenue':
        return `新規事業であるC事業部の売上最大化のため、開拓力の高い人材をC事業部に集中させ、他事業部は最低配置人数としました。C事業部${deptC.allocatedEmployees}名配置により、当部門の成長率を最大化します。`;

      default:
        return '配置理由の詳細はここに表示されます';
    }
  }

  // Set employees directly (useful for testing)
  setEmployees(employees: Employee[]): void {
    this.employees.set(employees);
  }

  // Run simulation
  private runSimulation(
    employees: Employee[],
    allocation: AllocationMap
  ): void {
    const totalEmployees = Object.values(allocation).reduce(
      (sum, count) => sum + count,
      0
    );
    const result = this.simulationEngineService.simulate(
      employees,
      allocation,
      Math.max(totalEmployees, 100) // Use at least 100 as base
    );
    this.simulationResult.set(result);
  }

  // Toggle lock state for an employee
  toggleLock(employeeId: string, department: string): void {
    const locked = { ...this.lockedEmployees() };
    if (locked[employeeId] === department) {
      delete locked[employeeId];
    } else {
      locked[employeeId] = department;
    }
    this.lockedEmployees.set(locked);
  }

  // Get average abilities across all employees and determine strengths/weaknesses
  getAverageAbilities() {
    const emps = this.employees();
    if (emps.length === 0) {
      return {
        avgSales: 0,
        avgManagement: 0,
        avgDevelopment: 0,
        avgNurture: 0,
        overallAvg: 0,
      };
    }
    const avgSales = emps.reduce((sum, e) => sum + e.sales, 0) / emps.length;
    const avgManagement = emps.reduce((sum, e) => sum + e.management, 0) / emps.length;
    const avgDevelopment = emps.reduce((sum, e) => sum + e.development, 0) / emps.length;
    const avgNurture = emps.reduce((sum, e) => sum + e.nurture, 0) / emps.length;
    const overallAvg = (avgSales + avgManagement + avgDevelopment + avgNurture) / 4;
    return { avgSales, avgManagement, avgDevelopment, avgNurture, overallAvg };
  }

  // Get strengths and weaknesses
  getStrengthsWeaknesses() {
    const avg = this.getAverageAbilities();
    const overallAvg = avg.overallAvg;
    return {
      strengths: [
        avg.avgSales > overallAvg ? '営業力' : null,
        avg.avgManagement > overallAvg ? '管理力' : null,
        avg.avgDevelopment > overallAvg ? '開拓力' : null,
        avg.avgNurture > overallAvg ? '育成力' : null,
      ].filter((s) => s !== null) as string[],
      weaknesses: [
        avg.avgSales < overallAvg ? '営業力' : null,
        avg.avgManagement < overallAvg ? '管理力' : null,
        avg.avgDevelopment < overallAvg ? '開拓力' : null,
        avg.avgNurture < overallAvg ? '育成力' : null,
      ].filter((w) => w !== null) as string[],
    };
  }

  // Get current state as object (for debugging/testing)
  getState() {
    return {
      employees: this.employees(),
      allocation: this.allocation(),
      simulationResult: this.simulationResult(),
      isLoading: this.isLoading(),
      selectedObjective: this.selectedObjective(),
      employeeCount: this.employeeCount(),
      reasonText: this.reasonText(),
      lockedEmployees: this.lockedEmployees(),
    };
  }
}
