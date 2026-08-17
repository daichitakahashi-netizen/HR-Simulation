import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, combineLatest, distinctUntilChanged, of } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { SimulationEngineService } from './simulation-engine.service';
import { CsvParserService } from './csv-parser.service';
import {
  Employee,
  AllocationResult,
  DepartmentObjective,
  AllocationMap,
} from '../models/simulation.model';

@Injectable({
  providedIn: 'root',
})
export class SimulationStoreService {
  // State observables using BehaviorSubject
  readonly employees$ = new BehaviorSubject<Employee[]>([]);
  readonly currentObjective$ = new BehaviorSubject<DepartmentObjective>('totalRevenue');
  readonly is110Mode$ = new BehaviorSubject<boolean>(false);
  readonly simulationResult$ = new BehaviorSubject<AllocationResult | null>(null);
  readonly reasoningText$ = new BehaviorSubject<string>('');

  // Compatibility layer for signal-based components
  readonly simulationResult = signal<AllocationResult | null>(null);
  readonly employees = signal<Employee[]>([]);
  readonly allocation = signal<AllocationMap>({});
  readonly selectedObjective = signal<string>('totalRevenue');
  readonly reasonText = signal<string>('');
  readonly lockedEmployees = signal<Record<string, string>>({});
  readonly isLoading = signal<boolean>(false);
  readonly employeeCount = signal<number>(100);
  readonly allocatedEmployeeIds = signal<Record<string, string[]>>({ A: [], B: [], C: [] });

  constructor(
    private httpClient: HttpClient,
    private simulationEngineService: SimulationEngineService,
    private csvParserService: CsvParserService
  ) {
    this.setupReactiveDataFlow();
  }

  private setupReactiveDataFlow(): void {
    combineLatest([
      this.employees$,
      this.currentObjective$,
      this.is110Mode$,
    ])
      .pipe(
        distinctUntilChanged((prev, curr) => {
          return JSON.stringify(prev) === JSON.stringify(curr);
        }),
        tap(() => this.isLoading.set(true)),
        switchMap(([employees, objective, is110Mode]) => {
          this.employees.set(employees);
          this.selectedObjective.set(objective);

          if (employees.length === 0) {
            return of(null);
          }

          const totalEmployees = is110Mode ? 110 : employees.length;
          const lockedEmployees = this.lockedEmployees();
          const allocation = this.simulationEngineService.calculateOptimalAllocation(
            employees,
            objective,
            lockedEmployees
          );
          const allocatedIds = this.simulationEngineService.getAllocatedEmployeeMapping(
            employees,
            objective,
            lockedEmployees
          );
          const result = this.simulationEngineService.simulate(
            employees,
            allocation,
            totalEmployees
          );

          this.simulationResult$.next(result);
          this.simulationResult.set(result);
          this.allocation.set(allocation);
          this.allocatedEmployeeIds.set(allocatedIds);

          const reasoningText = this.generateReasoningText(result, objective);
          this.reasoningText$.next(reasoningText);
          this.reasonText.set(reasoningText);

          return of(result);
        }),
        tap(() => this.isLoading.set(false))
      )
      .subscribe();
  }

  private triggerRecalculation(): void {
    const employees = this.employees$.value;
    this.employees$.next([...employees]);
  }

  loadInitialData(count: number = 100): void {
    this.isLoading.set(true);
    const csvFile = count === 110 ? '/assets/human_resources_110.csv' : '/assets/human_resources_100.csv';

    this.httpClient.get(csvFile, {
      responseType: 'text',
    }).subscribe({
      next: (csvText) => {
        let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);

        if (count === 110 && parsedEmployees.length < 110) {
          parsedEmployees = this.addMockEmployees(parsedEmployees, 110 - parsedEmployees.length);
        }

        this.employees$.next(parsedEmployees);
        this.is110Mode$.next(count === 110);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load CSV:', error);
        this.httpClient.get('/assets/human_resources_100.csv', {
          responseType: 'text',
        }).subscribe({
          next: (csvText) => {
            let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);
            if (count === 110) {
              parsedEmployees = this.addMockEmployees(parsedEmployees, 110 - parsedEmployees.length);
            }
            this.employees$.next(parsedEmployees);
            this.is110Mode$.next(count === 110);
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

  setEmployees(employees: Employee[]): void {
    this.employees$.next(employees);
  }

  updateObjective(objective: DepartmentObjective | string): void {
    const obj = objective as DepartmentObjective;
    this.currentObjective$.next(obj);
  }

  updateAllocation(allocation: AllocationMap): void {
    this.allocation.set(allocation);
  }

  setEmployeeCount(count: number): void {
    this.employeeCount.set(count);
    this.is110Mode$.next(count === 110);
    this.loadInitialData(count);
  }

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

  toggleLock(employeeId: string, department: string): void {
    const locked = { ...this.lockedEmployees() };
    if (locked[employeeId] === department) {
      delete locked[employeeId];
    } else {
      locked[employeeId] = department;
    }
    this.lockedEmployees.set(locked);
    this.triggerRecalculation();
  }

  private generateReasoningText(result: AllocationResult, objective: DepartmentObjective): string {
    const deptA = result.department['A'];
    const deptB = result.department['B'];
    const deptC = result.department['C'];

    const departments = [
      { name: 'A事業部', profit: deptA.profit, revenue: deptA.finalRevenue },
      { name: 'B事業部', profit: deptB.profit, revenue: deptB.finalRevenue },
      { name: 'C事業部', profit: deptC.profit, revenue: deptC.finalRevenue },
    ];

    let objectiveText = '';
    let maxDeptName = 'A事業部';

    if (objective === 'totalRevenue') {
      objectiveText = '全社売上最大化';
    } else if (objective === 'departmentAProfitMaximize') {
      objectiveText = 'A事業部の利益最大化';
      maxDeptName = 'A事業部';
    } else if (objective === 'departmentBRevenueMaximize') {
      objectiveText = 'B事業部の売上最大化';
      maxDeptName = 'B事業部';
    } else if (objective === 'departmentCRevenueMaximize') {
      objectiveText = 'C事業部の売上最大化';
      maxDeptName = 'C事業部';
    }

    const totalCost = result.summary.totalCost.toFixed(1);
    const totalRevenue = result.summary.totalRevenue.toFixed(1);

    return `【${objectiveText}】を達成するため、成長率と能力値のバランスから【${maxDeptName}】へ優先的に人材を配置しました。また、各事業部の最低要員を確保しつつ、各部門の充足率を最適化することで、全社コストを【${totalCost}億円】に抑え、最終的に【${totalRevenue}億円】を実現しました。`;
  }
}
