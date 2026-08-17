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
          const allocatedIds = this.simulationEngineService.getAllocatedEmployeeMapping(
            employees,
            objective,
            lockedEmployees
          );
          const result = this.simulationEngineService.simulateWithAllocation(
            employees,
            allocatedIds,
            totalEmployees
          );

          this.simulationResult$.next(result);
          this.simulationResult.set(result);
          this.allocation.set(result.allocation);
          this.allocatedEmployeeIds.set(allocatedIds);

          const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds);
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

  private generateReasoningText(
    result: AllocationResult,
    objective: DepartmentObjective,
    employees: Employee[],
    allocatedIds: Record<string, string[]>
  ): string {
    const deptA = result.department['A'];
    const deptB = result.department['B'];
    const deptC = result.department['C'];

    // Map objective to human-readable text
    let objectiveText = '';
    let targetDept = '';
    if (objective === 'totalRevenue') {
      objectiveText = '全社売上最大化';
    } else if (objective === 'departmentAProfitMaximize') {
      objectiveText = 'A事業部利益最大化';
      targetDept = 'A';
    } else if (objective === 'departmentBRevenueMaximize') {
      objectiveText = 'B事業部売上最大化';
      targetDept = 'B';
    } else if (objective === 'departmentCRevenueMaximize') {
      objectiveText = 'C事業部売上最大化';
      targetDept = 'C';
    }

    // Find department with highest final revenue growth
    const departments = [
      { code: 'A', name: 'A事業部', finalRevenue: deptA.finalRevenue, baseRevenue: deptA.baseRevenue },
      { code: 'B', name: 'B事業部', finalRevenue: deptB.finalRevenue, baseRevenue: deptB.baseRevenue },
      { code: 'C', name: 'C事業部', finalRevenue: deptC.finalRevenue, baseRevenue: deptC.baseRevenue },
    ];

    // Calculate growth from base for each department
    const deptGrowth = departments.map((d) => ({
      ...d,
      growth: d.finalRevenue - d.baseRevenue,
    }));

    // Determine dominant department (highest final revenue when objective is totalRevenue)
    let dominantDept = deptGrowth.reduce((prev, curr) =>
      curr.finalRevenue > prev.finalRevenue ? curr : prev
    );

    // If specific objective, that becomes dominant
    if (targetDept) {
      dominantDept = deptGrowth.find((d) => d.code === targetDept) || dominantDept;
    }

    // Identify which skills were leveraged (top allocated employees' dominant skills)
    const dominantAllocatedIds = allocatedIds[dominantDept.code];
    const allocatedEmployees = dominantAllocatedIds
      .map((id) => employees.find((e) => e.id === id))
      .filter((e) => e !== undefined) as Employee[];

    const skillScores = {
      sales: allocatedEmployees.reduce((sum, e) => sum + e.sales, 0) / Math.max(allocatedEmployees.length, 1),
      management: allocatedEmployees.reduce((sum, e) => sum + e.management, 0) / Math.max(allocatedEmployees.length, 1),
      development: allocatedEmployees.reduce((sum, e) => sum + e.development, 0) / Math.max(allocatedEmployees.length, 1),
      nurture: allocatedEmployees.reduce((sum, e) => sum + e.nurture, 0) / Math.max(allocatedEmployees.length, 1),
    };

    const dominantSkill = Object.entries(skillScores).reduce((prev, curr) =>
      curr[1] > prev[1] ? curr : prev
    );

    const skillNameMap: Record<string, string> = {
      sales: '営業力',
      management: '管理力',
      development: '開拓力',
      nurture: '育成力',
    };

    // Identify avoided penalties
    const avoidedPenalties = [];
    if (deptA.fulfillmentRate >= 0.7) {
      avoidedPenalties.push('A事業部の人員不足ペナルティ');
    }
    if (deptB.fulfillmentRate >= 0.7) {
      avoidedPenalties.push('B事業部の人員不足ペナルティ');
    }
    if (deptC.fulfillmentRate >= 0.7) {
      avoidedPenalties.push('C事業部の人員不足ペナルティ');
    }

    // Build reasoning text
    const totalRevenue = result.summary.totalRevenue.toFixed(1);
    const totalCost = result.summary.totalCost.toFixed(1);

    let reasoning = `【${objectiveText}】を実現するため、${dominantDept.name}を中心に配置しました。`;
    reasoning += `${dominantDept.name}には${skillNameMap[dominantSkill[0]]}に優れた人材を集約し、最大の売上向上効果を実現しています。`;

    if (avoidedPenalties.length > 0) {
      reasoning += `${avoidedPenalties.join('および')}を回避し、`;
    } else {
      reasoning += `各事業部の最低要員確保を成功させ、`;
    }

    reasoning += `全社コスト${totalCost}億円で売上${totalRevenue}億円を達成しました。`;

    return reasoning;
  }
}
