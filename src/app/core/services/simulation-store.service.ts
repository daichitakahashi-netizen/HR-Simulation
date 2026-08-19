import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, combineLatest, distinctUntilChanged, of, Observable } from 'rxjs';
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
  readonly simulationResult100$ = new BehaviorSubject<AllocationResult | null>(null);
  readonly simulationResult110$ = new BehaviorSubject<AllocationResult | null>(null);
  readonly reasoningText$ = new BehaviorSubject<string>('');

  // Compatibility layer for signal-based components
  readonly simulationResult = signal<AllocationResult | null>(null);
  readonly baselineResult = signal<AllocationResult | null>(null);
  readonly employees = signal<Employee[]>([]);
  readonly allocation = signal<AllocationMap>({});
  readonly selectedObjective = signal<string>('totalRevenue');
  readonly reasonText = signal<string>('');
  readonly lockedEmployees = signal<Record<string, string>>({});
  readonly isLoading = signal<boolean>(false);
  readonly employeeCount = signal<number>(100);
  readonly allocatedEmployeeIds = signal<Record<string, string[]>>({ A: [], B: [], C: [] });
  readonly is110Mode = signal<boolean>(false);

  private simulationWorker: Worker | null = null;

  constructor(
    private httpClient: HttpClient,
    private simulationEngineService: SimulationEngineService,
    private csvParserService: CsvParserService
  ) {
    this.initializeWorker();
    this.setupReactiveDataFlow();
  }

  private initializeWorker(): void {
    if (typeof Worker !== 'undefined') {
      try {
        this.simulationWorker = new Worker(
          new URL('../../workers/simulation.worker', import.meta.url),
          { type: 'module' }
        );
      } catch (error) {
        console.warn('Web Worker not available, falling back to main thread', error);
      }
    }
  }

  private setupReactiveDataFlow(): void {
    // Create a trigger for locked employees changes
    const lockedEmployeesTrigger$ = new BehaviorSubject<Record<string, string>>({});

    combineLatest([
      this.employees$,
      this.currentObjective$,
      lockedEmployeesTrigger$,
    ])
      .pipe(
        distinctUntilChanged((prev, curr) => {
          return JSON.stringify(prev) === JSON.stringify(curr);
        }),
        tap(() => this.isLoading.set(true)),
        switchMap(([employees, objective]) => {
          this.employees.set(employees);
          this.selectedObjective.set(objective);

          if (employees.length === 0) {
            this.isLoading.set(false);
            return of(null);
          }

          const lockedEmployees = this.lockedEmployees();

          return this.runDualSimulation(employees, objective, lockedEmployees);
        }),
        tap((results) => {
          if (results) {
            const { result100, result110 } = results;
            this.simulationResult100$.next(result100);
            this.simulationResult110$.next(result110);

            // Set displayed result based on mode
            const displayResult = this.is110Mode() ? result110 : result100;
            this.simulationResult.set(displayResult);
            this.baselineResult.set(result100);
            this.allocation.set(displayResult.allocation);
          }
          this.isLoading.set(false);
        })
      )
      .subscribe();

    // Listen to is110Mode$ changes for switching display without recalculation
    this.is110Mode$.pipe(
      distinctUntilChanged(),
      tap((is110Mode) => {
        this.is110Mode.set(is110Mode);
        const result100 = this.simulationResult100$.value;
        const result110 = this.simulationResult110$.value;
        const displayResult = is110Mode ? result110 : result100;
        if (displayResult) {
          this.simulationResult.set(displayResult);
          this.allocation.set(displayResult.allocation);
        }
      })
    ).subscribe();

    // Store the locked employees trigger for later use
    (this as any).lockedEmployeesTrigger$ = lockedEmployeesTrigger$;
  }

  private runDualSimulation(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string>
  ): Observable<{ result100: AllocationResult; result110: AllocationResult } | null> {
    return new Observable((observer) => {
      let result100: AllocationResult | null = null;
      let result110: AllocationResult | null = null;
      let completed100 = false;
      let completed110 = false;

      const checkCompletion = () => {
        if (completed100 && completed110 && result100 && result110) {
          observer.next({ result100, result110 });
          observer.complete();
        }
      };

      // Run 100-employee simulation first
      this.runSimulationWithHybridEngine(
        employees,
        objective,
        100,
        lockedEmployees
      ).subscribe({
        next: (result) => {
          if (result) {
            result100 = result;
          }
          completed100 = true;
          checkCompletion();
        },
        error: (error) => {
          console.error('Error in 100-employee simulation:', error);
          completed100 = true;
          checkCompletion();
        },
      });

      // Run 110-employee simulation with mock employees added
      const extendedEmployees = this.addMockEmployees(employees, 10);
      this.runSimulationWithHybridEngine(
        extendedEmployees,
        objective,
        110,
        lockedEmployees
      ).subscribe({
        next: (result) => {
          if (result) {
            result110 = result;
          }
          completed110 = true;
          checkCompletion();
        },
        error: (error) => {
          console.error('Error in 110-employee simulation:', error);
          completed110 = true;
          checkCompletion();
        },
      });
    });
  }

  private runSimulationWithHybridEngine(
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees: Record<string, string>
  ): Observable<AllocationResult | null> {
    return new Observable((observer) => {
      if (this.simulationWorker) {
        const handleMessage = (event: MessageEvent) => {
          try {
            const result = event.data as AllocationResult;

            const allocatedIds = {
              A: result.department['A'].allocatedEmployeeIds || [],
              B: result.department['B'].allocatedEmployeeIds || [],
              C: result.department['C'].allocatedEmployeeIds || [],
            };

            const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds);
            this.reasoningText$.next(reasoningText);
            this.reasonText.set(reasoningText);
            this.allocatedEmployeeIds.set(allocatedIds);

            this.simulationWorker!.removeEventListener('message', handleMessage);
            this.simulationWorker!.removeEventListener('error', handleError);
            observer.next(result);
            observer.complete();
          } catch (error) {
            handleError(error as ErrorEvent);
          }
        };

        const handleError = (error: ErrorEvent | any) => {
          console.error('Worker error:', error);
          this.simulationWorker!.removeEventListener('message', handleMessage);
          this.simulationWorker!.removeEventListener('error', handleError);
          observer.next(null);
          observer.complete();
        };

        this.simulationWorker.addEventListener('message', handleMessage);
        this.simulationWorker.addEventListener('error', handleError);

        this.simulationWorker.postMessage({
          employees,
          objective,
          totalEmployees,
          lockedEmployees,
        });
      } else {
        // Fallback to main thread calculation
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

        const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds);
        this.reasoningText$.next(reasoningText);
        this.reasonText.set(reasoningText);
        this.allocatedEmployeeIds.set(allocatedIds);

        observer.next(result);
        observer.complete();
      }
    });
  }

  private triggerRecalculation(): void {
    const employees = this.employees$.value;
    this.employees$.next([...employees]);
  }

  loadInitialData(count: number = 100): void {
    this.isLoading.set(true);

    this.httpClient.get('/assets/human_resources_100.csv', {
      responseType: 'text',
    }).subscribe({
      next: (csvText) => {
        let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);

        // Always load 100-employee base data; later use runDualSimulation for both 100 and 110
        this.employees$.next(parsedEmployees);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load CSV:', error);
        this.isLoading.set(false);
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

    // Validate lock constraint before applying
    if (!this.validateLockConstraint(locked)) {
      console.warn('Lock operation violates constraints and was cancelled');
      return;
    }

    this.lockedEmployees.set(locked);

    // Trigger recalculation with locked employees via employees$ trigger
    const employees = this.employees$.value;
    this.employees$.next([...employees]);
  }

  private validateLockConstraint(lockedEmployees: Record<string, string>): boolean {
    const totalEmployees = this.employees().length;
    if (totalEmployees === 0) return true;

    const minHeadcounts: Record<string, number> = {
      A: Math.ceil(30 * (totalEmployees / 100)),
      B: Math.ceil(20 * (totalEmployees / 100)),
      C: Math.ceil(10 * (totalEmployees / 100)),
    };

    const lockedCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const dept of Object.values(lockedEmployees)) {
      if (lockedCounts[dept] !== undefined) {
        lockedCounts[dept]++;
      }
    }

    // Check if locked counts exceed maximum allowed (total - other minimums)
    for (const dept of ['A', 'B', 'C']) {
      const otherMinsSum = Object.keys(minHeadcounts)
        .filter(d => d !== dept)
        .reduce((sum, d) => sum + minHeadcounts[d], 0);

      if (lockedCounts[dept] > totalEmployees - otherMinsSum) {
        console.warn(`Lock constraint violation: Department ${dept} would exceed capacity`);
        return false;
      }
    }

    return true;
  }

  getState() {
    return {
      employees: this.employees(),
      allocation: this.allocation(),
      simulationResult: this.simulationResult(),
      baselineResult: this.baselineResult(),
      isLoading: this.isLoading(),
      reasonText: this.reasonText(),
      lockedEmployees: this.lockedEmployees(),
      allocatedEmployeeIds: this.allocatedEmployeeIds(),
      is110Mode: this.is110Mode(),
    };
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
