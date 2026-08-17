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

  // Calculate allocation based on objective using heuristic rules
  private calculateAllocationForObjective(objective: string, totalEmployees: number): AllocationMap {
    const baseAllocation = totalEmployees === 100
      ? { A: 40, B: 35, C: 25 }
      : { A: 44, B: 39, C: 27 }; // Dynamic scaling for 110 employees

    switch (objective) {
      case 'total_revenue':
        // Maximize total company revenue: balance across all departments
        return baseAllocation;
      case 'a_profit':
        // Maximize A department profit: increase A, minimize others
        return totalEmployees === 100
          ? { A: 50, B: 30, C: 20 }
          : { A: 55, B: 33, C: 22 };
      case 'b_revenue':
        // Maximize B department revenue: increase B
        return totalEmployees === 100
          ? { A: 35, B: 45, C: 20 }
          : { A: 38, B: 50, C: 22 };
      case 'c_revenue':
        // Maximize C department revenue: concentrate on C with high development
        return totalEmployees === 100
          ? { A: 30, B: 30, C: 40 }
          : { A: 33, B: 33, C: 44 };
      default:
        return baseAllocation;
    }
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
    };
  }
}
