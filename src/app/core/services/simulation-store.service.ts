import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, combineLatest, distinctUntilChanged, of, Observable, forkJoin, Subject, merge } from 'rxjs';
import { tap, switchMap, concatMap, map, finalize, withLatestFrom } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
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
  readonly has110Data$ = new BehaviorSubject<boolean>(false);

  // Compatibility layer for signal-based components
  readonly simulationResult = signal<AllocationResult | null>(null);
  readonly baselineResult = signal<AllocationResult | null>(null);
  readonly employees = signal<Employee[]>([]);
  readonly allocation = signal<AllocationMap>({});
  readonly selectedObjective = signal<string>('totalRevenue');
  readonly reasonText = signal<string>('');
  readonly reasonText100 = signal<string>('');
  readonly reasonText110 = signal<string>('');
  readonly lockedEmployees = signal<Record<string, string>>({});
  readonly isLoading = signal<boolean>(false);
  readonly employeeCount = signal<number>(100);
  readonly allocatedEmployeeIds = signal<Record<string, string[]>>({ A: [], B: [], C: [] });
  readonly is110Mode = signal<boolean>(false);
  readonly has110Data = signal<boolean>(false);
  readonly insufficientDataWarning = signal<string>('');

  private simulationWorker: Worker | null = null;
  private snackBar = inject(MatSnackBar);
  private hasCalculatedResults = false;
  private isManualRecalculation = false;
  private csvDataCached = false;
  private simulationCache = new Map<string, { result100: AllocationResult; result110: AllocationResult | null }>();
  private currentRequestId: number = 0;
  private recalculateTrigger$ = new Subject<void>();

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
    let previousEmployeeIds: string[] = [];
    let previousObjective: DepartmentObjective | null = null;
    let previousLockedEmployees: Record<string, string> = {};

    combineLatest([
      this.employees$,
      this.currentObjective$,
      lockedEmployeesTrigger$,
      merge(of(null), this.recalculateTrigger$),
    ])
      .pipe(
        distinctUntilChanged((prev, curr) => {
          // Always pass through when recalculate trigger fires
          if (curr[3] !== undefined && curr[3] !== null) {
            return false;
          }
          return JSON.stringify(prev.slice(0, 3)) === JSON.stringify(curr.slice(0, 3));
        }),
        tap(() => {
          console.log('[Store] Employees/Objective/Locked changed or recalculate triggered');
        }),
        switchMap(([employees, objective]) => {
          console.log('[Store] Switch to simulation with', employees.length, 'employees and objective:', objective);
          this.employees.set(employees);
          this.selectedObjective.set(objective);

          if (employees.length === 0) {
            console.log('[Store] No employees, skipping simulation (initial state guard)');
            this.isLoading.set(false);
            return of(null);
          }

          // Detect if employee data has changed (new CSV load or employee list updated)
          const currentEmployeeIds = employees.map(e => e.id).sort();
          const employeeDataChanged =
            previousEmployeeIds.length === 0 ||
            JSON.stringify(previousEmployeeIds) !== JSON.stringify(currentEmployeeIds);

          previousEmployeeIds = currentEmployeeIds;

          // Detect if objective or locked employees have changed
          const currentLockedEmployees = this.lockedEmployees();
          const objectiveChanged = previousObjective !== objective;
          const lockedEmployeesChanged = JSON.stringify(previousLockedEmployees) !== JSON.stringify(currentLockedEmployees);

          previousObjective = objective;
          previousLockedEmployees = { ...currentLockedEmployees };

          // Skip auto-calculation if:
          // 1. Cache exists and NOT a manual recalculation AND
          // 2. Employee data, objective, and locked employees haven't changed
          if (this.hasCalculatedResults && !this.isManualRecalculation && !employeeDataChanged && !objectiveChanged && !lockedEmployeesChanged) {
            console.log('[Store] Cache exists and nothing changed, skipping auto-calculation');
            this.isLoading.set(false);
            // Display cached results without re-running simulation
            this.updateDisplayState();
            return of(null);
          }

          // Trigger new simulation for manual recalc or new employee data
          if (employeeDataChanged) {
            console.log('[Store] Employee data changed, resetting calculation cache and Map cache');
            this.hasCalculatedResults = false;
            this.simulationResult100$.next(null);
            this.simulationResult110$.next(null);
            this.simulationCache.clear();
          }

          this.isManualRecalculation = false;
          console.log('[Store] Starting dual simulation');
          this.isLoading.set(true);

          return this.runDualSimulation(employees, objective, currentLockedEmployees);
        }),
        tap((results) => {
          console.log('[Store] Simulation results received:', results ? 'success' : 'null');
          if (results) {
            const { result100, result110 } = results;
            this.simulationResult100$.next(result100);
            this.simulationResult110$.next(result110);
            this.has110Data.set(result110 !== null);
            this.hasCalculatedResults = true;
            this.updateDisplayState();
          }
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

        // Check if 110-mode data is available
        const has110Data = result110 !== null;
        this.has110Data.set(has110Data);

        // If switching to 110-mode and 110-mode result is not yet available, show loading state
        if (is110Mode && result110 === null) {
          console.log('[Store] Switched to 110-mode but calculation not completed, showing loading state');
          this.isLoading.set(true);
        }

        this.updateDisplayState();
      })
    ).subscribe();

    // Store the locked employees trigger for later use
    (this as any).lockedEmployeesTrigger$ = lockedEmployeesTrigger$;
  }

  private runDualSimulation(
    employees: Employee[],
    objective: DepartmentObjective,
    lockedEmployees: Record<string, string>
  ): Observable<{ result100: AllocationResult; result110: AllocationResult | null } | null> {
    const cacheKey = this.generateCacheKey(objective, lockedEmployees);
    const result100RequestId = ++this.currentRequestId;
    const result110RequestId = ++this.currentRequestId;

    if (this.simulationCache.has(cacheKey)) {
      console.log('[Store] Cache hit! Restoring results from Map cache (0ms)');
      const cachedResults = this.simulationCache.get(cacheKey)!;
      const results = { result100: cachedResults.result100, result110: cachedResults.result110 };

      return of(results).pipe(
        finalize(() => {
          console.log('[Store] Cache hit - setting isLoading to false');
          this.isLoading.set(false);
        })
      );
    }

    console.log('[Store] Starting dual simulation: running 100-employee and 110-employee in parallel');
    console.log('[Store] 100-employee Request ID:', result100RequestId);
    console.log('[Store] 110-employee Request ID:', result110RequestId);

    const result100$ = this.runSimulationWithHybridEngine(
      employees.slice(0, 100),
      objective,
      100,
      lockedEmployees,
      result100RequestId
    ).pipe(
      tap((result100) => {
        if (result100) {
          console.log('[Store] 100-employee simulation completed.');
          this.simulationResult100$.next(result100);
          // 100名モードの場合のみローディング解除
          if (!this.is110Mode()) {
            this.isLoading.set(false);
          }
          this.updateDisplayState();
        }
      })
    );

    let result110$: Observable<AllocationResult | null>;
    if (employees.length >= 110) {
      console.log('[Store] 110-employee data available, starting parallel calculation...');

      result110$ = this.runSimulationWithHybridEngine(
        employees,
        objective,
        110,
        lockedEmployees,
        result110RequestId
      ).pipe(
        tap((result110) => {
          if (result110) {
            console.log('[Store] 110-employee simulation completed.');
            this.simulationResult110$.next(result110);
            this.has110Data.set(true);
            // 110名モードの場合、ここでローディング解除
            if (this.is110Mode()) {
              this.isLoading.set(false);
            }
            this.updateDisplayState();
          }
        })
      );
    } else {
      console.log('[Store] 110-employee data not available, skipping 110-employee calculation');
      result110$ = of(null).pipe(
        tap(() => {
          console.log('[Store] 110-employee calculation skipped (no data available)');
          // 110名データがない場合でも、110名モードであればローディング解除
          if (this.is110Mode()) {
            this.isLoading.set(false);
          }
        })
      );
    }

    return forkJoin([result100$, result110$]).pipe(
      map(([result100, result110]) => {
        if (!result100) {
          console.error('[Store] 100-employee simulation failed');
          return null;
        }

        console.log('[Store] All parallel simulations completed. Caching results...');
        this.simulationCache.set(cacheKey, { result100, result110 });
        console.log('[Store] Results cached in Map for future use');

        return { result100, result110 };
      }),
      finalize(() => {
        console.log('[Store] Dual simulation finalized - setting isLoading to false');
        this.isLoading.set(false);
      })
    );
  }

  private runSimulationWithHybridEngine(
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees: Record<string, string>,
    requestId: number
  ): Observable<AllocationResult | null> {
    return new Observable((observer) => {
      if (!this.simulationWorker) {
        console.error('[Store] Web Worker not available and no fallback calculation available');
        this.snackBar.open('Web Workerが利用できません', '閉じる', { duration: 5000, panelClass: ['error-snackbar'] });
        this.isLoading.set(false);
        observer.next(null);
        observer.complete();
        return;
      }

      let completed = false;
      let handleMessage: ((event: MessageEvent) => void) | null = null;
      let handleError: ((error: ErrorEvent | any) => void) | null = null;

      const cleanup = () => {
        if (handleMessage && this.simulationWorker) {
          this.simulationWorker.removeEventListener('message', handleMessage);
        }
        if (handleError && this.simulationWorker) {
          this.simulationWorker.removeEventListener('error', handleError);
        }
        handleMessage = null;
        handleError = null;
      };

      handleMessage = (event: MessageEvent) => {
        if (completed) return;

        try {
          console.log('[Store] Received message from worker:', event.data.type || 'LEGACY', 'requestId:', event.data.requestId, 'expected:', requestId);

          const { type, data, error, stack } = event.data;

          if (type === 'ERROR') {
            if (event.data.requestId !== requestId) {
              console.log('[Store] Ignoring stale error message. Current requestId:', requestId, 'Received requestId:', event.data.requestId);
              return;
            }

            console.error('[Store] Worker reported error:', error, stack);
            this.snackBar.open(`計算エラー: ${error}`, '閉じる', { duration: 5000, panelClass: ['error-snackbar'] });
            completed = true;
            cleanup();
            this.isLoading.set(false);
            observer.next(null);
            observer.complete();
            return;
          }

          if (type === 'SUCCESS' && data) {
            if (event.data.requestId !== requestId) {
              console.log('[Store] Ignoring stale message. Current requestId:', requestId, 'Received requestId:', event.data.requestId);
              return;
            }

            console.log('[Store] Processing SUCCESS message from worker');
            const result = data as AllocationResult;

            const allocatedIds = {
              A: result.department['A'].allocatedEmployeeIds || [],
              B: result.department['B'].allocatedEmployeeIds || [],
              C: result.department['C'].allocatedEmployeeIds || [],
            };

            this.allocatedEmployeeIds.set(allocatedIds);

            completed = true;
            this.hasCalculatedResults = true;
            console.log('[Store] Emitting result via observer.next()');
            observer.next(result);
            observer.complete();

            cleanup();

            const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds, totalEmployees);
            this.reasoningText$.next(reasoningText);
            if (totalEmployees === 100) {
              this.reasonText100.set(reasoningText);
            } else {
              this.reasonText110.set(reasoningText);
            }
            this.updateDisplayReasonText();
            console.log('[Store] Text generation completed');
            return;
          }

          // Fallback: treat as AllocationResult if no type field (backward compatibility)
          const result = event.data as AllocationResult;
          if (result.allocation && result.department) {
            if (event.data.requestId !== requestId) {
              console.log('[Store] Ignoring stale LEGACY message. Current requestId:', requestId, 'Received requestId:', event.data.requestId);
              return;
            }

            console.log('[Store] Processing LEGACY message format (no type field)');
            const allocatedIds = {
              A: result.department['A'].allocatedEmployeeIds || [],
              B: result.department['B'].allocatedEmployeeIds || [],
              C: result.department['C'].allocatedEmployeeIds || [],
            };

            this.allocatedEmployeeIds.set(allocatedIds);

            completed = true;
            this.hasCalculatedResults = true;
            console.log('[Store] Emitting result via observer.next()');
            observer.next(result);
            observer.complete();

            cleanup();

            const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds, totalEmployees);
            this.reasoningText$.next(reasoningText);
            if (totalEmployees === 100) {
              this.reasonText100.set(reasoningText);
            } else {
              this.reasonText110.set(reasoningText);
            }
            this.updateDisplayReasonText();
            console.log('[Store] Text generation completed');
          }
        } catch (error) {
          console.error('[Store] Error processing worker message:', error);
          if (!completed) {
            completed = true;
            cleanup();
            observer.next(null);
            observer.complete();
          }
        }
      };

      handleError = (error: ErrorEvent | any) => {
        if (completed) return;

        console.error('[Store] Worker error event:', error);
        const errorMsg = error instanceof ErrorEvent ? error.message : (error?.message || 'Unknown worker error');
        this.snackBar.open(`Workerエラー: ${errorMsg}`, '閉じる', { duration: 5000, panelClass: ['error-snackbar'] });
        completed = true;
        cleanup();
        this.isLoading.set(false);
        observer.next(null);
        observer.complete();
      };

      console.log('[Store] Posting message to worker (totalEmployees=' + totalEmployees + ', requestId=' + requestId + ')');
      this.simulationWorker.addEventListener('message', handleMessage);
      this.simulationWorker.addEventListener('error', handleError);

      this.simulationWorker.postMessage({
        employees,
        objective,
        totalEmployees,
        lockedEmployees,
        requestId,
      });

      return () => {
        if (!completed) {
          completed = true;
          cleanup();
          this.isLoading.set(false);
        }
      };
    });
  }

  private generateCacheKey(objective: DepartmentObjective, lockedEmployees: Record<string, string>): string {
    const lockedKey = JSON.stringify(lockedEmployees);
    return `${objective}|${lockedKey}`;
  }

  private triggerRecalculation(): void {
    const employees = this.employees$.value;
    this.employees$.next([...employees]);
  }

  runSimulation(): void {
    console.log('[Store] Manual recalculation initiated');
    this.isLoading.set(true);
    this.isManualRecalculation = true;
    this.hasCalculatedResults = false;
    this.simulationCache.clear();
    console.log('[Store] Cache cleared for manual recalculation');
    this.recalculateTrigger$.next();
  }

  loadInitialData(count: number = 100): void {
    // Skip if CSV data is already cached
    if (this.csvDataCached && this.employees$.value.length > 0) {
      console.log('[Store] CSV data already cached, skipping reload');
      return;
    }

    this.isLoading.set(true);
    console.log('[Store] Loading initial CSV data');

    this.httpClient.get('/assets/human_resources_100.csv', {
      responseType: 'text',
    }).subscribe({
      next: (csvText) => {
        console.log('[Store] CSV loaded successfully');
        let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);
        console.log('[Store] CSV parsed, employee count:', parsedEmployees.length);

        this.csvDataCached = true;
        // Always load 100-employee base data; later use runDualSimulation for both 100 and 110
        // Note: isLoading state will be managed by reactive flow (setupReactiveDataFlow)
        this.employees$.next(parsedEmployees);
      },
      error: (error) => {
        console.error('[Store] Failed to load CSV:', error);
        this.snackBar.open(`CSVの読み込みに失敗しました: ${error.message || error}`, '閉じる', { duration: 5000, panelClass: ['error-snackbar'] });
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

  uploadEmployeesCsv(parsedEmployees: Employee[]): void {
    const count = parsedEmployees.length;
    const currentEmployees = this.employees$.value;

    if (count === 10 && currentEmployees.length === 100) {
      const mergedEmployees = this.mergeEmployees(currentEmployees, parsedEmployees);
      this.employees$.next(mergedEmployees);
      this.snackBar.open(`社員データを結合しました（100名 + 10名 = 110名）`, '✓', { duration: 5000 });
      return;
    }

    if (count === 100 || count === 110) {
      this.employees$.next(parsedEmployees);
      this.snackBar.open(`${count}名分の社員データをアップロードしました`, '✓', { duration: 5000 });
      return;
    }

    this.snackBar.open('CSVデータは100名、110名、または追加10名分である必要があります', '閉じる', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  private mergeEmployees(existing: Employee[], additional: Employee[]): Employee[] {
    const usedIds = new Set(existing.map(e => e.id));
    const adjustedAdditional: Employee[] = [];

    for (const emp of additional) {
      let newId = emp.id;
      let counter = 1;

      while (usedIds.has(newId)) {
        newId = `${emp.id}_${counter}`;
        counter++;
      }

      adjustedAdditional.push({
        ...emp,
        id: newId,
      });

      usedIds.add(newId);
    }

    return [...existing, ...adjustedAdditional];
  }

  updateObjective(objective: DepartmentObjective | string): void {
    const obj = objective as DepartmentObjective;
    this.currentObjective$.next(obj);
    this.selectedObjective.set(obj);
  }

  getObjectiveJapaneseName(objective: string): string {
    const mapping: Record<string, string> = {
      'totalRevenue': '全社売上最大化',
      'departmentAProfitMaximize': 'A事業部利益最大化',
      'departmentBRevenueMaximize': 'B事業部売上最大化',
      'departmentCRevenueMaximize': 'C事業部売上最大化',
    };
    return mapping[objective] || objective;
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
    const error = this.validateLockConstraint(locked);
    if (error) {
      this.snackBar.open(error, '閉じる', { duration: 5000, panelClass: ['error-snackbar'] });
      console.warn('Lock operation violates constraints:', error);
      return;
    }

    this.lockedEmployees.set(locked);

    // Trigger recalculation via locked employees change (manual recalc required)
    this.isManualRecalculation = true;
    const lockedEmployeesTrigger$ = (this as any).lockedEmployeesTrigger$;
    if (lockedEmployeesTrigger$) {
      lockedEmployeesTrigger$.next(locked);
    }

    this.snackBar.open('ロック設定を更新しました', '✓', { duration: 3000 });
  }

  private validateLockConstraint(lockedEmployees: Record<string, string>): string | null {
    const totalEmployees = this.employees().length;
    if (totalEmployees === 0) return null;

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
        const maxAllowed = totalEmployees - otherMinsSum;
        return `事業部${dept}にはこれ以上ロック設定できません（最大${maxAllowed}名まで、現在${lockedCounts[dept]}名）`;
      }
    }

    return null;
  }

  private updateDisplayState(): void {
    const result100 = this.simulationResult100$.value;
    const result110 = this.simulationResult110$.value;
    const is110Mode = this.is110Mode();

    if (is110Mode) {
      if (result110 !== null) {
        this.insufficientDataWarning.set('');
        this.simulationResult.set(result110);
        this.allocation.set(result110.allocation);
      } else {
        this.insufficientDataWarning.set('※110名用人事データ（追加10名）が読み込まれていないため、100名でのシミュレーション結果を表示しています');
        if (result100) {
          this.simulationResult.set(result100);
          this.allocation.set(result100.allocation);
        }
      }
    } else {
      this.insufficientDataWarning.set('');
      if (result100) {
        this.simulationResult.set(result100);
        this.allocation.set(result100.allocation);
      }
    }

    if (result100) {
      this.baselineResult.set(result100);
    }

    this.updateDisplayReasonText();
  }

  private updateDisplayReasonText(): void {
    const is110Mode = this.is110Mode();
    const reasonText100 = this.reasonText100();
    const reasonText110 = this.reasonText110();

    if (is110Mode) {
      this.reasonText.set(reasonText110 || reasonText100);
    } else {
      this.reasonText.set(reasonText100);
    }
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
    allocatedIds: Record<string, string[]>,
    totalEmployees: number
  ): string {
    const deptA = result.department['A'];
    const deptB = result.department['B'];
    const deptC = result.department['C'];
    const is110Mode = totalEmployees === 110;
    const baselineResult = this.simulationResult100$.value;

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
      { code: 'A', name: 'A事業部', finalRevenue: deptA.finalRevenue, baseRevenue: deptA.baseRevenue, allocatedEmp: deptA.allocatedEmployees },
      { code: 'B', name: 'B事業部', finalRevenue: deptB.finalRevenue, baseRevenue: deptB.baseRevenue, allocatedEmp: deptB.allocatedEmployees },
      { code: 'C', name: 'C事業部', finalRevenue: deptC.finalRevenue, baseRevenue: deptC.baseRevenue, allocatedEmp: deptC.allocatedEmployees },
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
    const totalRevenue = result.summary.totalRevenue.toFixed(2);
    const totalCost = result.summary.totalCost.toFixed(2);
    const totalProfit = result.summary.totalProfit.toFixed(2);

    let reasoning = `【${objectiveText}】を実現するため、${dominantDept.name}を中心に配置しました。`;
    reasoning += `${dominantDept.name}には${skillNameMap[dominantSkill[0]]}に優れた人材を集約し、最大の売上向上効果を実現しています。`;

    if (is110Mode) {
      if (baselineResult) {
        const revenueDiff = (result.summary.totalRevenue - baselineResult.summary.totalRevenue).toFixed(2);
        const profitDiff = (result.summary.totalProfit - baselineResult.summary.totalProfit).toFixed(2);
        const revenueDiffDisp = parseFloat(revenueDiff) >= 0 ? `+${revenueDiff}` : revenueDiff;
        const profitDiffDisp = parseFloat(profitDiff) >= 0 ? `+${profitDiff}` : profitDiff;

        reasoning += `追加採用の10名を${dominantDept.name}など成長性の高い部門に重点配置することで、`;
        reasoning += `売上${totalRevenue}億円（Δ${revenueDiffDisp}億円）、利益${totalProfit}億円（Δ${profitDiffDisp}億円）の向上を実現しました。`;
      } else {
        reasoning += `追加採用の10名を${dominantDept.name}など成長性の高い部門に重点配置することで、`;
        reasoning += `売上${totalRevenue}億円、利益${totalProfit}億円を達成しました。`;
      }
    } else {
      reasoning += `100名での最適配置により、全社売上${totalRevenue}億円、全社利益${totalProfit}億円を実現しました。`;
    }

    return reasoning;
  }
}
