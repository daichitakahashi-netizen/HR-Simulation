import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, combineLatest, distinctUntilChanged, of, Observable, forkJoin, Subject, merge } from 'rxjs';
import { tap, switchMap, concatMap, map, finalize, withLatestFrom, debounceTime } from 'rxjs/operators';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SimulationEngineService } from './simulation-engine.service';
import { CsvParserService } from './csv-parser.service';
import {
  Employee,
  AllocationResult,
  DepartmentObjective,
  AllocationMap,
} from '../models/simulation.model';
import { ScenarioSummary } from '../models/scenario.model';

const ADDITIONAL_10_EMPLOYEES_STORAGE_KEY = 'uploaded_additional_10_employees';
const ADDITIONAL_FILE_NAME_STORAGE_KEY = 'uploaded_additional_file_name';

// アプリ起動（ブラウザリロード／サーバー再起動）につき一度だけ、追加10名データのSessionStorageを
// 破棄するためのモジュールスコープ・フラグ。単年・経年・データ管理のどの画面が最初に開かれても、
// 同一ページロード内で最初に呼ばれた側がクリアを実行し、以降の呼び出しは何もしない
// （SPA内遷移でユーザーが直前にアップロードした正規データを誤って消さないため）。
let hasPerformedBootSessionClear = false;
export function clearAdditionalEmployeesOnBootOnce(): void {
  if (hasPerformedBootSessionClear) return;
  hasPerformedBootSessionClear = true;
  sessionStorage.removeItem(ADDITIONAL_10_EMPLOYEES_STORAGE_KEY);
  sessionStorage.removeItem(ADDITIONAL_FILE_NAME_STORAGE_KEY);
}

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
  readonly uploadedFileName = signal<string | null>(null);
  readonly userNotes = signal<string>('');
  readonly isDirty = signal<boolean>(false);

  private worker100: Worker | null = null;
  private worker110: Worker | null = null;
  private snackBar = inject(MatSnackBar);
  private hasCalculatedResults = false;
  private isManualRecalculation = false;
  private csvDataCached = false;
  private simulationCache = new Map<string, { result100: AllocationResult; result110: AllocationResult | null; reasonText100: string; reasonText110: string }>();
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
        this.worker100 = new Worker(
          new URL('../../workers/simulation.worker', import.meta.url),
          { type: 'module' }
        );
        this.worker110 = new Worker(
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
    let previousBase100EmployeeIds: string[] = [];
    let previousObjective: DepartmentObjective | null = null;
    let previousLockedEmployees: Record<string, string> = {};

    combineLatest([
      this.employees$,
      this.currentObjective$,
      lockedEmployeesTrigger$,
      merge(of(null), this.recalculateTrigger$),
    ])
      .pipe(
        debounceTime(50),
        distinctUntilChanged((prev, curr) => {
          // Always pass through when manual recalculation is triggered
          if (this.isManualRecalculation) {
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

          // Detect whether only the additional 10 employees (101〜110) changed while the
          // standard 100-employee base data stayed identical (e.g. 追加10名CSVの登録・更新)
          const currentBase100EmployeeIds = employees.slice(0, 100).map(e => e.id).sort();
          const base100DataChanged =
            previousBase100EmployeeIds.length === 0 ||
            JSON.stringify(previousBase100EmployeeIds) !== JSON.stringify(currentBase100EmployeeIds);
          const onlyAdditionalEmployeesChanged = employeeDataChanged && !base100DataChanged;

          previousEmployeeIds = currentEmployeeIds;
          previousBase100EmployeeIds = currentBase100EmployeeIds;

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
            if (onlyAdditionalEmployeesChanged) {
              console.log('[Store] Only additional 10-employee data changed, keeping 100-employee result/cache and clearing 110-employee result/cache only');
              this.simulationResult110$.next(null);
              this.simulationCache.clear();
            } else {
              console.log('[Store] Employee data changed, resetting calculation cache and Map cache');
              this.hasCalculatedResults = false;
              this.simulationResult100$.next(null);
              this.simulationResult110$.next(null);
              this.simulationCache.clear();
            }
          }

          this.isManualRecalculation = false;
          console.log('[Store] Starting dual simulation');
          this.isLoading.set(true);

          return this.runDualSimulation(employees, objective, currentLockedEmployees, onlyAdditionalEmployeesChanged);
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
        const employees = this.employees$.value;

        // Check if 110-mode data is available
        const has110Data = result110 !== null;
        this.has110Data.set(has110Data);

        // Smart Toggle（フェイルセーフ）: データ不足時は計算をスキップし即座に100名結果を維持
        if (is110Mode && employees.length < 110 && result110 === null) {
          console.log('[Store] Switched to 110-mode but 110-employee data not available, activating failsafe');
          this.insufficientDataWarning.set('※110名用人事データ（追加10名）が読み込まれていないため、100名でのシミュレーション結果を表示しています');
          this.snackBar.open('追加10名分のデータが未ロードです', '閉じる', { duration: 5000, panelClass: ['error-snackbar'] });
          if (result100) {
            this.simulationResult.set(result100);
            this.allocation.set(result100.allocation);
          }
          this.isLoading.set(false);
          return;
        }

        // オンデマンド計算: 110名モードに切り替わり、110名結果がまだキャッシュに無い場合のみ計算を起動
        if (is110Mode && result110 === null && employees.length >= 110) {
          console.log('[Store] Switched to 110-mode, running on-demand 110-employee calculation');
          this.runOnDemand110Calculation();
          return;
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
    lockedEmployees: Record<string, string>,
    skip100Calculation: boolean = false
  ): Observable<{ result100: AllocationResult; result110: AllocationResult | null } | null> {
    const cacheKey = this.generateCacheKey(objective, lockedEmployees);
    const result100RequestId = ++this.currentRequestId;
    const result110RequestId = ++this.currentRequestId;

    if (!skip100Calculation && this.simulationCache.has(cacheKey)) {
      console.log('[Store] Cache hit! Restoring results from Map cache (0ms)');
      const cachedResults = this.simulationCache.get(cacheKey)!;
      const results = { result100: cachedResults.result100, result110: cachedResults.result110 };
      this.reasonText100.set(cachedResults.reasonText100);
      this.reasonText110.set(cachedResults.reasonText110);
      this.updateDisplayReasonText();

      return of(results).pipe(
        finalize(() => {
          console.log('[Store] Cache hit - setting isLoading to false');
          this.isLoading.set(false);
        })
      );
    }

    // Delete only the cache entry for this specific objective/locked-employee combination
    if (this.isManualRecalculation) {
      this.simulationCache.delete(cacheKey);
      console.log('[Store] Cleared cache for current condition (objective/locked-employees)');
    }

    console.log('[Store] Starting dual simulation: running 100-employee and 110-employee in parallel');
    console.log('[Store] 100-employee Request ID:', result100RequestId);
    console.log('[Store] 110-employee Request ID:', result110RequestId);

    let result100$: Observable<AllocationResult | null>;
    if (skip100Calculation && this.simulationResult100$.value) {
      console.log('[Store] Skipping 100-employee recalculation (only additional employees changed), reusing existing result');
      const existingResult100 = this.simulationResult100$.value;
      result100$ = of(existingResult100).pipe(
        tap((result100) => {
          if (result100 && !this.is110Mode()) {
            this.isLoading.set(false);
          }
        })
      );
    } else {
      result100$ = this.runSimulationWithHybridEngine(
        this.worker100,
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
    }

    let result110$: Observable<AllocationResult | null>;
    if (this.is110Mode() && employees.length >= 110) {
      console.log('[Store] 110-mode active, starting parallel 110-employee calculation...');

      result110$ = this.runSimulationWithHybridEngine(
        this.worker110,
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
        this.simulationCache.set(cacheKey, {
          result100,
          result110,
          reasonText100: this.reasonText100(),
          reasonText110: this.reasonText110(),
        });
        console.log('[Store] Results cached in Map for future use');

        // Verify 110-employee difference
        if (result110) {
          this.verifyDifference(result100, result110, objective);
        }

        return { result100, result110 };
      })
    );
  }

  private runOnDemand110Calculation(): void {
    const employees = this.employees$.value;
    if (employees.length < 110) {
      this.isLoading.set(false);
      return;
    }

    const objective = this.selectedObjective() as DepartmentObjective;
    const lockedEmployees = this.lockedEmployees();
    const cacheKey = this.generateCacheKey(objective, lockedEmployees);

    const cached = this.simulationCache.get(cacheKey);
    if (cached && cached.result110 !== null) {
      console.log('[Store] 110-employee cache hit, restoring from Map cache (0ms)');
      this.simulationResult110$.next(cached.result110);
      this.reasonText110.set(cached.reasonText110);
      this.has110Data.set(true);
      this.updateDisplayReasonText();
      this.updateDisplayState();
      this.isLoading.set(false);
      return;
    }

    console.log('[Store] Starting on-demand 110-employee calculation');
    this.isLoading.set(true);
    const requestId = ++this.currentRequestId;

    this.runSimulationWithHybridEngine(
      this.worker110,
      employees,
      objective,
      110,
      lockedEmployees,
      requestId
    ).subscribe((result110) => {
      if (result110) {
        console.log('[Store] On-demand 110-employee simulation completed.');
        this.simulationResult110$.next(result110);
        this.has110Data.set(true);

        const existingCache = this.simulationCache.get(cacheKey);
        const result100 = existingCache?.result100 ?? this.simulationResult100$.value;
        if (result100) {
          this.simulationCache.set(cacheKey, {
            result100,
            result110,
            reasonText100: existingCache?.reasonText100 ?? this.reasonText100(),
            reasonText110: this.reasonText110(),
          });
        }

        this.verifyDifference(result100 ?? result110, result110, objective);
        this.updateDisplayState();
      }
      this.isLoading.set(false);
    });
  }

  private verifyDifference(result100: AllocationResult, result110: AllocationResult, objective: DepartmentObjective): void {
    const revenueDiff = result110.summary.totalRevenue - result100.summary.totalRevenue;
    const profitDiff = result110.summary.totalProfit - result100.summary.totalProfit;
    const revenueDiffStr = revenueDiff >= 0 ? `+${revenueDiff.toFixed(2)}` : revenueDiff.toFixed(2);
    const profitDiffStr = profitDiff >= 0 ? `+${profitDiff.toFixed(2)}` : profitDiff.toFixed(2);

    const objName = this.getObjectiveJapaneseName(objective);
    console.log(
      `[Verification] 100名 vs 110名比較 (${objName}): ` +
      `売上Δ=${revenueDiffStr}億円, ` +
      `利益Δ=${profitDiffStr}億円, ` +
      `100名結果(A=${result100.allocation['A']}, B=${result100.allocation['B']}, C=${result100.allocation['C']}), ` +
      `110名結果(A=${result110.allocation['A']}, B=${result110.allocation['B']}, C=${result110.allocation['C']})`
    );

    // Verify department-level differences
    for (const dept of ['A', 'B', 'C']) {
      const d100 = result100.department[dept];
      const d110 = result110.department[dept];
      const revenueDeptDiff = d110.finalRevenue - d100.finalRevenue;
      const profitDeptDiff = d110.profit - d100.profit;
      const revenueDeptDiffStr = revenueDeptDiff >= 0 ? `+${revenueDeptDiff.toFixed(2)}` : revenueDeptDiff.toFixed(2);
      const profitDeptDiffStr = profitDeptDiff >= 0 ? `+${profitDeptDiff.toFixed(2)}` : profitDeptDiff.toFixed(2);

      console.log(
        `[Verification] 部門${dept}差分: 売上Δ=${revenueDeptDiffStr}億円, 利益Δ=${profitDeptDiffStr}億円, ` +
        `配置人数100名時=${d100.allocatedEmployees}名→110名時=${d110.allocatedEmployees}名`
      );
    }
  }

  private runSimulationWithHybridEngine(
    targetWorker: Worker | null,
    employees: Employee[],
    objective: DepartmentObjective,
    totalEmployees: number,
    lockedEmployees: Record<string, string>,
    requestId: number
  ): Observable<AllocationResult | null> {
    return new Observable((observer) => {
      const worker = targetWorker;

      if (!worker) {
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
        if (handleMessage && worker) {
          worker.removeEventListener('message', handleMessage);
        }
        if (handleError && worker) {
          worker.removeEventListener('error', handleError);
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

            const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds, totalEmployees);
            this.reasoningText$.next(reasoningText);
            if (totalEmployees === 100) {
              this.reasonText100.set(reasoningText);
            } else {
              this.reasonText110.set(reasoningText);
            }
            this.updateDisplayReasonText();
            console.log('[Store] Text generation completed');

            completed = true;
            this.hasCalculatedResults = true;
            console.log('[Store] Emitting result via observer.next()');
            observer.next(result);
            observer.complete();

            cleanup();
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

            const reasoningText = this.generateReasoningText(result, objective, employees, allocatedIds, totalEmployees);
            this.reasoningText$.next(reasoningText);
            if (totalEmployees === 100) {
              this.reasonText100.set(reasoningText);
            } else {
              this.reasonText110.set(reasoningText);
            }
            this.updateDisplayReasonText();
            console.log('[Store] Text generation completed');

            completed = true;
            this.hasCalculatedResults = true;
            console.log('[Store] Emitting result via observer.next()');
            observer.next(result);
            observer.complete();

            cleanup();
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
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);

      worker.postMessage({
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
    this.isDirty.set(false);

    // Apply pending objective change if isDirty was true
    const selectedObj = this.selectedObjective();
    this.currentObjective$.next(selectedObj as DepartmentObjective);

    this.isManualRecalculation = true;
    this.hasCalculatedResults = false;
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

    // アプリ起動時・リロード時は過去セッションの追加10名データを完全に破棄し、
    // 単年・経年の両画面で「追加10名未読み込み」状態に確実に同期させる。
    clearAdditionalEmployeesOnBootOnce();

    this.httpClient.get('/assets/human_resources_100.csv', {
      responseType: 'text',
    }).subscribe({
      next: (csvText) => {
        console.log('[Store] CSV loaded successfully');
        let parsedEmployees = this.csvParserService.parseEmployeesCsv(csvText);
        console.log('[Store] CSV parsed, employee count:', parsedEmployees.length);

        this.csvDataCached = true;
        // 初期ロード時は常に100名のみでスタートし、SessionStorageの追加10名データは読み込まない。
        // Note: isLoading state will be managed by reactive flow (setupReactiveDataFlow)
        this.uploadedFileName.set(null);
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

  // 単年側でユーザーがアップロード済みの追加10名データ（101〜110番相当）を取得する。
  // 100名+10名の結合（110名）が完了していない場合はnullを返す。
  getUploadedAdditionalEmployees(): Employee[] | null {
    const employees = this.employees$.value;
    if (employees.length !== 110) return null;
    return employees.slice(100);
  }

  uploadEmployeesCsv(parsedEmployees: Employee[], fileName?: string): void {
    const count = parsedEmployees.length;
    const currentEmployees = this.employees$.value;

    if (count === 10 && currentEmployees.length === 100) {
      const mergedEmployees = this.mergeEmployees(currentEmployees, parsedEmployees);
      this.employees$.next(mergedEmployees);
      this.saveAdditionalEmployeesToStorage(mergedEmployees.slice(100));
      if (fileName) {
        this.uploadedFileName.set(fileName);
      }
      this.snackBar.open(`社員データを結合しました（100名 + 10名 = 110名）`, '✓', { duration: 5000 });
      return;
    }

    if (count === 100 || count === 110) {
      this.employees$.next(parsedEmployees);
      this.uploadedFileName.set(null);
      if (count === 110) {
        this.saveAdditionalEmployeesToStorage(parsedEmployees.slice(100));
      } else {
        sessionStorage.removeItem(ADDITIONAL_10_EMPLOYEES_STORAGE_KEY);
      }
      this.snackBar.open(`${count}名分の社員データをアップロードしました`, '✓', { duration: 5000 });
      return;
    }

    this.snackBar.open('CSVデータは100名、110名、または追加10名分である必要があります', '閉じる', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  removeAdditionalData(): void {
    const currentEmployees = this.employees$.value;
    if (currentEmployees.length === 110) {
      const resetEmployees = currentEmployees.slice(0, 100);
      this.employees$.next(resetEmployees);
      this.uploadedFileName.set(null);
      sessionStorage.removeItem(ADDITIONAL_10_EMPLOYEES_STORAGE_KEY);
      this.simulationCache.clear();
      this.hasCalculatedResults = false;
      this.isManualRecalculation = true;
      this.recalculateTrigger$.next();
      this.snackBar.open('追加データを削除し、初期100名状態にリセットしました', '✓', { duration: 5000 });
    }
  }

  private saveAdditionalEmployeesToStorage(additionalEmployees: Employee[]): void {
    try {
      sessionStorage.setItem(ADDITIONAL_10_EMPLOYEES_STORAGE_KEY, JSON.stringify(additionalEmployees));
    } catch (error) {
      console.error('[Store] Failed to save additional 10 employees to SessionStorage:', error);
    }
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
    const cacheKey = this.generateCacheKey(obj, this.lockedEmployees());

    this.selectedObjective.set(obj);

    if (this.simulationCache.has(cacheKey)) {
      console.log('[Store] Cache hit for objective change! Restoring results...');
      const cachedResults = this.simulationCache.get(cacheKey)!;
      const { result100, result110, reasonText100, reasonText110 } = cachedResults;

      this.simulationResult100$.next(result100);
      this.simulationResult110$.next(result110);
      this.has110Data.set(result110 !== null);
      this.reasonText100.set(reasonText100);
      this.reasonText110.set(reasonText110);

      this.updateDisplayState();
      this.updateDisplayReasonText();
      this.isDirty.set(false);
      console.log('[Store] Objective changed with cached results restored');

      // 110名モード中に該当キャッシュへ110名結果が無い場合はオンデマンドで計算
      if (this.is110Mode() && result110 === null && this.employees$.value.length >= 110) {
        this.runOnDemand110Calculation();
      }
    } else {
      console.log('[Store] No cache for this objective/locked-employee combination, marking as dirty');
      this.isDirty.set(true);
    }
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

    // Signal update without triggering recalculation
    this.lockedEmployees.set(locked);
    this.isDirty.set(true);

    this.snackBar.open('ロック設定を更新しました。「再計算を実行」を押して結果を反映してください', '✓', { duration: 5000 });
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

  updateUserNotes(notes: string): void {
    this.userNotes.set(notes);
  }

  clearUserNotes(): void {
    this.userNotes.set('');
  }

  applyScenario(scenario: ScenarioSummary): void {
    // Apply the scenario's allocation result to the store's active state
    if (scenario.allocationResult) {
      this.simulationResult.set(scenario.allocationResult);
      this.allocation.set(scenario.allocationResult.allocation);
    }

    // Apply objective
    if (scenario.objective) {
      this.selectedObjective.set(scenario.objective);
      this.currentObjective$.next(scenario.objective as DepartmentObjective);
    }

    // Apply user notes
    if (scenario.userNotes) {
      this.userNotes.set(scenario.userNotes);
    }

    // Apply reasoning text
    if (scenario.decisionReason) {
      this.reasonText.set(scenario.decisionReason);
      this.reasoningText$.next(scenario.decisionReason);
    }

    // Apply allocated employee IDs
    if (scenario.allocatedEmployeeIds) {
      this.allocatedEmployeeIds.set(scenario.allocatedEmployeeIds);
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
